DESCRIPTION
-----------
This package provides an interactive mouse-behavior analysis system for the CaptchaSolve30k dataset. It studies trajectories from CAPTCHA-style mini-games to segment users based on kinematic features.

The system consists of three main components:
1. A Jupyter Notebook (CaptchaSolve.ipynb) that loads a Hugging Face session dataset, extracts six trajectory features, performs PCA and K-Means clustering, trains a Random Forest classifier, and exports the data.
2. A Flask backend (app.py) that serves the dataset, handles session replays, and exposes a POST /api/classify endpoint to run live classifications through the Random Forest model.
3. An interactive frontend featuring a WASM-based browser game to capture live user mouse data, and a D3.js dashboard to visualize PC1 vs PC2 scatter plots, radar charts of kinematic features, and animated trajectory replays.

The full session dataset is public on Hugging Face (CaptchaSolve30k); it is not bundled in this submission. Precomputed exports and model.pkl under dashboard/data/ are included so the demo runs without downloading the full corpus.


INSTALLATION
------------
Prerequisites: Python 3.11+

1. Unzip team165final.zip. Open a terminal in the CODE folder (the directory that contains pyproject.toml, main.py, and dashboard/).

2. Install dependencies. We recommend uv:
   curl -LsSf https://astral.sh/uv/install.sh | sh
   source "$HOME/.local/bin/env"
   uv sync

   (Alternatively, create a virtualenv and pip install the packages listed under [project.dependencies] in pyproject.toml.)

3. Hugging Face token (needed to load CaptchaSolve30k from the hub). See https://huggingface.co/docs/hub/en/security-tokens
   cd CODE
   cp .env.example .env
   Edit .env and set HF_TOKEN to your token.

Dataset link: https://huggingface.co/datasets/Capycap-AI/CaptchaSolve30k


EXECUTION
---------
Running the web dashboard and game demo:
1. From the CODE directory, start Flask:
   uv run python main.py
   (equivalent: uv run python -m dashboard.backend.app)

2. In a browser open http://127.0.0.1:5001/
   - / — WASM game and live classification
   - /dashboard — PCA scatter, filters, trajectory replays

Optional — re-run the full data pipeline (Jupyter):
1. uv run python -m ipykernel install --user --name cse6242 --display-name "CSE6242 (Python 3)"
2. uv run jupyter notebook notebook/CaptchaSolve.ipynb
3. Run all cells to regenerate JSON under dashboard/data/ and model.pkl.


DEMO VIDEO (OPTIONAL)
---------------------
Unlisted YouTube walkthrough (install through running the demo):
https://youtu.be/i0SZUTvFVbI?si=qTjgMZ5hKvPj4nVn
