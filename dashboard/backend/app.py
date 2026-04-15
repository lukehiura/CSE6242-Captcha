from __future__ import annotations

import json
import logging
import math
import os
import pickle
import threading
from pathlib import Path

import numpy as np
from datasets import concatenate_datasets, load_dataset
from flask import Flask, jsonify, make_response, request, send_from_directory
from flask_cors import CORS

logger = logging.getLogger(__name__)

_BACKEND_DIR  = Path(__file__).resolve().parent
_FRONTEND_DIR = _BACKEND_DIR.parent / "frontend"
_DEFAULT_DATA = _BACKEND_DIR.parent / "data"
_HF_REPO      = "Capycap-AI/CaptchaSolve30k"
_HF_SPLITS    = ("train", "validation", "test")
_DEFAULT_PORT = 5001

_ds_all   = None
_ds_lock  = threading.Lock()

_scatter_pts: list[dict] | None = None
_scatter_lock = threading.Lock()

_model: dict | None = None
_model_lock = threading.Lock()

EPS = 1e-6
MAX_SPEED_PS = 800  # px/sample — discard teleport glitches


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")



def _load_model(data_dir: Path) -> dict | None:
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        fp = data_dir / "model.pkl"
        if not fp.is_file():
            return None
        with open(fp, "rb") as f:
            _model = pickle.load(f)
        logger.info("Loaded RF model bundle from %s", fp)
        return _model


def _dedupe(tick_inputs: list) -> list:
    seen: set[int] = set()
    unique = []
    for p in tick_inputs:
        if hasattr(p, "as_py"):
            p = p.as_py()
        idx = int(p["sampleIndex"])
        if idx not in seen:
            seen.add(idx)
            unique.append(p)
    return unique


def _extract_features(tick_inputs: list, duration_ms: float) -> dict | None:
    """Extract the 6 kinematic features from a list of tick dicts."""
    points = _dedupe(tick_inputs)
    if len(points) < 3:
        return None
    coords = np.array([(p["x"], p["y"]) for p in points], dtype=float)
    step_d = np.linalg.norm(np.diff(coords, axis=0), axis=1)
    step_d = step_d[step_d <= MAX_SPEED_PS] if (step_d <= MAX_SPEED_PS).sum() >= 2 else step_d
    path_length = float(step_d.sum())
    straight_line = float(np.linalg.norm(coords[-1] - coords[0]))
    return {
        "duration":        float(duration_ms),
        "path_length":     path_length,
        "speed_mean":      float(step_d.mean()),
        "path_efficiency": straight_line / (path_length + EPS),
        "pause_rate":      float((step_d < 0.5).mean()),
        "speed_std":       float(step_d.std()),
    }


def _downsample_ticks(ticks: list, duration_ms: float, target_rate: float) -> list:
    """Downsample physics ticks to match the training tick rate (~77.7/sec)."""
    if not ticks:
        return ticks
    duration_sec = duration_ms / 1000.0
    if duration_sec <= 0:
        return ticks
    target_n = max(3, int(target_rate * duration_sec))
    if len(ticks) <= target_n:
        return ticks
    indices = np.linspace(0, len(ticks) - 1, target_n, dtype=int)
    return [ticks[i] for i in indices]



def _tick_inputs_to_json(tick_inputs) -> list[dict]:
    if tick_inputs is None:
        return []
    out = []
    for t in tick_inputs:
        if hasattr(t, "as_py"):
            t = t.as_py()
        out.append({
            "x":           float(t["x"]),
            "y":           float(t["y"]),
            "isDown":      bool(t["isDown"]),
            "sampleIndex": int(t["sampleIndex"]),
        })
    return out


def _ensure_loaded() -> None:
    global _ds_all
    if _ds_all is not None:
        return
    with _ds_lock:
        if _ds_all is not None:
            return
        repo   = os.getenv("HF_DATASET_REPO", _HF_REPO)
        splits = tuple(
            s.strip()
            for s in os.getenv("HF_DATASET_SPLITS", ",".join(_HF_SPLITS)).split(",")
            if s.strip()
        )
        token = os.getenv("HF_TOKEN") or None
        logger.info("Loading %s …", repo)
        ds_dict = load_dataset(repo, token=token)
        missing = [s for s in splits if s not in ds_dict]
        if missing:
            raise RuntimeError(f"Missing splits {missing}; available: {list(ds_dict.keys())}")
        _ds_all = concatenate_datasets([ds_dict[s] for s in splits])
        logger.info("Dataset ready — %d rows", len(_ds_all))


def _get_scatter_pts(data_dir: Path) -> list[dict] | None:
    global _scatter_pts
    if _scatter_pts is not None:
        return _scatter_pts
    with _scatter_lock:
        if _scatter_pts is not None:
            return _scatter_pts
        fp = data_dir / "scatter_points.json"
        if not fp.is_file():
            return None
        with open(fp) as f:
            _scatter_pts = json.load(f)
        logger.info("Cached %d scatter points from %s", len(_scatter_pts), fp)
        return _scatter_pts


def _send_json(data_dir: Path, filename: str, missing_msg: str):
    fp = data_dir / filename
    if not fp.is_file():
        return jsonify({"error": missing_msg}), 404
    return send_from_directory(str(data_dir), filename, mimetype="application/json")


# ── RF classify pipeline ──────────────────────────────────────────────────────

def _rf_classify(model: dict, ticks: list, duration_ms: float, game_type: str) -> dict:
    """
    Full RF inference pipeline:
      downsample → extract features → z-score → RF predict →
      PCA coords → anomaly percentile vs training cluster distances.

    Returns a dict compatible with the existing /api/classify JSON shape plus
    additional RF-specific fields (probabilities, anomaly_pct, pca_coords).
    """
    rf              = model["rf"]
    pca             = model["pca"]
    km              = model["km"]
    zscore_params   = model["zscore_params"]
    cluster_names   = model["cluster_names"]
    cluster_features = model["cluster_features"]
    tick_rate       = model["training_tick_rate"]

    if game_type not in zscore_params:
        raise ValueError(
            f"Unknown game_type '{game_type}'. "
            f"Known: {list(zscore_params.keys())}"
        )

    ticks_ds = _downsample_ticks(ticks, duration_ms, tick_rate)
    feats = _extract_features(ticks_ds, duration_ms)
    if feats is None:
        raise ValueError("Too few trajectory points to extract features.")

    gt_params = zscore_params[game_type]
    z_vals = {
        col: (feats[col] - mu) / sigma if sigma > 1e-8 else 0.0
        for col, (mu, sigma) in gt_params.items()
        if col in feats
    }
    x_z = np.array([[z_vals[c] for c in cluster_features]])

    cluster_id = int(rf.predict(x_z)[0])
    proba      = rf.predict_proba(x_z)[0]
    prob_dict  = {int(c): float(p) for c, p in zip(rf.classes_, proba)}

    x_pca    = pca.transform(x_z)[0]
    centroid = km.cluster_centers_[cluster_id]
    dist_live = float(
        np.linalg.norm(np.asarray(x_pca[:2], dtype=float) - np.asarray(centroid[:2], dtype=float))
    )

    all_pts = _scatter_pts or []
    cluster_pts = [p for p in all_pts if p.get("cluster") == cluster_id and not p.get("is_outlier", False)]
    if cluster_pts:
        train_dists = np.array([
            math.sqrt((p["pca_x"] - centroid[0]) ** 2 + (p["pca_y"] - centroid[1]) ** 2)
            for p in cluster_pts
        ])
        anomaly_pct = float((train_dists < dist_live).mean() * 100)
    else:
        anomaly_pct = 0.0

    if cluster_pts:
        cluster_pts_sorted = sorted(
            cluster_pts,
            key=lambda p: (p["pca_x"] - x_pca[0]) ** 2 + (p["pca_y"] - x_pca[1]) ** 2,
        )
        exemplars = [
            {"hf_index": p["hf_index"], "pca_x": p["pca_x"], "pca_y": p["pca_y"]}
            for p in cluster_pts_sorted[:5]
        ]
    else:
        exemplars = []

    return {
        "cluster":       cluster_id,
        "cluster_name":  cluster_names.get(cluster_id, f"Cluster {cluster_id}"),
        "probabilities": prob_dict,
        "features_raw":  feats,
        "features_z":    z_vals,
        "pca_coords":    x_pca.tolist(),
        "anomaly_pct":   anomaly_pct,
        "exemplars":     exemplars,
    }



def create_app() -> Flask:
    data_dir = Path(os.getenv("DASHBOARD_DATA_DIR", str(_DEFAULT_DATA))).resolve()

    app = Flask(
        __name__,
        static_folder=str(_FRONTEND_DIR),
        static_url_path="",
    )
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-key-change-in-production")
    CORS(app)

    def _no_cache(html_file: str):
        resp = make_response(app.send_static_file(html_file))
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        return resp

    @app.route("/")
    def index():
        return _no_cache("game.html")

    @app.route("/dashboard")
    def dashboard():
        return _no_cache("index.html")

    @app.route("/health")
    def health():
        model = _load_model(data_dir)
        return jsonify({
            "status": "ok",
            "classifier": "rf" if model is not None else "centroid_fallback",
        })

    @app.route("/api/scatter_points.json")
    def api_scatter_points():
        return _send_json(data_dir, "scatter_points.json",
                          "Run notebook export — missing scatter_points.json")

    @app.route("/api/cluster_meta.json")
    def api_cluster_meta():
        return _send_json(data_dir, "cluster_meta.json", "Missing cluster_meta.json")

    @app.route("/api/cluster_profiles.json")
    def api_cluster_profiles():
        return _send_json(data_dir, "cluster_profiles.json", "Missing cluster_profiles.json")

    @app.route("/api/classify", methods=["POST"])
    def classify():
        body = request.get_json(force=True, silent=True) or {}
        game_type = body.get("game_type", "")
        ticks     = body.get("ticks", [])
        duration  = body.get("duration")

        model = _load_model(data_dir)

        if model is not None and ticks and duration is not None:
            try:
                duration_ms = float(duration)
            except (TypeError, ValueError):
                return jsonify({"error": "'duration' must be a number (milliseconds)"}), 400

            _get_scatter_pts(data_dir)  # warm cache for anomaly percentile

            try:
                result = _rf_classify(model, ticks, duration_ms, game_type)
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 400
            except Exception:
                logger.exception("RF classify failed")
                return jsonify({"error": "classification_failed"}), 500

            return jsonify(result)

        def _parse_feat(key):
            val = body.get(key, 0)
            if val is None or (isinstance(val, str) and not val.strip()):
                raise ValueError(f"Field '{key}' must be a number.")
            try:
                return float(val)
            except (TypeError, ValueError):
                raise ValueError(f"Field '{key}' must be a number.")

        try:
            features = {
                "speed_mean":      _parse_feat("speed_mean"),
                "path_efficiency": _parse_feat("path_efficiency"),
                "pause_rate":      _parse_feat("pause_rate"),
                "duration":        _parse_feat("duration"),
            }
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        all_pts = _get_scatter_pts(data_dir)
        if all_pts is None:
            return jsonify({"error": "scatter_points.json missing — run notebook export"}), 503

        pts = [p for p in all_pts if not p.get("is_outlier", False)]
        if not pts:
            return jsonify({"error": "no_scatter_points_available"}), 503

        game_pts = [p for p in pts if p.get("game_type") == game_type] or pts if game_type else pts

        feat_keys = list(features.keys())

        def _dist(a, b):
            return math.sqrt(sum((a.get(k, 0) - b.get(k, 0)) ** 2 for k in feat_keys))

        from collections import defaultdict
        sums   = defaultdict(lambda: defaultdict(float))
        counts = defaultdict(int)
        for p in game_pts:
            cl = p["cluster"]
            for fk in feat_keys:
                sums[cl][fk] += p.get(fk, 0)
            counts[cl] += 1
        centroids = {cl: {fk: sums[cl][fk] / counts[cl] for fk in feat_keys} for cl in sums}

        best_cluster = min(centroids, key=lambda cl: _dist(features, centroids[cl]))
        cluster_pts  = sorted(
            [p for p in game_pts if p["cluster"] == best_cluster],
            key=lambda p: _dist(features, p),
        )
        exemplars = [
            {"hf_index": p["hf_index"], "pca_x": p["pca_x"], "pca_y": p["pca_y"]}
            for p in cluster_pts[:5]
        ]

        if model is None:
            logger.warning(
                "model.pkl not found in %s — using centroid-distance fallback. "
                "Run the notebook export cell (Step 10) to enable the RF classifier.",
                data_dir,
            )

        return jsonify({
            "cluster":   best_cluster,
            "features":  features,
            "exemplars": exemplars,
            "centroid":  centroids[best_cluster],
        })

    @app.route("/session/<int:hf_index>")
    def get_session(hf_index: int):
        try:
            _ensure_loaded()
        except Exception as e:
            logger.exception("Dataset load failed")
            return jsonify({"error": "dataset_load_failed", "detail": str(e)}), 503

        n = len(_ds_all)
        if hf_index < 0 or hf_index >= n:
            return jsonify({"error": "not_found", "hf_index": hf_index, "n_rows": n}), 404

        row = _ds_all[hf_index]
        return jsonify({
            "hf_index":    hf_index,
            "game_type":   row.get("gameType"),
            "duration":    row.get("duration"),
            "touchscreen": bool(row.get("touchscreen", False)),
            "ticks":       _tick_inputs_to_json(row.get("tickInputs")),
        })

    return app


app = create_app()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    port  = int(os.getenv("PORT", os.getenv("DASHBOARD_PORT", str(_DEFAULT_PORT))))
    debug = _env_bool("FLASK_DEBUG")
    logger.info("Starting dashboard at http://0.0.0.0:%d/", port)
    app.run(host="0.0.0.0", port=port, debug=debug)
