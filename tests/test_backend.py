"""Backend tests: storage, transports and the HTTP server (no printer needed)."""
import base64
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

    def test_open_with_file(self):
        """A file given on the command line reaches the window once, through a token."""
        import http.client
        from zebraapp import server

        def call(method, path, headers=None, body=None):
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            c.request(method, path, body=body, headers=dict({"Host": "localhost:%d" % self.port}, **(headers or {})))
            r = c.getresponse()
            out = (r.status, dict(r.getheaders()), r.read())
            c.close()
            return out
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "Deneme etiketi.zebra"
            f.write_text('{"format":"ZebraApp","w":50,"h":30,"elements":[]}', encoding="utf-8")
            (Path(d) / "bos.nlbl").write_bytes(b"")
            (Path(d) / "notes.exe").write_bytes(b"x")
            self.assertEqual(server.register_open(str(Path(d) / "notes.exe")), "")      # not a label file
            self.assertEqual(server.register_open(str(Path(d) / "missing.zebra")), "")
            # a second start asks the running copy for a window code and a file token
            post = {"X-ZebraApp": "1", "Content-Type": "application/json", "X-ZebraApp-Key": self.key}
            st, _, data = call("POST", "/api/launch", post, json.dumps({"open": str(f)}).encode())
            j = json.loads(data)
            self.assertTrue(j["open"])
            st, hdr, _ = call("GET", "/?k=%s&open=%s" % (j["code"], j["open"]))
            self.assertEqual((st, hdr["Location"]), (302, "/?open=" + j["open"]))
            self.assertEqual(call("GET", "/api/opened?t=" + j["open"])[0], 403)       # needs the cookie
            out = json.loads(self.req("/api/opened?t=" + j["open"])[1])
            self.assertEqual(out["name"], "Deneme etiketi.zebra")
            self.assertEqual(base64.b64decode(out["data"]), f.read_bytes())
            self.assertFalse(json.loads(self.req("/api/opened?t=" + j["open"])[1])["ok"])   # used up
            out = json.loads(self.req("/api/opened?t=" + server.register_open(str(Path(d) / "bos.nlbl")))[1])
            self.assertFalse(out["ok"])
            self.assertIn("0", out["message"])

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


class MessagesTest(unittest.TestCase):
    def test_server_messages_follow_the_language(self):
        from zebraapp.messages import localize
        no_printer = "No printer selected. Add one under Printers."
        self.assertNotEqual(localize(no_printer, (), "tr"), no_printer)              # Turkish, no parameters
        self.assertEqual(localize(no_printer, (), "en"), no_printer)
        self.assertNotEqual(localize("Choose a valid PDF page number.", (), "pt"), "Choose a valid PDF page number.")
        self.assertEqual(localize("Choose a valid PDF page number.", (), "pt-BR"), localize("Choose a valid PDF page number.", (), "pt"))
        self.assertIn("ZD421", localize("Sent %d bytes to %s.", (12, "ZD421"), "tr"))


class FileTypesTest(unittest.TestCase):
    """The downloaded Linux app registers .zebra/.nlbl for the user once per path and version."""

    def test_linux_registration(self):
        from unittest import mock
        from zebraapp import integrate
        ran = []
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(integrate, "_run", ran.append), \
                mock.patch.object(integrate, "SYSTEM_DESKTOP", Path(d) / "none.desktop"), \
                mock.patch.object(integrate.sys, "platform", "linux"), \
                mock.patch.dict(os.environ, {"XDG_DATA_HOME": ""}):
            home, data = Path(d) / "home", Path(d) / "data"
            data.mkdir()
            app = "/home/kullanici/İndirilenler/Zebra App $1.AppImage"
            self.assertEqual(integrate.register(data, app, home), "linux")
            entry = (home / ".local/share/applications/zebraapp.desktop").read_text(encoding="utf-8")
            self.assertIn('Exec="/home/kullanici/İndirilenler/Zebra App \\$1.AppImage" %F', entry)
            self.assertIn("MimeType=application/x-zebraapp-label;application/x-zebradesigner-label;", entry)
            self.assertIn('pattern="*.nlbl"', (home / ".local/share/mime/packages/zebraapp.xml").read_text(encoding="utf-8"))
            self.assertTrue((home / ".local/share/icons/hicolor/scalable/apps/zebraapp.svg").exists())
            self.assertIn(["xdg-mime", "default", "zebraapp.desktop", integrate.MIME_ZEBRA, integrate.MIME_NLBL], ran)
            self.assertEqual(integrate.register(data, app, home), "")               # done already
            self.assertEqual(integrate.register(data, "/opt/ZebraApp.AppImage", home), "linux")   # moved
            (Path(d) / "none.desktop").write_text("")                               # the .deb is installed
            self.assertEqual(integrate.register(data, "/elsewhere.AppImage", home), "deb")

    @unittest.skipUnless(sys.platform == "win32" and os.environ.get("CI"), "writes to the registry: only on CI Windows runners")
    def test_windows_registration(self):
        import winreg
        from zebraapp import integrate
        exe = r"C:\Programlar\Zebra App\ZebraApp.exe"
        try:
            self.assertEqual(integrate._windows(exe), "windows")
            def value(path, name=""):
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Software\\Classes\\" + path) as k:
                    return winreg.QueryValueEx(k, name)[0]
            self.assertEqual(value(r"ZebraApp.Label\shell\open\command"), '"%s" "%%1"' % exe)
            self.assertEqual(value(".zebra"), "ZebraApp.Label")
            value(r".nlbl\OpenWithProgids", "ZebraApp.Label")                       # listed under "Open with"
        finally:
            for path in (r"ZebraApp.Label\shell\open\command", r"ZebraApp.Label\shell\open", r"ZebraApp.Label\shell",
                         r"ZebraApp.Label\DefaultIcon", "ZebraApp.Label", r".zebra\OpenWithProgids", ".zebra",
                         r".nlbl\OpenWithProgids", ".nlbl"):
                try:
                    winreg.DeleteKey(winreg.HKEY_CURRENT_USER, "Software\\Classes\\" + path)
                except OSError:
                    pass

    def test_only_downloaded_apps_register(self):
        from zebraapp import integrate
        self.assertIsNone(integrate.app_path())                                     # running from source
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(integrate.register(Path(d)), "")


class AesZipTest(unittest.TestCase):
    """.nlbl files are WinZip AES zips; read and written without extra packages."""
    PW = b"deneme-parola"

    def test_aes_known_answers(self):
        from zebraapp import aeszip
        plain = bytes.fromhex("00112233445566778899aabbccddeeff")          # FIPS-197 appendix C
        for size, expected in ((16, "69c4e0d86a7b0430d8cdb78070b4c55a"), (24, "dda97ca4864cdfe06eaf70a0ec0d7191"),
                               (32, "8ea2b7ca516745bfeafc49904b496089")):
            w, rounds = aeszip._expand(bytes(range(size)))
            self.assertEqual(aeszip._encrypt_block(w, rounds, plain).hex(), expected)

    def test_roundtrip_password_and_tampering(self):
        from zebraapp import aeszip
        import zipfile
        files = {"Formats/Öğe": b"<a>" + b"x" * 5000 + b"</a>", "b.slnx": b"", "c": b"kisa"}
        raw = aeszip.write(list(files.items()), self.PW)
        self.assertEqual(aeszip.read_all(raw, self.PW, 10 ** 6), files)
        with self.assertRaises(RuntimeError):
            aeszip.read_all(raw, b"yanlis", 10 ** 6)
        broken = bytearray(raw)
        broken[100] ^= 1                                                     # inside the encrypted body
        with self.assertRaises(zipfile.BadZipFile):
            aeszip.read_all(bytes(broken), self.PW, 10 ** 6)
        with self.assertRaises(ValueError):
            aeszip.read_all(raw, self.PW, 100)                                  # over the size limit

    def test_same_format_as_pyzipper(self):
        try:
            import pyzipper
        except ImportError:
            self.skipTest("pyzipper not installed (only needed for this cross-check)")
        import io
        from zebraapp import aeszip
        files = {"Formats/A": b"y" * 3000, "A.slnx": b"<s/>"}
        with pyzipper.AESZipFile(io.BytesIO(aeszip.write(list(files.items()), self.PW))) as z:
            z.setpassword(self.PW)
            self.assertEqual({n: z.read(n) for n in z.namelist()}, files)
        out = io.BytesIO()
        with pyzipper.AESZipFile(out, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES) as z:
            z.setpassword(self.PW)
            for n, v in files.items():
                z.writestr(n, v)
        self.assertEqual(aeszip.read_all(out.getvalue(), self.PW, 10 ** 6), files)


class NlblTest(unittest.TestCase):
    def test_empty_and_foreign_files_are_explained(self):
        from zebraapp.nlbl import import_label
        with self.assertRaisesRegex(ValueError, "0 bayt"):
            import_label(b"")
        with self.assertRaisesRegex(ValueError, "geçerli bir ZebraDesigner"):
            import_label(b"PK\x03\x04 bozuk")

    def test_png_image_without_pillow(self):
        import base64, struct, zlib
        from unittest import mock
        from zebraapp import nlbl
        row = b"\x00" + b"\xff\xff\xff\xff"
        def chunk(t, d):
            return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(row)) + chunk(b"IEND", b"")
        with mock.patch.dict("sys.modules", {"PIL": None}):
            self.assertEqual(nlbl._image_png(png), png)
            with self.assertRaisesRegex(ValueError, "PNG değil"):
                nlbl._image_png(b"\xff\xd8\xff jpeg")
            label = {"name": "Görsel", "w": 30, "h": 20, "dpi": 300, "elements": [
                {"type": "image", "x": 1, "y": 1, "w": 10, "h": 10, "src": "data:image/png;base64," + base64.b64encode(png).decode()}]}
            back, _ = nlbl.import_label(nlbl.export_label(label)[0])
        self.assertEqual(back["elements"][0]["type"], "image")

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

