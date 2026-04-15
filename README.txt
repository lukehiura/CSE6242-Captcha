DESCRIPTION
-----------
This package provides an interactive mouse-behavior analysis system for the CaptchaSolve30k dataset. It studies trajectories from CAPTCHA-style mini-games to segment users based on kinematic features. 

The system consists of three main components: 
1. A Jupyter Notebook (CaptchaSolve.ipynb) that loads a Hugging Face session dataset, extracts six trajectory features, performs PCA and K-Means clustering, trains a Random Forest classifier, and exports the data.
2. A Flask backend (app.py) that serves the dataset, handles session replays, and exposes a POST /api/classify endpoint to run live classifications through the Random Forest model.
3. An interactive frontend featuring a WASM-based browser game to capture live user mouse data, and a D3.js dashboard to visualize PC1 vs PC2 scatter plots, radar charts of kinematic features, and animated trajectory replays.


INSTALLATION
------------
Prerequisites: Python 3.11+ 

1. Unzip the project folder and navigate into the root directory:
   cd CSE6242-Captcha

2. Install the dependencies. We recommend using `uv` for fast dependency resolution:
   curl -LsSf https://astral.sh/uv/install.sh | sh
   source "$HOME/.local/bin/env"
   uv sync

   (Alternatively, you can create a standard virtualenv and pip install the packages listed under [project.dependencies] in pyproject.toml).

3. Set up your Hugging Face access token (required to load the CaptchaSolve30k dataset) More instructions here https://huggingface.co/docs/hub/en/security-tokens
   cp .env.example .env

   replace HF_TOKEN="your_huggingface_token_here"


EXECUTION
---------
Running the Web Dashboard & Game Demo:
1. Start the Flask application from the root directory:
   uv run python main.py
   (equivalent: uv run python -m dashboard.backend.app)

2. Open a web browser and navigate to: http://127.0.0.1:5001/
   - The root URL (/) allows you to play the WASM game and generates live classification data.
   - The dashboard URL (/dashboard) allows you to interact with the clustering results, filter by game type, and view trajectory replays.

Running the Data Pipeline (Optional, Jupyter Notebook):
If you wish to re-run the end-to-end data processing pipeline:
1. Register the kernel and open Jupyter Notebook:
   uv run python -m ipykernel install --user --name cse6242 --display-name "CSE6242 (Python 3)"
   uv run jupyter notebook notebook/CaptchaSolve.ipynb
2. Run all cells to process the dataset and regenerate the JSON exports and `model.pkl` in the `dashboard/data/` folder.


DEMO VIDEO
----------
TBD: Working on this. 