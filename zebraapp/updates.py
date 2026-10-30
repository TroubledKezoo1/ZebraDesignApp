"""Looks for a newer ZebraApp release on GitHub (desktop app).

The browser page may not talk to other sites (Content-Security-Policy), so the check runs here.
Only one anonymous GET to the public GitHub API is made; nothing about the user is sent.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import platform
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

from . import __version__, ed25519

REPO = "TroubledKezoo1/ZebraDesignApp"
API = "https://api.github.com/repos/%s/releases/latest" % REPO
_cache = {"t": 0.0, "data": None}
_lock = threading.Lock()
ALLOWED = "https://github.com/%s/releases/download/" % REPO     # the only place an update is downloaded from
progress = {"state": "idle", "done": 0, "total": 0, "code": ""}
_plock = threading.Lock()
# Release key: every release signs SHA256SUMS.txt (file SHA256SUMS.txt.sig, base64). The private half is a GitHub secret
# (RELEASE_SIGNING_KEY) and a copy on the maintainer's computer. An update is installed only if this key signed its checksums.
SIGNING_PUBKEY = bytes.fromhex("31b5c5ef324a16f6fd2f872bbca62b5efc729174f92a2b681c2beeec991be064")


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
    out["sums"] = _asset_url(rel.get("assets"), "SHA256SUMS.txt")
    out["sig"] = _asset_url(rel.get("assets"), "SHA256SUMS.txt.sig")
    out["self_update"] = bool(out["url"] and out["sums"] and out["sig"] and self_update_target())
    return out


# ------------------------------------------------------------------ install the update in place
class UpdateError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _asset_url(assets, name):
    for a in assets or []:
        if a.get("name") == name:
            return a.get("browser_download_url")
    return None


def self_update_target():
    """The file to replace: the AppImage (Linux) or the .exe (Windows). None for everything else
    (source, pip, .deb, macOS .dmg, or a folder we may not write to): those keep the download link."""
    if not getattr(sys, "frozen", False):
        return None
    if sys.platform.startswith("linux"):
        path = os.environ.get("APPIMAGE")
    elif sys.platform == "win32":
        path = sys.executable
    else:
        return None
    if not path or not os.path.isfile(path) or not os.access(os.path.dirname(path) or ".", os.W_OK):
        return None
    return path


def parse_sums(text):
    out = {}
    for line in str(text).splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2 and len(parts[0]) == 64:
            out[parts[1].strip().lstrip("*")] = parts[0].lower()
    return out


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _get_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ZebraApp/" + __version__})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read(1 << 20)


def _download(url, dest, report):
    req = urllib.request.Request(url, headers={"User-Agent": "ZebraApp/" + __version__})
    with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 18)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            report(done, total)


def _set(**kw):
    with _plock:
        progress.update(kw)


def swap(target, new):
    """Put `new` in place of `target`; the old file stays next to it as <name>.old (a way back)."""
    old = target + ".old"
    if os.name == "posix":
        os.chmod(new, 0o755)
    try:
        if os.path.exists(old):
            os.remove(old)
    except OSError:
        pass
    os.replace(target, old)          # a running .exe / AppImage may be renamed, just not overwritten
    try:
        os.replace(new, target)
    except OSError:
        os.replace(old, target)
        raise


def _quit():
    try:
        from . import transports
        transports.ble.disconnect()
    except Exception:  # noqa: BLE001
        pass
    os._exit(0)


def _relaunch(target):
    env = dict(os.environ)
    env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    for k in ("APPDIR", "APPIMAGE", "ARGV0", "OWD"):
        env.pop(k, None)
    kw = {"creationflags": 0x00000008 | 0x00000200} if sys.platform == "win32" else {"start_new_session": True}
    subprocess.Popen([target, "--reuse-window"], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, close_fds=True, **kw)
    threading.Timer(1.5, _quit).start()


def run_install(target, url, sums_url, sig_url, restart=True, pubkey=None):
    new = target + ".new"
    try:
        if not (url.startswith(ALLOWED) and sums_url.startswith(ALLOWED) and sig_url.startswith(ALLOWED)):
            raise UpdateError("source")
        _set(state="downloading", done=0, total=0, code="")
        sums = _get_bytes(sums_url)
        try:
            sig = base64.b64decode(_get_bytes(sig_url).strip(), validate=True)
        except ValueError:
            raise UpdateError("nosig")
        if not ed25519.verify(pubkey or SIGNING_PUBKEY, sums, sig):
            raise UpdateError("badsig")
        want = parse_sums(sums.decode("utf-8", "replace")).get(url.rsplit("/", 1)[-1])
        if not want:
            raise UpdateError("nosum")
        _download(url, new, lambda d, t: _set(done=d, total=t))
        _set(state="verifying")
        if _sha256(new) != want:
            raise UpdateError("sha")
        _set(state="installing")
        swap(target, new)
        _set(state="restarting")
        if restart:
            _relaunch(target)
    except UpdateError as e:
        _fail(new, e.code)
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        _fail(new, "net")
    except OSError:
        _fail(new, "write")


def _fail(new, code):
    try:
        if os.path.exists(new):
            os.remove(new)
    except OSError:
        pass
    _set(state="error", code=code)


def start_install():
    with _plock:
        if progress["state"] in ("downloading", "verifying", "installing", "restarting"):
            return {"ok": False, "code": "busy"}
    r = check(force=True)
    target = self_update_target()
    if r.get("state") != "available" or not r.get("self_update") or not target:
        return {"ok": False, "code": "unsupported"}
    _set(state="downloading", done=0, total=0, code="")
    threading.Thread(target=run_install, args=(target, r["url"], r["sums"], r["sig"]), daemon=True).start()
    return {"ok": True, "latest": r["latest"]}
