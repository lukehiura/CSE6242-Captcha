from __future__ import annotations

import json
import logging
import math
import os
import threading
from collections import defaultdict
from pathlib import Path

from datasets import concatenate_datasets, load_dataset
from flask import Flask, jsonify, make_response, request, send_from_directory
from flask_cors import CORS

logger = logging.getLogger(__name__)

_BACKEND_DIR   = Path(__file__).resolve().parent
_FRONTEND_DIR  = _BACKEND_DIR.parent / "frontend"
_DEFAULT_DATA  = _BACKEND_DIR.parent / "data"
_HF_REPO       = "Capycap-AI/CaptchaSolve30k"
_HF_SPLITS     = ("train", "validation", "test")
_DEFAULT_PORT  = 5001

_ds_all      = None
_ds_lock     = threading.Lock()

_scatter_pts: list[dict] | None = None
_scatter_lock = threading.Lock()


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


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
        splits = tuple(s.strip() for s in os.getenv("HF_DATASET_SPLITS", ",".join(_HF_SPLITS)).split(",") if s.strip())
        token  = os.getenv("HF_TOKEN") or None
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
        return jsonify({"status": "ok"})

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

        game_type = body.get("game_type", "")

        all_pts = _get_scatter_pts(data_dir)
        if all_pts is None:
            return jsonify({"error": "scatter_points.json missing"}), 503

        pts = [p for p in all_pts if not p.get("is_outlier", False)]
        if not pts:
            return jsonify({"error": "no_scatter_points_available"}), 503

        if game_type:
            game_pts = [p for p in pts if p.get("game_type") == game_type] or pts
        else:
            game_pts = pts

        feat_keys = list(features.keys())

        def dist(a, b):
            return math.sqrt(sum((a.get(k, 0) - b.get(k, 0)) ** 2 for k in feat_keys))

        sums   = defaultdict(lambda: defaultdict(float))
        counts = defaultdict(int)
        for p in game_pts:
            cl = p["cluster"]
            for fk in feat_keys:
                sums[cl][fk] += p.get(fk, 0)
            counts[cl] += 1
        centroids = {cl: {fk: sums[cl][fk] / counts[cl] for fk in feat_keys} for cl in sums}

        best_cluster = min(centroids, key=lambda cl: dist(features, centroids[cl]))

        cluster_pts = [p for p in game_pts if p["cluster"] == best_cluster]
        cluster_pts.sort(key=lambda p: dist(features, p))
        exemplars = [{"hf_index": p["hf_index"], "pca_x": p["pca_x"], "pca_y": p["pca_y"]}
                     for p in cluster_pts[:5]]

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
            "hf_index":   hf_index,
            "game_type":  row.get("gameType"),
            "duration":   row.get("duration"),
            "touchscreen": bool(row.get("touchscreen", False)),
            "ticks":      _tick_inputs_to_json(row.get("tickInputs")),
        })

    return app


app = create_app()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    port  = int(os.getenv("PORT", os.getenv("DASHBOARD_PORT", str(_DEFAULT_PORT))))
    debug = _env_bool("FLASK_DEBUG")
    logger.info("Starting dashboard at http://0.0.0.0:%d/", port)
    app.run(host="0.0.0.0", port=port, debug=debug)
