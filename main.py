from __future__ import annotations

import logging
import os

from dashboard.backend.app import create_app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    app = create_app()
    port = int(os.getenv("PORT", os.getenv("DASHBOARD_PORT", "5001")))
    debug = os.getenv("FLASK_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")
    print("Starting CaptchaCapture Dashboard…")
    app.run(host="0.0.0.0", port=port, debug=debug)


if __name__ == "__main__":
    main()
