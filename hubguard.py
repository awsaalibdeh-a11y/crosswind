"""Server side of the universal layer: this app obeys the owner's switches kept in Cramly (see cramly/universe.py).

  import hubguard; hubguard.install(app, "alibi")

When the app is switched off every API call except the static files answers 503 and every page shows a plain "switched off" screen; when a request carries a banned or
timed-out account (X-Hub-Key) or device (X-Hub-Dev) it is refused. Cramly is only asked every 20 seconds, in the background, and
if it cannot be reached the app carries on as normal (fail open), so a sleeping Cramly never takes this app down."""

import json
import os
import threading
import time
import urllib.parse
import urllib.request

from flask import jsonify, request

HUB = os.environ.get("HUB_URL", "https://cramly-twz5.onrender.com").rstrip("/")
KEEP = ("/static/", "/health", "/healthz", "/sw.js", "/favicon", "/manifest")        # always reachable, so pages can show why they are off
_cache = {}                                                                           # (key, dev) -> (answer, fetched at)
_lock = threading.Lock()


def _ask(app_id, key, dev):
    q = urllib.parse.urlencode({"app": app_id, "dev": dev or "", "since": 2 ** 31})
    req = urllib.request.Request(f"{HUB}/api/uni/guard?{q}", headers={"Authorization": f"Bearer {key}"} if key else {})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode())


def _refresh(app_id, key, dev):
    try:
        ans = _ask(app_id, key, dev)
    except Exception:                                                                 # Cramly asleep or down: keep the last answer
        ans = None
    with _lock:
        if ans is not None:
            _cache[(key, dev)] = (ans, time.time())
        elif (key, dev) in _cache:
            _cache[(key, dev)] = (_cache[(key, dev)][0], time.time() - 240)          # try again in about a minute, not on every request
        else:
            _cache[(key, dev)] = ({}, time.time() - 240)


def verdict(app_id, key="", dev=""):
    """What the owner has decided for this visitor: {} when everything is fine."""
    k = (key, dev)
    with _lock:
        hit = _cache.get(k)
        if len(_cache) > 2000:
            _cache.clear()
    if hit is None:
        threading.Thread(target=_refresh, args=(app_id, key, dev), daemon=True).start()   # first sight: do not make the visitor wait
        return {}
    if time.time() - hit[1] > 300:                                                       # every 5 minutes: each check is traffic, and wakes Cramly
        threading.Thread(target=_refresh, args=(app_id, key, dev), daemon=True).start()
    return hit[0]


def install(app, app_id):
    if os.environ.get("HUB_DISABLED"):
        return

    @app.before_request
    def hub_gate():
        p = request.path
        if p.startswith(KEEP):
            return None
        v = verdict(app_id, request.headers.get("X-Hub-Key", "")[:80], request.headers.get("X-Hub-Dev", "")[:48])
        if v.get("off"):
            msg = v.get("message") or "Switched off for a bit. Back soon."
            if p.startswith("/api/") or request.is_json:
                return jsonify(error=msg, maintenance=True), 503
            # a 200, not a 503, for pages: if the host health-checks "/" a failing page would get the app restarted, fighting the switch
            return (f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><meta name=robots content=noindex><title>Switched off</title>"
                    f"<body style='margin:0;display:grid;place-items:center;min-height:100vh;background:#0a0a0b;color:#ececf0;font:16px system-ui;text-align:center;padding:24px'>"
                    f"<div><div style='font-size:48px'>🛠️</div><h2>{app_id.title()} is switched off</h2><p style='color:#9a9aa3'>{msg}</p></div>", 200, {"Cache-Control": "no-store"})
        if v.get("banned") or v.get("timeout_until", 0) > time.time():
            if p.startswith("/api/"):
                return jsonify(error="This account is blocked or on a break.", banned=bool(v.get("banned"))), 403
        return None
