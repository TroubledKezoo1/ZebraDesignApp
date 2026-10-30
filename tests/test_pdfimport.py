"""PDF tests use generated, public-domain fixtures; no customer documents."""
import base64
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from zebraapp import pdfimport


def make_pdf(rotated=False, cropped=False):
    """Two differently sized pages with distinct black marks, without extra deps."""
    first = "q 0 0 0 rg 0 0 20 20 re f Q"
    second = "q 0 0 0 rg 40 40 20 20 re f Q"
    attrs = (" /Rotate 90" if rotated else "") + (" /CropBox [0 0 113.3858268 56.6929134]" if cropped else "")
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 226.7716535 113.3858268] /Contents 4 0 R%s >>" % attrs,
        "<< /Length %d >>\nstream\n%s\nendstream" % (len(first), first),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 170.0787402 226.7716535] /Contents 6 0 R >>",
        "<< /Length %d >>\nstream\n%s\nendstream" % (len(second), second),
    ]
    data = b"%PDF-1.4\n"
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += ("%d 0 obj\n%s\nendobj\n" % (i, obj)).encode("ascii")
    start = len(data)
    data += ("xref\n0 %d\n0000000000 65535 f \n" % len(offsets)).encode("ascii")
    data += b"".join(("%010d 00000 n \n" % offset).encode("ascii") for offset in offsets[1:])
    data += ("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(offsets), start)).encode("ascii")
    return data


HAVE_PDF = bool(importlib.util.find_spec("pypdfium2") and importlib.util.find_spec("PIL"))


@unittest.skipUnless(HAVE_PDF, "install .[pdf] to test PDF import")
class PDFImportTest(unittest.TestCase):
    def test_dimensions_rotation_crop_and_page_selection(self):
        pages = pdfimport.inspect_pdf(make_pdf())["pages"]
        self.assertEqual([(p["w"], p["h"]) for p in pages], [(80, 40), (60, 80)])
        self.assertEqual(pdfimport.inspect_pdf(make_pdf(rotated=True))["pages"][0]["w"], 40)
        self.assertEqual(pdfimport.inspect_pdf(make_pdf(cropped=True))["pages"][0]["w"], 40)
        label = pdfimport.import_pdf(make_pdf(), page=2, name="sample.pdf")
        self.assertEqual((label["w"], label["h"], label["name"]), (60, 80, "sample (2/2)"))

    def test_printer_resolution_embedded_pixels_and_one_copy(self):
        from PIL import Image
        original = make_pdf()
        for dpi in (203, 300, 600):
            label = pdfimport.import_pdf(original, dpi=dpi, name="example.PDF")
            image = Image.open(io.BytesIO(base64.b64decode(label["elements"][0]["src"].split(",")[1])))
            self.assertEqual(image.size, (round(80 * dpi / 25.4), round(40 * dpi / 25.4)))
            self.assertEqual(image.getpixel((1, image.height - 2)), (0, 0, 0))
            self.assertEqual(image.getpixel((image.width - 2, 1)), (255, 255, 255))
            self.assertEqual(label["job"]["copies"], 1)
            self.assertEqual(label["job"]["count"], 1)
        self.assertEqual(original, make_pdf())

    def test_bad_files_pages_dpi_and_allocation_limits(self):
        for bad in (b"", b"not a PDF", "not bytes"):
            with self.assertRaises(ValueError):
                pdfimport.inspect_pdf(bad)
        for page in (0, 3, -1, True, "1", 1.5):
            with self.assertRaises(ValueError):
                pdfimport.import_pdf(make_pdf(), page=page)
        for dpi in (0, 250, True, "300"):
            with self.assertRaises(ValueError):
                pdfimport.import_pdf(make_pdf(), dpi=dpi)
        with patch.object(pdfimport, "MAX_BYTES", 10), self.assertRaises(ValueError):
            pdfimport.inspect_pdf(make_pdf())
        with patch.object(pdfimport, "MAX_PAGES", 1), self.assertRaises(ValueError):
            pdfimport.inspect_pdf(make_pdf())
        with patch.object(pdfimport, "MAX_PIXELS", 10), self.assertRaisesRegex(ValueError, "lower dpi"):
            pdfimport.import_pdf(make_pdf())

    def test_password_protected_pdf_is_rejected(self):
        # Generated from make_pdf(), not a customer document.
        data = base64.b64decode('JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDBjZWE4YWFhOWE+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMgovS2lkcyBbIDQgMCBSIDYgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9NZWRpYUJveCBbIDAgMCAyMjYuNzcxNjU0IDExMy4zODU4MjcgXQovQ29udGVudHMgNSAwIFIKL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovTGVuZ3RoIDI3Cj4+CnN0cmVhbQpM8gPYKEwtBVYmTf6SwFvRQbWY9e4enntbpsUKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9NZWRpYUJveCBbIDAgMCAxNzAuMDc4NzQgMjI2Ljc3MTY1NCBdCi9Db250ZW50cyA3IDAgUgovUGFyZW50IDIgMCBSCj4+CmVuZG9iago3IDAgb2JqCjw8Ci9MZW5ndGggMjkKPj4Kc3RyZWFtCtTmy29PGg4yczw3WLOduIymklXIUtCyGQWOw4PoCmVuZHN0cmVhbQplbmRvYmoKOCAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8YTgxN2MwMzIxY2ViOTJjMDQ3MDkyMDc2MTA0NjJkZjViZWIwMzJjYzBhYTQ4YTY3MGY5YWVmNTM3NTk2MzdkNj4KL1UgPGU5NzY2MDgxZTEyMTJkYmM0M2ZhMDMxMWYxMTE3YjY2MjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgOQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTI0IDAwMDAwIG4gCjAwMDAwMDAxNzMgMDAwMDAgbiAKMDAwMDAwMDI3NiAwMDAwMCBuIAowMDAwMDAwMzUzIDAwMDAwIG4gCjAwMDAwMDA0NTUgMDAwMDAgbiAKMDAwMDAwMDUzNCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDkKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDMzMzUzMzM0MzYzNDYyMzg2NTM4MzE2MjMxMzE2MTM1MzEzMDYyNjUzOTM3MzUzMjM1MzgzMTM1NjU2MzYyNjI+IDwzMzM1MzMzNDM2MzQ2MjM4NjUzODMxNjIzMTMxNjEzNTMxMzA2MjY1MzkzNzM1MzIzNTM4MzEzNTY1NjM2MjYyPiBdCi9FbmNyeXB0IDggMCBSCj4+CnN0YXJ0eHJlZgo3NDkKJSVFT0YK')
        with self.assertRaisesRegex(ValueError, "password-protected"):
            pdfimport.inspect_pdf(data)

    def test_native_calls_are_serialized(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            labels = list(pool.map(lambda p: pdfimport.import_pdf(make_pdf(), page=p), [1, 2, 1, 2] * 2))
        self.assertEqual([x["w"] for x in labels], [80, 60] * 4)

    def test_missing_dependencies_report_install_instruction(self):
        import builtins
        real_import = builtins.__import__

        def without_pdfium(name, *args, **kwargs):
            if name == "pypdfium2":
                raise ImportError("not installed")
            return real_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=without_pdfium):
            with self.assertRaisesRegex(ValueError, r"zebraapp\[pdf\]"):
                pdfimport.import_pdf(make_pdf())


@unittest.skipUnless(HAVE_PDF, "install .[pdf] to test PDF import")
class PDFHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from http.server import ThreadingHTTPServer
        from zebraapp import server
        from zebraapp.storage import Store
        cls.server = server
        cls.old_store, cls.old_port = server.store, server.PORT
        cls.tmp = tempfile.TemporaryDirectory()
        server.store = Store(Path(cls.tmp.name))
        server.store.save_config({"language": "en", "printers": []})
        cls.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        server.PORT = cls.http.server_port
        cls.url = "http://127.0.0.1:%d" % server.PORT
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.server.store, cls.server.PORT = cls.old_store, cls.old_port
        cls.tmp.cleanup()

    def request(self, path, body, headers=None):
        request = urllib.request.Request(self.url + path, json.dumps(body).encode(),
                                        {"Content-Type": "application/json", "X-ZebraApp": "1", **(headers or {})})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())

    def test_info_import_and_invalid_input(self):
        data = base64.b64encode(make_pdf()).decode()
        self.assertEqual(len(self.request("/api/pdf/info", {"data": data})["pages"]), 2)
        result = self.request("/api/pdf/import", {"data": data, "page": 2, "dpi": 203})
        self.assertTrue(result["ok"])
        self.assertEqual(result["label"]["w"], 60)
        for body in ({"data": "!"}, {"data": []}, {"data": data, "page": 3}, {"data": data, "dpi": 250}):
            self.assertFalse(self.request("/api/pdf/import", body)["ok"])

    def test_import_cannot_print_and_requires_same_origin_header(self):
        data = {"data": base64.b64encode(make_pdf()).decode()}
        with patch.object(self.server.transports, "send", side_effect=AssertionError("must not print")):
            self.assertTrue(self.request("/api/pdf/import", data)["ok"])
        for headers in ({"X-ZebraApp": ""}, {"Origin": "https://example.invalid"}):
            with self.assertRaises(urllib.error.HTTPError) as context:
                self.request("/api/pdf/info", data, headers)
            self.assertEqual(context.exception.code, 403)


if __name__ == "__main__":
    unittest.main()
