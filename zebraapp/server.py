"""Local web server that serves the editor and talks to printers.

It only listens on 127.0.0.1, checks the Host/Origin headers and requires a
custom header on every POST, so other websites cannot make it print.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import __version__, fonts, transports
from .messages import localize
from .storage import Store

STATIC = Path(__file__).resolve().parent / "static"
store: Store = None  # type: ignore[assignment]
last_ping = 0.0
PORT = 8765


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
    return msg("Unexpected error: %s", e)


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
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        if path.suffix == ".woff2":
            ctype = "font/woff2"
        if path.suffix == ".js":
            ctype = "text/javascript"
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

    # ---- GET
    def do_GET(self):
        if not self._allowed():
            self.send_error(403)
            return
        path = self.path.split("?", 1)[0]
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
        elif path == "/api/ping":
            global last_ping
            last_ping = time.time()
            self._json({"ok": True})
        else:
            self.send_error(404)

    # ---- POST
    def do_POST(self):
        if not self._allowed() or self.headers.get("X-ZebraApp") != "1":
            self.send_error(403)
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n < 0 or n > 30 * 1024 * 1024:
                raise ValueError("request too large")
            data = json.loads(self.rfile.read(n) or b"{}")
            path = self.path
            if path == "/api/nlbl/import":
                from .nlbl import import_label
                raw = base64.b64decode(data.get("data", ""), validate=True)
                label, warnings = import_label(raw)
                self._json({"ok": True, "label": label, "warnings": warnings})
            elif path == "/api/nlbl/export":
                from .nlbl import export_label
                raw, warnings = export_label(data.get("label") or {})
                self._json({"ok": True, "data": base64.b64encode(raw).decode("ascii"), "warnings": warnings})
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


def watchdog():
    """Quit a little after the last window closes (no more pings)."""
    while True:
        time.sleep(5)
        if last_ping and time.time() - last_ping > 25:
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
    global store, PORT
    ap = argparse.ArgumentParser(prog="zebraapp", description="ZPL label designer for Zebra printers")
    ap.add_argument("--port", type=int, default=int(os.environ.get("ZEBRAAPP_PORT", "8765")))
    ap.add_argument("--data-dir", help="folder for settings and saved labels")
    ap.add_argument("--no-browser", action="store_true", help="do not open a window; keep running until Ctrl+C")
    ap.add_argument("--version", action="version", version="%(prog)s " + __version__)
    args = ap.parse_args(argv)
    if args.data_dir:
        os.environ["ZEBRAAPP_HOME"] = args.data_dir
    store = Store()
    PORT = args.port
    url = "http://localhost:%d" % PORT
    if _already_running(PORT):
        print("ZebraApp is already running:", url)
        if not args.no_browser:
            open_window(url)
        return
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("ZebraApp %s  %s   (data: %s)" % (__version__, url, store.base))
    if not args.no_browser:
        threading.Timer(0.5, lambda: open_window(url)).start()
        threading.Thread(target=watchdog, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
