# CardioAI – Final Year Project

## Development Point: Resource Optimization

### API · Database · Memory · Compute

---

## 1. Project Overview

**CardioAI** is a web-based clinical decision-support system for cardiac MRI analysis. A doctor uploads a cardiac MRI scan, the system runs a deep-learning segmentation model (U-Net/DuckNet architecture), and the result is an automatic assessment of the patient's **Ejection Fraction (EF)** and **disease severity** (Normal / Mild / Moderate / Severe).

### System Stack

| Layer      | Technology                         | Purpose                      |
| ---------- | ---------------------------------- | ---------------------------- |
| Backend    | Python · Flask                     | REST API server              |
| AI Model   | TensorFlow / Keras (DuckNet U-Net) | MRI segmentation             |
| Database   | SQLite                             | Users and analysis records   |
| Frontend   | Vanilla JS (no framework)          | Dashboard and sign-in UI     |
| Auth       | JWT (JSON Web Tokens)              | Stateless session management |
| Deployment | Gunicorn · Render                  | Production WSGI server       |

### API Endpoints

| Method | Route                      | Description                        |
| ------ | -------------------------- | ---------------------------------- |
| `POST` | `/login`                   | Authenticate user, return JWT      |
| `GET`  | `/api/dashboard`           | Stats + list of all analyses       |
| `POST` | `/api/analyze`             | Upload MRI, run model, save result |
| `GET`  | `/api/analysis/<id>/image` | Fetch overlay image on demand      |
| `GET`  | `/`                        | Sign-in page                       |
| `GET`  | `/dashboard`               | Dashboard page                     |

---

## 2. What "Resource Optimization" Means

Resource optimization means making the system use the minimum necessary amount of:

- **Server compute** – CPU / GPU processing time
- **Memory** – RAM used on the server and in the browser
- **Database** – number of queries, data transferred, query speed
- **Network bandwidth** – size of data sent between server and client
- **Disk I/O** – file read/write operations

A system that is not optimized still _works_, but it wastes resources, responds more slowly, and will degrade rapidly as data grows. For a clinical system where doctors are waiting for results, and where the system may run on limited cloud hardware, every unnecessary operation has a real cost.

---

## 3. Problems Found (Before Optimization)

Eight specific problems were identified by auditing every layer of the pipeline. Each is explained below with a plain-English description of why it was wasteful.

---

### Problem 1 — Dashboard sent every overlay image on every page load

**Where:** `GET /api/dashboard` backend route and `dashboard.js` frontend

**What was happening:**

Every time a doctor opened the dashboard, the server ran:

```sql
SELECT * FROM analyses ORDER BY ...
```

This fetched **every column** of every row — including the `overlay_image` column.

The `overlay_image` column stores a **Base64-encoded PNG** of the side-by-side MRI segmentation result. A single PNG overlay is approximately **65–130 KB** when encoded as Base64 text. The JavaScript then stored all of these images inside a `_lastAnalyses` array in browser memory, even though the doctor had not clicked "View" on any of them.

**The waste:**

| Records in DB | Data sent on each page load (before) | Data sent on each page load (after) |
| ------------- | ------------------------------------ | ----------------------------------- |
| 10 records    | ~1.3 MB                              | ~5 KB                               |
| 100 records   | ~13 MB                               | ~5 KB                               |
| 1,000 records | ~130 MB                              | ~5 KB                               |

**Fix applied:**

The dashboard query was changed to select only the columns needed for the table, and instead of sending the image itself, it sends a single integer flag called `has_overlay` (1 or 0):

```sql
-- BEFORE (wasteful)
SELECT * FROM analyses ORDER BY ...

-- AFTER (optimized)
SELECT analysis_id, patient_id, analysis_date, ejection_fraction,
       severity, accuracy, status,
       (overlay_image IS NOT NULL AND overlay_image != '') as has_overlay
FROM analyses ORDER BY ...
```

The image is now only fetched when the doctor actually clicks the "View" button on a specific record (see Problem 6).

---

### Problem 2 — Statistics were calculated in Python by looping all records

**Where:** `api_dashboard()` function in `app.py`

**What was happening:**

After fetching all rows from the database, the code looped through them in Python to calculate stats:

```python
# BEFORE — pulling all data into Python just to count and average
records = [dict(r) for r in rows]
n = len(records)
avg_acc = round(sum(r["accuracy"] for r in records) / n, 1) if n else 0.0
avg_ef  = round(sum(r["ejection_fraction"] for r in records) / n, 1) if n else 0.0

dist = {"Normal": 0, "Mild": 0, "Moderate": 0, "Severe": 0}
for r in records:
    if r["severity"] in dist:
        dist[r["severity"]] += 1
```

This means: load all rows from disk into memory, deserialize them, then do arithmetic that the database engine can do in a single optimized pass.

**Fix applied:**

One SQL query now computes all statistics on the database server, returning a single row of results. The database engine is specifically built for this kind of aggregation and does it far more efficiently than a Python loop:

```sql
SELECT COUNT(*) as n,
       ROUND(AVG(accuracy), 1)          as avg_acc,
       ROUND(AVG(ejection_fraction), 1) as avg_ef,
       SUM(CASE WHEN severity='Normal'   THEN 1 ELSE 0 END) as cnt_normal,
       SUM(CASE WHEN severity='Mild'     THEN 1 ELSE 0 END) as cnt_mild,
       SUM(CASE WHEN severity='Moderate' THEN 1 ELSE 0 END) as cnt_moderate,
       SUM(CASE WHEN severity='Severe'   THEN 1 ELSE 0 END) as cnt_severe
FROM analyses
```

Result: **one query, one row returned** — no Python loop needed.

---

### Problem 3 — H5 MRI files were written to disk before being read

**Where:** `_preprocess_image()` function in `app.py`

**What was happening:**

When a doctor uploaded an `.h5` file (ACDC cardiac MRI dataset format), the server was writing it as a temporary file to disk, opening it, then deleting it:

```python
# BEFORE — unnecessary disk write → read → delete cycle
import h5py, tempfile
with tempfile.NamedTemporaryFile(suffix=".h5", delete=False) as tmp:
    tmp.write(file_bytes)   # WRITE to disk
    tmp_path = tmp.name
try:
    with h5py.File(tmp_path, "r") as f:   # READ from disk
        img = f["image"][:]
finally:
    os.unlink(tmp_path)     # DELETE from disk
```

The file was already in server memory (as `file_bytes`). Writing it to disk and reading it back was completely unnecessary disk I/O — typically one of the slowest operations a computer can do.

**Fix applied:**

The `h5py` library supports reading directly from a memory buffer using Python's built-in `io.BytesIO`. No disk access required:

```python
# AFTER — pure in-memory processing
import h5py
with h5py.File(io.BytesIO(file_bytes), "r") as f:
    img = f["image"][:]
```

The `import tempfile` and `os.unlink()` calls were also removed as they were no longer needed.

---

### Problem 4 — Two separate database queries to generate new IDs

**Where:** `api_analyze()` function in `app.py`

**What was happening:**

Every time a new analysis was saved, the code made two separate trips to the database — one to find the highest Patient ID, and another to find the highest Analysis ID:

```python
# BEFORE — two separate database queries
pt_row = conn.execute(
    "SELECT MAX(CAST(SUBSTR(patient_id, 4) AS INTEGER)) "
    "FROM analyses WHERE patient_id LIKE 'PT-%'"
).fetchone()
patient_id = f"PT-{(pt_row[0] or 8830) + 1}"

ca_row = conn.execute(
    "SELECT MAX(CAST(SUBSTR(analysis_id, 4) AS INTEGER)) "
    "FROM analyses WHERE analysis_id LIKE 'CA-%'"
).fetchone()
analysis_id = f"CA-{(ca_row[0] or 2400) + 1}"
```

Each database query has overhead: the Python-to-SQLite call, query parsing, execution, and result deserialization.

**Fix applied:**

Both values are fetched in a single SQL query using subqueries, cutting the number of database round-trips in half:

```python
# AFTER — one query, both values returned together
id_row = conn.execute(
    "SELECT "
    "(SELECT MAX(CAST(SUBSTR(patient_id, 4) AS INTEGER)) "
    "  FROM analyses WHERE patient_id LIKE 'PT-%') AS max_pt, "
    "(SELECT MAX(CAST(SUBSTR(analysis_id, 4) AS INTEGER)) "
    "  FROM analyses WHERE analysis_id LIKE 'CA-%') AS max_ca"
).fetchone()
patient_id  = f"PT-{(id_row['max_pt'] or 8830) + 1}"
analysis_id = f"CA-{(id_row['max_ca'] or 2400) + 1}"
```

---

### Problem 5 — No database indexes on frequently queried columns

**Where:** `init_db()` in `app.py`

**What was happening:**

The `analyses` table had no indexes defined (apart from the primary key on `analysis_id`). Every query that filters or sorts on any other column has to perform a **full table scan** — reading every row in the table to find results.

The two most common query patterns in the application are:

1. `ORDER BY analysis_date DESC` — used on every dashboard load
2. `WHERE patient_id LIKE 'PT-%'` — used on every new analysis to generate a new ID

Without an index, both queries scan the entire table regardless of its size.

**Fix applied:**

Two indexes were added inside `init_db()` so they are created automatically on first startup:

```python
cur.execute(
    "CREATE INDEX IF NOT EXISTS idx_analyses_date "
    "ON analyses (analysis_date)"
)
cur.execute(
    "CREATE INDEX IF NOT EXISTS idx_analyses_ptid "
    "ON analyses (patient_id)"
)
```

**What an index does:** Think of a book's index at the back. Without it, you read every page to find a topic. With it, you jump directly to the right page. A database index works the same way — SQLite builds an internal sorted lookup structure so queries on `analysis_date` or `patient_id` find results instantly instead of scanning every record.

`CREATE INDEX IF NOT EXISTS` means the index is only created if it does not already exist — so re-running the server never causes an error.

---

### Problem 6 — Database connection not protected against exceptions

**Where:** `api_analyze()` function in `app.py`

**What was happening:**

The database connection was opened, used, and closed in a straight sequence:

```python
# BEFORE — if INSERT or commit raises an exception, conn.close() is never called
conn = get_db()
conn.execute("INSERT INTO ...")
conn.commit()
conn.close()   # ← only reached if no exception occurs above
```

If the `INSERT` or `commit` raised any exception, Python would jump to the `except` block, skipping `conn.close()`. SQLite connections left open are not immediately returned and can accumulate over time, especially under error conditions.

**Fix applied:**

The connection is now wrapped in a `try/finally` block. The `finally` clause is **always** executed, whether an exception occurred or not — guaranteeing the connection is always closed:

```python
# AFTER — connection always closed regardless of errors
conn = get_db()
try:
    conn.execute("INSERT INTO ...")
    conn.commit()
finally:
    conn.close()   # ← always runs, even on exception
```

The same pattern was also applied to the `api_dashboard` and `api_analysis_image` endpoints.

---

### Problem 7 — Heavy libraries imported inside request-handling functions

**Where:** `_preprocess_image()`, `_compute_ef()`, and `_render_overlay()` in `app.py`

**What was happening:**

`numpy` and `PIL (Pillow)` were imported _inside_ the function body, which means Python ran the import statement on **every single request**:

```python
# BEFORE — import executed on every call to the function
def _preprocess_image(file_bytes, ext):
    import numpy as np        # runs every time
    ...
    from PIL import Image     # runs every time

def _compute_ef(pred_mask):
    import numpy as np        # runs every time
    ...

def _render_overlay(img_array, pred_mask):
    import numpy as np        # runs every time
    from PIL import Image     # runs every time
```

Python does cache imports after the first load, so subsequent calls are fast dict lookups rather than full file loads. However, it still adds unnecessary code execution on every hot path, and makes the code harder to read.

**Fix applied:**

`numpy` and `PIL` are now imported once at module level (top of the file), resolved a single time when the server starts:

```python
# AFTER — imported once at startup
import numpy as np
from PIL import Image
```

All inline import statements for these two libraries were removed from the function bodies.

Note: `import tensorflow as tf` is intentionally kept as a deferred import inside `_load_model()` to avoid a long startup delay — TensorFlow takes several seconds to initialize. This is a deliberate trade-off, not an oversight.

---

### Problem 8 — Unused import in the module

**Where:** Top of `app.py`

**What was happening:**

`import uuid` was present at the top of the file but the `uuid` module was never used anywhere in the code. Every module import takes memory and time to load.

**Fix applied:**

The unused import was removed.

---

## 4. Complete Before vs After Summary

| #   | Problem                                    | Layer              | Before                            | After                                            |
| --- | ------------------------------------------ | ------------------ | --------------------------------- | ------------------------------------------------ |
| 1   | Overlay images in every dashboard response | API + DB + Network | All blobs sent every load         | `has_overlay` flag only; image fetched on demand |
| 2   | Stats computed in Python loop              | Compute            | N rows loaded into memory         | Single SQL aggregation query                     |
| 3   | H5 file written to disk then read          | Disk I/O           | Temp file create → read → delete  | Pure in-memory `io.BytesIO`                      |
| 4   | Two MAX() queries to generate IDs          | DB                 | 2 round-trips per analysis        | 1 round-trip (subquery)                          |
| 5   | No DB indexes                              | DB                 | Full table scan on every query    | Index-based lookup                               |
| 6   | DB connection not protected                | Memory             | Leak possible on exceptions       | `try/finally` guarantees close                   |
| 7   | numpy / PIL imported in hot functions      | Memory / Compute   | Import statement runs per request | Imported once at module startup                  |
| 8   | Unused `uuid` import                       | Memory             | Loaded and never used             | Removed                                          |

---

## 5. New Endpoint Added: On-Demand Image Loading

As part of fixing Problem 1, a new API endpoint was added:

```
GET /api/analysis/<analysis_id>/image
Authorization: Bearer <JWT>
```

**Response:**

```json
{
  "overlay_image": "<base64 encoded PNG string>"
}
```

**How it works in the frontend:**

When a doctor clicks the "View" button on any row in the dashboard table, JavaScript now makes a `fetch()` call to this endpoint for that specific record only:

```javascript
// dashboard.js — image is only fetched when the user actually asks for it
fetch("/api/analysis/" + aid + "/image", {
  headers: { Authorization: "Bearer " + token },
})
  .then(function (res) {
    return res.json();
  })
  .then(function (data) {
    if (data.overlay_image) openLightbox(data.overlay_image, aid);
  });
```

This is called **lazy loading** — resources are only loaded when they are actually needed.

---

## 6. Key Technical Concepts to Know for Presentation

### JWT (JSON Web Token) Authentication

- After login, the server generates a signed token containing the user's ID, name, email, and an expiry time (8 hours).
- Every protected API call must include this token in the `Authorization: Bearer <token>` header.
- The server verifies the token's signature using a secret key. If the token is forged, expired, or missing, access is denied (401).
- No session data is stored on the server — the token itself is the session. This is called **stateless authentication**.

### SQLite Database Design

- Two tables: `users` (authentication) and `analyses` (results).
- The `analysis_id` is the primary key, which SQLite automatically indexes.
- `overlay_image` stores the Base64-encoded PNG as a TEXT column — large, but keeps the system self-contained without a separate file storage service.
- **Parameterized queries** (`?` placeholders) are used throughout to prevent SQL injection attacks.

### The AI Model (DuckNet / U-Net)

- Architecture: an encoder-decoder convolutional neural network.
- Input: a 256×256 grayscale MRI image, normalized to the range [0, 1].
- Output: a 256×256 pixel classification map with 4 classes: Background (0), Left Ventricle cavity (1), Right Ventricle (2), Myocardium (3).
- **Ejection Fraction (EF)** is estimated from the ratio of myocardium area to LV cavity area — a proxy for cardiac function.
- Model weights are loaded **once at server startup** (`_load_model()`) and reused for every inference. Loading weights on every request would take several seconds and be completely impractical.

### Gunicorn (Production Server)

- Flask's built-in development server handles one request at a time.
- **Gunicorn** is a production WSGI server that runs multiple **worker processes** simultaneously, each handling separate requests.
- Because the AI model is loaded at startup, each worker loads its own copy of the model into memory. This is a known trade-off in Flask/Gunicorn deployments.
- The `Procfile` tells Render's cloud platform to start the app with Gunicorn: `web: gunicorn app:app`.

### Base64 Encoding of Images

- Binary image data (PNG) cannot be directly embedded in a JSON response.
- **Base64 encoding** converts binary bytes into a text string using only printable ASCII characters, making it safe to include in JSON.
- The overhead is approximately 33% (3 bytes of binary become 4 characters of text).
- For a 512×256 PNG overlay image, the Base64 string is approximately 65–130 KB.

---

## 7. Data Flow Diagram

```
Doctor (Browser)
       │
       │  POST /login  (email + password)
       ▼
   Flask Server
       │
       │  SHA-256 hash password → query users table
       │  Return JWT token (8h expiry)
       │
       ▼
Doctor (Browser) stores token in localStorage
       │
       │  GET /api/dashboard  (Bearer JWT)
       ▼
   Flask Server
       │
       │  Verify JWT → SQL aggregation query (stats)
       │  SQL SELECT (no overlay_image) → table rows
       │  Return JSON { stats, recent_analyses }
       │
       ▼
Dashboard renders — table shows "View" buttons (no images loaded yet)
       │
       │  [Doctor clicks "View" on a row]
       │  GET /api/analysis/CA-xxxx/image  (Bearer JWT)
       ▼
   Flask Server
       │
       │  SELECT overlay_image WHERE analysis_id = ?
       │  Return JSON { overlay_image: "<base64>" }
       │
       ▼
Lightbox opens with the image

       │
       │  [Doctor uploads MRI]
       │  POST /api/analyze  (multipart form, Bearer JWT)
       ▼
   Flask Server
       │
       │  Read file bytes → _preprocess_image() → (1,256,256,1) tensor
       │  _model.predict() → (1,256,256,4) probability map
       │  argmax → segmentation mask
       │  _compute_ef() → ejection fraction value
       │  _severity_from_ef() → severity label
       │  _render_overlay() → Base64 PNG
       │  Single query → new IDs
       │  INSERT into analyses
       │  Return JSON result
       │
       ▼
Dashboard auto-refreshes to show new record
```

---

## 8. Anticipated Examiner Questions and Answers

**Q: Why use SQLite instead of PostgreSQL or MySQL?**
SQLite is a file-based database with no separate server process — ideal for a self-contained prototype or single-server deployment. For a production clinical system at scale, migrating to PostgreSQL would be the natural next step. The query code is standard SQL, so the migration would be straightforward.

**Q: Why is the AI model loaded at startup instead of on each request?**
Loading the TensorFlow model and its weights from disk takes 5–15 seconds. Loading it on every request would make the system unusable. Loaded once at startup, the model stays in RAM and inference takes less than 1 second per image.

**Q: What is the purpose of the `try/finally` pattern around database connections?**
`finally` is a Python block that executes regardless of whether an exception occurred. Wrapping `conn.close()` inside `finally` ensures the database connection is always released — even if the INSERT fails, the network drops, or any other error occurs. Without this, connections can accumulate and eventually exhaust SQLite's connection limit.

**Q: What is lazy loading and why is it used for the overlay images?**
Lazy loading means only fetching a resource when it is actually needed. The overlay images are stored in the database but not included in the dashboard list response. They are only fetched when the doctor explicitly clicks "View." This prevents transferring potentially hundreds of megabytes of image data on every page load when the doctor may never look at most images.

**Q: What is an SQL index and why does it matter?**
An index is a sorted data structure (usually a B-tree) that SQLite maintains automatically alongside the table. When a query filters or sorts on an indexed column, SQLite uses the index to jump directly to the relevant rows instead of scanning the entire table. Without indexes, every query's time grows linearly with the number of records. With indexes, it grows logarithmically — a query over 1,000,000 records is only about twice as slow as over 1,000 records.

**Q: Is Base64 storage of images in a relational database good practice?**
It is acceptable for a self-contained prototype with a modest number of records. In a production system, binary files should be stored in an object store (e.g., AWS S3, Cloudflare R2) and the database should store only a URL reference. This keeps the database lean and allows the file storage layer to scale independently. For the scope of this FYP, storing in SQLite avoids the complexity of a separate storage service.

**Q: Why is `import tensorflow as tf` kept inside `_load_model()` instead of at the top of the file?**
TensorFlow takes several seconds to initialize when first imported. Keeping it as a deferred import means the Flask server starts immediately — useful for health checks and serving the sign-in page before the model is fully loaded. The startup sequence prints a confirmation message when the model is ready. `numpy` and `PIL`, which load in milliseconds, were moved to module level for clarity.

---

## 9. File Structure Reference

```
FYP_Rauf/
├── app.py                   ← Flask backend (all API logic, model, database)
├── model_weights.weights.h5 ← Trained DuckNet weights (loaded at startup)
├── requirements.txt         ← Python dependencies
├── Procfile                 ← Gunicorn startup command for deployment
├── render.yaml              ← Render.com deployment configuration
├── static/
│   ├── css/styles.css       ← All frontend styling
│   └── js/
│       ├── auth.js          ← Sign-in page logic
│       └── dashboard.js     ← Dashboard logic (analysis table, modal, charts)
└── templates/
    ├── index.html           ← Sign-in page HTML
    └── dashboard.html       ← Dashboard page HTML
```

---

## 10. Summary of Optimization Impact

The most significant change is the removal of overlay image data from the dashboard API response. This transforms the system from one that sends an amount of data proportional to the number of records, to one that sends a constant, small payload regardless of database size.

Before: `dashboard load time ∝ number of records × ~100 KB`
After: `dashboard load time ≈ constant (a few KB of text)`

The database indexes ensure that queries remain fast as records grow. The `try/finally` guards ensure the server remains stable under error conditions. The in-memory H5 processing removes disk I/O from the critical path of every MRI upload. Together, these changes make the system more responsive, more stable, and more scalable — all without changing any visible functionality for the user.
