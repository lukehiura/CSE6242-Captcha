# CSE 6242 — CAPTCHA behavioral segmentation

**Team 165** — Cho, Hiura, Kweon, Yu, Zailaa — Spring 2026

## Project summary

This repository studies mouse/touch trajectories from CAPTCHA-style mini-games: a Jupyter notebook loads a Hugging Face session dataset, engineers features, normalizes and reduces dimensionality, clusters sessions, and exports JSON for a Flask-served web UI. The default landing page is a browser game (WebAssembly); a separate route opens an interactive PCA dashboard with trajectory replay loaded from the same dataset.

## Key features

- **`notebook/CaptchaSolve.ipynb`** — End-to-end analysis: feature extraction (six trajectory metrics), z-scoring within game type, PCA, K-Means (with a composite rule for choosing **K** documented in the notebook), comparison with GMM/DBSCAN in diagnostics, figures under `figures/`, and export of `dashboard/data/*.json`.
- **Flask app (`dashboard/backend/app.py`)** — Serves static files from `dashboard/frontend/`, JSON under `/api/`, raw session ticks via `/session/<hf_index>` (loads the HF dataset on first use), and **POST `/api/classify`** (nearest cluster by Euclidean distance to centroids built from non-outlier rows in `scatter_points.json`, optional `game_type` filter).
- **Play UI (`/` → `game.html`)** — Loads `game.js` (Emscripten bundle), runs three game modes (`sheep-herding`, `thread-the-needle`, `polygon-stacking`), records input, computes four summary stats client-side, calls `/api/classify`, then links to the dashboard with query params.
- **Dashboard (`/dashboard` → `index.html`)** — D3.js: PC1 vs PC2 scatter, game-type filter panel, radar view (cluster mean vs selected point using `FEATURES` in `js/config.js`), animated trajectory from `/session/<id>`, deep-link support via `?cluster=`, `?point=`, `?game=`.

## Installation

**Requirements:** Python **≥ 3.11** (see `pyproject.toml`).

Using [uv](https://github.com/astral-sh/uv):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"   # or restart your shell

cd CSE6242-Captcha
uv sync --extra dev
```

Without uv, create a virtualenv and `pip install` the packages listed under `[project.dependencies]` in `pyproject.toml` (there is no `[build-system]` stanza, so editable `pip install -e .` is not configured).

**Optional dev tools:** `uv run ruff check .` (Ruff is in the `dev` extra).

## Usage

### 1. Refresh exported dashboard data

From the repo root (notebook path is relative to `notebook/`):

```bash
uv run python -m ipykernel install --user --name cse6242 --display-name "CSE6242 (Python 3)"
uv run jupyter notebook notebook/CaptchaSolve.ipynb
```

Run the notebook through the **export** section. It writes:

| File | Role |
|------|------|
| `dashboard/data/scatter_points.json` | Per-session `hf_index`, `pca_x` / `pca_y`, `cluster`, features, `is_outlier`, etc. |
| `dashboard/data/cluster_meta.json` | Cluster `id`, `name`, `size`, `color` for the dashboard legend |
| `dashboard/data/cluster_profiles.json` | Per-cluster feature means plus `_norm` columns (notebook export) |

The Flask route **`/api/cluster_profiles.json`** serves this file, but the current dashboard entry script **`js/dashboard.js` only fetches `scatter_points.json` and `cluster_meta.json`** — not `cluster_profiles.json`.

### 2. Run the web server

```bash
uv run python dashboard/backend/app.py
```

Default listen address: `http://0.0.0.0:5001/`.

**Port already in use** (`Address already in use` / `Port 5001 is in use`):

- See which process holds the port (no `sudo` needed for your own user): `lsof -i :5001`
- Stop it: `kill <PID>` (e.g. the `python3.x` PID shown by `lsof`)
- Or use another port without killing anything: `PORT=5002 uv run python dashboard/backend/app.py` (then open `http://127.0.0.1:5002/`)

**`.env` tip:** If you see *“There are .env files present. Install python-dotenv to use them”*, Flask is not loading `.env` automatically. Either export variables in your shell, add `python-dotenv` and load it in `app.py`, or ignore the message if you do not rely on `.env`.

| Route | Behavior |
|-------|----------|
| `/` | `game.html` (play + classify) |
| `/dashboard` | `index.html` (PCA dashboard) |
| `/health` | `{"status":"ok"}` |
| `/api/scatter_points.json` | Static JSON from data dir |
| `/api/cluster_meta.json` | Static JSON from data dir |
| `/api/cluster_profiles.json` | Static JSON from data dir |
| `POST /api/classify` | JSON body → cluster id + exemplar HF indices |
| `/session/<int:hf_index>` | Session metadata + `ticks` from HF dataset |

**Dashboard deep link** (after playing, the results page builds this automatically):

```text
http://127.0.0.1:5001/dashboard?cluster=0&point=12345&game=sheep-herding
```

**Classify API example:**

```bash
curl -s -X POST http://127.0.0.1:5001/api/classify \
  -H "Content-Type: application/json" \
  -d '{"speed_mean":1.2,"path_efficiency":0.5,"pause_rate":0.1,"duration":8.0,"game_type":"sheep-herding"}'
```

## Configuration / environment variables

| Variable | Default | Used by |
|----------|---------|---------|
| `PORT` or `DASHBOARD_PORT` | `5001` | `app.py` `__main__` |
| `FLASK_DEBUG` | off | Truthy if set to `1`, `true`, `yes`, or `on` (case-insensitive) |
| `DASHBOARD_DATA_DIR` | `dashboard/data` (resolved from `dashboard/backend/`) | JSON file paths + classify cache |
| `HF_DATASET_REPO` | `Capycap-AI/CaptchaSolve30k` | `/session/<id>` dataset load |
| `HF_DATASET_SPLITS` | `train,validation,test` | Split names passed to `load_dataset` |
| `HF_TOKEN` | unset | Hugging Face token for private or gated datasets |
| `SECRET_KEY` | dev default string | Flask `SECRET_KEY` |

**Frontend API base:** `js/config.js` uses `window.DASHBOARD_API_BASE` when set; `js/dashboard_api_base.js` is currently empty, so the UI expects the **same origin** as the Flask server.

## Folder structure

```text
CSE6242-Captcha/
├── pyproject.toml          # dependencies + Ruff config
├── uv.lock
├── main.py                 # placeholder CLI (“Hello from cse6242-captcha!”)
├── notebook/
│   └── CaptchaSolve.ipynb  # analysis, figures, JSON export
├── figures/                # plots written by the notebook (path configured in notebook)
└── dashboard/
    ├── data/               # exported JSON (may be gitignored or committed)
    ├── backend/
    │   └── app.py          # Flask application
    └── frontend/
        ├── index.html      # dashboard (served at /dashboard)
        ├── game.html       # game + classify (served at /)
        ├── game.js         # Emscripten runtime + WASM glue
        ├── css/
        └── js/             # D3 dashboard modules, shared config/state
```

## Contributing

Changes that alter export schemas (`scatter_points.json`, `cluster_meta.json`, `cluster_profiles.json`) should stay consistent with `dashboard/backend/app.py` and the frontend parsers in `dashboard/frontend/js/`. Re-run the notebook export and smoke-test `/`, `/dashboard`, `/api/classify`, and `/session/0` after substantive changes.
