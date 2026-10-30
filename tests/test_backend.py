"""Backend tests: storage, transports and the HTTP server (no printer needed)."""
import json
import os
import socket
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from zebraapp import transports  # noqa: E402
from zebraapp.messages import localize  # noqa: E402
from zebraapp.storage import Store  # noqa: E402


class StorageTest(unittest.TestCase):
    def test_roundtrip_and_legacy_config(self):
        with tempfile.TemporaryDirectory() as d:
            st = Store(Path(d))
            self.assertEqual(st.labels(), [])
            st.save_labels([{"name": "a"}])
            self.assertEqual(st.labels(), [{"name": "a"}])
            (Path(d) / "config.json").write_text(json.dumps({"printer_address": "AA:BB"}), encoding="utf-8")
            cfg = st.config()
            self.assertEqual(cfg["printers"][0]["transport"], "ble")
            self.assertEqual(cfg["printers"][0]["address"], "AA:BB")
            self.assertEqual(cfg["active"], cfg["printers"][0]["id"])


class TransportTest(unittest.TestCase):
    def test_tcp_sends_bytes(self):
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        got = []

        def accept():
            c, _ = srv.accept()
            data = b""
            while True:
                chunk = c.recv(4096)
                if not chunk:
                    break
                data += chunk
            got.append(data)
            c.close()
        th = threading.Thread(target=accept)
        th.start()
        r = transports.send({"transport": "tcp", "host": "127.0.0.1", "port": srv.getsockname()[1], "name": "t"}, b"^XA^XZ")
        th.join(5)
        srv.close()
        self.assertEqual(got, [b"^XA^XZ"])
        self.assertEqual(r["bytes"], 6)

    def test_device_and_command(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "out.zpl")
            transports.send({"transport": "device", "path": out}, b"^XA^XZ")
            self.assertEqual(Path(out).read_bytes(), b"^XA^XZ")
            script = os.path.join(d, "sink.py")
            Path(script).write_text("import sys;open(sys.argv[1],'wb').write(sys.stdin.buffer.read())", encoding="utf-8")
            cmd = '"%s" "%s" "%s"' % (sys.executable, script, out + "2")
            transports.send({"transport": "command", "command": cmd}, b"hello")
            self.assertEqual(Path(out + "2").read_bytes(), b"hello")

    def test_errors_are_translated(self):
        with self.assertRaises(transports.TransportError) as cm:
            transports.send({"transport": "tcp", "host": ""}, b"x")
        e = cm.exception
        self.assertIn("IP", localize(e.template, e.params, "tr"))

    def test_parse_hs(self):
        raw = b"\x02030,1,0,1245,000,0,0,0,000,0,0,0\x03\r\n\x02001,0,1,0,1,2,6,0,00000000,1,000\x03\r\n\x021234,0\x03\r\n"
        f = transports.parse_hs(raw)
        self.assertTrue(f["paper_out"])
        self.assertFalse(f["paused"])
        self.assertTrue(f["head_open"])
        self.assertFalse(f["ribbon_out"])


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from http.server import ThreadingHTTPServer
        from zebraapp import server
        cls.tmp = tempfile.TemporaryDirectory()
        server.store = Store(Path(cls.tmp.name))
        server.KEY = server.load_key(Path(cls.tmp.name))
        cls.key = server.KEY
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        server.PORT = cls.srv.server_address[1]
        cls.port = server.PORT
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.tmp.cleanup()

    def req(self, path, body=None, headers=None):
        h = {"Content-Type": "application/json", "Cookie": "zebra_key=" + self.key}
        if body is not None:
            h["X-ZebraApp"] = "1"
        h.update(headers or {})
        r = urllib.request.Request("http://127.0.0.1:%d%s" % (self.port, path),
                                   data=None if body is None else json.dumps(body).encode(), headers=h)
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, resp.read()

    def test_static_and_settings(self):
        code, body = self.req("/")
        self.assertEqual(code, 200)
        self.assertIn(b"ZebraApp", body)
        code, body = self.req("/static/js/zpl.js")
        self.assertEqual(code, 200)
        self.assertIn("printers", json.loads(self.req("/api/settings")[1]))
        fams = json.loads(self.req("/api/fonts")[1])["families"]
        self.assertIsInstance(fams, list)
        self.assertEqual(self.req("/static/js/zplimport.js")[0], 200)

    def test_security(self):
        for headers, body in (({"X-ZebraApp": ""}, {}), ({"Origin": "http://evil.example"}, {})):
            with self.assertRaises(urllib.error.HTTPError) as cm:
                self.req("/api/print_raw", body, headers)
            self.assertEqual(cm.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.req("/static/../server.py")
        self.assertIn(cm.exception.code, (403, 404))

    def test_session_cookie_is_required(self):
        import http.client

        def call(method, path, headers=None, body=None):
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            c.request(method, path, body=body, headers=dict({"Host": "localhost:%d" % self.port}, **(headers or {})))
            r = c.getresponse()
            data = r.read()
            out = (r.status, dict(r.getheaders()), data)
            c.close()
            return out
        self.assertEqual(call("GET", "/api/ping")[0], 200)                       # open, says nothing
        self.assertEqual(call("GET", "/api/settings")[0], 403)
        self.assertEqual(call("GET", "/static/js/zpl.js")[0], 403)
        self.assertEqual(call("GET", "/api/settings", {"Cookie": "zebra_key=wrong"})[0], 403)
        self.assertEqual(call("GET", "/")[0], 403)                               # explains how to open it
        post = {"X-ZebraApp": "1", "Content-Type": "application/json"}
        self.assertEqual(call("POST", "/api/print_raw", post, b'{"data":"^XA^XZ"}')[0], 403)
        self.assertEqual(call("POST", "/api/launch", post, b"{}")[0], 403)       # needs the key
        self.assertEqual(call("POST", "/api/launch", dict(post, **{"X-ZebraApp-Key": "nope"}), b"{}")[0], 403)
        # the launch code is exchanged once for the cookie
        st, _, data = call("POST", "/api/launch", dict(post, **{"X-ZebraApp-Key": self.key}), b"{}")
        self.assertEqual(st, 200)
        code = json.loads(data)["code"]
        st, hdr, _ = call("GET", "/?k=" + code)
        self.assertEqual(st, 302)
        self.assertIn("zebra_key=" + self.key, hdr["Set-Cookie"])
        self.assertIn("HttpOnly", hdr["Set-Cookie"])
        self.assertIn("SameSite=Strict", hdr["Set-Cookie"])
        self.assertEqual(call("GET", "/?k=" + code)[0], 403)                     # used up
        self.assertEqual(call("GET", "/", {"Cookie": hdr["Set-Cookie"].split(";")[0]})[0], 200)

    def test_key_file_is_private_and_stable(self):
        from zebraapp import server
        with tempfile.TemporaryDirectory() as d:
            k1 = server.load_key(Path(d))
            self.assertEqual(server.load_key(Path(d)), k1)
            self.assertGreaterEqual(len(k1), 64)
            if os.name == "posix":
                self.assertEqual((Path(d) / "session.key").stat().st_mode & 0o077, 0)

    def test_print_through_device_printer(self):
        out = os.path.join(self.tmp.name, "printed.zpl")
        self.req("/api/settings", {"printers": [{"id": "p1", "name": "File", "transport": "device", "path": out}], "active": "p1", "language": "en"})
        res = json.loads(self.req("/api/print_raw", {"data": "^XA^FDhi^FS^XZ"})[1])
        self.assertTrue(res["ok"], res)
        self.assertIn("Sent 14 bytes to File", res["message"])
        self.assertEqual(Path(out).read_text(), "^XA^FDhi^FS^XZ")


if __name__ == "__main__":
    unittest.main()


class TemplatesTest(unittest.TestCase):
    def test_templates_roundtrip_and_validation(self):
        with tempfile.TemporaryDirectory() as d:
            st = Store(Path(d))
            self.assertEqual(st.templates(), [])
            t = {"id": "a", "name": "Adres", "w": 80, "h": 40, "dpi": 300, "elements": []}
            st.save_templates([t])
            self.assertEqual(st.templates()[0]["name"], "Adres")
            for bad in ([{"w": 80, "h": 40, "dpi": 300}], [dict(t, dpi=250)], [dict(t, w=True)], [dict(t, h=0)], "x"):
                with self.assertRaises(ValueError):
                    st.save_templates(bad)


class NlblTest(unittest.TestCase):
    def setUp(self):
        try:
            import pyzipper  # noqa: F401
            import PIL  # noqa: F401
        except ImportError:
            self.skipTest("pyzipper/Pillow not installed")

    def test_export_then_import(self):
        from zebraapp.nlbl import export_label, import_label
        label = {"name": "Deneme", "w": 80, "h": 40, "dpi": 300, "elements": [
            {"type": "text", "x": 3, "y": 2, "size": 4, "text": "Merhaba Şişli", "bold": True, "font": ""},
            {"type": "qr", "x": 50, "y": 5, "mag": 5, "ec": "Q", "data": "https://example.com"},
            {"type": "barcode", "kind": "code128", "x": 3, "y": 20, "h": 8, "module": 2, "data": "ABC123", "human": True},
            {"type": "line", "x": 3, "y": 15, "dir": "h", "len": 60, "t": 0.3},
            {"type": "box", "x": 1, "y": 1, "w": 78, "h": 38, "t": 0.5, "round": 2},
        ]}
        raw, _ = export_label(label)
        back, _ = import_label(raw)
        kinds = [e["type"] for e in back["elements"]]
        self.assertEqual(sorted(kinds), sorted(["text", "qr", "barcode", "line", "box"]))
        self.assertEqual((back["w"], back["h"], back["dpi"]), (80, 40, 300))
        text = next(e for e in back["elements"] if e["type"] == "text")
        self.assertEqual(text["text"], "Merhaba Şişli")
        self.assertTrue(text["bold"])
        qr = next(e for e in back["elements"] if e["type"] == "qr")
        self.assertEqual((qr["data"], qr["ec"], qr["mag"]), ("https://example.com", "Q", 5))

    def test_rejects_what_it_cannot_carry(self):
        from zebraapp.nlbl import export_label
        base = {"name": "x", "w": 80, "h": 40, "dpi": 300, "elements": []}
        with self.assertRaises(ValueError):
            export_label(dict(base, dpi=203))
        with self.assertRaises(ValueError):
            export_label(dict(base, elements=[{"type": "text", "x": 0, "y": 0, "text": "a", "rot": 90}]))
        with self.assertRaises(ValueError):
            from zebraapp.nlbl import import_label
            import_label(b"not a zip")

