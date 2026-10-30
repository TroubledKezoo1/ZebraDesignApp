"""Looks for a newer ZebraApp release on GitHub (desktop app).

The browser page may not talk to other sites (Content-Security-Policy), so the check runs here.
Only one anonymous GET to the public GitHub API is made; nothing about the user is sent.
"""
from __future__ import annotations

import json
import platform
import sys
import threading
import time
import urllib.error
import urllib.request

from . import __version__

REPO = "TroubledKezoo1/ZebraDesignApp"
API = "https://api.github.com/repos/%s/releases/latest" % REPO
_cache = {"t": 0.0, "data": None}
_lock = threading.Lock()


def parse(v):
    out = []
    for part in str(v).lstrip("vV").split(".")[:3]:
        digits = "".join(ch for ch in part if ch.isdigit())
        out.append(int(digits) if digits else 0)
    return tuple(out + [0] * (3 - len(out)))


def newer(latest, current):
    return parse(latest) > parse(current)


def _machine():
    m = platform.machine().lower()
    return "arm64" if m in ("arm64", "aarch64") else "x64"


def pick_asset(assets, system=None, machine=None):
    """The download for this system, or None (source / pip installs, unknown systems)."""
    system = system or sys.platform
    machine = machine or _machine()
    arm = machine == "arm64"
    if system == "win32":
        want = "-windows-%s.exe" % ("arm64" if arm else "x64")
    elif system == "darwin":
        want = "-macos-%s.dmg" % ("arm64" if arm else "x64")
    elif system.startswith("linux"):
        want = "-%s.AppImage" % ("aarch64" if arm else "x86_64")
    else:
        return None
    for a in assets or []:
        if str(a.get("name", "")).endswith(want):
            return a.get("browser_download_url")
    return None


def _fetch():
    req = urllib.request.Request(API, headers={"Accept": "application/vnd.github+json", "User-Agent": "ZebraApp/" + __version__})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode("utf-8"))


def check(force=False, fetch=None, now=None):
    """Returns {"state": "current"|"available"|"error", "current", "latest", "url", "page", "notes"}."""
    fetch = fetch or _fetch
    now = time.time() if now is None else now
    with _lock:
        if not force and _cache["data"] is not None and now - _cache["t"] < 3600:
            rel = _cache["data"]
        else:
            try:
                rel = fetch()
            except (urllib.error.URLError, OSError, ValueError):
                return {"state": "error", "current": __version__}
            if not isinstance(rel, dict) or "tag_name" not in rel:
                return {"state": "error", "current": __version__}
            _cache["t"], _cache["data"] = now, rel
    latest = str(rel["tag_name"]).lstrip("vV")
    out = {"current": __version__, "latest": latest, "page": rel.get("html_url") or "https://github.com/%s/releases/latest" % REPO}
    if not newer(latest, __version__):
        out["state"] = "current"
        return out
    out["state"] = "available"
    out["url"] = pick_asset(rel.get("assets")) if getattr(sys, "frozen", False) else None
    out["frozen"] = bool(getattr(sys, "frozen", False))
    return out
