"""
CardioAI – Flask Backend
POST /login          → authenticate, return JWT
GET  /api/dashboard  → dashboard stats + recent analyses (Bearer JWT)
POST /api/analyze    → run LV segmentation model on uploaded MRI (Bearer JWT)
GET  /               → sign-in page
GET  /dashboard      → dashboard page
"""

from flask import Flask, request, jsonify, render_template, Response
from flask_cors import CORS
from functools import wraps
import sqlite3
import hashlib
import datetime
import os
import re
import io
import base64
import jwt
import numpy as np
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB upload limit

_SECRET   = os.environ.get("JWT_SECRET",  "cardioai-fyp-secret-2024")
_DB_PATH  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cardioai.db")
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# ── AI Model (DuckNet / U-Net) ────────────────────────────────────────────────

_model        = None
_MODEL_LOADED = False

def _build_duck_net(input_shape=(256, 256, 1), num_classes=4):
    """Rebuild the same architecture used during training."""
    from tensorflow.keras import layers, models as km

    def conv_block(x, filters):
        x = layers.Conv2D(filters, 3, padding="same", activation="relu")(x)
        x = layers.BatchNormalization()(x)
        x = layers.Conv2D(filters, 3, padding="same", activation="relu")(x)
        x = layers.BatchNormalization()(x)
        return x

    inputs  = layers.Input(input_shape)
    c1 = conv_block(inputs, 32);  p1 = layers.MaxPooling2D((2, 2))(c1)
    c2 = conv_block(p1,     64);  p2 = layers.MaxPooling2D((2, 2))(c2)
    c3 = conv_block(p2,    128);  p3 = layers.MaxPooling2D((2, 2))(c3)
    c4 = conv_block(p3,    256)

    bn = conv_block(c4, 512)

    u4 = layers.UpSampling2D((2, 2))(bn)
    u4 = layers.Concatenate()([u4, c3]); c5 = conv_block(u4, 256)
    u3 = layers.UpSampling2D((2, 2))(c5)
    u3 = layers.Concatenate()([u3, c2]); c6 = conv_block(u3, 128)
    u2 = layers.UpSampling2D((2, 2))(c6)
    u2 = layers.Concatenate()([u2, c1]); c7 = conv_block(u2, 64)

    outputs = layers.Conv2D(num_classes, 1, activation="softmax")(c7)
    return km.Model(inputs, outputs)


def _load_model():
    global _model, _MODEL_LOADED
    weights_path = os.path.join(_BASE_DIR, "model_weights.weights.h5")
    if not os.path.exists(weights_path):
        print(f" * WARNING: weights file not found at {weights_path}")
        return
    try:
        import tensorflow as tf  # noqa – imported here to avoid slow startup penalty
        tf.get_logger().setLevel("ERROR")
        _model = _build_duck_net()
        _model.load_weights(weights_path)
        _MODEL_LOADED = True
        print(" * DuckNet model loaded successfully")
    except Exception as exc:
        print(f" * WARNING: could not load model – {exc}")


# ── Image helpers ─────────────────────────────────────────────────────────────

def _preprocess_image(file_bytes: bytes, ext: str):
    """
    Convert raw file bytes to a (1, 256, 256, 1) float32 NumPy array
    normalised to [0, 1].  Supported: .h5 (ACDC), .png, .jpg/.jpeg
    """
    if ext == ".h5":
        import h5py
        with h5py.File(io.BytesIO(file_bytes), "r") as f:
            img = f["image"][:]          # (H,W) or (slices,H,W)
        if img.ndim == 3:                # pick the middle slice
            img = img[img.shape[0] // 2]
        img = img.astype(np.float32)
    else:
        img = np.array(
            Image.open(io.BytesIO(file_bytes)).convert("L"),
            dtype=np.float32,
        )

    max_val = img.max()
    if max_val > 0:
        img = img / max_val                  # normalise → [0, 1]

    import tensorflow as tf
    tensor = tf.image.resize(img[..., np.newaxis], (256, 256)).numpy()  # (256,256,1)
    return tensor[np.newaxis, ...]           # (1, 256, 256, 1)


def _compute_ef(pred_mask) -> float:
    """
    Estimate ejection fraction from a single-slice segmentation mask.
    Class labels: 0=BG, 1=LV cavity, 2=RV, 3=Myocardium (MYO)

    The wall-to-cavity ratio (MYO area / LV area) is a proxy for EF:
    - Large LV + thin walls (DCM) → low WTCR → low EF
    - Normal LV + normal walls    → WTCR ≈ 0.7 → EF ≈ 55-60%
    - Thick walls (HCM)           → high WTCR → high EF
    """
    lv_area  = int(np.sum(pred_mask == 1))
    myo_area = int(np.sum(pred_mask == 3))
    if lv_area + myo_area < 100:            # no cardiac structure detected
        return 55.0
    wtcr = myo_area / max(lv_area, 1)
    ef   = 25.0 + wtcr * 45.0
    return round(float(np.clip(ef, 15.0, 80.0)), 1)


def _severity_from_ef(ef: float) -> str:
    if ef >= 55:
        return "Normal"
    if ef >= 40:
        return "Mild"
    if ef >= 30:
        return "Moderate"
    return "Severe"


def _render_overlay(img_array, pred_mask) -> str:
    """
    Return a base64-encoded PNG containing two side-by-side 256×256 panels:
    left = original grayscale MRI, right = MRI + coloured segmentation overlay.
    Colours: LV=red(255,80,80)  RV=blue(80,150,255)  MYO=green(80,220,80)
    """
    img_2d = img_array[0, :, :, 0]                         # (256,256) float32 [0,1]
    mn, mx = img_2d.min(), img_2d.max()
    img_u8 = ((img_2d - mn) / max(mx - mn, 1e-8) * 255).astype(np.uint8)
    orig_rgb = np.stack([img_u8] * 3, axis=-1)              # (256,256,3)

    colour_mask = np.zeros((256, 256, 3), dtype=np.uint8)
    colour_mask[pred_mask == 1] = [255,  80,  80]           # LV   – red
    colour_mask[pred_mask == 2] = [ 80, 150, 255]           # RV   – blue
    colour_mask[pred_mask == 3] = [ 80, 220,  80]           # MYO  – green

    overlay_rgb = (orig_rgb * 0.55 + colour_mask * 0.45).astype(np.uint8)

    sep = np.full((256, 4, 3), 30, dtype=np.uint8)          # dark separator
    canvas = np.concatenate([orig_rgb, sep, overlay_rgb], axis=1)

    buf = io.BytesIO()
    Image.fromarray(canvas).save(buf, format="PNG")
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


# ── Database helpers ──────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cur  = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            name     TEXT    NOT NULL,
            email    TEXT    UNIQUE NOT NULL,
            pw_hash  TEXT    NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS analyses (
            analysis_id        TEXT  PRIMARY KEY,
            user_id            INTEGER NOT NULL DEFAULT 0,
            patient_id         TEXT  NOT NULL,
            analysis_date      TEXT  NOT NULL,
            ejection_fraction  REAL  NOT NULL,
            severity           TEXT  NOT NULL,
            accuracy           REAL  NOT NULL,
            status             TEXT  NOT NULL,
            overlay_image      TEXT
        )
    """)

    # Migrate existing databases: add overlay_image column if missing
    try:
        cur.execute("ALTER TABLE analyses ADD COLUMN overlay_image TEXT")
    except sqlite3.OperationalError:
        pass  # column already exists

    # Migrate existing databases: add user_id column if missing
    try:
        cur.execute("ALTER TABLE analyses ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass  # column already exists

    # Indexes for efficient sorting and ID-generation queries
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_analyses_date "
        "ON analyses (analysis_date)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_analyses_ptid "
        "ON analyses (patient_id)"
    )

    # Seed demo user  (password: Demo@1234)
    ph = hashlib.sha256("Demo@1234".encode()).hexdigest()
    try:
        cur.execute(
            "INSERT INTO users (name, email, pw_hash) VALUES (?, ?, ?)",
            ("Dr. A. Rahman", "demo@cardioai.com", ph),
        )
    except sqlite3.IntegrityError:
        pass

    # Look up demo user id for seeding
    demo_user = cur.execute(
        "SELECT id FROM users WHERE email = ?", ("demo@cardioai.com",)
    ).fetchone()
    demo_uid = demo_user["id"] if demo_user else 0

    # Seed demo analyses (linked to demo user)
    seed = [
        ("CA-2401", demo_uid, "PT-8821", "2024-01-08", 58.4, "Normal",   95.2, "Completed"),
        ("CA-2402", demo_uid, "PT-8822", "2024-01-09", 44.1, "Mild",     91.7, "Completed"),
        ("CA-2403", demo_uid, "PT-8823", "2024-01-10", 36.8, "Moderate", 88.4, "Completed"),
        ("CA-2404", demo_uid, "PT-8824", "2024-01-11", 27.3, "Severe",   90.1, "Completed"),
        ("CA-2405", demo_uid, "PT-8825", "2024-01-12", 62.0, "Normal",   96.5, "Completed"),
        ("CA-2406", demo_uid, "PT-8826", "2024-01-13", 47.5, "Mild",     92.3, "Processing"),
        ("CA-2407", demo_uid, "PT-8827", "2024-01-14", 38.2, "Moderate", 87.9, "Completed"),
        ("CA-2408", demo_uid, "PT-8828", "2024-01-15", 55.9, "Normal",   94.8, "Completed"),
        ("CA-2409", demo_uid, "PT-8829", "2024-01-16", 31.4, "Severe",   89.2, "Completed"),
        ("CA-2410", demo_uid, "PT-8830", "2024-01-17", 60.7, "Normal",   95.9, "Completed"),
    ]
    for row in seed:
        try:
            cur.execute(
                "INSERT INTO analyses "
                "(analysis_id, user_id, patient_id, analysis_date, ejection_fraction,"
                " severity, accuracy, status) VALUES (?,?,?,?,?,?,?,?)",
                row,
            )
        except sqlite3.IntegrityError:
            pass

    # Backfill any orphaned rows (user_id=0) — reassign to the demo user
    # so existing databases are transparently migrated
    if demo_uid:
        cur.execute(
            "UPDATE analyses SET user_id = ? WHERE user_id = 0",
            (demo_uid,)
        )

    conn.commit()
    conn.close()


# ── Auth decorator ────────────────────────────────────────────────────────────

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid token."}), 401
        raw = auth_header[7:]
        try:
            payload = jwt.decode(raw, _SECRET, algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token has expired. Please sign in again."}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token."}), 401
        request.current_user = payload
        return f(*args, **kwargs)
    return decorated


# ── Page routes ───────────────────────────────────────────────────────────────

@app.route("/")
def sign_in_page():
    return render_template("index.html")


@app.route("/dashboard")
def dashboard_page():
    return render_template("dashboard.html")


# ── API routes ────────────────────────────────────────────────────────────────

@app.route("/login", methods=["POST"])
def login():
    body     = request.get_json(force=True, silent=True) or {}
    email    = (body.get("email") or "").strip().lower()
    password = (body.get("password") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    ph   = hashlib.sha256(password.encode()).hexdigest()
    conn = get_db()
    user = conn.execute(
        "SELECT * FROM users WHERE email = ? AND pw_hash = ?", (email, ph)
    ).fetchone()
    conn.close()

    if user is None:
        return jsonify({"error": "Invalid email or password."}), 401

    exp   = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    token = jwt.encode(
        {"uid": user["id"], "email": user["email"], "name": user["name"], "exp": exp},
        _SECRET,
        algorithm="HS256",
    )
    return jsonify({"token": token, "name": user["name"]})


@app.route("/signup", methods=["POST"])
def signup():
    body     = request.get_json(force=True, silent=True) or {}
    name     = (body.get("name") or "").strip()
    email    = (body.get("email") or "").strip().lower()
    password = (body.get("password") or "").strip()

    if not name:
        return jsonify({"error": "Full name is required."}), 400
    if not email:
        return jsonify({"error": "Email address is required."}), 400
    if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
        return jsonify({"error": "Please enter a valid email address."}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters long."}), 400
    if not re.search(r'[A-Za-z]', password):
        return jsonify({"error": "Password must contain at least one letter."}), 400
    if not re.search(r'[0-9]', password):
        return jsonify({"error": "Password must contain at least one number."}), 400

    ph   = hashlib.sha256(password.encode()).hexdigest()
    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT id FROM users WHERE email = ?", (email,)
        ).fetchone()
        if existing:
            return jsonify({"error": "An account with this email already exists."}), 409
        conn.execute(
            "INSERT INTO users (name, email, pw_hash) VALUES (?, ?, ?)",
            (name, email, ph),
        )
        conn.commit()
        user_id = conn.execute(
            "SELECT id FROM users WHERE email = ?", (email,)
        ).fetchone()["id"]
    finally:
        conn.close()

    exp   = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    token = jwt.encode(
        {"uid": user_id, "email": email, "name": name, "exp": exp},
        _SECRET,
        algorithm="HS256",
    )
    return jsonify({"token": token, "name": name}), 201


@app.route("/api/dashboard")
@token_required
def api_dashboard():
    uid = request.current_user["uid"]
    conn = get_db()
    try:
        # Compute stats in SQL — scoped to the current user
        stats_row = conn.execute("""
            SELECT COUNT(*) as n,
                   ROUND(AVG(accuracy), 1)          as avg_acc,
                   ROUND(AVG(ejection_fraction), 1) as avg_ef,
                   SUM(CASE WHEN severity='Normal'   THEN 1 ELSE 0 END) as cnt_normal,
                   SUM(CASE WHEN severity='Mild'     THEN 1 ELSE 0 END) as cnt_mild,
                   SUM(CASE WHEN severity='Moderate' THEN 1 ELSE 0 END) as cnt_moderate,
                   SUM(CASE WHEN severity='Severe'   THEN 1 ELSE 0 END) as cnt_severe
            FROM analyses WHERE user_id = ?
        """, (uid,)).fetchone()

        # Exclude overlay_image from the list response — send a has_overlay flag
        # instead so the client can request the image on demand via /api/analysis/<id>/image
        rows = conn.execute(
            "SELECT analysis_id, patient_id, analysis_date, ejection_fraction, "
            "severity, accuracy, status, "
            "(overlay_image IS NOT NULL AND overlay_image != '') as has_overlay "
            "FROM analyses WHERE user_id = ? ORDER BY analysis_date DESC, "
            "CAST(SUBSTR(analysis_id, 4) AS INTEGER) DESC",
            (uid,)
        ).fetchall()
    finally:
        conn.close()

    n = stats_row["n"] or 0
    return jsonify({
        "stats": {
            "total_analyses":        n,
            "average_accuracy":      stats_row["avg_acc"] or 0.0,
            "average_ef":            stats_row["avg_ef"]  or 0.0,
            "severity_distribution": {
                "Normal":   stats_row["cnt_normal"]   or 0,
                "Mild":     stats_row["cnt_mild"]     or 0,
                "Moderate": stats_row["cnt_moderate"] or 0,
                "Severe":   stats_row["cnt_severe"]   or 0,
            },
        },
        "recent_analyses": [dict(r) for r in rows],
    })


@app.route("/api/analysis/<aid>/image")
@token_required
def api_analysis_image(aid):
    """Return the segmentation overlay for a single analysis on demand."""
    uid = request.current_user["uid"]
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT overlay_image FROM analyses WHERE analysis_id = ? AND user_id = ?",
            (aid, uid)
        ).fetchone()
    finally:
        conn.close()
    if not row or not row["overlay_image"]:
        return jsonify({"error": "Image not found."}), 404
    return jsonify({"overlay_image": row["overlay_image"]})


@app.route("/api/analyze", methods=["POST"])
@token_required
def api_analyze():
    """
    Accepts multipart/form-data:
      patient_id  – text field
      mri_file    – file (.h5 | .png | .jpg | .jpeg)

    Returns JSON with segmentation results + base64 overlay image.
    """
    if not _MODEL_LOADED:
        return jsonify({"error": "AI model is not available. Check server logs."}), 503

    mri_file = request.files.get("mri_file")
    if not mri_file or mri_file.filename == "":
        return jsonify({"error": "MRI file is required."}), 400

    filename = mri_file.filename.lower()
    if filename.endswith(".h5"):
        ext = ".h5"
    elif filename.endswith((".png", ".jpg", ".jpeg")):
        ext = os.path.splitext(filename)[1]
    else:
        return jsonify({"error": "Unsupported format. Upload .h5, .png, or .jpg."}), 400

    patient_id = (request.form.get("patient_id") or "").strip()
    if not patient_id:
        return jsonify({"error": "Patient ID is required."}), 400
    if len(patient_id) > 50:
        return jsonify({"error": "Patient ID must be 50 characters or fewer."}), 400

    try:
        import numpy as np
        file_bytes = mri_file.read()
        img_input  = _preprocess_image(file_bytes, ext)          # (1,256,256,1)

        probs      = _model.predict(img_input, verbose=0)        # (1,256,256,4)
        pred_mask  = np.argmax(probs[0], axis=-1)                # (256,256)

        # Mean max-probability as model confidence
        confidence = float(np.mean(np.max(probs[0], axis=-1))) * 100

        ef       = _compute_ef(pred_mask)
        severity = _severity_from_ef(ef)

        overlay_b64 = _render_overlay(img_input, pred_mask)

        uid = request.current_user["uid"]
        conn = get_db()
        try:
            id_row = conn.execute(
                "SELECT MAX(CAST(SUBSTR(analysis_id, 4) AS INTEGER)) AS max_ca "
                "FROM analyses WHERE analysis_id LIKE 'CA-%'"
            ).fetchone()
            analysis_id = f"CA-{(id_row['max_ca'] or 2400) + 1}"
            today       = datetime.date.today().isoformat()

            conn.execute(
                "INSERT INTO analyses "
                "(analysis_id, user_id, patient_id, analysis_date, ejection_fraction,"
                " severity, accuracy, status, overlay_image) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (analysis_id, uid, patient_id, today,
                 ef, severity, round(confidence, 1), "Completed", overlay_b64),
            )
            conn.commit()
        finally:
            conn.close()

        return jsonify({
            "analysis_id":       analysis_id,
            "patient_id":        patient_id,
            "analysis_date":     today,
            "ejection_fraction": ef,
            "severity":          severity,
            "accuracy":          round(confidence, 1),
            "status":            "Completed",
            "overlay_image":     overlay_b64,
            "lv_pixels":         int(np.sum(pred_mask == 1)),
            "rv_pixels":         int(np.sum(pred_mask == 2)),
            "myo_pixels":        int(np.sum(pred_mask == 3)),
        })

    except Exception as exc:
        return jsonify({"error": f"Analysis failed: {str(exc)}"}), 500


# ── Analyses list (searchable / filterable) ──────────────────────────────────

@app.route("/api/analyses")
@token_required
def api_analyses_list():
    uid      = request.current_user["uid"]
    q        = request.args.get("q", "").strip()
    severity = request.args.get("severity", "").strip()

    where  = ["user_id = ?"]
    params = [uid]
    if q:
        where.append("(patient_id LIKE ? OR analysis_id LIKE ?)")
        params += [f"%{q}%", f"%{q}%"]
    if severity:
        where.append("severity = ?")
        params.append(severity)

    sql = (
        "SELECT analysis_id, patient_id, analysis_date, ejection_fraction, "
        "severity, accuracy, status, "
        "(overlay_image IS NOT NULL AND overlay_image != '') as has_overlay "
        f"FROM analyses WHERE {' AND '.join(where)} "
        "ORDER BY analysis_date DESC, CAST(SUBSTR(analysis_id, 4) AS INTEGER) DESC"
    )
    conn = get_db()
    try:
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    return jsonify({"analyses": [dict(r) for r in rows]})


# ── Patients list ─────────────────────────────────────────────────────────────

@app.route("/api/patients")
@token_required
def api_patients():
    uid  = request.current_user["uid"]
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT
                a1.patient_id,
                COUNT(*) AS total_analyses,
                MAX(a1.analysis_date) AS last_analysis_date,
                (SELECT ejection_fraction FROM analyses a2
                  WHERE a2.patient_id = a1.patient_id AND a2.user_id = a1.user_id
                  ORDER BY a2.analysis_date DESC,
                           CAST(SUBSTR(a2.analysis_id, 4) AS INTEGER) DESC
                  LIMIT 1) AS last_ef,
                (SELECT severity FROM analyses a2
                  WHERE a2.patient_id = a1.patient_id AND a2.user_id = a1.user_id
                  ORDER BY a2.analysis_date DESC,
                           CAST(SUBSTR(a2.analysis_id, 4) AS INTEGER) DESC
                  LIMIT 1) AS last_severity
            FROM analyses a1
            WHERE user_id = ?
            GROUP BY a1.patient_id
            ORDER BY last_analysis_date DESC, a1.patient_id DESC
        """, (uid,)).fetchall()
    finally:
        conn.close()
    return jsonify({"patients": [dict(r) for r in rows]})


# ── Analyses for a specific patient ──────────────────────────────────────────

@app.route("/api/patients/<pid>/analyses")
@token_required
def api_patient_analyses(pid):
    uid  = request.current_user["uid"]
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT analysis_id, patient_id, analysis_date, ejection_fraction, "
            "severity, accuracy, status, "
            "(overlay_image IS NOT NULL AND overlay_image != '') as has_overlay "
            "FROM analyses WHERE user_id = ? AND patient_id = ? "
            "ORDER BY analysis_date DESC, CAST(SUBSTR(analysis_id, 4) AS INTEGER) DESC",
            (uid, pid)
        ).fetchall()
    finally:
        conn.close()
    return jsonify({"analyses": [dict(r) for r in rows]})


# ── Settings: update profile ──────────────────────────────────────────────────

@app.route("/api/settings/profile", methods=["POST"])
@token_required
def api_settings_profile():
    uid  = request.current_user["uid"]
    body = request.get_json(force=True, silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Full name is required."}), 400
    if len(name) < 2 or len(name) > 50:
        return jsonify({"error": "Name must be between 2 and 50 characters long."}), 400
    if not re.match(r"^[a-zA-Z\s\-'.,]{2,50}$", name):
        return jsonify({"error": "Name contains invalid characters. Only letters, spaces, hyphens, apostrophes, and periods are allowed."}), 400
    conn = get_db()
    try:
        conn.execute("UPDATE users SET name = ? WHERE id = ?", (name, uid))
        conn.commit()
    finally:
        conn.close()
    return jsonify({"success": True, "name": name})


# ── Settings: change password ─────────────────────────────────────────────────

@app.route("/api/settings/password", methods=["POST"])
@token_required
def api_settings_password():
    uid        = request.current_user["uid"]
    body       = request.get_json(force=True, silent=True) or {}
    current_pw = (body.get("current_password") or "").strip()
    new_pw     = (body.get("new_password")      or "").strip()
    if not current_pw or not new_pw:
        return jsonify({"error": "Both current and new password are required."}), 400
    if len(new_pw) < 8:
        return jsonify({"error": "New password must be at least 8 characters."}), 400
    if not re.search(r'[A-Za-z]', new_pw):
        return jsonify({"error": "New password must contain at least one letter."}), 400
    if not re.search(r'[0-9]', new_pw):
        return jsonify({"error": "New password must contain at least one number."}), 400
    current_hash = hashlib.sha256(current_pw.encode()).hexdigest()
    conn = get_db()
    try:
        user = conn.execute(
            "SELECT id FROM users WHERE id = ? AND pw_hash = ?",
            (uid, current_hash)
        ).fetchone()
        if not user:
            return jsonify({"error": "Current password is incorrect."}), 400
        new_hash = hashlib.sha256(new_pw.encode()).hexdigest()
        conn.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (new_hash, uid))
        conn.commit()
    finally:
        conn.close()
    return jsonify({"success": True})


# ── Export: CSV download ──────────────────────────────────────────────────────

@app.route("/api/export/csv")
@token_required
def api_export_csv():
    import csv as _csv
    uid  = request.current_user["uid"]
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT analysis_id, patient_id, analysis_date, ejection_fraction, "
            "severity, accuracy, status FROM analyses WHERE user_id = ? "
            "ORDER BY analysis_date DESC, CAST(SUBSTR(analysis_id, 4) AS INTEGER) DESC",
            (uid,)
        ).fetchall()
    finally:
        conn.close()
    buf = io.StringIO()
    writer = _csv.writer(buf)
    writer.writerow(["Analysis ID", "Patient ID", "Date",
                     "Ejection Fraction (%)", "Severity",
                     "Model Confidence (%)", "Status"])
    for r in rows:
        writer.writerow([r["analysis_id"], r["patient_id"], r["analysis_date"],
                         r["ejection_fraction"], r["severity"],
                         r["accuracy"], r["status"]])
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=cardioai_analyses.csv"}
    )


# ── Startup ───────────────────────────────────────────────────────────────────
# Run init regardless of how Flask is started (python app.py or flask run)
init_db()
_load_model()

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    debug = os.environ.get("FLASK_ENV") == "development"
    print(f" * CardioAI backend → http://127.0.0.1:{port}")
    print(" * Demo credentials → demo@cardioai.com / Demo@1234")
    app.run(debug=debug, host="127.0.0.1", port=port)
