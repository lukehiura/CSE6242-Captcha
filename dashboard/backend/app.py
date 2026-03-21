"""
Backend API — CSE 6242 Team 165

Start with:
    uv run python dashboard/backend/app.py

Then serve the frontend:
    cd dashboard/frontend
    python3 -m http.server 8000
    open http://localhost:8000
"""

from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
