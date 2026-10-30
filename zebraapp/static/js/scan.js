/* Scan a barcode or QR code with the camera (or from a photo) and hand the text back.
   Uses ZXing (zebraapp/static/vendor/zxing.min.js), so it works offline and in the Android WebView. */
(function () {
  "use strict";
  function lang() { return (window.I18N && window.I18N.lang) || "tr"; }
  function L(tr, en) { return lang() === "en" ? en : tr; }

  var reader = null;
  function getReader() {
    if (reader) return reader;
    var Z = window.ZXing, F = Z.BarcodeFormat, hints = new Map();
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.DATA_MATRIX, F.PDF_417, F.AZTEC]);
    reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    return reader;
  }
  /* canvas -> { text, format } or null */
  function decodeCanvas(canvas) {
    var Z = window.ZXing;
    try {
      var bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      var r = getReader().decode(bmp);
      return { text: r.getText(), format: Z.BarcodeFormat[r.getBarcodeFormat()] };
    } catch (e) { return null; }
  }
  function drawScaled(src, w, h, canvas, max) {
    var k = Math.min(1, max / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  function decodeImageFile(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas"), res = null;
        [1600, 900, 2400].some(function (m) { res = decodeCanvas(drawScaled(img, img.naturalWidth, img.naturalHeight, c, m)); return !!res; });
        URL.revokeObjectURL(url); resolve(res);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  function open(done) {
    var old = document.getElementById("zScan"); if (old) old.remove();
    var wrap = document.createElement("div"); wrap.id = "zScan"; wrap.setAttribute("role", "dialog");
    wrap.style.cssText = "position:fixed;inset:0;z-index:100001;background:#000;color:#fff;display:grid;grid-template-rows:minmax(0,1fr) auto;font:14px/1.4 var(--ui)";
    var stage = document.createElement("div"); stage.style.cssText = "position:relative;overflow:hidden;min-height:0";
    var video = document.createElement("video"); video.setAttribute("playsinline", ""); video.muted = true; video.autoplay = true;
    video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover";
    var frame = document.createElement("div");
    frame.style.cssText = "position:absolute;left:50%;top:50%;width:min(78vw,420px);height:min(46vw,260px);transform:translate(-50%,-50%);border:3px solid rgba(255,255,255,.9);border-radius:14px;box-shadow:0 0 0 100vmax rgba(0,0,0,.45);pointer-events:none";
    var msg = document.createElement("div"); msg.setAttribute("role", "status");
    msg.style.cssText = "position:absolute;left:12px;right:12px;top:12px;text-align:center;text-shadow:0 1px 3px #000";
    msg.textContent = L("Barkodu ya da QR kodu çerçevenin içine getirin.", "Point the camera at a barcode or QR code.");
    stage.append(video, frame, msg);
    var bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:12px;background:#111";
    function btn(label, fn) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = fn;
      b.style.cssText = "min-height:44px;padding:0 16px;border-radius:8px;border:1px solid #555;background:#222;color:#fff;font:inherit;cursor:pointer";
      return b;
    }
    var stream = null, alive = true, timer = null, track = null;
    function stop() {
      alive = false; if (timer) clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      document.removeEventListener("keydown", onKey);
      wrap.remove();
    }
    function onKey(e) { if (e.key === "Escape") stop(); }
    function found(res) {
      if (!alive) return;
      try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* ignore */ }
      stop(); done(res);
    }
    var photo = document.createElement("input"); photo.type = "file"; photo.accept = "image/*"; photo.setAttribute("capture", "environment"); photo.hidden = true;
    photo.onchange = function () {
      var f = photo.files[0]; photo.value = ""; if (!f) return;
      msg.textContent = L("Fotoğraf okunuyor…", "Reading the photo…");
      decodeImageFile(f).then(function (res) { if (res) found(res); else msg.textContent = L("Fotoğrafta barkod bulunamadı. Daha yakından ve net çekin.", "No barcode found in the photo. Try again, closer and sharper."); });
    };
    var torchBtn = btn(L("Fener", "Torch"), function () {
      var on = !torchBtn.dataset.on;
      track.applyConstraints({ advanced: [{ torch: on }] }).then(function () { torchBtn.dataset.on = on ? "1" : ""; torchBtn.style.background = on ? "#555" : "#222"; }).catch(function () { /* no torch */ });
    });
    torchBtn.hidden = true;
    bar.append(torchBtn, btn(L("Fotoğraftan oku", "Read from a photo"), function () { photo.click(); }), btn(L("Kapat", "Close"), stop), photo);
    wrap.append(stage, bar); document.body.appendChild(wrap);
    document.addEventListener("keydown", onKey);

    if (!window.ZXing) { msg.textContent = L("Okuyucu yüklenemedi.", "The scanner did not load."); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg.textContent = L("Bu cihazda kamera kullanılamıyor. “Fotoğraftan oku” ile deneyin.", "No camera access here. Try “Read from a photo”."); return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then(function (s) {
      if (!alive) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; video.srcObject = s; track = s.getVideoTracks()[0];
      try { var caps = track.getCapabilities && track.getCapabilities(); if (caps && caps.torch) torchBtn.hidden = false; } catch (e) { /* ignore */ }
      var canvas = document.createElement("canvas");
      (function tick() {
        if (!alive) return;
        if (video.readyState >= 2 && video.videoWidth) {
          var res = decodeCanvas(drawScaled(video, video.videoWidth, video.videoHeight, canvas, 1280));
          if (res) return found(res);
        }
        timer = setTimeout(tick, 120);
      })();
    }).catch(function (e) {
      var denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
      msg.textContent = denied ? L("Kamera izni verilmedi. Telefonun ayarlarından ZebraApp'e kamera izni verin ya da “Fotoğraftan oku”yu kullanın.", "Camera permission was denied. Allow the camera for ZebraApp in settings, or use “Read from a photo”.")
        : L("Kamera açılamadı. “Fotoğraftan oku” ile deneyin.", "Could not open the camera. Try “Read from a photo”.");
    });
  }

  window.ZebraScan = { open: open, decodeCanvas: decodeCanvas, decodeImageFile: decodeImageFile };
})();
