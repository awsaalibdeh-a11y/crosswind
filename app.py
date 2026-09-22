"""Crosswind — a browser flight simulator.

The whole simulation runs in the browser; this server only hands over the page and its assets.
Asset URLs carry a version stamped from file mtimes so a deploy can never leave a player on a
half-updated mix of old JavaScript and new shaders.
"""

import os

from flask import Flask, render_template, send_from_directory

app = Flask(__name__)

ASSET_VERSION = str(int(max(
    os.path.getmtime(os.path.join(app.static_folder, name))
    for name in ("sim.js", "style.css")
)))


@app.route("/")
def index():
    return render_template("index.html", asset_v=ASSET_VERSION)


@app.route("/healthz")
def healthz():
    return {"ok": True}


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(app.static_folder, "favicon.svg", mimetype="image/svg+xml")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5055)), debug=True)
