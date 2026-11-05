"""Local web server that serves the editor and talks to printers.

It only listens on 127.0.0.1, checks the Host/Origin headers and requires a
custom header on every POST, so other websites cannot make it print.
"""
from __future__ import annotations

import argparse
import base64
import hmac
import json
import mimetypes
import re
import os
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from pathlib import Path

from . import __version__, fonts, transports
from .messages import localize
from .storage import Store

STATIC = Path(__file__).resolve().parent / "static"
store: Store = None  # type: ignore[assignment]

# ---- who may talk to this server
# Every request needs the session cookie. The cookie is handed out only in exchange for a one-time launch code,
# and the codes are given only to whoever can read `session.key` in the data folder (the person who runs the app).
# So other programs and other users on the same computer cannot print, change printers or run the "command" printer.
COOKIE = "zebra_key"
KEY = ""
_codes = {}
_codes_lock = threading.Lock()


def load_key(base: Path) -> str:
    """The secret in <data folder>/session.key (created once, readable by the owner only)."""
    path = Path(base) / "session.key"
    try:
        k = path.read_text(encoding="ascii").strip()
        if len(k) >= 32:
            return k
    except OSError:
        pass
    k = secrets.token_hex(32)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="ascii") as f:
        f.write(k)
    return k


def new_code() -> str:
    code = secrets.token_urlsafe(24)
    with _codes_lock:
        now = time.time()
        for c in [c for c, t in _codes.items() if t < now]:
            del _codes[c]
        _codes[code] = now + 600
    return code


def take_code(code: str) -> bool:
    with _codes_lock:
        return _codes.pop(code, 0) > time.time()


# "Open with ZebraApp" from the file manager: the path given on the command line is kept behind a
# one-time token, and the window fetches that file once through /api/opened.
OPEN_EXT = (".zebra", ".json", ".zpl", ".prn", ".txt", ".nlbl", ".pdf")
OPEN_LIMIT = 20 * 1024 * 1024
_opens = {}


def register_open(path):
    """A token for a label file the window should open, or "" if the path is not a label file."""
    try:
        p = Path(path).expanduser().resolve()
        if p.suffix.lower() not in OPEN_EXT or not p.is_file():
            return ""
    except (OSError, ValueError):
        return ""
    token = secrets.token_urlsafe(16)
    with _codes_lock:
        now = time.time()
        for t in [t for t, (_, exp) in _opens.items() if exp < now]:
            del _opens[t]
        _opens[token] = (str(p), now + 600)
    return token


def take_open(token):
    with _codes_lock:
        path, exp = _opens.pop(token, ("", 0))
    return path if exp > time.time() else ""


def _same(a: str, b: str) -> bool:
    return bool(a) and bool(b) and hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
last_ping = 0.0
# Quitting when the last window closes. Each window pings with its own id and says goodbye when it closes.
_windows = {}           # window id -> time of its last ping
_bye_at = 0.0           # when a window last said goodbye
QUIET = 150             # no ping at all for this long: the window is gone. Browsers slow the timers of hidden
                        # windows to once a minute, so this must stay well above 60 s.
GRACE = 5               # after a goodbye: time for a reload, or another open window, to check in
PORT = 8765
FIXED_TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
               ".png": "image/png", ".woff2": "font/woff2", ".xml": "application/xml", ".json": "application/json", ".txt": "text/plain"}


class AppError(Exception):
    def __init__(self, template, *args):
        self.template, self.params = template, args
        super().__init__(template % args if args else template)


def lang():
    return (store.config().get("language") or "tr") if store else "tr"


def msg(template, *args):
    return localize(template, args, lang())


def err_text(e):
    if isinstance(e, (transports.TransportError, AppError)):
        return localize(e.template, e.params, lang())
    if isinstance(e, ValueError) and str(e):
        return str(e)          # dogrulama mesajlari (orn. NLBL aktarimi) oldugu gibi gosterilir
    log_error(e)
    return msg("Unexpected error: %s: %s", type(e).__name__, e)


def log_error(e):
    """Unexpected errors leave a traceback in <data dir>/error.log (kept small) so they can be diagnosed."""
    try:
        import traceback, time
        path = store.base / "error.log" if store else None
        if not path:
            return
        old = path.read_text(encoding="utf-8", errors="replace")[-40000:] if path.exists() else ""
        text = "".join(traceback.format_exception(type(e), e, e.__traceback__))
        path.write_text(old + "\n[%s] ZebraApp %s\n%s" % (time.strftime("%Y-%m-%d %H:%M:%S"), __import__("zebraapp").__version__, text), encoding="utf-8")
    except Exception:
        pass


def active_printer(pid=None):
    p = store.printer(pid)
    if not p:
        raise AppError("No printer selected. Add one under Printers.")
    return p


def send(data: bytes, pid=None):
    if not data.strip():
        raise AppError("Nothing to send.")
    r = transports.send(active_printer(pid), data)
    text = msg("Sent %d bytes to %s.", r["bytes"], r["printer"])
    if r.get("output"):
        text += " " + r["output"]
    return text


def labelary(data):
    dpmm = {203: 8, 300: 12, 600: 24}.get(int(data.get("dpi", 300)), 12)
    w_in = min(15.0, max(0.5, float(data.get("w", 80)) / 25.4))
    h_in = min(15.0, max(0.5, float(data.get("h", 40)) / 25.4))
    url = "https://api.labelary.com/v1/printers/%ddpmm/labels/%.2fx%.2f/0/" % (dpmm, w_in, h_in)
    req = urllib.request.Request(url, data=str(data.get("zpl", "")).encode("utf-8"),
                                 headers={"Accept": "image/png", "Content-Type": "application/x-www-form-urlencoded",
                                          "User-Agent": "ZebraApp/" + __version__})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return {"ok": True, "png": base64.b64encode(r.read()).decode("ascii")}
    except urllib.error.HTTPError as e:
        return {"ok": False, "message": msg("Labelary error %d: %s", e.code, e.read().decode("utf-8", "replace")[:200])}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": msg("Could not reach Labelary (is the internet on?): %s", e)}


def state():
    p = store.printer()
    ble = bool(p and p.get("transport") == "ble")
    return {
        "active": p.get("id") if p else None,
        "transport": p.get("transport") if p else None,
        "ble": ble,
        "connected": ble and transports.ble.connected_to(p.get("address") or None),
        "name": (transports.ble.name if ble and transports.ble.connected_to() else (p.get("name") if p else "")),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "ZebraApp/" + __version__

    def log_message(self, *a):
        pass

    # ---- helpers
    def _send(self, code, body: bytes, ctype: str, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _file(self, path: Path):
        try:
            body = path.read_bytes()
        except OSError:
            self.send_error(404)
            return
        # fixed types first: the Windows registry sometimes maps these wrongly
        ctype = FIXED_TYPES.get(path.suffix.lower()) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("json") or ctype.endswith("svg+xml"):
            ctype += "; charset=utf-8"
        extra = {}
        if path.name == "index.html":
            extra["Content-Security-Policy"] = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
                                                "script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'")
        self._send(200, body, ctype, extra)

    def _allowed(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("localhost", "127.0.0.1", "[::1]"):
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in ("http://localhost:%d" % PORT, "http://127.0.0.1:%d" % PORT):
            return False
        return True

    def _authed(self):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie") or "")
        except Exception:  # noqa: BLE001
            return False
        m = jar.get(COOKIE)
        return bool(m) and _same(m.value, KEY)

    def _need_launch(self):
        page = ("<!doctype html><meta charset=utf-8><title>ZebraApp</title><body style='font:16px system-ui;max-width:34em;margin:12vh auto;padding:0 1em'>"
                "<h1>ZebraApp</h1><p>This page can only be opened by the app itself. "
                "Start ZebraApp again (or run <code>zebraapp</code>) and it opens a window for you.</p>"
                "<p>Bu sayfa yalnızca uygulamanın kendisiyle açılır. ZebraApp'i yeniden başlat; pencereyi senin için açar.</p>").encode("utf-8")
        self._send(403, page, "text/html; charset=utf-8")

    # ---- GET
    def do_GET(self):
        if not self._allowed():
            self.send_error(403)
            return
        parts = urlsplit(self.path)
        path = parts.path
        if path == "/api/ping":                     # needs no cookie (a second start asks whether we are running); says nothing
            global last_ping
            last_ping = time.time()
            w = (parse_qs(parts.query).get("w") or [""])[0]
            if re.fullmatch(r"[A-Za-z0-9]{1,40}", w) and (w in _windows or len(_windows) < 50):
                _windows[w] = last_ping
            self._json({"ok": True})
            return
        if path in ("/", "/index.html") and "k" in parse_qs(parts.query):
            if take_code(parse_qs(parts.query)["k"][0]):
                token = (parse_qs(parts.query).get("open") or [""])[0]
                where = "/?open=" + token if re.fullmatch(r"[A-Za-z0-9_-]{8,64}", token) else "/"
                self._send(302, b"", "text/plain", {"Location": where, "Set-Cookie": "%s=%s; Path=/; HttpOnly; SameSite=Strict" % (COOKIE, KEY)})
                return
        if not self._authed():
            if path in ("/", "/index.html"):
                self._need_launch()
            else:
                self.send_error(403)
            return
        if path in ("/", "/index.html"):
            self._file(STATIC / "index.html")
        elif path in ("/icon.svg", "/favicon.ico"):
            self._file(STATIC / "icon.svg")
        elif path.startswith("/static/"):
            target = (STATIC / path[len("/static/"):]).resolve()
            if STATIC.resolve() not in target.parents:
                self.send_error(403)
                return
            self._file(target)
        elif path == "/api/labels":
            self._json(store.labels())
        elif path == "/api/settings":
            cfg = store.config()
            self._json({"version": __version__, "language": cfg.get("language"), "active": cfg.get("active"),
                        "printers": cfg.get("printers"), "available": transports.available(), "data_dir": str(store.base)})
        elif path == "/api/state":
            self._json(state())
        elif path == "/api/templates":
            self._json(store.templates())
        elif path == "/api/fonts":
            self._json({"families": fonts.families()})
        elif path == "/api/update":
            from . import updates
            self._json(updates.check(force="force=1" in self.path))
        elif path == "/api/opened":
            self._json(self._opened((parse_qs(parts.query).get("t") or [""])[0]))
        elif path == "/api/update/progress":
            from . import updates
            self._json(dict(updates.progress))
        else:
            self.send_error(404)

    def _opened(self, token):
        path = take_open(token)
        if not path:
            return {"ok": False, "message": msg("The file link has expired. Open the file again.")}
        try:
            p = Path(path)
            size = p.stat().st_size
            if size == 0:
                return {"ok": False, "message": msg("The file is empty (0 bytes): %s", p.name)}
            if size > OPEN_LIMIT:
                return {"ok": False, "message": msg("Label files can be at most 20 MB.")}
            raw = p.read_bytes()
        except OSError as e:
            return {"ok": False, "message": msg("Could not open %s (%s)", Path(path).name, e.strerror or e)}
        return {"ok": True, "name": p.name, "data": base64.b64encode(raw).decode("ascii")}

    # ---- POST
    def do_POST(self):
        if not self._allowed() or self.headers.get("X-ZebraApp") != "1":
            self.send_error(403)
            return
        if self.path == "/api/launch":              # a second start of the app asks for a window code; it must know session.key
            if _same(self.headers.get("X-ZebraApp-Key") or "", KEY):
                try:
                    n = int(self.headers.get("Content-Length") or 0)
                    body = json.loads(self.rfile.read(n) or b"{}") if 0 < n < 65536 else {}
                except (ValueError, UnicodeDecodeError):
                    body = {}
                path = body.get("open") if isinstance(body, dict) else None
                self._json({"ok": True, "code": new_code(), "open": register_open(path) if isinstance(path, str) else ""})
            else:
                self.send_error(403)
            return
        if not self._authed():
            self.send_error(403)
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n < 0 or n > 30 * 1024 * 1024:
                raise ValueError("request too large")
            data = json.loads(self.rfile.read(n) or b"{}")
            path = self.path
            if path in ("/api/pdf/info", "/api/pdf/import"):
                from .pdfimport import inspect_pdf, import_pdf
                try:
                    encoded = data.get("data", "")
                    if not isinstance(encoded, str) or len(encoded) > 28 * 1024 * 1024:
                        raise ValueError("PDF files must be non-empty and no larger than 20 MB.")
                    raw = base64.b64decode(encoded, validate=True)
                    if path == "/api/pdf/info":
                        result = inspect_pdf(raw)
                    else:
                        result = {"label": import_pdf(raw, page=data.get("page", 1), dpi=data.get("dpi", 300), name=data.get("name", "PDF"))}
                except ValueError as exc:
                    raise AppError(str(exc)) from exc
                self._json(dict(result, ok=True))
            elif path == "/api/nlbl/import":
                from .nlbl import import_label
                raw = base64.b64decode(data.get("data", ""), validate=True)
                label, warnings = import_label(raw)
                self._json({"ok": True, "label": label, "warnings": warnings})
            elif path == "/api/nlbl/export":
                from .nlbl import export_label
                raw, warnings = export_label(data.get("label") or {})
                self._json({"ok": True, "data": base64.b64encode(raw).decode("ascii"), "warnings": warnings})
            elif path == "/api/bye":                # a window is closing
                global _bye_at
                _windows.pop(str(data.get("w") or ""), None)
                _bye_at = time.time()
                self._json({"ok": True})
            elif path == "/api/update/install":
                from . import updates
                self._json(updates.start_install())
            elif path == "/api/templates":
                store.save_templates(data)
                self._json({"ok": True})
            elif path == "/api/labels":
                store.save_labels(data)
                self._json({"ok": True})
            elif path == "/api/settings":
                cfg = store.config()
                for k in ("language", "active", "printers"):
                    if k in data:
                        cfg[k] = data[k]
                store.save_config(cfg)
                self._json({"ok": True})
            elif path == "/api/print_raw":
                self._json({"ok": True, "message": send(str(data.get("data", "")).encode("utf-8"), data.get("printer"))})
            elif path == "/api/test_printer":
                # unsaved printer settings from the dialog
                p = data.get("printer") or {}
                r = transports.send(p, str(data.get("data", "")).encode("utf-8"))
                self._json({"ok": True, "message": msg("Sent %d bytes to %s.", r["bytes"], r["printer"])})
            elif path == "/api/status":
                p = data.get("printer") or active_printer(data.get("id"))
                flags = transports.parse_hs(transports.query(p, b"~HS", 1.5))
                self._json({"ok": True, "flags": flags})
            elif path == "/api/discover":
                self._json({"ok": True, "items": transports.discover(str(data.get("transport")))})
            elif path == "/api/connect":
                p = active_printer(data.get("printer"))
                if p.get("transport") != "ble":
                    raise AppError("Only Bluetooth LE printers keep a connection open.")
                self._json({"ok": True, "message": msg("Connected: %s", transports.ble.connect(p))})
            elif path == "/api/disconnect":
                transports.ble.disconnect()
                self._json({"ok": True, "message": msg("Disconnected.")})
            elif path == "/api/labelary":
                self._json(labelary(data))
            else:
                self.send_error(404)
        except Exception as e:  # noqa: BLE001
            self._json({"ok": False, "message": err_text(e)}, 200)


# ------------------------------------------------------------------ window
def _browser_candidates():
    names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]
    for n in names:
        p = shutil.which(n)
        if p:
            yield p
    if sys.platform == "win32":
        for base in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
            if not base:
                continue
            for rel in (r"Google\Chrome\Application\chrome.exe", r"Microsoft\Edge\Application\msedge.exe"):
                p = Path(base) / rel
                if p.exists():
                    yield str(p)
    if sys.platform == "darwin":
        for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                  "/Applications/Chromium.app/Contents/MacOS/Chromium"):
            if os.path.exists(p):
                yield p


def open_window(url):
    """Open as an app window (Chrome/Edge --app) if possible, else the default browser."""
    for exe in _browser_candidates():
        try:
            subprocess.Popen([exe, "--app=" + url, "--window-size=1440,900"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except OSError:
            continue
    webbrowser.open(url)


def launch_url(port, key=None, open_path=None):
    """Window address with a one-time code, asked from the copy that is already running."""
    base = "http://localhost:%d" % port
    key = key or load_key(store.base)
    body = json.dumps({"open": os.path.abspath(open_path)} if open_path else {}).encode("utf-8")
    try:
        req = urllib.request.Request(base + "/api/launch", data=body, method="POST",
                                     headers={"X-ZebraApp": "1", "X-ZebraApp-Key": key, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=3) as r:
            j = json.loads(r.read().decode("utf-8"))
            return base + "/?k=" + j["code"] + ("&open=" + j["open"] if j.get("open") else "")
    except Exception:  # noqa: BLE001
        return base


def should_quit(now):
    """True when no window is left: the last one said goodbye, or nothing has pinged for QUIET seconds."""
    for w, t in list(_windows.items()):
        if now - t > QUIET:
            _windows.pop(w, None)
    if _windows:
        return False
    if _bye_at and now - _bye_at > GRACE:
        return True
    return bool(last_ping) and now - last_ping > QUIET


def watchdog():
    """Quit a few seconds after the last window closes."""
    while True:
        time.sleep(1)
        if should_quit(time.time()):
            try:
                transports.ble.disconnect()
            except Exception:  # noqa: BLE001
                pass
            os._exit(0)


def _already_running(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/ping" % port, timeout=1) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def main(argv=None):
    global store, PORT, last_ping, KEY
    ap = argparse.ArgumentParser(prog="zebraapp", description="ZPL label designer for Zebra printers")
    ap.add_argument("--port", type=int, default=int(os.environ.get("ZEBRAAPP_PORT", "8765")))
    ap.add_argument("--data-dir", help="folder for settings and saved labels")
    ap.add_argument("--no-browser", action="store_true", help="do not open a window; keep running until Ctrl+C")
    ap.add_argument("--reuse-window", action="store_true", help=argparse.SUPPRESS)   # restart after an update
    ap.add_argument("--version", action="version", version="%(prog)s " + __version__)
    ap.add_argument("files", nargs="*", help="label file to open (.zebra, .nlbl, .zpl, .pdf)")
    args = ap.parse_args(argv)
    open_path = args.files[0] if args.files else None
    if args.data_dir:
        os.environ["ZEBRAAPP_HOME"] = args.data_dir
    store = Store()
    KEY = load_key(store.base)
    from . import integrate                     # downloaded app: .zebra/.nlbl open with a double-click
    threading.Thread(target=integrate.register, args=(store.base,), daemon=True).start()
    PORT = args.port
    url = "http://localhost:%d" % PORT
    if args.reuse_window:                       # the old copy is still shutting down: wait for its port
        for _ in range(40):
            if not _already_running(PORT):
                break
            time.sleep(0.5)
    if _already_running(PORT):
        print("ZebraApp is already running:", url)
        if not args.no_browser:
            open_window(launch_url(PORT, KEY, open_path))
        else:
            print("Open:", launch_url(PORT, KEY, open_path))
        return
    srv = None
    for port in range(args.port, args.port + 10):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            # another program uses this port; ZebraApp itself was checked above
            if port == args.port + 9:
                raise
    PORT = port
    url = "http://localhost:%d" % PORT
    print("ZebraApp %s  %s   (data: %s)" % (__version__, url, store.base))
    token = register_open(open_path) if open_path else ""
    if open_path and not token:
        print("Not a label file, ignored:", open_path)
    first = url + "/?k=" + new_code() + ("&open=" + token if token else "")
    if args.no_browser:
        print("Open this address within 10 minutes (it works once):", first, flush=True)
    else:
        if args.reuse_window:                   # the window from before the update reloads itself; no second one
            last_ping = time.time()
        else:
            threading.Timer(0.5, lambda: open_window(first)).start()
        threading.Thread(target=watchdog, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
