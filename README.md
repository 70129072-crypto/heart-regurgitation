# CardioAI — Full-Stack Application

Left Ventricle Segmentation & Classification Dashboard + Sign-In page,  
backed by a **Flask + SQLite + JWT** Python API.

---

## Project Structure

```
FYP_Rauf/
├── app.py                  ← Flask backend (routes, auth, API)
├── requirements.txt        ← Python dependencies
├── cardioai.db             ← SQLite database (auto-created on first run)
├── templates/
│   ├── index.html          ← CardioAI Sign-In page
│   └── dashboard.html      ← LV Segmentation Dashboard
└── static/
    ├── css/
    │   └── styles.css      ← All page styles (sign-in + dashboard)
    └── js/
        ├── auth.js         ← Sign-in form logic
        └── dashboard.js    ← Dashboard data fetch & render
```

---

## Quick Start

### 1 — Install dependencies

```bash
cd FYP_Rauf
pip install -r requirements.txt
```

### 2 — Run the server

```bash
python app.py
```

You should see:

```
 * CardioAI backend → http://127.0.0.1:5000
 * Demo credentials → demo@cardioai.com / Demo@1234
```

### 3 — Open in browser

Navigate to **http://127.0.0.1:5000**

---

## Demo Credentials

| Field    | Value               |
| -------- | ------------------- |
| Email    | `demo@cardioai.com` |
| Password | `Demo@1234`         |

---

## API Reference

### `POST /login`

Authenticate a user and receive a JWT.

**Request body (JSON)**

```json
{ "email": "demo@cardioai.com", "password": "Demo@1234" }
```

**Success (200)**

```json
{ "token": "<jwt>", "name": "Dr. A. Rahman" }
```

**Failure (401)**

```json
{ "error": "Invalid email or password." }
```

---

### `GET /api/dashboard`

Returns stats and recent analyses. Requires `Authorization: Bearer <token>` header.

**Success (200)**

```json
{
  "stats": {
    "total_analyses": 10,
    "average_accuracy": 92.2,
    "average_ef": 46.3,
    "severity_distribution": {
      "Normal": 4,
      "Mild": 2,
      "Moderate": 2,
      "Severe": 2
    }
  },
  "recent_analyses": [
    {
      "analysis_id": "CA-2401",
      "patient_id": "PT-8821",
      "analysis_date": "2024-01-08",
      "ejection_fraction": 58.4,
      "severity": "Normal",
      "accuracy": 95.2,
      "status": "Completed"
    }
  ]
}
```

---

## Technology Stack

| Layer    | Technology                             |
| -------- | -------------------------------------- |
| Frontend | HTML5 · CSS3 · Vanilla JS (ES5 compat) |
| Fonts    | Inter (Google Fonts)                   |
| Icons    | Font Awesome 6 Free CDN                |
| Backend  | Python 3 · Flask 3                     |
| Auth     | PyJWT (HS256, 8 h TTL)                 |
| Database | SQLite (via stdlib `sqlite3`)          |
| CORS     | Flask-Cors                             |

---

## Notes

- The SQLite database (`cardioai.db`) is created and seeded automatically on first run.
- The JWT secret defaults to a hard-coded dev value. Set the `JWT_SECRET` environment  
  variable before deploying to production.
- Passwords are stored as SHA-256 hashes. Use bcrypt for a production deployment.
