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
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        server.PORT = cls.srv.server_address[1]
        cls.port = server.PORT
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.tmp.cleanup()

    def req(self, path, body=None, headers=None):
        h = {"Content-Type": "application/json"}
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

    def test_security(self):
        for headers, body in (({"X-ZebraApp": ""}, {}), ({"Origin": "http://evil.example"}, {})):
            with self.assertRaises(urllib.error.HTTPError) as cm:
                self.req("/api/print_raw", body, headers)
            self.assertEqual(cm.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.req("/static/../server.py")
        self.assertIn(cm.exception.code, (403, 404))

    def test_print_through_device_printer(self):
        out = os.path.join(self.tmp.name, "printed.zpl")
        self.req("/api/settings", {"printers": [{"id": "p1", "name": "File", "transport": "device", "path": out}], "active": "p1", "language": "en"})
        res = json.loads(self.req("/api/print_raw", {"data": "^XA^FDhi^FS^XZ"})[1])
        self.assertTrue(res["ok"], res)
        self.assertIn("Sent 14 bytes to File", res["message"])
        self.assertEqual(Path(out).read_text(), "^XA^FDhi^FS^XZ")


if __name__ == "__main__":
    unittest.main()
