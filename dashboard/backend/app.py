"""flask backend for the dashboard
run with: uv run python dashboard/backend/app.py
frontend is separate http server on 8000
"""

import os

from datasets import concatenate_datasets, load_dataset
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS


app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

@app.route('/')
def index():
    return app.send_static_file('index.html')

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))

HF_REPO = "Capycap-AI/CaptchaSolve30k"
SPLIT_ORDER = ("train", "validation", "test")

_ds_all = None


def _tick_inputs_to_json(tick_inputs) -> list[dict]:
    # turn ticks into plain dicts for json
    if tick_inputs is None:
        return []
    out: list[dict] = []
    for t in tick_inputs:
        if hasattr(t, "as_py"):
            t = t.as_py()
        out.append(
            {
                "x": float(t["x"]),
                "y": float(t["y"]),
                "isDown": bool(t["isDown"]),
                "sampleIndex": int(t["sampleIndex"]),
            }
        )
    return out


def _ensure_loaded():
    global _ds_all
    if _ds_all is not None:
        return
    token = os.getenv("HF_TOKEN") or None
    print("loading dataset...")  # takes a sec
    ds_dict = load_dataset(HF_REPO, token=token)
    missing = [s for s in SPLIT_ORDER if s not in ds_dict]
    if missing:
        raise RuntimeError(f"Missing splits {missing}; available: {list(ds_dict.keys())}")
    _ds_all = concatenate_datasets([ds_dict[s] for s in SPLIT_ORDER])
    print("ok done loading, rows=" + str(len(_ds_all)))


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/scatter_points.json")
def api_scatter_points():
    fp = os.path.join(DATA_DIR, "scatter_points.json")
    if not os.path.isfile(fp):
        return jsonify({"error": "run notebook export — missing scatter_points.json"}), 404
    return send_from_directory(DATA_DIR, "scatter_points.json", mimetype="application/json")


@app.route("/api/cluster_meta.json")
def api_cluster_meta():
    fp = os.path.join(DATA_DIR, "cluster_meta.json")
    if not os.path.isfile(fp):
        return jsonify({"error": "missing cluster_meta.json"}), 404
    return send_from_directory(DATA_DIR, "cluster_meta.json", mimetype="application/json")


@app.route("/api/cluster_profiles.json")
def api_cluster_profiles():
    fp = os.path.join(DATA_DIR, "cluster_profiles.json")
    if not os.path.isfile(fp):
        return jsonify({"error": "missing cluster_profiles.json"}), 404
    return send_from_directory(DATA_DIR, "cluster_profiles.json", mimetype="application/json")


@app.route("/session/<int:hf_index>")
def get_session(hf_index: int):
    try:
        _ensure_loaded()
    except Exception as e:
        return jsonify({"error": "dataset_load_failed", "detail": str(e)}), 503

    assert _ds_all is not None
    n = len(_ds_all)
    if hf_index < 0 or hf_index >= n:
        return jsonify({"error": "not_found", "hf_index": hf_index, "n_rows": n}), 404

    row = _ds_all[hf_index]
    ticks = _tick_inputs_to_json(row.get("tickInputs"))
    return jsonify(
        {
            "hf_index": hf_index,
            "game_type": row.get("gameType"),
            "duration": row.get("duration"),
            "touchscreen": bool(row.get("touchscreen", False)),
            "ticks": ticks,
        }
    )


if __name__ == "__main__":
    print("starting server 5001")
    app.run(host="0.0.0.0", port=5001, debug=True)
