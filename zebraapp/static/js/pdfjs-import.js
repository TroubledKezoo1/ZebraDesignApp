/* Opens a PDF page in the browser (pdf.js, bundled, offline) and renders it at printer resolution.
   Used on Android, and on the desktop when the server has no PDF engine. */
(function () {
  "use strict";
  var MAX_PIXELS = 4000000, MAX_PAGES = 500;
  var loading = null;
  function script(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script"); s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error("pdf.js")); };
      document.head.appendChild(s);
    });
  }
  function lib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!loading) loading = script("/static/vendor/pdf.min.js").then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdf.worker.min.js";
      return window.pdfjsLib;
    });
    return loading;
  }
  function fail(code) { var e = new Error(code); e.code = code; return e; }

  /* buffer (ArrayBuffer) -> { pages: [{page, w, h}] in mm, render(page, dpi) -> Promise<{ dataUrl, w, h }>, close() } */
  function open(buffer) {
    return lib().then(function (pdfjs) {
      return pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise.catch(function (e) {
        throw fail(e && e.name === "PasswordException" ? "password" : "invalid");
      });
    }).then(function (pdf) {
      if (pdf.numPages < 1 || pdf.numPages > MAX_PAGES) throw fail("pages");
      var sizes = [], seq = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) (function (n) {
        seq = seq.then(function () { return pdf.getPage(n); }).then(function (p) {
          var v = p.getViewport({ scale: 1 }), w = v.width * 25.4 / 72, h = v.height * 25.4 / 72;
          if (!(w >= 1 && w <= 2000 && h >= 1 && h <= 2000)) throw fail("size");
          sizes.push({ page: n, w: Math.round(w * 10000) / 10000, h: Math.round(h * 10000) / 10000 });
        });
      })(i);
      return seq.then(function () {
        return {
          pages: sizes,
          render: function (n, dpi) {
            var s = sizes[n - 1]; if (!s) return Promise.reject(fail("page"));
            var pw = Math.max(1, Math.round(s.w * dpi / 25.4)), ph = Math.max(1, Math.round(s.h * dpi / 25.4));
            if (Math.ceil(s.w * dpi / 25.4) * Math.ceil(s.h * dpi / 25.4) > MAX_PIXELS) return Promise.reject(fail("big"));
            return pdf.getPage(n).then(function (p) {
              var v1 = p.getViewport({ scale: 1 }), c = document.createElement("canvas"); c.width = pw; c.height = ph;
              var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, pw, ph);
              var vp = p.getViewport({ scale: pw / v1.width });
              return p.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                return { dataUrl: c.toDataURL("image/png"), w: s.w, h: s.h };
              });
            });
          },
          close: function () { try { pdf.destroy(); } catch (e) { /* ignore */ } }
        };
      });
    });
  }
  window.ZebraPdf = { open: open };
})();
