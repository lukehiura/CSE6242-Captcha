# CSE 6242 — CAPTCHA behavioral segmentation

**Team 165** — Cho, Hiura, Kweon, Yu, Zailaa — Spring 2026

## Project summary

This repository studies mouse/touch trajectories from CAPTCHA-style mini-games: a Jupyter notebook loads a Hugging Face session dataset, engineers features, normalizes and reduces dimensionality, clusters sessions, and exports JSON for a Flask-served web UI. The default landing page is a browser game (WebAssembly); a separate route opens an interactive PCA dashboard with trajectory replay loaded from the same dataset.

## Key features

- **`notebook/CaptchaSolve.ipynb`** — End-to-end analysis: feature extraction (six trajectory metrics), z-scoring within game type, PCA, K-Means, Random Forest classifier (97% accuracy, macro F1 0.97), figures under `figures/`, and export of `dashboard/data/*.json` + `model.pkl`.
- **Flask app (`dashboard/backend/app.py`)** — Serves static files from `dashboard/frontend/`, JSON under `/api/`, raw session ticks via `/session/<hf_index>`, and **POST `/api/classify`**. With `dashboard/data/model.pkl` (committed in this repo), the server always runs the full RF pipeline (downsample → feature extraction → z-score → RF predict → PCA projection → anomaly percentile).
- **Play UI (`/` → `game.html`)** — Loads `game.js` (Emscripten bundle), runs three game modes (`sheep-herding`, `thread-the-needle`, `polygon-stacking`), records raw ticks, sends them to `/api/classify` for RF classification, then links to the dashboard with query params.
- **Dashboard (`/dashboard` → `index.html`)** — D3.js: PC1 vs PC2 scatter, game-type filter panel, radar on six raw kinematic features (same set as clustering; see `js/config.js`), colors from `cluster_meta.json`, animated trajectory from `/session/<id>`, deep-link support via `?cluster=`, `?point=`, `?game=`.

## Installation

**Requirements:** Python **≥ 3.11** (see `pyproject.toml`).

Using [uv](https://github.com/astral-sh/uv):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"   # or restart your shell

cd CSE6242-Captcha
uv sync --extra dev
```

**Clean reinstall (new machine or “start over”):** from the repo root run `./scripts/fresh_setup.sh`. That deletes local `.venv`, caches, Jupyter checkpoints, and any `team*final.zip`, then runs `uv sync`. Your `.env` is kept unless you run `FRESH_RESET_ENV=1 ./scripts/fresh_setup.sh`, which backs up `.env` and copies from `.env.example`.

Without uv, create a virtualenv and `pip install` the packages listed under `[project.dependencies]` in `pyproject.toml` (there is no `[build-system]` stanza, so editable `pip install -e .` is not configured).

**Optional dev tools:** `uv run ruff check .` (Ruff is in the `dev` extra).

## Usage

### 1. Refresh exported dashboard data

From the repo root (notebook path is relative to `notebook/`):

```bash
uv run python -m ipykernel install --user --name cse6242 --display-name "CSE6242 (Python 3)"
uv run jupyter notebook notebook/CaptchaSolve.ipynb
```

Run the notebook through the **export** section (Step 9), then run the **model export cell (Step 10)**. The full set of outputs:

| File | Role |
|------|------|
| `dashboard/data/scatter_points.json` | Per-session `hf_index`, `pca_x` / `pca_y`, `cluster`, six kinematic features (`path_length`, `speed_std`, …), `is_outlier`, etc. |
| `dashboard/data/cluster_meta.json` | Cluster `id`, `name`, `size`, `color` for the dashboard legend |
| `dashboard/data/cluster_profiles.json` | Per-cluster feature means plus `_norm` columns for radar charts |
| `dashboard/data/model.pkl` | RF + PCA + K-Means + z-score params — loaded by `/api/classify` |

**`model.pkl`** must be present under `dashboard/data/` for classification: `/api/classify` only runs the Random Forest pipeline and returns **503** with `model_not_found` if the file is missing. `/health` includes `"model_ready": true` and `"classifier": "rf"` when the bundle loads.

### 2. Run the web server

```bash
uv run python main.py
# equivalent: uv run python -m dashboard.backend.app
```

Default listen address: `http://0.0.0.0:5001/`.

**Port already in use** (`Address already in use` / `Port 5001 is in use`):

- See which process holds the port (no `sudo` needed for your own user): `lsof -i :5001`
- Stop it: `kill <PID>` (e.g. the `python3.x` PID shown by `lsof`)
- Or use another port without killing anything: `PORT=5002 uv run python main.py` (then open `http://127.0.0.1:5002/`)

**`.env` tip:** If you see *“There are .env files present. Install python-dotenv to use them”*, Flask is not loading `.env` automatically. Either export variables in your shell, add `python-dotenv` and load it in `app.py`, or ignore the message if you do not rely on `.env`.

| Route | Behavior |
|-------|----------|
| `/` | `game.html` (play + classify) |
| `/dashboard` | `index.html` (PCA dashboard) |
| `/health` | `{"status":"ok","model_ready":true,"classifier":"rf"}` when `model.pkl` loads; `model_ready` false if missing |
| `/api/scatter_points.json` | Static JSON from data dir |
| `/api/cluster_meta.json` | Static JSON from data dir |
| `/api/cluster_profiles.json` | Static JSON from data dir |
| `POST /api/classify` | RF only: JSON body → cluster id + exemplar HF indices; **503** if `model.pkl` missing |
| `/session/<int:hf_index>` | Session metadata + `ticks` from HF dataset |

**Dashboard deep link** (after playing, the results page builds this automatically):

```text
http://127.0.0.1:5001/dashboard?cluster=0&point=12345&game=sheep-herding
```

**Classify API — RF path** (send raw ticks + duration in milliseconds):

```bash
curl -s -X POST http://127.0.0.1:5001/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "ticks": [{"x":10,"y":10,"isDown":false,"sampleIndex":0}, ...],
    "duration": 5200,
    "game_type": "sheep-herding"
  }'
```

Response includes `cluster`, `cluster_name`, `probabilities` (per-cluster RF confidence), `features_raw`, `features_z`, `pca_coords`, `anomaly_pct`, and `exemplars`.

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

## Final course submission (`team165final.zip`)

Canvas expects **team165final.zip** with exactly: **README.txt** (user guide), **DOC/** (`team165report.pdf`, `team165poster.pdf`), **CODE/** (minimal runnable tree). From a full git checkout, build it with:

```bash
chmod +x scripts/package_team165final.sh
./scripts/package_team165final.sh
```

Defaults: report from `./team165report.pdf` in the repo root (else a sibling `CSE6242-Docs` clone); poster from `./team165poster.pdf` or `./CSE6242 Final Poster.pdf` (else `CSE6242-Docs`). Override with `REPORT_SRC=...` and `POSTER_SRC=...` if needed. The script omits from **CODE/** in the zip: `.git`, virtualenvs, `.env`, `figures/`, root PDFs (they go only under **DOC/**), `README.md`, backup `*_old.*` files, and similar non-runtime files.

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
    ├── data/               # exported JSON + model.pkl (may be gitignored or committed)
    ├── backend/
    │   └── app.py          # Flask application
    └── frontend/
        ├── index.html      # dashboard (served at /dashboard)
        ├── game.html       # game + classify (served at /)
        ├── game.js         # Emscripten runtime + WASM glue (paired with game.wasm)
        ├── css/            # tokens, layout, components, viz.css
        └── js/             # D3 dashboard modules only — not a second copy of game.js
```

## Contributing

Changes that alter export schemas (`scatter_points.json`, `cluster_meta.json`, `cluster_profiles.json`) or the model bundle (`model.pkl`) should stay consistent with `dashboard/backend/app.py` and the frontend parsers in `dashboard/frontend/js/`. Re-run **both** notebook export cells (Step 9 and Step 10), restart Flask, and smoke-test `/`, `/dashboard`, `/api/classify`, and `/session/0` after substantive changes.
