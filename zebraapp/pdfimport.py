"""Import one PDF page as a self-contained label image, at printer resolution.

PDFium is not thread-safe, even across separate documents. Keep every native
operation (including cleanup) behind the same lock in the threaded web server.
"""
from __future__ import annotations

import base64
from contextlib import closing, contextmanager
import io
import math
from pathlib import PurePosixPath
import threading
import uuid

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 500
MAX_PIXELS = 4_000_000
_lock = threading.Lock()


@contextmanager
def _document(data):
    if not isinstance(data, bytes) or not data or len(data) > MAX_BYTES:
        raise ValueError("PDF files must be non-empty and no larger than 20 MB.")
    try:
        import pypdfium2 as pdfium
        from PIL import Image  # noqa: F401
    except ImportError as exc:
        raise ValueError('PDF import needs pypdfium2 and Pillow: pip install "zebraapp[pdf]"') from exc
    with _lock:
        try:
            doc = pdfium.PdfDocument(data)
        except pdfium.PdfiumError as exc:
            raise ValueError("The PDF could not be opened. Check that it is valid and not password-protected.") from exc
        try:
            if not 1 <= len(doc) <= MAX_PAGES:
                raise ValueError("A PDF must contain between 1 and 500 pages.")
            yield doc
        finally:
            doc.close()


def _size(page):
    width, height = page.get_size()  # Includes the page's CropBox and /Rotate.
    mm = (width * 25.4 / 72, height * 25.4 / 72)
    if not all(math.isfinite(n) and 1 <= n <= 2000 for n in mm):
        raise ValueError("PDF page dimensions must be between 1 and 2000 mm.")
    return mm


def inspect_pdf(data):
    """Return physical page sizes without rendering or touching the printer."""
    with _document(data) as doc:
        pages = []
        for index in range(len(doc)):
            with closing(doc[index]) as page:
                w, h = _size(page)
            pages.append({"page": index + 1, "w": round(w, 4), "h": round(h, 4)})
        return {"pages": pages}


def import_pdf(data, page=1, dpi=300, name="PDF"):
    """Render a one-based page; the original PDF is never rewritten."""
    if isinstance(dpi, bool) or dpi not in (203, 300, 600):
        raise ValueError("Choose a resolution of 203, 300 or 600 dpi.")
    if isinstance(page, bool) or not isinstance(page, int):
        raise ValueError("Choose a valid PDF page number.")
    with _document(data) as doc:
        from PIL import Image

        if not 1 <= page <= len(doc):
            raise ValueError("Choose a valid PDF page number.")
        doc.init_forms()
        with closing(doc[page - 1]) as source:
            w, h = _size(source)
            pixels = (max(1, round(w * dpi / 25.4)), max(1, round(h * dpi / 25.4)))
            if math.ceil(w * dpi / 25.4) * math.ceil(h * dpi / 25.4) > MAX_PIXELS:
                raise ValueError("This PDF page is too large at this resolution. Choose a lower dpi (maximum 4 million pixels).")
            with closing(source.render(scale=dpi / 72)) as bitmap:
                image = bitmap.to_pil().convert("RGB")
            if image.size != pixels:
                image = image.resize(pixels, Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="PNG")
        title = PurePosixPath(str(name).replace("\\", "/")).name
        if title.lower().endswith(".pdf"):
            title = title[:-4]
        title = (title or "PDF")[:120]
        if len(doc) > 1:
            title += " (%d/%d)" % (page, len(doc))
    return {
        "id": uuid.uuid4().hex[:10], "name": title, "w": round(w, 4), "h": round(h, 4), "dpi": dpi,
        "settings": {"media": "gap", "darkness": "", "speed": "", "shiftX": 0, "shiftY": 0, "rotate180": False},
        "job": {"copies": 1, "count": 1, "start": 1, "step": 1, "digits": 0, "csv": ""},
        "elements": [{"id": uuid.uuid4().hex[:10], "type": "image", "name": title,
                      "x": 0, "y": 0, "w": round(w, 4), "h": round(h, 4),
                      "src": "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii"),
                      "threshold": 128, "dither": False, "invert": False, "keepAspect": True,
                      "rot": 0, "hidden": False, "locked": False}]
    }
