# Decoding Human Motion: CAPTCHA Behavioral Segmentation

**CSE 6242 Team 165** — Cho, Hiura, Kweon, Yu, Zailaa — Spring 2026

Play a CAPTCHA game, see which behavioral cluster you belong to, and explore where you land among historical sessions on a PCA scatter plot.

---

## Project structure

```
CSE6242-Captcha/
  notebook/
    CaptchaSolve.ipynb      # Pipeline: load -> features -> EDA -> z-score -> PCA -> clustering -> export

  dashboard/
    data/                   # JSON written by the notebook (committed or regenerated locally)
      scatter_points.json   # PCA x/y, cluster, game_type, key features (for scatter + tooltips)
      cluster_profiles.json # Per-cluster mean features (normalized)
      cluster_meta.json     # Cluster ids, display names, short descriptions
    frontend/
      index.html            # Dashboard shell (visualizations in progress)
      game.js               # WASM glue (add when wiring the live game)
      game.wasm             # CAPTCHA engine (add when wiring the live game)
    backend/
      app.py                # Flask API (CORS + /health; classify endpoint TBD)

  proposal/
    paper.tex
    references.bib
    build.sh                # Compile to PDF: bash proposal/build.sh

  papers/                   # Reference papers (PDFs)
  pyproject.toml            # uv / dependencies
  README.md
  .gitignore
```

---

## Quick start

### Step 1 — Install uv (once)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env   # or restart your shell
```

### Step 2 — Install dependencies

```bash
uv sync --extra dev
```

This creates `.venv/` from `pyproject.toml` (notebook, ML stack, backend).

### Step 3 — Run the notebook

```bash
uv run python -m ipykernel install --user --name cse6242 --display-name "CSE6242 (Python 3)"
uv run jupyter notebook notebook/CaptchaSolve.ipynb
```

Select the **CSE6242** kernel. Run all cells through the export section. That refreshes `dashboard/data/*.json`.

### Step 4 — Run the app (optional)

Open two terminals:

```bash
# Terminal 1 — API (default port 5001)
uv run python dashboard/backend/app.py

# Terminal 2 — static frontend
cd dashboard/frontend
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). The backend health check is [http://127.0.0.1:5001/health](http://127.0.0.1:5001/health).

---


The notebook builds clusters from session trajectories

1. **Features (6):** `duration`, `path_length`, `speed_mean`, `path_efficiency`, `pause_rate`, `speed_std` — with deduping and outlier filtering during extraction.
2. **Normalization:** Z-score each feature **within game type** (`thread-the-needle`, `polygon-stacking`, `sheep-herding`) so tasks are comparable.
3. **Dimensionality reduction:** PCA retaining enough components to explain ~90% of variance (used for clustering; PC1/PC2 are used for the 2D scatter in exports).
4. **Clustering:** **K-Means** with **k = 3** on the PCA space. The notebook also compares **GMM** and **DBSCAN** for the write-up; K-Means is the primary model for interpretability.
5. **Labels:** Cluster display names from relative quantiles over speed, efficiency, and pause behavior.
6. **Export:** Three JSON files under `dashboard/data/` for the dashboard (scatter, profiles, metadata).

**Live classification** (browser -> backend -> same feature + model path) is planned; the Flask app currently exposes `/health` only until `game.js` / `game.wasm` and the classify route are wired up.

