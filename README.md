# Decoding Human Motion: CAPTCHA Behavioral Segmentation

**CSE 6242 Team 165** — Cho, Hiura, Kweon, Yu, Zailaa — Spring 2026

Play a CAPTCHA game, see which behavioral cluster you belong to, and explore where you land among 10,000 historical sessions.

---

## Project structure

```
CSE6242-Captcha/
  notebook/
    CaptchaSolve.ipynb      # Full data pipeline: load -> features -> cluster -> export
    output/                 # Generated files (gitignored, created by running notebook)
      scatter_points.json
      cluster_profiles.json
      cluster_meta.json
      representative_traces.json
      task_norm_stats.json
      pca_model.pkl
      rf_classifier.pkl

  dashboard/
    frontend/
      index.html            # Single-page dashboard (scatter plot + game + radar)
      game.js               # WASM glue code     (gitignored, downloaded by setup.sh)
      game.wasm             # CAPTCHA game engine (gitignored, downloaded by setup.sh)
                            # Fetches data directly from notebook/output/ at runtime
    backend/
      app.py                # Flask classify endpoint
                            # Reads models directly from notebook/output/ at runtime

  proposal/
    paper.tex               # LaTeX source
    references.bib
    build.sh                # Compile to PDF: bash proposal/build.sh

  papers/                   # Reference papers (PDFs)
  setup.sh                  # One-command setup after running the notebook
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

### Step 2 — Install all dependencies

```bash
uv sync --extra dev
```

This creates `.venv/` and installs everything from `pyproject.toml` — including the notebook, ML, and backend packages. No manual `pip install` needed.

### Step 3 — Run the notebook

```bash
# Register the Jupyter kernel backed by the uv environment
uv run python -m ipykernel install --user --name cse6242 --display-name "CSE6242 (Python 3)"

# Open the notebook (select the CSE6242 kernel)
uv run jupyter notebook notebook/CaptchaSolve.ipynb
```

This writes all output to `notebook/output/`.

### Step 4 — Set up the dashboard

```bash
bash setup.sh
```

Downloads `game.js` and `game.wasm` from the HuggingFace Space if not already present.
The frontend and backend both read directly from `notebook/output/` — no data copying needed.

### Step 3 — Run

Open two terminals:

```bash
# Terminal 1: backend
uv run python dashboard/backend/app.py
# Running on http://localhost:5000

# Terminal 2: frontend
cd dashboard/frontend
python3 -m http.server 8000
# Open http://localhost:8000
```

---

## How it works

```
User plays CAPTCHA game in browser
    -> raw (x, y, isDown) mouse stream
    -> POST /classify to backend
    -> extract ~30 movement features
    -> normalize per game type using task_norm_stats.json
    -> PCA compression (pca_model.pkl)
    -> Random Forest classification (rf_classifier.pkl)
    -> return cluster label + UMAP coordinates
    -> dot animates onto the scatter plot
```

---

## Evaluation targets

| Metric | Target |
|---|---|
| Silhouette score | > 0.40 on held-out 20% test split |
| Cluster count | >= 3 distinct behavioral groups |
| RF accuracy (5-fold CV) | > 75% |
| Think-aloud task completion | 100% within 2 minutes |
| Likert interpretability score | >= 4.0 / 5.0 |
