
"""
Flask backend for live CAPTCHA session classification.
Run:  python flask_app.py
POST /classify with JSON body = raw session from the game.
"""
import json, pickle, os
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

MODEL_DIR = os.path.join(os.path.dirname(__file__), "model")

# Load artifacts once at startup
with open(f"{MODEL_DIR}/rf_model.pkl", "rb") as f:
    rf_model = pickle.load(f)
with open(f"{MODEL_DIR}/pca_model.pkl", "rb") as f:
    pca_model = pickle.load(f)
with open(f"{MODEL_DIR}/kmeans_model.pkl", "rb") as f:
    kmeans_model = pickle.load(f)
with open(f"{MODEL_DIR}/game_norm_stats.json") as f:
    norm_stats = json.load(f)
with open(f"{MODEL_DIR}/cluster_names.json") as f:
    cluster_names = {int(k): v for k, v in json.load(f).items()}
with open(f"{MODEL_DIR}/feature_order.json") as f:
    FEATURE_ORDER = json.load(f)

training_dists = np.load(f"{MODEL_DIR}/training_distances.npy")

EPS = 1e-6
MAX_SPEED_PS = 800


def extract_features(session):
    ticks = session.get("tickInputs") or session.get("tick_inputs")
    seen, points = set(), []
    for p in ticks:
        idx = int(p["sampleIndex"])
        if idx not in seen:
            seen.add(idx)
            points.append(p)
    if len(points) < 3:
        return None

    coords = np.asarray([(p["x"], p["y"]) for p in points], dtype=float)
    step_d = np.linalg.norm(np.diff(coords, axis=0), axis=1)
    valid = step_d[step_d <= MAX_SPEED_PS]
    if len(valid) > 2:
        step_d = valid

    path_length = float(step_d.sum())
    straight    = float(np.linalg.norm(coords[-1] - coords[0]))
    return {
        "duration":        float(session.get("duration", 0)),
        "path_length":     path_length,
        "speed_mean":      float(step_d.mean()),
        "path_efficiency": straight / (path_length + EPS),
        "pause_rate":      float((step_d < 0.5).mean()),
        "speed_std":       float(step_d.std()),
    }


@app.route("/classify", methods=["POST"])
def classify():
    session = request.get_json(force=True)
    game_type = session.get("gameType", "")

    if game_type not in norm_stats:
        return jsonify({"error": f"Unknown game type: {game_type}"}), 400

    feats = extract_features(session)
    if feats is None:
        return jsonify({"error": "Too few valid points"}), 400

    # Z-score
    z = []
    for col in FEATURE_ORDER:
        mu  = norm_stats[game_type][col]["mean"]
        std = norm_stats[game_type][col]["std"]
        z.append((feats[col] - mu) / std if std > 1e-8 else 0.0)

    x = np.array([z])
    cluster_id = int(rf_model.predict(x)[0])
    proba      = rf_model.predict_proba(x)[0]
    x_pca      = pca_model.transform(x)[0]
    centroid   = kmeans_model.cluster_centers_[cluster_id]
    dist       = float(np.linalg.norm(x_pca - centroid))
    pct        = float((training_dists < dist).mean() * 100)

    return jsonify({
        "cluster_id":    cluster_id,
        "cluster_name":  cluster_names.get(cluster_id, f"Cluster {cluster_id}"),
        "probabilities": {int(c): float(p) for c, p in zip(rf_model.classes_, proba)},
        "pca_coords":    x_pca.tolist(),
        "features_raw":  feats,
        "centroid_dist":  dist,
        "anomaly_pct":    pct,
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "clusters": len(cluster_names)})


if __name__ == "__main__":
    app.run(debug=True, port=5050)
