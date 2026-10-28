/* ZebraApp editoru */
(function () {
  "use strict";
  var __ = function (s) { return window.I18N ? window.I18N.t(s) : s; };
  var Z = window.Z, R = window.R;
  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ================= durum ================= */
  var docs = [], doc = null, sel = [], layouts = [], clipboard = null;
  var undoStack = [], redoStack = [], lastCk = 0, dirty = false;
  var view = { zoom: 6, grid: true, snap: true, gridMm: 1, nudge: 0.5 };
  var tool = "select", hover = -1, guides = [], marquee = null, drag = null, spaceDown = false;
  var previewIdx = 0, lastContentField = null, pendingImagePos = null, connected = false;
  var RULER = 22, MARGIN = 36;
  var TYPE_NAMES = { text: __("Metin"), qr: __("QR kod"), barcode: __("Barkod"), line: __("Çizgi"), box: __("Kutu"), ellipse: __("Elips"), image: __("Görsel") };
  var TYPE_ICON = { text: "i-text", qr: "i-qr", barcode: "i-barcode", line: "i-line", box: "i-box", ellipse: "i-ellipse", image: "i-image" };

  /* yerel sunucu: POST isteklerinde X-ZebraApp basligi zorunlu (baska siteler yazdiramasin) */
  function api(url, body) {
    var post = body !== undefined;
    return fetch(url, { method: post ? "POST" : "GET", headers: post ? { "Content-Type": "application/json", "X-ZebraApp": "1" } : {}, body: post ? JSON.stringify(body) : undefined })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function mm(dotsV) { return r2(dotsV * 25.4 / doc.dpi); }
  function d(mmV) { return Z.dots(mmV, doc.dpi); }
  function byId(id) { for (var i = 0; i < doc.elements.length; i++) if (doc.elements[i].id === id) return doc.elements[i]; return null; }
  function idx(id) { for (var i = 0; i < doc.elements.length; i++) if (doc.elements[i].id === id) return i; return -1; }
  function selEls() { return sel.map(byId).filter(Boolean); }

  /* ================= belge ================= */
  function defaultSettings() { return { media: "gap", darkness: "", speed: "", shiftX: 0, shiftY: 0, rotate180: false }; }
  function defaultJob() { return { copies: 1, count: 1, start: 1, step: 1, digits: 0, csv: "" }; }
  function blankDoc() { var p = activePrinter(); return { id: uid(), name: __("Adsız etiket"), w: 80, h: 40, dpi: p && p.dpi ? +p.dpi : 300, settings: defaultSettings(), job: defaultJob(), elements: [] }; }

  var DEF = {
    text: { type: "text", text: __("Metin"), rich: null, size: 4, widthPct: 90, lineGap: 1.25, bold: false, italic: false, underline: false, strike: false, spacing: 0,
      caseMode: "", align: "left", vAlign: "top", boxW: 0, boxH: 0, wrap: false, fit: false, font: "", rot: 0, reverse: false },
    qr: { type: "qr", data: "https://ornek.com", mag: 5, ec: "M", rot: 0 },
    barcode: { type: "barcode", kind: "code128", data: "123456789012", h: 10, module: 3, ratio: 3, human: true, humanAbove: false, rot: 0 },
    line: { type: "line", dir: "h", len: 30, t: 0.3, rot: 0 },
    box: { type: "box", w: 30, h: 15, t: 0.3, filled: false, round: 0, reverse: false, rot: 0 },
    ellipse: { type: "ellipse", w: 20, h: 15, t: 0.3, filled: false, reverse: false, rot: 0 },
    image: { type: "image", src: "", w: 25, h: 25, threshold: 128, dither: false, invert: false, keepAspect: true, rot: 0 }
  };

  function newEl(type, x, y, extra) {
    var el = Object.assign(clone(DEF[type]), { id: uid(), x: r2(x || 0), y: r2(y || 0), hidden: false, locked: false, name: "" }, extra || {});
    if (type === "qr" && doc.dpi < 300) el.mag = 4;
    if (type === "barcode" && doc.dpi < 300) el.module = 2;
    return el;
  }

  /* eski kayit bicimlerini yeni bicime cevir */
  function migrate(o) {
    var dd = Object.assign(blankDoc(), o || {});
    dd.id = dd.id || uid();
    dd.settings = Object.assign(defaultSettings(), dd.settings || {});
    dd.job = Object.assign(defaultJob(), dd.job || {});
    dd.dpi = +dd.dpi || 300;
    dd.elements = (dd.elements || []).map(function (e) {
      e = Object.assign({}, e);
      if (e.type === "line" && e.len == null) { e.len = e.w != null ? e.w : 30; e.dir = e.dir || "h"; delete e.w; }
      if (e.type === "qr" && e.mag == null && e.size) { e.mag = clamp(Math.round(Z.dots(e.size, dd.dpi) / 25), 1, 10); delete e.size; }
      if (e.type === "barcode" && e.module == null) { e.module = e.mod || 2; e.kind = e.kind || "code128"; delete e.mod; }
      var base = DEF[e.type] ? clone(DEF[e.type]) : {};
      e = Object.assign(base, e);
      e.id = e.id || uid();
      if (e.hidden == null) e.hidden = false;
      if (e.type === "text" && (e.font === "zebra" || e.font === "ZEBRA 0")) e.font = "";   /* baska ZebraApp surumleri */
      if (e.locked == null) e.locked = false;
      return e;
    });
    return dd;
  }

  function T(type, props) { return Object.assign(clone(DEF[type]), { id: uid(), hidden: false, locked: false, name: "" }, props); }
  function samples() {
    var a = blankDoc(); a.name = __("Alıcı etiketi"); a.w = 80; a.h = 40;
    a.elements = [
      T("text", { x: 3.1, y: 2.2, size: 4.4, bold: true, text: __("Alıcı:  Örnek Makina Ltd. Şti."), name: __("Başlık") }),
      T("line", { x: 3.1, y: 7.5, len: 69.4, t: 0.25 }),
      T("text", { x: 3.1, y: 8.8, size: 3.56, lineGap: 1.31, name: __("Adres"),
        text: __("Atatürk Caddesi No: 12 Kat: 3\nÖrnek İş Merkezi\n34000 Kadıköy / İstanbul\nTel: +90 212 000 00 00") })
    ];
    var b = blankDoc(); b.name = __("Ürün etiketi (QR + barkod)"); b.w = 80; b.h = 40;
    b.elements = [
      T("box", { x: 1.5, y: 1.5, w: 77, h: 37, t: 0.4, round: 3, name: __("Çerçeve") }),
      T("qr", { x: 4, y: 5, mag: b.dpi >= 300 ? 7 : 5, data: "https://example.com/p/{SAYAC}" }),
      T("text", { x: 32, y: 5, size: 5, bold: true, text: __("ÜRÜN ADI") }),
      T("text", { x: 32, y: 12, size: 3, text: __("Seri no: {SAYAC}\nTarih: {TARIH}") }),
      T("barcode", { x: 32, y: 22, h: 8, module: 2, data: "ZB{SAYAC}" })
    ];
    b.job.digits = 5;
    var c = blankDoc(); c.name = __("Kargo etiketi 100x150"); c.w = 100; c.h = 150;
    c.elements = [
      T("box", { x: 0, y: 0, w: 100, h: 14, filled: true, name: __("Üst bant") }),
      T("text", { x: 4, y: 3.5, size: 7, bold: true, reverse: true, text: __("KARGO") }),
      T("text", { x: 4, y: 20, size: 3.5, text: __("GÖNDERİCİ") }),
      T("text", { x: 4, y: 25, size: 4.5, bold: true, text: "{gonderici}" }),
      T("line", { x: 4, y: 34, len: 92, t: 0.3 }),
      T("text", { x: 4, y: 38, size: 3.5, text: __("ALICI") }),
      T("text", { x: 4, y: 43, size: 6, bold: true, text: "{alici}" }),
      T("text", { x: 4, y: 52, size: 4.5, boxW: 92, wrap: true, text: "{adres}" }),
      T("barcode", { x: 10, y: 100, h: 25, module: c.dpi >= 300 ? 4 : 3, data: "{takip}" })
    ];
    c.job.csv = __("gonderici;alici;adres;takip\nÖrnek Teknoloji A.Ş.;Örnek Makina Ltd. Şti.;Atatürk Caddesi No: 12 Örnek İş Merkezi 34000 Kadıköy / İstanbul;TR0000000001\nÖrnek Teknoloji A.Ş.;Deneme Ticaret;Cumhuriyet Mah. 5. Sokak No: 7 06000 Çankaya / Ankara;TR0000000002");
    function tx(x, y, size, value, width, bold) { return T("text", { x: x, y: y, size: size, text: value, boxW: width, wrap: true, bold: !!bold }); }
    var d1 = blankDoc(); d1.name = __("Adres etiketi (doldurmalı)"); d1.w = 80; d1.h = 40;
    d1.elements = [tx(3, 2, 2.5, __("ALICI"), 74), tx(3, 6, 4.5, "{" + __("Ad Soyad") + "}", 74, true), T("line", { x: 3, y: 12, len: 74, t: 0.25 }),
      tx(3, 14, 3.5, "{" + __("Adres") + "}", 74), tx(3, 28, 3.5, "{" + __("Posta Kodu") + "} {" + __("İlçe") + "} / {" + __("İl") + "}", 74, true), tx(3, 34, 3, __("Tel: ") + "{" + __("Telefon") + "}", 74)];
    var d2 = blankDoc(); d2.name = __("Gönderici ve alıcı"); d2.w = 100; d2.h = 100;
    d2.elements = [tx(4, 3, 3, __("GÖNDERİCİ"), 92), tx(4, 8, 4, "{" + __("Gönderici") + "}", 92, true), tx(4, 15, 3.5, "{" + __("Gönderici Adresi") + "}", 92),
      T("line", { x: 4, y: 32, len: 92, t: 0.4 }), tx(4, 36, 3, __("ALICI"), 92), tx(4, 42, 5, "{" + __("Ad Soyad") + "}", 92, true), tx(4, 52, 4, "{" + __("Adres") + "}", 92),
      tx(4, 77, 4, "{" + __("Posta Kodu") + "} {" + __("İlçe") + "} / {" + __("İl") + "}", 92, true), tx(4, 88, 3.5, __("Tel: ") + "{" + __("Telefon") + "}", 92)];
    var d3 = blankDoc(); d3.name = __("Ürün ve barkod"); d3.w = 80; d3.h = 40;
    d3.elements = [tx(3, 3, 4.5, "{" + __("Ürün Adı") + "}", 74, true), tx(3, 10, 3, __("Kod: ") + "{" + __("Ürün Kodu") + "}", 74),
      T("barcode", { x: 3, y: 17, h: 10, module: 2, data: "{" + __("Ürün Kodu") + "}", human: true }), tx(53, 31, 4, "{" + __("Fiyat") + "} TL", 24, true)];
    var d4 = blankDoc(); d4.name = __("Dosya ve raf etiketi"); d4.w = 80; d4.h = 30;
    d4.elements = [tx(3, 3, 5, "{" + __("Başlık") + "}", 74, true), T("line", { x: 3, y: 10, len: 74, t: 0.3 }), tx(3, 13, 3.5, "{" + __("Açıklama") + "}", 74), tx(3, 23, 3, "{" + __("Referans") + "}", 74)];
    return [a, b, c, d1, d2, d3, d4];
  }

  /* ================= geri al ================= */
  function checkpoint(force) {
    var now = Date.now();
    dirty = true; updateTitle();
    if (!force && now - lastCk < 700) return;
    lastCk = now;
    undoStack.push(JSON.stringify(doc));
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
    updateUndoBtns();
  }
  function restore(json) {
    doc = migrate(JSON.parse(json));
    sel = sel.filter(function (id) { return byId(id); });
    refreshAll();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(doc)); restore(undoStack.pop()); lastCk = 0; dirty = true; updateUndoBtns(); updateTitle(); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(doc)); restore(redoStack.pop()); lastCk = 0; dirty = true; updateUndoBtns(); updateTitle(); }
  function updateUndoBtns() { $("undo").disabled = !undoStack.length; $("redo").disabled = !redoStack.length; }
  function updateTitle() { document.title = (dirty ? "• " : "") + (doc ? doc.name : "") + " — ZebraApp"; }

  /* ================= gorunum ================= */
  var cv = $("cv"), ctx = cv.getContext("2d"), wrap = $("cwrap");
  var css = getComputedStyle(document.documentElement);
  function cvar(n) { return css.getPropertyValue(n).trim(); }
  function s() { return view.zoom * 25.4 / doc.dpi; } /* piksel / nokta */
  function labelPx() { return { w: doc.w * view.zoom, h: doc.h * view.zoom }; }
  var origin = { x: 0, y: 0 };

  var rafPending = false;
  function schedule() { if (!rafPending) { rafPending = true; requestAnimationFrame(function () { rafPending = false; render(); }); } }

  function currentRec() {
    var recs = Z.records(jobForRecords());
    return recs[clamp(previewIdx, 0, recs.length - 1)] || recs[0];
  }
  function jobForRecords() {
    var j = doc.job || defaultJob(), csv = Z.parseCSV(j.csv);
    return { copies: j.copies, count: j.count, start: j.start, step: j.step, digits: j.digits, rows: csv.rows };
  }

  function render() {
    if (!doc) return;
    var lp = labelPx(), dpr = window.devicePixelRatio || 1;
    var cw = Math.max(wrap.clientWidth, Math.ceil(lp.w + RULER + MARGIN * 2));
    var ch = Math.max(wrap.clientHeight, Math.ceil(lp.h + RULER + MARGIN * 2));
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
      cv.style.width = cw + "px"; cv.style.height = ch + "px";
    }
    origin.x = Math.round(Math.max(RULER + MARGIN, RULER + (cw - RULER - lp.w) / 2));
    origin.y = Math.round(Math.max(RULER + MARGIN, RULER + (ch - RULER - lp.h) / 2));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cvar("--desk") || "#c9cfcc";
    ctx.fillRect(0, 0, cw, ch);
    /* golge */
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.28)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
    ctx.fillStyle = "#fff"; ctx.fillRect(origin.x, origin.y, lp.w, lp.h); ctx.restore();

    var S = s();
    layouts = R.drawDoc(ctx, doc, S, origin.x, origin.y, currentRec(), { skip: editing ? editing.id : null });

    ctx.save();
    ctx.translate(origin.x, origin.y);
    /* izgara */
    if (view.grid) {
      var g = view.gridMm * view.zoom;
      if (g >= 5) {
        ctx.beginPath();
        for (var gx = g; gx < lp.w - 0.5; gx += g) { ctx.moveTo(Math.round(gx) + 0.5, 0); ctx.lineTo(Math.round(gx) + 0.5, lp.h); }
        for (var gy = g; gy < lp.h - 0.5; gy += g) { ctx.moveTo(0, Math.round(gy) + 0.5); ctx.lineTo(lp.w, Math.round(gy) + 0.5); }
        ctx.strokeStyle = "rgba(30,123,255,.09)"; ctx.lineWidth = 1; ctx.stroke();
        var g10 = g * 10;
        ctx.beginPath();
        for (var hx = g10; hx < lp.w; hx += g10) { ctx.moveTo(Math.round(hx) + 0.5, 0); ctx.lineTo(Math.round(hx) + 0.5, lp.h); }
        for (var hy = g10; hy < lp.h; hy += g10) { ctx.moveTo(0, Math.round(hy) + 0.5); ctx.lineTo(lp.w, Math.round(hy) + 0.5); }
        ctx.strokeStyle = "rgba(30,123,255,.18)"; ctx.stroke();
      }
    }
    /* gizli ogeler, hover, secim */
    var selCol = cvar("--sel") || "#1e7bff";
    doc.elements.forEach(function (el, i) {
      var b = layouts[i] && layouts[i].box; if (!b) return;
      var rx = b.x * S, ry = b.y * S, rw = Math.max(1, b.w * S), rh = Math.max(1, b.h * S);
      if (el.hidden) { ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.strokeRect(rx + .5, ry + .5, rw, rh); ctx.restore(); }
      var isSel = sel.indexOf(el.id) >= 0;
      if (isSel || i === hover) {
        ctx.save();
        ctx.strokeStyle = selCol; ctx.lineWidth = isSel ? 1.5 : 1;
        if (!isSel) ctx.globalAlpha = 0.6;
        if (el.locked) ctx.setLineDash([5, 3]);
        var Lc = layouts[i];
        if (Lc.raster && Lc.angle % 90) {
          var cs = Z.corners(Lc); ctx.beginPath();
          cs.forEach(function (c, k) { if (k) ctx.lineTo(c[0] * S, c[1] * S); else ctx.moveTo(c[0] * S, c[1] * S); });
          ctx.closePath(); ctx.stroke();
          if (isSel) { ctx.globalAlpha = 0.35; ctx.setLineDash([3, 3]); ctx.strokeRect(Math.round(rx) - 1.5, Math.round(ry) - 1.5, Math.round(rw) + 3, Math.round(rh) + 3); }
        } else ctx.strokeRect(Math.round(rx) - 1.5, Math.round(ry) - 1.5, Math.round(rw) + 3, Math.round(rh) + 3);
        ctx.restore();
      }
    });
    if (sel.length === 1) {
      var el1 = byId(sel[0]), L1 = layouts[idx(sel[0])];
      if (el1 && L1 && !el1.locked) {
        if (canResize(L1)) handles(L1.box).forEach(function (h) {
          ctx.fillStyle = "#fff"; ctx.strokeStyle = selCol; ctx.lineWidth = 1.5;
          ctx.fillRect(h.x * S - 4, h.y * S - 4, 8, 8); ctx.strokeRect(h.x * S - 4, h.y * S - 4, 8, 8);
        });
        /* dondurme tutamaci: kutunun ustunde */
        var rp = rotHandle(L1.box), hx = rp.x * S, hy = rp.y * S;
        ctx.save();
        ctx.strokeStyle = selCol; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(hx, L1.box.y * S - 2); ctx.lineTo(hx, hy + 8); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(hx, hy, 4.2, -Math.PI * 0.95, Math.PI * 0.55); ctx.stroke();
        var ax = hx + 4.2 * Math.cos(Math.PI * 0.55), ay = hy + 4.2 * Math.sin(Math.PI * 0.55);
        ctx.fillStyle = selCol; ctx.beginPath(); ctx.moveTo(ax - 3, ay + 1); ctx.lineTo(ax + 1.5, ay - 3.2); ctx.lineTo(ax + 2.2, ay + 2.6); ctx.closePath(); ctx.fill();
        if (drag && drag.mode === "rotate") {
          ctx.font = "600 12px system-ui, sans-serif"; ctx.fillStyle = selCol; ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.fillText(Z.normRot(el1.rot) + "°", hx + 14, hy);
        }
        ctx.restore();
      }
    }
    /* kilavuzlar */
    ctx.strokeStyle = cvar("--guide") || "#e0237a"; ctx.lineWidth = 1;
    guides.forEach(function (g2) {
      ctx.beginPath();
      if (g2.x != null) { ctx.moveTo(Math.round(g2.x * S) + 0.5, -MARGIN); ctx.lineTo(Math.round(g2.x * S) + 0.5, lp.h + MARGIN); }
      else { ctx.moveTo(-MARGIN, Math.round(g2.y * S) + 0.5); ctx.lineTo(lp.w + MARGIN, Math.round(g2.y * S) + 0.5); }
      ctx.stroke();
    });
    /* secim dikdortgeni / cizim onizlemesi */
    if (marquee) {
      ctx.fillStyle = "rgba(30,123,255,.08)"; ctx.strokeStyle = selCol; ctx.setLineDash([4, 3]);
      var mx = Math.min(marquee.x0, marquee.x1) * S, my = Math.min(marquee.y0, marquee.y1) * S;
      var mw = Math.abs(marquee.x1 - marquee.x0) * S, mh = Math.abs(marquee.y1 - marquee.y0) * S;
      ctx.fillRect(mx, my, mw, mh); ctx.strokeRect(mx + .5, my + .5, mw, mh); ctx.setLineDash([]);
    }
    ctx.restore();
    drawRulers(cw, ch);
    positionEditor();
  }

  function drawRulers(cw, ch) {
    var z = view.zoom, bg = cvar("--chrome") || "#f7f8f7", fg = cvar("--muted") || "#5f6a66", line = cvar("--line") || "#d3d9d6";
    var sx = wrap.scrollLeft, sy = wrap.scrollTop;
    ctx.save();
    ctx.fillStyle = bg; ctx.fillRect(sx, sy, cw, RULER); ctx.fillRect(sx, sy, RULER, ch);
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(sx, sy + RULER + .5); ctx.lineTo(sx + cw, sy + RULER + .5); ctx.moveTo(sx + RULER + .5, sy); ctx.lineTo(sx + RULER + .5, sy + ch); ctx.stroke();
    ctx.fillStyle = fg; ctx.strokeStyle = fg; ctx.font = "10px " + "system-ui, sans-serif"; ctx.textBaseline = "top";
    var step = z >= 4 ? 1 : (z >= 2 ? 2 : 5), labelEvery = z >= 6 ? 5 : (z >= 3 ? 10 : 20);
    ctx.beginPath();
    for (var m = 0; m <= doc.w; m += step) {
      var x = Math.round(origin.x + m * z) + 0.5, len = m % labelEvery === 0 ? 10 : (m % 5 === 0 ? 6 : 3);
      ctx.moveTo(x, sy + RULER); ctx.lineTo(x, sy + RULER - len);
      if (m % labelEvery === 0) ctx.fillText(String(m), x + 2, sy + 2);
    }
    for (var n = 0; n <= doc.h; n += step) {
      var y = Math.round(origin.y + n * z) + 0.5, l2 = n % labelEvery === 0 ? 10 : (n % 5 === 0 ? 6 : 3);
      ctx.moveTo(sx + RULER, y); ctx.lineTo(sx + RULER - l2, y);
      if (n % labelEvery === 0) { ctx.save(); ctx.translate(sx + 2, y + 2); ctx.rotate(Math.PI / 2); ctx.textBaseline = "bottom"; ctx.fillText(String(n), 0, 0); ctx.restore(); }
    }
    ctx.stroke();
    if (lastPointer) {
      ctx.strokeStyle = cvar("--guide") || "#e0237a"; ctx.beginPath();
      var px = Math.round(origin.x + lastPointer.x * s()) + 0.5, py = Math.round(origin.y + lastPointer.y * s()) + 0.5;
      ctx.moveTo(px, sy); ctx.lineTo(px, sy + RULER); ctx.moveTo(sx, py); ctx.lineTo(sx + RULER, py); ctx.stroke();
    }
    ctx.fillStyle = bg; ctx.fillRect(sx, sy, RULER, RULER);
    ctx.fillStyle = fg; ctx.fillText("mm", sx + 3, sy + 6);
    ctx.restore();
  }
  wrap.addEventListener("scroll", schedule);
  window.addEventListener("resize", function () { schedule(); drawPrintPreview(); });
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(wrap);

  function setZoom(z, anchor) {
    var old = view.zoom;
    view.zoom = clamp(z, 1, 40);
    var pct = Math.round(view.zoom / 6 * 100);
    $("zoomVal").textContent = pct + "%"; $("zSlider").value = pct;
    if (anchor) {
      var ratio = view.zoom / old;
      requestAnimationFrame(function () {
        wrap.scrollLeft = (anchor.sx + wrap.scrollLeft) * ratio - anchor.sx;
        wrap.scrollTop = (anchor.sy + wrap.scrollTop) * ratio - anchor.sy;
      });
    }
    schedule();
  }
  function fit() {
    var aw = wrap.clientWidth - RULER - MARGIN * 2, ah = wrap.clientHeight - RULER - MARGIN * 2;
    setZoom(Math.max(1, Math.min(aw / doc.w, ah / doc.h)));
  }

  /* ================= isaretci ================= */
  var lastPointer = null;
  function ptr(e) {
    var r = cv.getBoundingClientRect(), S = s();
    return { x: (e.clientX - r.left - origin.x) / S, y: (e.clientY - r.top - origin.y) / S };
  }
  function handles(b) {
    var x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
    return [{ k: "nw", x: x0, y: y0 }, { k: "n", x: xm, y: y0 }, { k: "ne", x: x1, y: y0 }, { k: "e", x: x1, y: ym },
            { k: "se", x: x1, y: y1 }, { k: "s", x: xm, y: y1 }, { k: "sw", x: x0, y: y1 }, { k: "w", x: x0, y: ym }];
  }
  var CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
  function canResize(L) { return !(L.raster && L.angle % 90); }
  function rotHandle(b) { return { x: b.x + b.w / 2, y: b.y - 26 / s() }; }
  function hitRot(p) {
    if (sel.length !== 1) return false;
    var el = byId(sel[0]); if (!el || el.locked) return false;
    var L = layouts[idx(sel[0])]; if (!L) return false;
    var hp = rotHandle(L.box), tol = 10 / s();
    return Math.abs(p.x - hp.x) <= tol && Math.abs(p.y - hp.y) <= tol;
  }
  /* donus acisini degistir, ogenin merkezi yerinde kalsin */
  function setRotKeep(el, deg, c) {
    if (!c) { var L0 = Z.layout(el, doc, currentRec()); c = { x: L0.box.x + L0.box.w / 2, y: L0.box.y + L0.box.h / 2 }; }
    var nr = Z.normRot(deg);
    /* gorsel yan yatinca kutusu da yan yatar: genislik ve yukseklik yer degistirir */
    if (el.type === "image" && Z.sideways(el.rot) !== Z.sideways(nr)) { var tw = el.w; el.w = el.h; el.h = tw; }
    el.rot = nr;
    var L = Z.layout(el, doc, currentRec());
    el.x = mm(c.x - L.box.w / 2); el.y = mm(c.y - L.box.h / 2);
  }
  function hitHandle(p) {
    if (sel.length !== 1) return null;
    var el = byId(sel[0]); if (!el || el.locked) return null;
    var L = layouts[idx(sel[0])]; if (!L || !canResize(L)) return null;
    var tol = 6 / s(), hs = handles(L.box);
    for (var i = 0; i < hs.length; i++) if (Math.abs(p.x - hs[i].x) <= tol && Math.abs(p.y - hs[i].y) <= tol) return hs[i].k;
    return null;
  }
  function hitEl(p) {
    var tol = 4 / s();
    for (var i = doc.elements.length - 1; i >= 0; i--) {
      var el = doc.elements[i], b = layouts[i] && layouts[i].box;
      if (!b || el.hidden) continue;
      if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return i;
    }
    return -1;
  }

  function snapBox(b, ignoreIds) {
    guides = [];
    var W = d(doc.w), H = d(doc.h), th = 6 / s(), dx = 0, dy = 0;
    if (view.snap) {
      var tx = [0, W / 2, W], ty = [0, H / 2, H];
      doc.elements.forEach(function (el, i) {
        if (ignoreIds.indexOf(el.id) >= 0 || el.hidden) return;
        var o = layouts[i] && layouts[i].box; if (!o) return;
        tx.push(o.x, o.x + o.w / 2, o.x + o.w); ty.push(o.y, o.y + o.h / 2, o.y + o.h);
      });
      var cx = [b.x, b.x + b.w / 2, b.x + b.w], cy = [b.y, b.y + b.h / 2, b.y + b.h], best = th, bx = null, by = null;
      cx.forEach(function (c) { tx.forEach(function (t) { if (Math.abs(t - c) < best) { best = Math.abs(t - c); dx = t - c; bx = t; } }); });
      best = th;
      cy.forEach(function (c) { ty.forEach(function (t) { if (Math.abs(t - c) < best) { best = Math.abs(t - c); dy = t - c; by = t; } }); });
      if (bx != null) guides.push({ x: bx });
      if (by != null) guides.push({ y: by });
      var g = d(view.gridMm);
      if (bx == null && view.grid && g > 0) dx = Math.round(b.x / g) * g - b.x;
      if (by == null && view.grid && g > 0) dy = Math.round(b.y / g) * g - b.y;
    }
    return { dx: dx, dy: dy };
  }

  function unionBox(ids) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ids.forEach(function (id) {
      var L = layouts[idx(id)]; if (!L) return;
      x0 = Math.min(x0, L.box.x); y0 = Math.min(y0, L.box.y); x1 = Math.max(x1, L.box.x + L.box.w); y1 = Math.max(y1, L.box.y + L.box.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  cv.addEventListener("mousedown", function (e) {
    if (e.button === 1 || (spaceDown && e.button === 0)) {
      drag = { mode: "pan", sx: e.clientX, sy: e.clientY, l: wrap.scrollLeft, t: wrap.scrollTop };
      cv.style.cursor = "grabbing"; e.preventDefault(); return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (layouts.length !== doc.elements.length) render();
    var p = ptr(e);
    if (tool !== "select") {
      if (tool === "box" || tool === "ellipse" || tool === "line") {
        var sp = snapPoint(p);
        drag = { mode: "create", x0: sp.x, y0: sp.y, x1: sp.x, y1: sp.y };
        marquee = { x0: sp.x, y0: sp.y, x1: sp.x, y1: sp.y };
        return;
      }
      var q = snapPoint(p);
      if (tool === "image") { pendingImagePos = q; $("fileImage").click(); setTool("select"); return; }
      var made = newEl(tool, Math.max(0, mm(q.x)), Math.max(0, mm(q.y)));
      addElement(made);
      setTool("select");
      if (made.type === "text") setTimeout(function () { startEdit(made, true); }, 0);
      else setTimeout(focusContent, 0);
      return;
    }
    if (hitRot(p)) {
      var elr = byId(sel[0]), Lr = layouts[idx(sel[0])];
      checkpoint(true);
      drag = { mode: "rotate", id: elr.id, c: { x: Lr.box.x + Lr.box.w / 2, y: Lr.box.y + Lr.box.h / 2 } };
      cv.style.cursor = "grabbing";
      return;
    }
    var h = hitHandle(p);
    if (h) {
      var el0 = byId(sel[0]), L0 = layouts[idx(sel[0])];
      checkpoint(true);
      drag = { mode: "resize", k: h, id: sel[0], b0: Object.assign({}, L0.box), el0: clone(el0), L0: L0, p0: p };
      return;
    }
    var i = hitEl(p);
    if (painter) { if (i >= 0) paintOn(doc.elements[i]); else { setPainter(null); status(""); } schedule(); return; }
    if (i >= 0) {
      var id = doc.elements[i].id;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        var at = sel.indexOf(id);
        if (at >= 0) sel.splice(at, 1); else sel.push(id);
      } else if (sel.indexOf(id) < 0) sel = [id];
      selectionChanged();
      var movable = selEls().filter(function (x) { return !x.locked; });
      if (movable.length && sel.indexOf(id) >= 0) {
        drag = { mode: "move", p0: p, orig: movable.map(function (x) { return { id: x.id, x: x.x, y: x.y }; }), b0: unionBox(movable.map(function (x) { return x.id; })), moved: false };
      }
    } else {
      if (!(e.shiftKey || e.ctrlKey)) { sel = []; selectionChanged(); }
      drag = { mode: "marquee", base: sel.slice() };
      marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    }
    schedule();
  });

  function snapPoint(p) {
    if (!view.snap || !view.grid) return p;
    var g = d(view.gridMm);
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }

  window.addEventListener("mousemove", function (e) {
    if (!doc) return;
    var p = ptr(e);
    if (e.target === cv || drag) {
      lastPointer = p;
      $("stPos").textContent = "X " + mm(p.x).toFixed(1) + "  Y " + mm(p.y).toFixed(1) + " mm";
    }
    if (!drag) {
      if (e.target !== cv) return;
      if (spaceDown) { cv.style.cursor = "grab"; schedule(); return; }
      var h = tool === "select" ? hitHandle(p) : null, i = tool === "select" ? hitEl(p) : -1, onRot = tool === "select" && hitRot(p);
      cv.style.cursor = tool !== "select" ? "crosshair" : (onRot ? "grab" : (h ? CURSORS[h] : (i >= 0 ? (doc.elements[i].locked ? "not-allowed" : "move") : "default")));
      if (i !== hover) hover = i;
      schedule();
      return;
    }
    if (drag.mode === "pan") {
      wrap.scrollLeft = drag.l - (e.clientX - drag.sx); wrap.scrollTop = drag.t - (e.clientY - drag.sy); return;
    }
    if (drag.mode === "move") {
      var dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
      if (!drag.moved && Math.abs(dx) * s() < 3 && Math.abs(dy) * s() < 3) return;
      if (!drag.moved) { checkpoint(true); drag.moved = true; }
      var nb = { x: drag.b0.x + dx, y: drag.b0.y + dy, w: drag.b0.w, h: drag.b0.h };
      var sn = e.altKey ? { dx: 0, dy: 0 } : snapBox(nb, drag.orig.map(function (o) { return o.id; }));
      if (e.altKey) guides = [];
      var tdx = mm(dx + sn.dx), tdy = mm(dy + sn.dy);
      drag.orig.forEach(function (o) { var el = byId(o.id); el.x = r2(Math.max(-500, o.x + tdx)); el.y = r2(o.y + tdy); });
      changed({ inspectorValues: true });
      return;
    }
    if (drag.mode === "resize") { doResize(p, e.shiftKey); return; }
    if (drag.mode === "rotate") {
      var elR = byId(drag.id); if (!elR) return;
      var ang = Math.atan2(p.y - drag.c.y, p.x - drag.c.x) * 180 / Math.PI + 90;
      ang = e.shiftKey ? Math.round(ang / 15) * 15 : Math.round(ang);
      [0, 90, 180, 270, 360].forEach(function (k) { if (Math.abs(ang - k) <= 4 || Math.abs(ang + 360 - k) <= 4) ang = k; });
      setRotKeep(elR, ang, drag.c);
      $("stPos").textContent = __("Açı: ") + Z.normRot(elR.rot) + "°";
      changed({ inspectorValues: true });
      return;
    }
    if (drag.mode === "marquee") {
      marquee.x1 = p.x; marquee.y1 = p.y;
      var x0 = Math.min(marquee.x0, p.x), x1 = Math.max(marquee.x0, p.x), y0 = Math.min(marquee.y0, p.y), y1 = Math.max(marquee.y0, p.y);
      var ids = drag.base.slice();
      doc.elements.forEach(function (el, k) {
        var b = layouts[k] && layouts[k].box; if (!b || el.hidden) return;
        if (b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0 && ids.indexOf(el.id) < 0) ids.push(el.id);
      });
      sel = ids; selectionChanged(true); schedule(); return;
    }
    if (drag.mode === "create") {
      var q = snapPoint(p); drag.x1 = q.x; drag.y1 = q.y; marquee.x1 = q.x; marquee.y1 = q.y; schedule(); return;
    }
  });

  window.addEventListener("mouseup", function () {
    if (!drag) return;
    var m = drag.mode, dr = drag;
    drag = null; guides = []; cv.style.cursor = "";
    if (m === "marquee") { marquee = null; selectionChanged(); }
    if (m === "create") {
      marquee = null;
      var x0 = Math.min(dr.x0, dr.x1), y0 = Math.min(dr.y0, dr.y1), w = Math.abs(dr.x1 - dr.x0), h = Math.abs(dr.y1 - dr.y0);
      var small = w < d(2) && h < d(2), el;
      if (tool === "line") {
        if (small) el = newEl("line", mm(dr.x0), mm(dr.y0));
        else if (w >= h) el = newEl("line", mm(x0), mm(dr.y0), { dir: "h", len: mm(w) });
        else el = newEl("line", mm(dr.x0), mm(y0), { dir: "v", len: mm(h) });
      } else {
        el = small ? newEl(tool, mm(dr.x0), mm(dr.y0)) : newEl(tool, mm(x0), mm(y0), { w: mm(w), h: mm(h) });
      }
      addElement(el);
      setTool("select");
    }
    if (m === "move" || m === "resize") { refreshInspectorValues(); renderLayers(); }
    if (m === "rotate") { renderInspector(); renderLayers(); }
    schedule();
  });

  cv.addEventListener("dblclick", function (e) {
    var i = hitEl(ptr(e));
    if (i < 0) return;
    var hitE = doc.elements[i];
    if (hitE.type === "text" && !hitE.locked) { startEdit(hitE, false); return; }
    sel = [hitE.id]; selectionChanged(); focusContent();
  });
  cv.addEventListener("mouseleave", function () { lastPointer = null; hover = -1; schedule(); });
  wrap.addEventListener("wheel", function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    var r = wrap.getBoundingClientRect();
    setZoom(view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), { sx: e.clientX - r.left, sy: e.clientY - r.top });
  }, { passive: false });

  function doResize(p, keepAspect) {
    var el = byId(drag.id); if (!el) return;
    var b0 = drag.b0, k = drag.k, e0 = drag.el0;
    var x0 = b0.x, y0 = b0.y, x1 = b0.x + b0.w, y1 = b0.y + b0.h;
    if (k.indexOf("w") >= 0) x0 = Math.min(p.x, x1 - 4);
    if (k.indexOf("e") >= 0) x1 = Math.max(p.x, x0 + 4);
    if (k.indexOf("n") >= 0) y0 = Math.min(p.y, y1 - 4);
    if (k.indexOf("s") >= 0) y1 = Math.max(p.y, y0 + 4);
    if (view.snap && view.grid) {
      var g = d(view.gridMm);
      if (k.indexOf("w") >= 0) x0 = Math.round(x0 / g) * g;
      if (k.indexOf("e") >= 0) x1 = Math.round(x1 / g) * g;
      if (k.indexOf("n") >= 0) y0 = Math.round(y0 / g) * g;
      if (k.indexOf("s") >= 0) y1 = Math.round(y1 / g) * g;
    }
    var nw = Math.max(4, x1 - x0), nh = Math.max(4, y1 - y0);
    var aspect = keepAspect || (el.type === "image" && el.keepAspect);
    if (aspect && k.length === 2) {
      var f = Math.max(nw / b0.w, nh / b0.h); nw = b0.w * f; nh = b0.h * f;
    }
    var rot = Z.normRot(el.rot), side = rot === 90 || rot === 270;
    switch (el.type) {
      case "box": case "ellipse":
        if (side) { el.w = mm(nh); el.h = mm(nw); } else { el.w = mm(nw); el.h = mm(nh); }
        break;
      case "image":
        if (el.keepAspect && k.length === 1) {
          if (k === "e" || k === "w") nh = nw * b0.h / b0.w; else nw = nh * b0.w / b0.h;
        }
        el.w = mm(nw); el.h = mm(nh); break;
      case "line":
        if ((el.dir === "v") !== side) el.len = mm(nh); else el.len = mm(nw); break;
      case "qr":
        var n = drag.L0.mat.n; el.mag = clamp(Math.round(Math.max(nw, nh) / n), 1, 10); break;
      case "barcode":
        var units = drag.L0.W / drag.L0.module, hr = drag.L0.hr;
        var along = side ? nh : nw, across = side ? nw : nh;
        if (k.length === 2 || (side ? (k === "n" || k === "s") : (k === "e" || k === "w"))) el.module = clamp(Math.round(along / units), 1, 10);
        if (k.length === 2 || (side ? (k === "e" || k === "w") : (k === "n" || k === "s"))) el.h = r2(Math.max(1, mm(across - hr)));
        break;
      case "text":
        var horiz = side ? (k === "n" || k === "s") : (k === "e" || k === "w");
        if (horiz) { el.boxW = mm(side ? nh : nw); }
        else {
          var f2 = side ? nw / b0.w : nh / b0.h;
          el.size = r2(clamp(e0.size * f2, 0.8, 60));
        }
        break;
    }
    /* sabit kalan kenara gore konumla */
    var L = Z.layout(el, doc, currentRec());
    el.x = mm(k.indexOf("w") >= 0 ? (b0.x + b0.w - L.box.w) : b0.x);
    el.y = mm(k.indexOf("n") >= 0 ? (b0.y + b0.h - L.box.h) : b0.y);
    if (el.type === "text" && (k === "e" || k === "w") && !side) el.x = mm(k === "w" ? x0 : b0.x);
    changed({ inspectorValues: true });
  }

  /* ================= ogeler ================= */
  function addElement(el) {
    checkpoint(true);
    var max = doc.elements.length;
    doc.elements.push(el);
    if (el.x + 1 > doc.w) el.x = r2(Math.max(0, doc.w - 10));
    if (el.y + 1 > doc.h) el.y = r2(Math.max(0, doc.h - 5));
    sel = [el.id];
    selectionChanged();
    changed({ layers: true });
    return max;
  }
  function deleteSel() {
    if (!sel.length) return;
    checkpoint(true);
    doc.elements = doc.elements.filter(function (e) { return sel.indexOf(e.id) < 0; });
    sel = []; selectionChanged(); changed({ layers: true });
  }
  function duplicateSel(off) {
    var els = selEls(); if (!els.length) return;
    checkpoint(true);
    var o = off == null ? 2 : off, ids = [];
    els.forEach(function (el) { var c = clone(el); c.id = uid(); c.x = r2(c.x + o); c.y = r2(c.y + o); doc.elements.push(c); ids.push(c.id); });
    sel = ids; selectionChanged(); changed({ layers: true });
  }
  function copySel() { var els = selEls(); if (els.length) { clipboard = clone(els); status(els.length + __(" öğe kopyalandı.")); } }
  function paste() {
    if (!clipboard) return;
    checkpoint(true);
    var ids = [];
    clipboard.forEach(function (el) { var c = clone(el); c.id = uid(); c.x = r2(c.x + 2); c.y = r2(c.y + 2); doc.elements.push(c); ids.push(c.id); });
    clipboard = clipboard.map(function (e) { var c = clone(e); c.x += 2; c.y += 2; return c; });
    sel = ids; selectionChanged(); changed({ layers: true });
  }
  function reorder(dir) {
    var els = selEls(); if (!els.length) return;
    checkpoint(true);
    var rest = doc.elements.filter(function (e) { return sel.indexOf(e.id) < 0; });
    doc.elements = dir > 0 ? rest.concat(els) : els.concat(rest);
    changed({ layers: true });
  }
  function nudge(dx, dy) {
    var els = selEls().filter(function (e) { return !e.locked; }); if (!els.length) return;
    checkpoint();
    els.forEach(function (e) { e.x = r2(e.x + dx); e.y = r2(e.y + dy); });
    changed({ inspectorValues: true });
  }
  function align(kind) {
    var els = selEls().filter(function (e) { return !e.locked; }); if (!els.length) return;
    checkpoint(true);
    var boxes = els.map(function (e) { return { el: e, b: layouts[idx(e.id)].box }; });
    var ref = els.length === 1 ? { x: 0, y: 0, w: d(doc.w), h: d(doc.h) } : unionBox(els.map(function (e) { return e.id; }));
    if (kind === "dh" || kind === "dv") {
      if (boxes.length < 3) { status(__("Eşit dağıtmak için en az 3 öğe seç."), true); return; }
      var key = kind === "dh" ? "x" : "y", size = kind === "dh" ? "w" : "h";
      boxes.sort(function (a, b) { return a.b[key] - b.b[key]; });
      var total = 0; boxes.forEach(function (o) { total += o.b[size]; });
      var first = boxes[0].b, last = boxes[boxes.length - 1].b;
      var span = last[key] + last[size] - first[key], gap = (span - total) / (boxes.length - 1), pos = first[key];
      boxes.forEach(function (o) { o.el[key] = mm(pos); pos += o.b[size] + gap; });
    } else {
      boxes.forEach(function (o) {
        var b = o.b, dx = 0, dy = 0;
        if (kind === "left") dx = ref.x - b.x;
        if (kind === "right") dx = ref.x + ref.w - (b.x + b.w);
        if (kind === "hcenter") dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
        if (kind === "top") dy = ref.y - b.y;
        if (kind === "bottom") dy = ref.y + ref.h - (b.y + b.h);
        if (kind === "vcenter") dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
        o.el.x = r2(o.el.x + mm(dx)); o.el.y = r2(o.el.y + mm(dy));
      });
    }
    changed({ inspectorValues: true });
  }

  /* ================= degisiklik / yenileme ================= */
  function changed(opts) {
    opts = opts || {};
    if (opts.layers) renderLayers();
    if (opts.inspectorValues) refreshInspectorValues();
    if (opts.inspector) renderInspector();
    updatePrintSummary();
    updateRibbon(); updateCount();
    schedule();
  }
  function selectionChanged(light) {
    renderLayers();
    if (!light) renderInspector();
    var n = sel.length, el = n === 1 ? byId(sel[0]) : null;
    $("stSel").textContent = n === 0 ? __("Seçim yok") : (n === 1 ? TYPE_NAMES[el.type] + __(" seçili") : n + __(" öğe seçili"));
    updateRibbon();
  }
  function updateCount() { if (doc) $("stCount").textContent = doc.elements.length + " " + __("öğe"); }
  function refreshAll() {
    renderLayers(); renderInspector(); syncLabelTab(); syncPrintTab(); updateTitle(); updateUndoBtns(); updateCount();
    selectionChanged();
    schedule();
  }
  function status(msg, err) {
    ["stMsg", "ppStatus"].forEach(function (id) { var e = $(id); if (e) { e.textContent = msg || ""; e.className = (id === "ppStatus" ? "note pps" : "") + (err ? " err" : ""); } });
  }

  /* ================= katmanlar ================= */
  function elLabel(el) {
    if (el.name) return el.name;
    if (el.type === "text") return (String(el.text || "").split("\n")[0] || __("Metin")).slice(0, 40);
    if (el.type === "qr") return "QR: " + String(el.data || "").slice(0, 30);
    if (el.type === "barcode") return ({ code128: "Code 128", code39: "Code 39", ean13: "EAN-13" }[el.kind] || __("Barkod")) + ": " + String(el.data || "").slice(0, 24);
    if (el.type === "line") return el.dir === "v" ? __("Dikey çizgi") : __("Yatay çizgi");
    return TYPE_NAMES[el.type];
  }
  var dragLayer = null;
  function renderLayers() {
    var ul = $("layers"); ul.innerHTML = "";
    if (!doc.elements.length) { var li0 = document.createElement("li"); li0.className = "empty"; li0.textContent = __("Henüz öğe yok. Ekle sekmesinden bir araç seçip etikete tıkla."); ul.appendChild(li0); return; }
    for (var i = doc.elements.length - 1; i >= 0; i--) (function (el, i) {
      var li = document.createElement("li");
      li.className = (sel.indexOf(el.id) >= 0 ? "sel " : "") + (el.hidden ? "hid" : "");
      li.draggable = true;
      li.innerHTML = '<svg class="ic"><use href="#' + TYPE_ICON[el.type] + '"/></svg><span class="nm"></span>' +
        '<button class="eye' + (el.hidden ? " act" : "") + '" title="' + (el.hidden ? __("Göster") : __("Gizle (basılmaz)")) + '"><svg><use href="#' + (el.hidden ? "i-eyeoff" : "i-eye") + '"/></svg></button>' +
        '<button class="lk' + (el.locked ? " act" : "") + '" title="' + (el.locked ? __("Kilidi aç") : __("Kilitle")) + '"><svg><use href="#' + (el.locked ? "i-lock" : "i-unlock") + '"/></svg></button>';
      li.querySelector(".nm").textContent = elLabel(el);
      li.addEventListener("click", function (e) {
        if (e.target.closest("button")) return;
        if (e.shiftKey || e.ctrlKey) { var a = sel.indexOf(el.id); if (a >= 0) sel.splice(a, 1); else sel.push(el.id); }
        else sel = [el.id];
        selectionChanged(); schedule();
      });
      li.addEventListener("dblclick", function () {
        var n = prompt(__("Katman adı"), el.name || elLabel(el));
        if (n != null) { checkpoint(true); el.name = n.trim(); renderLayers(); }
      });
      li.querySelector(".eye").addEventListener("click", function () { checkpoint(true); el.hidden = !el.hidden; changed({ layers: true }); });
      li.querySelector(".lk").addEventListener("click", function () { checkpoint(true); el.locked = !el.locked; changed({ layers: true }); });
      li.addEventListener("dragstart", function (e) { dragLayer = el.id; e.dataTransfer.effectAllowed = "move"; });
      li.addEventListener("dragover", function (e) { e.preventDefault(); });
      li.addEventListener("drop", function (e) {
        e.preventDefault();
        if (!dragLayer || dragLayer === el.id) return;
        checkpoint(true);
        var from = idx(dragLayer), moving = doc.elements.splice(from, 1)[0], to = idx(el.id);
        doc.elements.splice(to + 1, 0, moving);
        dragLayer = null; changed({ layers: true });
      });
      ul.appendChild(li);
    })(doc.elements[i], i);
  }

  /* ================= ozellikler paneli ================= */
  var insp = $("inspector");
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function setVal(el, key, v, opts) {
    checkpoint();
    /* en-boy orani korunan gorselde genislik/yukseklik birlikte degisir */
    if (el.type === "image" && (key === "w" || key === "h") && el.keepAspect && v > 0 && el.w > 0 && el.h > 0) {
      var ratio = el.w / el.h;
      if (isFinite(ratio)) { el[key === "w" ? "h" : "w"] = r2(key === "w" ? v / ratio : v * ratio); opts = Object.assign({ inspectorValues: true }, opts || {}); }
    }
    el[key] = v;
    changed(Object.assign({ layers: key === "text" || key === "data" || key === "name" || key === "kind" || key === "dir" }, opts || {}));
  }
  function fNum(el, key, label, step, min, max, unit) {
    var inp = h("input", { type: "number", step: step || "0.1" });
    if (min != null) inp.min = min; if (max != null) inp.max = max;
    inp.value = el[key]; inp.dataset.key = key;
    inp.addEventListener("input", function () { var v = parseFloat(inp.value); if (isFinite(v)) setVal(el, key, v); });
    return h("label", {}, [document.createTextNode(label + (unit ? " (" + unit + ")" : "")), inp]);
  }
  function fText(el, key, label, area, content) {
    var inp = h(area ? "textarea" : "input", area ? { rows: "4" } : { type: "text" });
    inp.value = el[key] == null ? "" : el[key]; inp.dataset.key = key;
    inp.addEventListener("input", function () { setVal(el, key, inp.value); });
    if (content) { inp.addEventListener("focus", function () { lastContentField = { el: el, key: key, inp: inp }; }); inp.classList.add("content"); }
    return h("label", {}, [document.createTextNode(label), inp]);
  }
  function fCheck(el, key, label, after) {
    var inp = h("input", { type: "checkbox" }); inp.checked = !!el[key]; inp.dataset.key = key;
    inp.addEventListener("change", function () { setVal(el, key, inp.checked); if (after) after(); });
    return h("label", { class: "chk" }, [inp, document.createTextNode(label)]);
  }
  function fSelect(el, key, label, options, after) {
    var s2 = h("select", {});
    options.forEach(function (o) { var op = h("option", { value: o[0], text: o[1] }); s2.appendChild(op); });
    s2.value = String(el[key]); s2.dataset.key = key;
    s2.addEventListener("change", function () {
      var v = s2.value; if (/^-?\d+(\.\d+)?$/.test(v) && typeof DEF[el.type][key] === "number") v = +v;
      setVal(el, key, v, { inspector: !!after }); if (after) after(v);
    });
    return h("label", {}, [document.createTextNode(label), s2]);
  }
  function fSeg(el, key, label, options) {
    var wrapS = h("div", { class: "seg" });
    options.forEach(function (o) {
      var b = h("button", { type: "button", text: o[1], title: o[2] || o[1] });
      if (String(el[key]) === String(o[0])) b.classList.add("on");
      b.addEventListener("click", function () {
        var v = typeof DEF[el.type][key] === "number" ? +o[0] : o[0];
        setVal(el, key, v);
        qsa("button", wrapS).forEach(function (x) { x.classList.remove("on"); }); b.classList.add("on");
      });
      wrapS.appendChild(b);
    });
    wrapS.dataset.seg = key;
    return h("label", {}, [document.createTextNode(label), wrapS]);
  }
  function fRange(el, key, label, min, max) {
    var inp = h("input", { type: "range", min: min, max: max, step: "1" }), out = h("span", { text: String(el[key]) });
    inp.value = el[key]; inp.dataset.key = key;
    inp.addEventListener("input", function () { out.textContent = inp.value; setVal(el, key, +inp.value); });
    return h("label", {}, [h("span", {}, [document.createTextNode(label + ": "), out]), inp]);
  }
  function r(cls, kids) { return h("div", { class: cls }, kids); }
  function varChips(target) {
    var cols = Z.parseCSV((doc.job || {}).csv).cols;
    var c = h("div", { class: "chips" });
    ["SAYAC", "TARIH", "SAAT"].concat(cols).forEach(function (v) {
      c.appendChild(h("button", { type: "button", class: "chip", text: "{" + v + "}", title: __("Alana ekle"), onclick: function () { insertVar("{" + v + "}", target); } }));
    });
    return c;
  }
  function insertVar(token, target) {
    var t = target || lastContentField; if (!t) return;
    var inp = t.inp, st = inp.selectionStart == null ? inp.value.length : inp.selectionStart, en = inp.selectionEnd == null ? st : inp.selectionEnd;
    inp.value = inp.value.slice(0, st) + token + inp.value.slice(en);
    inp.focus(); inp.selectionStart = inp.selectionEnd = st + token.length;
    setVal(t.el, t.key, inp.value);
  }

  function fRot(el) {
    var inp = h("input", { type: "number", step: "1", min: "-360", max: "360" }); inp.value = Z.normRot(el.rot); inp.dataset.key = "rot";
    inp.addEventListener("input", function () { var v = parseFloat(inp.value); if (!isFinite(v)) return; checkpoint(); setRotKeep(el, v); changed({ layers: false }); });
    inp.addEventListener("change", function () { renderInspector(); });
    var quick = h("div", { class: "seg" });
    [0, 90, 180, 270].forEach(function (a) {
      var b = h("button", { type: "button", text: a + "°" }); if (Z.normRot(el.rot) === a) b.classList.add("on");
      b.addEventListener("click", function () { checkpoint(true); setRotKeep(el, a); changed({ inspector: true }); });
      quick.appendChild(b);
    });
    return h("div", { class: "r2" }, [h("label", {}, [document.createTextNode(__("Döndür (°)")), inp]), h("label", {}, [document.createTextNode(__("Hızlı")), quick])]);
  }
  var FONTS = [];
  function fontOptions(cur) {
    var o = [["", __("Yazıcı yazı tipi (en hızlı)")], ["ZFont", __("Roboto Condensed (gömülü)")]];
    FONTS.forEach(function (f) { o.push([f, f]); });
    if (cur && cur !== "ZFont" && FONTS.indexOf(cur) < 0) o.push([cur, cur + " " + __("(bu bilgisayarda yok)")]);
    return o;
  }
  /* bilgisayarda kurulu ve tarayicinin cizebildigi yazi tipleri */
  function loadFonts() {
    var probe = document.createElement("canvas").getContext("2d"), sample = "mmmmmmmmmmlli WŞğİ 0123456789";
    function width(f) { probe.font = "40px " + f; return probe.measureText(sample).width; }
    var base = { m: width("monospace"), s: width("serif"), a: width("sans-serif") };
    function has(fam) { var q = '"' + fam.replace(/"/g, "") + '"'; return width(q + ", monospace") !== base.m || width(q + ", serif") !== base.s || width(q + ", sans-serif") !== base.a; }
    var common = ["Arial", "Arial Narrow", "Helvetica", "Verdana", "Tahoma", "Segoe UI", "Calibri", "Times New Roman", "Georgia", "Courier New",
      "Consolas", "Impact", "DejaVu Sans", "DejaVu Sans Condensed", "DejaVu Serif", "DejaVu Sans Mono", "Liberation Sans", "Liberation Sans Narrow",
      "Liberation Serif", "Liberation Mono", "Ubuntu", "Ubuntu Condensed", "Ubuntu Mono", "Noto Sans", "Noto Serif", "Noto Sans Mono", "Cantarell",
      "Roboto", "Open Sans", "Lato", "Montserrat", "Source Sans Pro", "Inter", "Futura", "Gill Sans", "Avenir", "Menlo", "Monaco"];
    return api("/api/fonts").catch(function () { return { families: [] }; }).then(function (j) {
      var all = {}, list = [];
      (j.families || []).concat(common).forEach(function (f) { if (f && !all[f]) { all[f] = 1; list.push(f); } });
      FONTS = list.filter(has).sort(function (a, b) { return a.localeCompare(b); });
      fillFontSel();
    });
  }
  function fillFontSel() {
    var sl = $("fFont"), t = textSel()[0]; sl.innerHTML = "";
    fontOptions(t ? t.font : "").forEach(function (o) { sl.appendChild(h("option", { value: o[0], text: o[1] })); });
    sl.value = t ? (t.font || "") : "";
  }
  function renderInspector() {
    insp.innerHTML = "";
    var els = selEls();
    if (!els.length) {
      insp.appendChild(h("div", { class: "insp-empty", html:
        __("<b>Öğe seçili değil.</b>") +
        __("<span>Ekle sekmesinden bir araç seçip etikete tıkla. Kutu, elips ve çizgiyi sürükleyerek çiz. Yazıyı değiştirmek için üstüne çift tıkla.</span>") +
        __("<span><span class='kbd'>Shift</span> ile çoklu seç, boş alanda sürükleyerek alan seç.</span>") +
        __("<span><span class='kbd'>Ctrl+Z</span> geri al · <span class='kbd'>Ctrl+D</span> çoğalt · <span class='kbd'>Ctrl+C/V</span> kopyala/yapıştır · <span class='kbd'>Del</span> sil</span>") +
        __("<span>Ok tuşları taşır (<span class='kbd'>Shift</span> ile 10 kat). <span class='kbd'>Alt</span> basılıyken sürüklersen yakalama kapanır.</span>") +
        __("<span><span class='kbd'>Ctrl</span>+tekerlek yakınlaştırır, <span class='kbd'>Boşluk</span>+sürükle kaydırır.</span>") }));
      return;
    }
    if (els.length > 1) {
      insp.appendChild(h("div", { class: "insp-title", text: els.length + __(" öğe seçili") }));
      insp.appendChild(h("p", { class: "note", text: __("Üstteki hizalama düğmeleriyle birbirine göre hizala, ok tuşlarıyla birlikte taşı.") }));
      return;
    }
    var el = els[0], sec = h("div", { class: "sec" });
    insp.appendChild(h("div", { class: "insp-title", html: '<svg><use href="#' + TYPE_ICON[el.type] + '"/></svg><span></span>' }));
    insp.querySelector(".insp-title span").textContent = TYPE_NAMES[el.type];
    insp.appendChild(sec);
    var add = function (n) { sec.appendChild(n); };

    if (el.type === "text") {
      var ct = fText(el, "text", __("İçerik (her satır ayrı)"), true, true);
      add(ct);
      if (el.rich) {
        ct.querySelector("textarea").readOnly = true;
        add(h("div", { class: "row wrap" }, [
          h("span", { class: "note", text: __("Kelime kelime biçimli metin: içeriği etiketin üstünde düzenle (çift tıkla).") }),
          h("button", { type: "button", class: "tb", text: __("Kelime biçimlerini kaldır"), onclick: function () { checkpoint(true); el.rich = null; changed({ inspector: true }); } })
        ]));
      }
      add(varChips());
      add(fSelect(el, "font", __("Yazı tipi"), fontOptions(el.font), function () { renderInspector(); updateRibbon(); }));
      if (el.font) add(h("p", { class: "note", text: __("Bu yazı tipi yazıcıya resim olarak gider: ekrandakiyle birebir aynı basılır, ama veri biraz büyür.") }));
      add(r("r2", [fNum(el, "size", __("Yazı yüksekliği"), "0.1", 0.5, 80, "mm"), fNum(el, "widthPct", __("Harf genişliği"), "5", 30, 200, "%")]));
      add(r("r2", [fNum(el, "lineGap", __("Satır aralığı"), "0.05", 0.8, 4, "×"), fNum(el, "spacing", __("Karakter aralığı"), "0.1", -2, 20, "mm")]));
      add(fSeg(el, "align", __("Hizalama"), [["left", __("Sol")], ["center", __("Orta")], ["right", __("Sağ")], ["justify", __("İki yana")]]));
      add(r("r2", [fSeg(el, "vAlign", __("Kutuda dikey"), [["top", __("Üst")], ["middle", __("Orta")], ["bottom", __("Alt")]]),
        fSelect(el, "caseMode", __("Büyük/küçük harf"), [["", __("Yazdığın gibi")], ["upper", __("BÜYÜK")], ["lower", __("küçük")], ["title", __("Her Kelime")]])]));
      add(r("r2", [fNum(el, "boxW", __("Metin kutusu genişliği"), "0.5", 0, 500, "mm"), fNum(el, "boxH", __("Metin kutusu yüksekliği"), "0.5", 0, 500, "mm")]));
      add(fCheck(el, "wrap", __("Kutuya sığmayan satırı alta kaydır")));
      add(fCheck(el, "fit", __("Kutuya sığmazsa yazıyı küçült"), function () { if (el.fit && !(el.boxW > 0) && !(el.boxH > 0)) { el.boxW = r2(Math.max(5, doc.w - 2 * el.x)); renderInspector(); } }));
      var stripK = function (k) { return function () { if (el.rich) { var rr = clone(el.rich); rr.forEach(function (x) { delete x[k]; }); setRuns(el, rr); } schedule(); updateRibbon(); }; };
      add(r("r2", [fCheck(el, "bold", __("Kalın"), stripK("b")), fCheck(el, "italic", __("İtalik"), stripK("i"))]));
      add(r("r2", [fCheck(el, "underline", __("Altı çizili"), stripK("u")), fCheck(el, "strike", __("Üstü çizili"), stripK("s"))]));
      add(fCheck(el, "reverse", __("Ters baskı (siyah üstüne beyaz)")));
      if (Z.textRaster(el) && !el.font) add(h("p", { class: "note", text: __("İtalik, altı/üstü çizili, karakter aralığı, iki yana yaslama ve kelime kelime biçim yazıcının kendi yazı tipinde yok; bu metin resim olarak basılır.") }));
      add(h("p", { class: "note", text: __("Ortalama, sağa yaslama ve sığdırma için kutu genişliği gerekir. Sığdır açıkken uzun yazı her etikette ayrı ayrı küçültülür.") }));
      qsa("[data-seg=align] button", sec).forEach(function (b) {
        b.addEventListener("click", function () {
          if (el.align !== "left" && !(el.boxW > 0)) { el.boxW = r2(Math.max(5, doc.w - 2 * el.x)); refreshInspectorValues(); schedule(); }
        });
      });
    } else if (el.type === "qr") {
      add(fText(el, "data", __("QR içeriği"), true, true));
      add(varChips());
      var L = layouts[idx(el.id)];
      add(r("r2", [fNum(el, "mag", __("Modül boyutu"), "1", 1, 10, "1–10"), fSelect(el, "ec", __("Hata düzeltme"), [["L", __("L (%7)")], ["M", __("M (%15)")], ["Q", __("Q (%25)")], ["H", __("H (%30)")]])]));
      add(h("p", { class: "note", "data-info": "qr", text: L ? __("Yaklaşık boyut: ") + mm(L.box.w).toFixed(1) + __(" mm (") + L.mat.n + "×" + L.mat.n + __(" modül)") : "" }));
    } else if (el.type === "barcode") {
      add(fSelect(el, "kind", __("Barkod türü"), [["code128", __("Code 128 (harf + rakam)")], ["code39", "Code 39"], ["ean13", __("EAN-13 (12 rakam)")]], function () { renderInspector(); }));
      add(fText(el, "data", el.kind === "ean13" ? __("12 haneli numara (kontrol hanesi otomatik)") : __("Barkod içeriği"), false, true));
      add(varChips());
      add(r("r2", [fNum(el, "h", __("Çubuk yüksekliği"), "0.5", 1, 200, "mm"), fNum(el, "module", __("Çubuk kalınlığı"), "1", 1, 10, "nokta")]));
      if (el.kind === "code39") add(fNum(el, "ratio", __("Kalın/ince oranı"), "0.1", 2, 3));
      add(r("r2", [fCheck(el, "human", __("Altında yazı")), fCheck(el, "humanAbove", __("Yazı üstte"))]));
    } else if (el.type === "line") {
      add(fSeg(el, "dir", __("Yön"), [["h", __("Yatay")], ["v", __("Dikey")]]));
      add(r("r2", [fNum(el, "len", __("Uzunluk"), "0.5", 0.1, 1000, "mm"), fNum(el, "t", __("Kalınlık"), "0.05", 0.05, 50, "mm")]));
    } else if (el.type === "box" || el.type === "ellipse") {
      add(r("r2", [fNum(el, "w", __("Genişlik"), "0.5", 0.1, 1000, "mm"), fNum(el, "h", __("Yükseklik"), "0.5", 0.1, 1000, "mm")]));
      add(r("r2", [fNum(el, "t", __("Kenar kalınlığı"), "0.05", 0.05, 50, "mm"), el.type === "box" ? fNum(el, "round", __("Köşe yuvarlama"), "1", 0, 8, "0–8") : h("span", {})]));
      add(r("r2", [fCheck(el, "filled", __("Dolu")), fCheck(el, "reverse", __("Ters baskı"))]));
      add(h("p", { class: "note", text: __("Ters baskı: altındaki siyahı beyaza, beyazı siyaha çevirir.") }));
    } else if (el.type === "image") {
      if (el.src) add(h("img", { class: "thumb", src: el.src, alt: __("Görsel") }));
      add(h("button", { type: "button", class: "tb", text: __("Görseli değiştir"), onclick: function () { pendingImagePos = { replace: el.id }; $("fileImage").click(); } }));
      add(r("r2", [fNum(el, "w", __("Genişlik"), "0.5", 1, 1000, "mm"), fNum(el, "h", __("Yükseklik"), "0.5", 1, 1000, "mm")]));
      add(fRange(el, "threshold", __("Siyah eşiği"), 1, 254));
      add(r("r2", [fCheck(el, "dither", __("Gri tonları noktala")), fCheck(el, "invert", __("Renkleri ters çevir"))]));
      add(fCheck(el, "keepAspect", __("En-boy oranını koru")));
      add(h("p", { class: "note", text: __("Logo ve siyah-beyaz çizimler en iyi sonucu verir. Fotoğraf için 'noktala'yı aç.") }));
    }
    var common = h("div", { class: "sec" });
    common.appendChild(h("h4", { text: __("Konum ve katman") }));
    common.appendChild(r("r2", [fNum(el, "x", "X", "0.5", -500, 1000, "mm"), fNum(el, "y", "Y", "0.5", -500, 1000, "mm")]));
    common.appendChild(fRot(el));
    if (!Z.isNative(el) && Z.normRot(el.rot) % 90) common.appendChild(h("p", { class: "note", text: el.type === "barcode"
      ? __("Bu açı resim olarak basılır; barkodun okunabilirliği düşebilir. 0°, 90°, 180° ve 270°'yi yazıcı kendisi çizer.")
      : __("Bu açı resim olarak basılır. 0°, 90°, 180° ve 270°'yi yazıcı kendisi çizer.") }));
    common.appendChild(fText(el, "name", __("Katman adı (isteğe bağlı)")));
    common.appendChild(r("r2", [fCheck(el, "hidden", __("Gizle (basılmaz)"), function () { renderLayers(); }), fCheck(el, "locked", __("Kilitle"), function () { renderLayers(); })]));
    insp.appendChild(common);
  }
  function refreshInspectorValues() {
    var el = sel.length === 1 ? byId(sel[0]) : null; if (!el) return;
    qsa("[data-key]", insp).forEach(function (inp) {
      if (document.activeElement === inp) return;
      var k = inp.dataset.key;
      if (inp.type === "checkbox") inp.checked = !!el[k]; else inp.value = el[k] == null ? "" : el[k];
    });
    var info = insp.querySelector("[data-info=qr]"), L = layouts[idx(el.id)];
    if (info && L && L.mat) info.textContent = __("Yaklaşık boyut: ") + mm(L.box.w).toFixed(1) + __(" mm (") + L.mat.n + "×" + L.mat.n + __(" modül)");
  }
  function focusContent() {
    var c = insp.querySelector(".content");
    if (c) { c.focus(); if (c.select) c.select(); }
  }

  /* ================= sekmeler ================= */

  /* ================= etiket sekmesi ================= */
  function syncLabelTab() {
    var st = doc.settings;
    $("lW").value = doc.w; $("lH").value = doc.h; $("lDpi").value = String(doc.dpi);
    $("sMedia").value = st.media; $("sDark").value = st.darkness; $("sSpeed").value = String(st.speed || "");
    $("sShiftX").value = st.shiftX; $("sShiftY").value = st.shiftY; $("sRot").checked = !!st.rotate180;
    $("lPreset").value = "";
    updateLabelStatus();
  }
  function updateLabelStatus() { $("stLabel").textContent = doc.w + " × " + doc.h + " mm · " + doc.dpi + " dpi"; }
  function bindDoc(id, fn, ev) {
    $(id).addEventListener(ev || "input", function () { checkpoint(); fn(this); updateLabelStatus(); changed({ inspectorValues: true }); });
  }
  $("docTitle").addEventListener("input", function () { checkpoint(); doc.name = this.value; updateTitle(); });
  $("docTitle").addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === "Escape") this.blur(); });
  $("docTitle").addEventListener("focus", function () { var t = this; setTimeout(function () { t.select(); }, 0); });
  $("docTitle").addEventListener("blur", function () { if (!this.value.trim()) { this.value = doc.name = __("Adsız etiket"); updateTitle(); } });
  bindDoc("lW", function (e) { var v = parseFloat(e.value); if (v > 0) doc.w = v; });
  bindDoc("lH", function (e) { var v = parseFloat(e.value); if (v > 0) doc.h = v; });
  bindDoc("lDpi", function (e) { doc.dpi = +e.value; }, "change");
  bindDoc("sMedia", function (e) { doc.settings.media = e.value; }, "change");
  bindDoc("sDark", function (e) { doc.settings.darkness = e.value === "" ? "" : clamp(+e.value, 0, 30); });
  bindDoc("sSpeed", function (e) { doc.settings.speed = e.value ? +e.value : ""; }, "change");
  bindDoc("sShiftX", function (e) { doc.settings.shiftX = +e.value || 0; });
  bindDoc("sShiftY", function (e) { doc.settings.shiftY = +e.value || 0; });
  bindDoc("sRot", function (e) { doc.settings.rotate180 = e.checked; }, "change");
  $("lPreset").addEventListener("change", function () {
    if (!this.value) return;
    var p = this.value.split("x"); checkpoint(true); doc.w = +p[0]; doc.h = +p[1]; syncLabelTab(); fit();
  });
  $("gSize").addEventListener("input", function () { view.gridMm = Math.max(0.5, +this.value || 1); schedule(); });
  $("nudge").addEventListener("input", function () { view.nudge = Math.max(0.1, +this.value || 0.5); });
  $("lW").addEventListener("change", fit); $("lH").addEventListener("change", fit);

  /* ================= yazdir sekmesi ================= */
  function syncPrintTab() {
    var j = doc.job;
    $("pCopies").value = j.copies; $("pCount").value = j.count; $("pStart").value = j.start; $("pStep").value = j.step;
    $("pDigits").value = j.digits; $("pRec").value = previewIdx + 1;
    renderCols(); updatePrintSummary();
  }
  function bindJob(id, key, num) {
    $(id).addEventListener("input", function () {
      checkpoint();
      doc.job[key] = num ? (+this.value || 0) : this.value;
      if (key === "csv") renderCols();
      updatePrintSummary(); schedule();
    });
  }
  bindJob("pCopies", "copies", true); bindJob("pCount", "count", true); bindJob("pStart", "start", true);
  bindJob("pStep", "step", true); bindJob("pDigits", "digits", true);
  function setRec(i) {
    var n = Z.records(jobForRecords()).length;
    previewIdx = clamp(i, 0, Math.max(0, n - 1)); $("pRec").value = previewIdx + 1;
    schedule(); drawPrintPreview();
  }
  $("pRec").addEventListener("input", function () { setRec((+this.value || 1) - 1); });
  $("pRecPrev").addEventListener("click", function () { setRec(previewIdx - 1); });
  $("pRecNext").addEventListener("click", function () { setRec(previewIdx + 1); });
  $("ppPrev").addEventListener("click", function () { setRec(previewIdx - 1); });
  $("ppNext").addEventListener("click", function () { setRec(previewIdx + 1); });
  $("pCsvEdit").addEventListener("click", function () {
    var ta = h("textarea", { spellcheck: "false", placeholder: __("ad;adres;telefon") + "\n" + __("Örnek Makina;Kadıköy;0212 000 00 00") });
    ta.value = doc.job.csv || "";
    ta.addEventListener("input", function () { checkpoint(); doc.job.csv = ta.value; renderCols(); updatePrintSummary(); schedule(); });
    openModal(__("Veri listesi (CSV)"), [h("p", { class: "note", text: __("İlk satır sütun adlarıdır; ; , ya da sekme ile ayır. Alanlara {sütun_adı} yazınca her satır için bir etiket basılır.") }), ta]);
    setTimeout(function () { ta.focus(); }, 0);
  });
  function renderCols() {
    var csv = Z.parseCSV(doc.job.csv), cols = csv.cols, box = $("pCols"); box.innerHTML = "";
    if (!cols.length) box.appendChild(h("span", { class: "empty", text: __("Liste yükleyince sütun adları burada çıkar; tıklayınca seçili metne eklenir.") }));
    cols.forEach(function (c) { box.appendChild(h("button", { type: "button", class: "chip", text: "{" + c + "}", title: __("Seçili alana ekle"), onclick: function () { insertToken("{" + c + "}"); } })); });
    $("pCsvInfo").textContent = csv.rows.length ? csv.rows.length + " " + __("satır") : __("Liste yok");
  }
  function updatePrintSummary() {
    if (!doc) return;
    var j = jobForRecords(), n = Z.records(j).length, c = Math.max(1, Math.round(+doc.job.copies || 1));
    var tpl = j.rows.length ? __("{n} CSV satırı × {c} adet = toplam {t} etiket basılacak.") : __("{n} farklı etiket × {c} adet = toplam {t} etiket basılacak.");
    $("pSummary").textContent = tpl.replace("{n}", n).replace("{c}", c).replace("{t}", n * c);
    $("pRec").max = n; $("pRecMax").textContent = "/ " + n;
    if (previewIdx > n - 1) previewIdx = Math.max(0, n - 1);
    renderPrinterInfo();
    if (curBs === "print") drawPrintPreview();
  }
  $("pCsvFile").addEventListener("click", function () { $("fileCsv").click(); });
  $("fileCsv").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { checkpoint(true); doc.job.csv = String(rd.result); syncPrintTab(); schedule(); status(__("CSV yüklendi: ") + f.name); };
    rd.readAsText(f, "utf-8"); this.value = "";
  });
  $("pCsvClear").addEventListener("click", function () { checkpoint(true); doc.job.csv = ""; syncPrintTab(); schedule(); });

  /* ================= gorsel ekleme ================= */
  $("fileImage").addEventListener("change", function () {
    var f = this.files[0]; this.value = ""; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var src = String(rd.result);
      Z.loadImage(src).then(function (img) {
        if (!img) { status(__("Görsel açılamadı."), true); return; }
        var ratio = img.naturalHeight / img.naturalWidth;
        if (pendingImagePos && pendingImagePos.replace) {
          var el = byId(pendingImagePos.replace);
          if (el) { checkpoint(true); el.src = src; el.h = r2(el.w * (Z.sideways(el.rot) ? 1 / ratio : ratio)); changed({ inspector: true }); }
        } else {
          var p = pendingImagePos || { x: d(doc.w / 2 - 12), y: d(Math.max(1, doc.h / 2 - 10)) };
          var w = Math.min(30, doc.w - mm(p.x) - 2), hh = w * ratio;
          if (hh > doc.h - 2) { hh = doc.h - 4; w = hh / ratio; }
          addElement(newEl("image", mm(p.x), mm(p.y), { src: src, w: r2(Math.max(5, w)), h: r2(Math.max(3, hh)) }));
        }
        pendingImagePos = null;
        schedule();
      });
    };
    rd.readAsDataURL(f);
  });

  /* ================= araclar ================= */
  function setTool(t) {
    tool = t;
    qsa("[data-tool]").forEach(function (b) { b.classList.toggle("on", b.dataset.tool === t); });
    cv.style.cursor = t === "select" ? "default" : "crosshair";
    if (t === "image") { pendingImagePos = null; $("fileImage").click(); setTool("select"); return; }
    status(t === "select" ? "" : ({ text: __("Metni koymak için etikete tıkla."), qr: __("QR kodu koymak için tıkla."), barcode: __("Barkodu koymak için tıkla."),
      line: __("Çizgi çizmek için sürükle."), box: __("Kutu çizmek için sürükle."), ellipse: __("Elips çizmek için sürükle.") }[t] || ""));
  }
  qsa("[data-tool]").forEach(function (b) { b.addEventListener("click", function () { setTool(b.dataset.tool); }); });

  qsa("[data-al]").forEach(function (b) { b.addEventListener("click", function () { align(b.dataset.al); }); });
  $("toFront").addEventListener("click", function () { reorder(1); });
  $("toBack").addEventListener("click", function () { reorder(-1); });
  $("dupBtn").addEventListener("click", function () { duplicateSel(); });
  $("delBtn").addEventListener("click", deleteSel);
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  $("zIn").addEventListener("click", function () { setZoom(view.zoom * 1.25); });
  $("zOut").addEventListener("click", function () { setZoom(view.zoom / 1.25); });
  $("zFit").addEventListener("click", fit);
  $("z100").addEventListener("click", function () { setZoom(6); });
  $("zInS").addEventListener("click", function () { setZoom(view.zoom * 1.25); });
  $("zOutS").addEventListener("click", function () { setZoom(view.zoom / 1.25); });
  $("zSlider").addEventListener("input", function () { setZoom(+this.value / 100 * 6); });
  $("zoomVal").addEventListener("click", fit);
  $("gridOn").addEventListener("change", function () { view.grid = this.checked; schedule(); });
  $("snapOn").addEventListener("change", function () { view.snap = this.checked; });

  /* ================= klavye ================= */
  function typing(e) { var t = e.target; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable); }
  window.addEventListener("keydown", function (e) {
    var k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === "s" || k === "S")) { e.preventDefault(); saveDoc(e.shiftKey); return; }
    if (ctrl && (k === "p" || k === "P")) { e.preventDefault(); if ($("modal").hidden) openBackstage("print"); return; }
    if (ctrl && (k === "n" || k === "N")) { e.preventDefault(); newDoc(); return; }
    if (ctrl && (k === "o" || k === "O")) { e.preventDefault(); if ($("modal").hidden) askOpen(); return; }
    if (k === "F12") { e.preventDefault(); saveDoc(true); return; }
    if (ctrl && (k === "h" || k === "H" || k === "f" || k === "F") && $("modal").hidden && $("bs").hidden) { e.preventDefault(); openFind(); return; }
    if (!$("modal").hidden) { if (k === "Escape") closeModal(); return; }
    if (!$("bs").hidden) { if (k === "Escape" && !typing(e)) closeBackstage(); return; }
    if (typing(e)) { if (k === "Escape") e.target.blur(); return; }
    if (ctrl && (k === "b" || k === "B")) { e.preventDefault(); fmtToggle("b"); return; }
    if (ctrl && (k === "i" || k === "I")) { e.preventDefault(); fmtToggle("i"); return; }
    if (ctrl && (k === "u" || k === "U")) { e.preventDefault(); fmtToggle("u"); return; }
    if (ctrl && e.shiftKey && (k === ">" || k === "<")) { e.preventDefault(); stepSize(k === ">" ? 1 : -1); return; }
    if ((k === "F2" || k === "Enter") && sel.length === 1) {
      var eEl = byId(sel[0]);
      if (eEl && eEl.type === "text") { e.preventDefault(); startEdit(eEl, k === "F2" ? false : true); return; }
    }
    if (ctrl && (k === "z" || k === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (ctrl && (k === "y" || k === "Y")) { e.preventDefault(); redo(); return; }
    if (ctrl && (k === "d" || k === "D")) { e.preventDefault(); duplicateSel(); return; }
    if (ctrl && (k === "c" || k === "C")) { e.preventDefault(); copySel(); return; }
    if (ctrl && (k === "x" || k === "X")) { e.preventDefault(); copySel(); deleteSel(); return; }
    if (ctrl && (k === "v" || k === "V")) { e.preventDefault(); paste(); return; }
    if (ctrl && (k === "a" || k === "A")) { e.preventDefault(); sel = doc.elements.filter(function (x) { return !x.hidden; }).map(function (x) { return x.id; }); selectionChanged(); schedule(); return; }
    if (ctrl && k === "]") { e.preventDefault(); reorder(1); return; }
    if (ctrl && k === "[") { e.preventDefault(); reorder(-1); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); deleteSel(); return; }
    if (k === "Escape") { if (tool !== "select") setTool("select"); else { sel = []; selectionChanged(); schedule(); } return; }
    var step = view.nudge * (e.shiftKey ? 10 : 1);
    if (k === "ArrowLeft") { e.preventDefault(); nudge(-step, 0); return; }
    if (k === "ArrowRight") { e.preventDefault(); nudge(step, 0); return; }
    if (k === "ArrowUp") { e.preventDefault(); nudge(0, -step); return; }
    if (k === "ArrowDown") { e.preventDefault(); nudge(0, step); return; }
    if (k === " ") { spaceDown = true; e.preventDefault(); cv.style.cursor = "grab"; return; }
    if (k === "+" || k === "=") { setZoom(view.zoom * 1.25); return; }
    if (k === "-") { setZoom(view.zoom / 1.25); return; }
    if (k === "0") { fit(); return; }
    if (ctrl || e.altKey) return;
    var tk = { v: "select", t: "text", q: "qr", b: "barcode", l: "line", r: "box", e: "ellipse", i: "image" }[k.toLowerCase()];
    if (tk) setTool(tk);
  });
  window.addEventListener("keyup", function (e) { if (e.key === " ") { spaceDown = false; cv.style.cursor = ""; } });
  /* pencere odagi kaybedince basili tuslari unut: yoksa sol tik "kaydir" gibi davranir */
  window.addEventListener("blur", function () { spaceDown = false; cv.style.cursor = ""; });
  document.addEventListener("visibilitychange", function () { spaceDown = false; });

  /* ================= dosya islemleri (dosya tabanli) ================= */
  var fileHandle = null, EXT = ".zebra";
  var haveFS = !!(window.showSaveFilePicker && window.showOpenFilePicker);
  function persist() { return api("/api/labels", docs); }   // yalniz eski kutuphane + ornekler
  function renderOpen() { $("docTitle").value = doc ? doc.name : ""; }
  function nameFromFile(n) { return String(n || "").replace(/\.(zebra|json|zpl|prn|txt|nlbl)$/i, ""); }
  function safeName() { return (doc.name || "etiket").replace(/[^\wçğıöşüÇĞİÖŞÜ\- ]+/g, "").trim().replace(/\s+/g, "_") || "etiket"; }

  /* son kullanilan dosyalar: dosya tutamaclari IndexedDB'de */
  var Recent = (function () {
    var ST = "recent";
    function db() {
      return new Promise(function (res, rej) {
        var r = indexedDB.open("zebraapp", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(ST, { keyPath: "key" }); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction(ST, mode), out = fn(t.objectStore(ST));
          t.oncomplete = function () { res(out && out.result); }; t.onerror = function () { rej(t.error); };
        });
      });
    }
    function list() {
      return tx("readonly", function (s) { return s.getAll(); })
        .then(function (a) { return (a || []).sort(function (x, y) { return y.t - x.t; }); })
        .catch(function () { return []; });
    }
    return {
      list: list,
      remove: function (key) { return tx("readwrite", function (s) { s.delete(key); }).catch(function () {}); },
      add: function (handle) {
        return list().then(function (items) {
          return Promise.all(items.map(function (it, i) {
            return Promise.resolve(it.handle.isSameEntry(handle)).then(function (same) { return same || i >= 11 ? it.key : null; }, function () { return null; });
          })).then(function (keys) {
            return tx("readwrite", function (s) {
              keys.forEach(function (k) { if (k) s.delete(k); });
              s.put({ key: String(Date.now()) + Math.random(), name: handle.name, handle: handle, t: Date.now() });
            });
          });
        }).catch(function () {});
      }
    };
  })();

  function confirmDiscard() { return !dirty || confirm(__("Kaydedilmemiş değişiklikler var. Devam edersen kaybolacak.")); }
  function loadDoc(dd, handle) {
    doc = migrate(clone(dd)); fileHandle = handle || null;
    if (handle) doc.name = nameFromFile(handle.name) || doc.name;
    if (editing) { editing = null; ted.hidden = true; }
    sel = []; undoStack = []; redoStack = []; dirty = false; previewIdx = 0;
    preloadImages(); refreshAll(); renderOpen(); closeBackstage(); requestAnimationFrame(fit);
  }
  function newDoc() { if (!confirmDiscard()) return; loadDoc(blankDoc()); }

  function docText() { return JSON.stringify(Object.assign({ format: "ZebraApp", formatVersion: 1 }, doc), null, 2); }
  function writeHandle(hd, text) {
    return hd.createWritable().then(function (w) { return w.write(text).then(function () { return w.close(); }); });
  }
  /* ---------- ZebraDesigner 3 (.nlbl), deneysel; donusturme sunucuda (nlbl.py) ---------- */
  function isNlbl(name) { return /\.nlbl$/i.test(name || ""); }
  var NLBL_TYPE = { description: __("ZebraDesigner 3 etiketi (deneysel)"), accept: { "application/octet-stream": [".nlbl"] } };
  function nlblApi(action, body) { return api("/api/nlbl/" + action, body).then(function (j) { if (!j.ok) throw new Error(j.message); return j; }); }
  function nlblWarn(ws) {
    if (ws && ws.length && !confirm(ws.join("\n") + "\n\n" + __("Devam edilsin mi?"))) { var e = new Error("cancel"); e.name = "AbortError"; throw e; }
  }
  function toB64(buf) {
    var bytes = new Uint8Array(buf), bin = "";
    for (var i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(bin);
  }
  function readNlbl(file) {
    if (file.size > MAX_FILE) return Promise.reject(new Error(__("Etiket dosyası en fazla 20 MB olabilir.")));
    return file.arrayBuffer().then(function (buf) { return nlblApi("import", { data: toB64(buf) }); })
      .then(function (j) { nlblWarn(j.warnings); return j.label; });
  }
  /* ZebraDesigner'in bilmedigi ZebraApp ayarlarini sadelestir, gorselleri baski gorunumune cevir */
  function prepareNlbl(d) {
    var copy = clone(d), warn = [];
    var hidden = copy.elements.filter(function (e) { return e.hidden; }).length;
    if (hidden) { copy.elements = copy.elements.filter(function (e) { return !e.hidden; }); warn.push(__("Gizli öğeler aktarılmadı.")); }
    copy.elements.forEach(function (e) {
      if (e.type !== "text") return;
      if (e.rich) { setRuns(e, e.rich); e.rich = null; warn.push(__("Kelime kelime biçim ZebraDesigner'a taşınmaz; metin düz yazı olarak aktarılır.")); }
      if (e.caseMode) { e.text = Z.caseT(e.text, e.caseMode); }
      if (e.italic || e.underline || e.strike || +e.spacing || e.align === "justify" || e.fit || e.boxH)
        warn.push(__("İtalik, altı/üstü çizili, karakter aralığı, iki yana yaslama ve kutuya sığdır ZebraDesigner'a taşınmaz."));
    });
    var imgs = copy.elements.filter(function (e) { return e.type === "image" && e.src && Z.isNative(e); });
    return Promise.all(imgs.map(function (e) { return Z.loadImage(e.src); })).then(function () {
      imgs.forEach(function (e) {
        var w = Math.max(8, Z.dots(e.w, copy.dpi)), hh = Math.max(1, Z.dots(e.h, copy.dpi));
        if (w * hh > 4000000) throw new Error(__("Görsel baskı boyutu en fazla 4 milyon piksel olabilir."));
        var bmp = Z.bitmap(e, w, hh); if (!bmp) throw new Error(__("Etiketteki görsel okunamadı."));
        e.src = bmpToPng(bmp); e.threshold = 128; e.dither = false; e.invert = false; e.rot = 0;   /* donus resme islendi */
      });
      return { label: copy, warnings: warn.filter(function (x, i) { return warn.indexOf(x) === i; }) };
    });
  }
  function encodeFor(name) {
    if (!isNlbl(name)) return Promise.resolve(docText());
    return prepareNlbl(doc).then(function (r) {
      return nlblApi("export", { label: r.label }).then(function (j) {
        nlblWarn(r.warnings.concat(j.warnings || []));
        return Uint8Array.from(atob(j.data), function (c) { return c.charCodeAt(0); });
      });
    });
  }
  function saveDoc(asNew, kind) {
    var nl = kind === "nlbl";
    if (!haveFS) {
      var fn = safeName() + (nl ? ".nlbl" : EXT);
      return encodeFor(fn).then(function (data) {
        var a = document.createElement("a"), url = URL.createObjectURL(new Blob([data], { type: nl ? "application/octet-stream" : "application/json" }));
        a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        if (!nl) { dirty = false; updateTitle(); }
        status(__("İndirilenler klasörüne kaydedildi: ") + fn);
      }).catch(function (e) { if (!e || e.name !== "AbortError") status(__("Kaydedilemedi: ") + ((e && e.message) || e), true); });
    }
    var pick = (fileHandle && !asNew) ? Promise.resolve(fileHandle) : window.showSaveFilePicker({
      suggestedName: safeName() + (nl ? ".nlbl" : EXT), startIn: fileHandle || "documents",
      types: [nl ? NLBL_TYPE : { description: __("ZebraApp etiketi"), accept: { "application/json": [EXT] } }]
    });
    return pick.then(function (hd) {
      if (hd !== fileHandle && !nl) doc.name = nameFromFile(hd.name) || doc.name;
      return encodeFor(hd.name).then(function (data) { return writeHandle(hd, data); }).then(function () {
        if (nl && hd !== fileHandle) { status(__("ZebraDesigner dosyası kaydedildi: ") + hd.name); Recent.add(hd); return; }
        fileHandle = hd; dirty = false; renderOpen(); updateTitle();
        status(__("Kaydedildi: ") + hd.name); Recent.add(hd);
      });
    }).catch(function (e) {
      if (e && e.name === "AbortError") return;
      status(__("Kaydedilemedi: ") + ((e && e.message) || e), true);
    });
  }

  function looksZPL(t) { return /\^XA/i.test(t) && !/^\s*[\[{]/.test(t); }
  function bmpToPng(b) {
    var c = document.createElement("canvas"); c.width = b.w; c.height = b.h;
    var g = c.getContext("2d"), id = g.createImageData(b.w, b.h);
    for (var i = 0; i < b.w * b.h; i++) { var v = b.bits[i] ? 0 : 255; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    g.putImageData(id, 0, 0);
    return c.toDataURL("image/png");
  }
  /* ZPL dosyasini duzenlenebilir etikete cevir. ZPL cozunurluk bilgisi tasimadigi icin once sorulur. */
  function importZPL(text, name) {
    var ap = activePrinter(), guess = Z.guessDpi(text), pref = ap && ap.dpi ? +ap.dpi : guess;
    if (/\^PW/i.test(text)) pref = guess;
    var selD = h("select", {});
    [203, 300, 600].forEach(function (v) { selD.appendChild(h("option", { value: String(v), text: v + " dpi" + (v === guess ? " " + __("(önerilen)") : "") })); });
    selD.value = String(pref);
    var go = h("button", { type: "button", class: "tb primary", text: __("Aç"), onclick: function () { closeModal(); run(+selD.value); } });
    openModal(__("ZPL dosyasını aç"), [
      h("p", { class: "note", text: __("ZPL dosyaları çözünürlük bilgisi taşımaz. Bu dosya hangi çözünürlükteki yazıcı için yazıldı? Yanlış seçersen ölçüler büyük ya da küçük çıkar.") }),
      h("label", {}, [document.createTextNode(__("Çözünürlük")), selD]), h("div", { class: "row" }, [go])]);
    setTimeout(function () { go.focus(); }, 0);
    function run(dpi) {
      var r;
      try { r = Z.parseZPL(text, dpi); } catch (e) { status(__("ZPL okunamadı: ") + e, true); return; }
      var dd = blankDoc();
      dd.name = name || __("İçe aktarılan etiket"); dd.w = r.w; dd.h = r.h; dd.dpi = dpi;
      Object.keys(r.settings).forEach(function (k) { dd.settings[k] = r.settings[k]; });
      dd.job.copies = r.copies;
      dd.elements = r.elements.map(function (e) { if (e.type === "image" && e.bmp) { e.src = bmpToPng(e.bmp); delete e.bmp; } return e; });
      loadDoc(dd); dirty = true; updateTitle();
      preloadImages();
      var msg = __("ZPL açıldı: {n} öğe.").replace("{n}", dd.elements.length);
      if (r.labels > 1) msg += " " + __("Dosyada {n} etiket var, ilki açıldı.").replace("{n}", r.labels);
      if (r.unsupported.length) msg += " " + __("Atlanan komutlar: ") + r.unsupported.join(" ");
      msg += " " + __("Kaydetmek için Ctrl+S (.zebra olarak).");
      status(msg, !dd.elements.length);
    }
  }
  /* .zebra dosyasini kontrol et: bozuk ya da baska programin dosyasi editoru bozmasin */
  var MAX_FILE = 20 * 1024 * 1024, EL_TYPES = ["text", "qr", "barcode", "line", "box", "ellipse", "image"];
  function checkDoc(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(__("Geçerli bir ZebraApp etiket dosyası seç (.zebra)."));
    if (v.format && v.format !== "ZebraApp") throw new Error(__("Bu dosya ZebraApp tasarımı değil."));
    if (v.formatVersion && v.formatVersion > 1) throw new Error(__("Bu dosya daha yeni bir ZebraApp sürümü gerektiriyor."));
    var okNum = function (n, a, b) { return typeof n === "number" && isFinite(n) && n >= a && n <= b; };
    if (!Array.isArray(v.elements) || v.elements.length > 2000 || !okNum(v.w, 1, 2000) || !okNum(v.h, 1, 2000) || [203, 300, 600].indexOf(+v.dpi) < 0)
      throw new Error(__("Geçerli bir ZebraApp etiket dosyası seç (.zebra)."));
    v.elements.forEach(function (e) {
      if (!e || EL_TYPES.indexOf(e.type) < 0 || !isFinite(e.x) || !isFinite(e.y)) throw new Error(__("Etiket öğeleri geçersiz."));
      if (e.type === "image" && e.src && !/^data:image\/(png|jpeg|webp|gif|bmp);base64,/i.test(e.src)) throw new Error(__("Etiketteki görseller dosyanın içine gömülü olmalı."));
    });
    return v;
  }
  function loadFromText(text, hd, fname) {
    if (looksZPL(text)) { importZPL(text, nameFromFile(hd ? hd.name : fname)); return true; }
    var data;
    try { data = JSON.parse(String(text).replace(/^\uFEFF/, "")); } catch (e) { status(__("Dosya okunamadı: geçerli bir ZebraApp etiketi değil."), true); return false; }
    if (Array.isArray(data)) data = data[0];
    try { checkDoc(data); } catch (e) { status(e.message, true); return false; }
    data = migrate(data); if (!data.id) data.id = uid();
    loadDoc(data, hd); if (hd) { status(__("Açıldı: ") + hd.name); Recent.add(hd); }
    return true;
  }
  function openHandle(hd, key) {
    var perm = hd.requestPermission ? hd.requestPermission({ mode: "readwrite" }) : Promise.resolve("granted");
    return perm.then(function (pm) { if (pm !== "granted") throw new Error(__("İzin verilmedi.")); return hd.getFile(); })
      .then(function (f) {
        if (f.size > MAX_FILE) throw new Error(__("Etiket dosyası en fazla 20 MB olabilir."));
        if (isNlbl(f.name)) return readNlbl(f).then(function (label) { loadLabelObject(label, hd); });
        return f.text().then(function (t) { loadFromText(t, hd); });
      })
      .catch(function (e) {
        if (e && e.name === "NotFoundError" && key) { Recent.remove(key); status(__("Dosya bulunamadı, listeden kaldırıldı."), true); }
        else if (!e || e.name !== "AbortError") status(__("Açılamadı: ") + ((e && e.message) || e), true);
      });
  }
  /* sunucudan gelen etiket nesnesi (NLBL) */
  function loadLabelObject(label, hd) {
    try { checkDoc(label); } catch (e) { status(e.message, true); return; }
    var dd = migrate(label); dd.id = dd.id || uid();
    loadDoc(dd, hd);
    if (hd) Recent.add(hd);
    status(__("ZebraDesigner dosyası açıldı. Kaydet aynı .nlbl dosyasını günceller; .zebra kopyası için Farklı kaydet."));
  }
  function pickAndOpen() {
    if (!haveFS) { $("fileImport").click(); return; }
    window.showOpenFilePicker({ multiple: false, startIn: fileHandle || "documents",
      types: [{ description: __("Etiket dosyaları (.zebra, .zpl, .nlbl)"), accept: { "application/json": [EXT, ".json"], "text/plain": [".zpl", ".prn", ".txt"], "application/octet-stream": [".nlbl"] } }] })
      .then(function (a) { return openHandle(a[0]); })
      .catch(function (e) { if (!e || e.name !== "AbortError") status(__("Açılamadı: ") + ((e && e.message) || e), true); });
  }
  $("fileImport").addEventListener("change", function () {
    var f = this.files[0]; this.value = ""; if (!f) return;
    if (f.size > MAX_FILE) { status(__("Etiket dosyası en fazla 20 MB olabilir."), true); return; }
    if (isNlbl(f.name)) { readNlbl(f).then(function (label) { loadLabelObject(label, null); }).catch(function (e) { if (e.name !== "AbortError") status(__("Açılamadı: ") + e.message, true); }); return; }
    var rd = new FileReader();
    rd.onload = function () { loadFromText(String(rd.result), null, f.name); };
    rd.readAsText(f, "utf-8");
  });

  /* Ac sayfasi (Dosya > Ac) */
  function renderOpenPage() {
    var box = $("openList");
    function section(title) { box.appendChild(h("div", { class: "openHead", text: title })); }
    function render(recent) {
      box.innerHTML = "";
      box.appendChild(h("button", { class: "tb primary", text: __("Bilgisayardan aç…"), onclick: function () { if (confirmDiscard()) pickAndOpen(); } }));
      if (haveFS) {
        section(__("Son kullanılanlar"));
        if (!recent.length) box.appendChild(h("div", { class: "openEmpty", text: __("Henüz son kullanılan dosya yok.") }));
        recent.forEach(function (it) {
          var row = h("div", { class: "openRow" }, [
            h("div", { class: "on" }, [h("b", { text: it.name }), h("small", { text: new Date(it.t).toLocaleString() })]),
            h("button", { class: "tb", text: __("Kaldır"), onclick: function (ev) { ev.stopPropagation(); Recent.remove(it.key).then(function () { render(recent.filter(function (x) { return x.key !== it.key; })); }); } })
          ]);
          row.addEventListener("click", function () { if (confirmDiscard()) openHandle(it.handle, it.key); });
          box.appendChild(row);
        });
      }
      if (docs.length) {
        section(__("Uygulama içinde kayıtlı etiketler (eski sürüm)"));
        docs.slice().reverse().forEach(function (dd) {
          var row = h("div", { class: "openRow" }, [
            h("div", { class: "on" }, [h("b", { text: dd.name || __("Adsız etiket") }),
              h("small", { text: dd.w + " × " + dd.h + " mm · " + (dd.elements || []).length + " " + __("öğe") })]),
            h("button", { class: "tb", text: __("Sil"), onclick: function (ev) {
              ev.stopPropagation();
              if (!confirm(__("'{a}' silinsin mi?").replace("{a}", dd.name))) return;
              docs = docs.filter(function (x) { return x.id !== dd.id; }); persist(); render(recent);
            } })
          ]);
          row.addEventListener("click", function () { if (!confirmDiscard()) return; loadDoc(dd); dirty = true; updateTitle(); status(__("Kopya açıldı. Dosya olarak kaydetmek için Ctrl+S.")); });
          box.appendChild(row);
        });
      }
    }
    render([]);
    Recent.list().then(function (r) { if (curBs === "open") render(r); });
  }
  function askOpen() { openBackstage("open"); }

  $("fSave").addEventListener("click", function () { saveDoc(false).then(closeBackstage); });
  $("fSaveQuick").addEventListener("click", function () { saveDoc(false); });
  $("fSaveAs").addEventListener("click", function () { saveDoc(true).then(closeBackstage); });
  function download(name, text, type) {
    type = type || "text/plain";
    function fallback() {
      var a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: type }));
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      status(__("İndirilenler klasörüne kaydedildi: ") + name);
    }
    if (!window.showSaveFilePicker) { fallback(); return; }
    var acc = {}; acc[type] = [(name.match(/\.[^.]+$/) || [".txt"])[0]];
    window.showSaveFilePicker({ suggestedName: name, startIn: fileHandle || "documents", types: [{ description: name, accept: acc }] })
      .then(function (fh) { return writeHandle(fh, text).then(function () { status(__("Dışa aktarıldı: ") + fh.name); }); })
      .catch(function (err) { if (err && err.name === "AbortError") return; fallback(); });
  }
  $("fExportNlbl").addEventListener("click", function () { saveDoc(true, "nlbl"); });
  $("fExportZpl").addEventListener("click", function () { buildJobZPL().then(function (z) { download(safeName() + ".zpl", z); }); });
  window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  function preloadImages() {
    var ps = doc.elements.filter(function (e) { return e.type === "image" && e.src; }).map(function (e) { return Z.loadImage(e.src); });
    return Promise.all(ps).then(schedule);
  }

  /* ================= yazdirma ================= */
  function buildJobZPL() {
    return preloadImages().then(function () {
      var j = jobForRecords(); j.copies = doc.job.copies;
      return Z.docZPL(doc, j);
    });
  }
  function previewZPL() {
    return preloadImages().then(function () { return Z.labelZPL(doc, currentRec(), 1); });
  }

  function busy(btns, on) { btns.forEach(function (b) { if ($(b)) $(b).disabled = on; }); }
  function send(zpl, what) {
    busy(["pPrint", "printTop"], true);
    status((what || __("Gönderiliyor")) + "…");
    return api("/api/print_raw", { data: zpl })
      .then(function (j) { status(j.message || (j.ok ? __("Gönderildi.") : __("Hata")), !j.ok); refreshState(); return j; })
      .catch(function (e) { status(__("Uygulama sunucusuna ulaşılamadı: ") + e, true); })
      .then(function (j) { busy(["pPrint", "printTop"], false); return j; });
  }
  function printJob() {
    var j = jobForRecords(), n = Z.records(j).length * Math.max(1, +doc.job.copies || 1);
    if (n > 50 && !confirm(n + __(" etiket basılacak. Emin misin?"))) return;
    buildJobZPL().then(function (z) { send(z, n + __(" etiket gönderiliyor")); });
  }
  $("pPrint").addEventListener("click", printJob);
  $("printTop").addEventListener("click", printJob);
  $("pCal").addEventListener("click", function () { send("~JC", __("Kalibrasyon")); });
  $("pFeed").addEventListener("click", function () { send("^XA^XZ", __("Boş etiket")); });
  $("pCfg").addEventListener("click", function () { send("~WC", __("Ayar etiketi")); });

  /* modal */
  function openModal(title, nodes) {
    $("mTitle").textContent = title; var b = $("mBody"); b.innerHTML = "";
    nodes.forEach(function (n) { b.appendChild(n); }); $("modal").hidden = false;
  }
  function closeModal() { $("modal").hidden = true; }
  $("mClose").addEventListener("click", closeModal);
  $("modal").addEventListener("mousedown", function (e) { if (e.target === this) closeModal(); });

  $("pZpl").addEventListener("click", function () {
    buildJobZPL().then(function (z) {
      var ta = h("textarea", { spellcheck: "false" }); ta.value = z;
      var bar = h("div", { class: "row wrap" }, [
        h("button", { class: "tb primary", text: __("Bu kodu yazdır"), onclick: function () { send(ta.value, __("Ham ZPL")); } }),
        h("button", { class: "tb", text: __("Kopyala"), onclick: function () { ta.select(); try { navigator.clipboard.writeText(ta.value); status(__("Kopyalandı.")); } catch (e) { document.execCommand("copy"); } } }),
        h("button", { class: "tb", text: __("Dosyaya kaydet"), onclick: function () { download(safeName() + ".zpl", ta.value); } })
      ]);
      openModal(__("ZPL kodu (") + z.length + __(" karakter)"), [h("p", { class: "note", text: __("Burada yaptığın değişiklik tasarıma yansımaz; sadece bu gönderim için kullanılır.") }), ta, bar]);
    });
  });
  $("pLabelary").addEventListener("click", function () {
    var btn = this; btn.disabled = true; status(__("Labelary önizlemesi alınıyor…"));
    previewZPL().then(function (z) {
      return api("/api/labelary", { zpl: z, dpi: doc.dpi, w: doc.w, h: doc.h });
    }).then(function (j) {
      if (!j.ok) { status(j.message || __("Önizleme alınamadı."), true); return; }
      status("");
      openModal(__("Gerçek önizleme (Labelary, ") + doc.dpi + __(" dpi)"), [
        h("img", { src: "data:image/png;base64," + j.png, alt: __("Labelary önizlemesi") }),
        h("p", { class: "note", text: __("Bu görüntü yazıcının yazı tipiyle çizilir; editördeki önizlemeden biraz farklı olabilir.") })
      ]);
    }).catch(function (e) { status(__("Önizleme alınamadı: ") + e, true); })
      .then(function () { btn.disabled = false; });
  });

  /* ================= yazicilar ================= */
  var settings = { printers: [], active: null, available: {}, language: null };
  var TRANSPORT_NAMES = {
    ble: "Bluetooth LE", tcp: __("Ağ (Wi-Fi / Ethernet)"), system: __("Sistem yazıcısı / USB"),
    device: __("USB aygıt dosyası (Linux)"), serial: __("Seri port / klasik Bluetooth"), command: __("Harici komut")
  };
  function activePrinter() {
    for (var i = 0; i < settings.printers.length; i++) if (settings.printers[i].id === settings.active) return settings.printers[i];
    return settings.printers[0] || null;
  }
  function saveSettings(extra) {
    return api("/api/settings", Object.assign({ printers: settings.printers, active: settings.active }, extra || {}));
  }
  function printerSummary(p) {
    if (!p) return "";
    var m = window.modelById(p.model), where = p.transport === "tcp" ? p.host : (p.transport === "ble" ? (p.address || p.name_prefix || "") :
      (p.transport === "system" ? p.queue : (p.transport === "command" ? p.command : p.path)));
    return __(TRANSPORT_NAMES[p.transport] || p.transport) + (where ? " · " + where : "") + " · " + (p.dpi || 203) + " dpi" + (m && m.id !== "other" ? " · " + m.name : "");
  }
  function renderPrinterSel() {
    var s2 = $("prSel"); s2.innerHTML = "";
    if (!settings.printers.length) s2.appendChild(h("option", { value: "", text: __("Yazıcı yok") }));
    settings.printers.forEach(function (p) { s2.appendChild(h("option", { value: p.id, text: p.name })); });
    s2.appendChild(h("option", { value: "__add", text: __("+ Yazıcı ekle…") }));
    var ap = activePrinter(); s2.value = ap ? ap.id : "";
    s2.title = ap ? printerSummary(ap) : __("Yazıcı ekle");
    if (!(ap && ap.transport === "ble")) { $("conn").hidden = true; $("disc").hidden = true; }
  }
  $("prSel").addEventListener("change", function () {
    if (this.value === "__add") { renderPrinterSel(); openPrinters("new"); return; }
    if (!this.value) return;
    settings.active = this.value; saveSettings(); renderPrinterSel(); refreshState(); updatePrintSummary();
  });
  $("prBtn").addEventListener("click", function () { var ap = activePrinter(); openPrinters(ap ? ap.id : "new"); });

  function refreshState() {
    return api("/api/state").then(function (st) {
      connected = st.connected;
      var p = $("pill"), ap = activePrinter();
      if (!ap) { p.textContent = __("Yazıcı yok"); p.className = "pill warn"; }
      else if (st.ble) { p.textContent = st.connected ? __("Bağlı") : __("Bağlı değil"); p.className = "pill" + (st.connected ? " on" : ""); }
      else { p.textContent = __(TRANSPORT_NAMES[ap.transport] || ap.transport); p.className = "pill"; }
      var isBle = !!(ap && ap.transport === "ble");
      $("conn").hidden = !isBle || !!st.connected; $("disc").hidden = !isBle || !st.connected;
      $("conn").disabled = false;
    }).catch(function () { $("pill").textContent = __("Sunucu yok"); $("pill").className = "pill warn"; });
  }
  $("conn").addEventListener("click", function () {
    var b = this; b.disabled = true; status(__("Yazıcı aranıyor…"));
    api("/api/connect", {}).then(function (j) { status(j.message, !j.ok); }).catch(function (e) { status(String(e), true); }).then(refreshState);
  });
  $("disc").addEventListener("click", function () { api("/api/disconnect", {}).then(function (j) { status(j.message, !j.ok); }).then(refreshState); });
  setInterval(refreshState, 4000);
  setInterval(function () { fetch("/api/ping").catch(function () {}); }, 5000);

  function printerWarnings() {
    var p = activePrinter(), out = [];
    if (!p) { out.push({ text: __("Henüz yazıcı eklenmedi."), action: [__("Yazıcı ekle"), function () { openPrinters("new"); }] }); return out; }
    if (+p.dpi && +p.dpi !== +doc.dpi) out.push({ text: __("Etiket {a} dpi, yazıcı {b} dpi. Baskı ölçüsü yanlış çıkar.").replace("{a}", doc.dpi).replace("{b}", p.dpi),
      action: [__("Etiketi yazıcıya uyarla"), function () { checkpoint(true); doc.dpi = +p.dpi; syncLabelTab(); changed({ inspector: true }); fit(); }] });
    var m = window.modelById(p.model);
    if (m && m.width && doc.w > m.width + 0.5) out.push({ text: __("Etiket {a} mm geniş, bu yazıcı en fazla yaklaşık {b} mm basar.").replace("{a}", doc.w).replace("{b}", m.width) });
    return out;
  }
  function renderPrinterInfo() {
    var box = $("pPrinter"); if (!box) return; box.innerHTML = "";
    var p = activePrinter();
    box.appendChild(h("div", { class: "prinfo" }, [h("b", { text: p ? p.name : __("Yazıcı yok") }), h("span", { class: "note", text: p ? printerSummary(p) : "" })]));
    printerWarnings().forEach(function (w) {
      var row = h("div", { class: "warnbox" }, [h("span", { text: w.text })]);
      if (w.action) row.appendChild(h("button", { type: "button", class: "tb", text: w.action[0], onclick: w.action[1] }));
      box.appendChild(row);
    });
  }

  function testZPL(p) {
    var dpi = +p.dpi || 203, k = dpi / 203, now = new Date();
    var W = Math.round(Math.min(window.modelById(p.model).width || 100, doc.w) * dpi / 25.4);
    function f(y, size, text) { return "^FO" + Math.round(20 * k) + "," + Math.round(y * k) + "^A0N," + Math.round(size * k) + "," + Math.round(size * k * 0.9) + "^FD" + text + "^FS"; }
    return ["^XA", "^CI28", "^PW" + W, f(20, 40, "ZebraApp"), f(70, 24, (p.name || "").replace(/[\^~]/g, "")),
      f(100, 24, dpi + __(" dpi · ") + (TRANSPORT_NAMES[p.transport] || p.transport)), f(130, 24, now.toLocaleString()),
      "^FO" + Math.round(20 * k) + "," + Math.round(165 * k) + "^GB" + Math.round(W - 40 * k) + "," + Math.max(2, Math.round(3 * k)) + "," + Math.max(2, Math.round(3 * k)) + "^FS", "^XZ"].join("\n");
  }
  function hsText(f) {
    var issues = [];
    if (f.paper_out) issues.push(__("Kâğıt / etiket bitti"));
    if (f.paused) issues.push(__("Yazıcı duraklatılmış"));
    if (f.head_open) issues.push(__("Kafa kapağı açık"));
    if (f.ribbon_out) issues.push(__("Ribon bitti"));
    if (f.buffer_full) issues.push(__("Tampon dolu"));
    if (f.over_temp) issues.push(__("Kafa çok sıcak"));
    if (f.under_temp) issues.push(__("Kafa çok soğuk"));
    return issues.length ? issues.join(", ") : __("Yazıcı hazır.");
  }

  function openPrinters(focus) {
    var list = settings.printers, cur = null, isNew = false;
    var listBox = h("ul", { class: "prlist" }), form = h("div", { class: "prform" }), wrapP = h("div", { class: "prwrap" }, [h("div", {}, [listBox,
      h("button", { type: "button", class: "tb", text: __("+ Yeni yazıcı"), onclick: function () { pick("new"); } })]), form]);
    function blankPrinter() {
      var ble = !!settings.available.ble;
      return { id: uid(), name: __("Yeni yazıcı"), model: "zd421", dpi: 203, transport: ble ? "ble" : "tcp", host: "", port: 9100, address: "", name_prefix: "", queue: "", path: "", baud: 9600, command: "" };
    }
    function pick(id) {
      if (id === "new") { cur = blankPrinter(); isNew = true; }
      else { var f = list.filter(function (p) { return p.id === id; })[0]; cur = f ? clone(f) : blankPrinter(); isNew = !f; }
      renderList(); renderForm();
    }
    function renderList() {
      listBox.innerHTML = "";
      if (!list.length) listBox.appendChild(h("li", { class: "empty", text: __("Kayıtlı yazıcı yok.") }));
      list.forEach(function (p) {
        var li = h("li", { class: (cur && cur.id === p.id ? "sel" : ""), onclick: function () { pick(p.id); } }, [
          h("b", { text: p.name }), h("span", { class: "note", text: printerSummary(p) })]);
        if (p.id === settings.active) li.appendChild(h("span", { class: "pill on", text: __("Varsayılan") }));
        listBox.appendChild(li);
      });
    }
    function inp(key, label, type, ph) {
      var i = h("input", { type: type || "text" }); if (ph) i.placeholder = ph;
      i.value = cur[key] == null ? "" : cur[key];
      i.addEventListener("input", function () { cur[key] = type === "number" ? (+i.value || 0) : i.value; });
      return h("label", {}, [document.createTextNode(label), i]);
    }
    function sel2(key, label, opts, after) {
      var s2 = h("select", {});
      opts.forEach(function (o) { s2.appendChild(h("option", { value: o[0], text: o[1] })); });
      s2.value = String(cur[key]);
      s2.addEventListener("change", function () { cur[key] = /^\d+$/.test(s2.value) ? +s2.value : s2.value; if (after) after(); });
      return h("label", {}, [document.createTextNode(label), s2]);
    }
    function finder(key, kind, label, ph) {
      var field = inp(key, label, "text", ph), res = h("div", { class: "chips" });
      var btn = h("button", { type: "button", class: "tb", text: kind === "ble" ? __("Ara") : __("Listele"), onclick: function () {
        btn.disabled = true; res.innerHTML = ""; res.appendChild(h("span", { class: "note", text: kind === "ble" ? __("Bluetooth cihazları aranıyor (6 sn)…") : __("Aranıyor…") }));
        api("/api/discover", { transport: kind }).then(function (j) {
          res.innerHTML = "";
          if (!j.ok) { res.appendChild(h("span", { class: "note err", text: j.message })); return; }
          if (!j.items.length) res.appendChild(h("span", { class: "note", text: __("Hiçbir şey bulunamadı.") }));
          j.items.forEach(function (it) {
            res.appendChild(h("button", { type: "button", class: "chip", text: it.label, onclick: function () {
              cur[key] = it.value; field.querySelector("input").value = it.value;
              if (kind === "ble" && it.name && (!cur.name || cur.name === __("Yeni yazıcı"))) { cur.name = it.name; renderForm(); }
            } }));
          });
        }).catch(function (e) { res.innerHTML = ""; res.appendChild(h("span", { class: "note err", text: String(e) })); })
          .then(function () { btn.disabled = false; });
      } });
      return h("div", { class: "finder" }, [h("div", { class: "row end" }, [field, btn]), res]);
    }
    function renderForm() {
      form.innerHTML = "";
      var av = settings.available || {}, model = window.modelById(cur.model);
      form.appendChild(inp("name", __("Ad")));
      form.appendChild(h("div", { class: "r2" }, [
        sel2("model", __("Model"), window.MODELS.map(function (m) { return [m.id, m.id === "other" ? __(m.name) : m.name]; }), function () {
          var m = window.modelById(cur.model); if (m.dpis.indexOf(+cur.dpi) < 0) cur.dpi = m.dpis[0]; renderForm();
        }),
        sel2("dpi", __("Çözünürlük"), model.dpis.map(function (d2) { return [String(d2), d2 + __(" dpi (") + Math.round(d2 / 25.4) + " " + __("nokta/mm") + ")"]; }))
      ]));
      form.appendChild(sel2("transport", __("Bağlantı"), Object.keys(TRANSPORT_NAMES).filter(function (k) { return av.android ? k === "ble" : (k !== "device" || av.platform === "linux"); })
        .map(function (k) { return [k, __(TRANSPORT_NAMES[k])]; }), renderForm));
      var tr = cur.transport, note = "";
      if (tr === "ble") {
        form.appendChild(finder("address", "ble", __("Bluetooth adresi"), "00:11:22:33:44:55"));
        form.appendChild(inp("name_prefix", __("ya da ad başlangıcı (adres boşsa)"), "text", __("ZD421")));
        note = av.ble ? __("Yazıcı aynı anda yalnızca bir cihaza bağlanır; telefonun Bluetooth'unu kapat.") : __("Bluetooth LE için 'bleak' paketi gerekli:  pip install bleak");
      } else if (tr === "tcp") {
        form.appendChild(h("div", { class: "r2" }, [inp("host", __("IP adresi"), "text", "192.168.1.50"), inp("port", __("Port"), "number", "9100")]));
        note = __("Yazıcının IP adresini ayar etiketinden ya da ekranından öğrenebilirsin. Port genellikle 9100'dür.");
      } else if (tr === "system") {
        form.appendChild(finder("queue", "system", __("Sistem yazıcısı adı"), __("Zebra_ZD421")));
        note = av.platform === "win32" ? __("Windows'ta yazıcı sürücüsü kurulu olmalı; pywin32 gerekli:  pip install pywin32") : __("CUPS'ta 'raw' kuyruk olarak eklenmiş yazıcı. USB ile bağlı yazıcılar için en kolay yol.");
      } else if (tr === "device") {
        form.appendChild(finder("path", "device", __("Aygıt yolu"), "/dev/usb/lp0"));
        note = __("USB kablosuyla bağlı yazıcıya doğrudan yazar. Yetki hatası alırsan:  sudo usermod -aG lp $USER");
      } else if (tr === "serial") {
        form.appendChild(finder("path", "serial", __("Port"), av.platform === "win32" ? __("COM3") : "/dev/rfcomm0"));
        form.appendChild(inp("baud", __("Hız (baud)"), "number", "9600"));
        note = av.serial ? __("Klasik Bluetooth (SPP) için önce eşleştir: Linux'ta rfcomm, Windows'ta COM portu oluşur.") : __("Seri port için pyserial gerekli:  pip install pyserial");
      } else if (tr === "command") {
        form.appendChild(inp("command", __("Komut (ZPL'yi standart girişten okumalı)"), "text", "zebra-print"));
        note = __("Kendi gönderme aracını kullanmak için: ZPL bu komutun girişine verilir.");
      }
      if (note) form.appendChild(h("p", { class: "note", text: note }));
      var out = h("p", { class: "note", role: "status" });
      form.appendChild(h("div", { class: "row wrap" }, [
        h("button", { type: "button", class: "tb primary", text: __("Kaydet"), onclick: function () {
          var i = -1; list.forEach(function (p, k) { if (p.id === cur.id) i = k; });
          if (i >= 0) list[i] = clone(cur); else list.push(clone(cur));
          if (!settings.active || isNew && list.length === 1) settings.active = cur.id;
          isNew = false;
          saveSettings().then(function () { out.textContent = __("Kaydedildi."); renderList(); renderPrinterSel(); refreshState(); updatePrintSummary(); });
        } }),
        h("button", { type: "button", class: "tb", text: __("Varsayılan yap"), onclick: function () {
          if (!list.some(function (p) { return p.id === cur.id; })) { out.textContent = __("Önce kaydet."); return; }
          settings.active = cur.id; saveSettings().then(function () { renderList(); renderPrinterSel(); refreshState(); updatePrintSummary(); out.textContent = __("Varsayılan yazıcı değişti."); });
        } }),
        h("button", { type: "button", class: "tb", text: __("Test etiketi bas"), onclick: function () {
          out.textContent = __("Gönderiliyor…");
          api("/api/test_printer", { printer: cur, data: testZPL(cur) }).then(function (j) { out.textContent = j.message; out.className = "note" + (j.ok ? "" : " err"); });
        } }),
        h("button", { type: "button", class: "tb", text: __("Durumu oku"), onclick: function () {
          out.textContent = __("Soruluyor…");
          api("/api/status", { printer: cur }).then(function (j) { out.textContent = j.ok ? hsText(j.flags) : j.message; out.className = "note" + (j.ok ? "" : " err"); });
        } }),
        h("button", { type: "button", class: "danger tb", text: __("Sil"), onclick: function () {
          if (!list.some(function (p) { return p.id === cur.id; })) { pick(list[0] ? list[0].id : "new"); return; }
          if (!confirm(__("Bu yazıcı silinsin mi?"))) return;
          settings.printers = list = list.filter(function (p) { return p.id !== cur.id; });
          if (settings.active === cur.id) settings.active = list[0] ? list[0].id : null;
          saveSettings().then(function () { renderPrinterSel(); refreshState(); updatePrintSummary(); pick(list[0] ? list[0].id : "new"); });
        } })
      ]));
      form.appendChild(out);
    }
    openModal(__("Yazıcılar"), [wrapP]);
    pick(focus || (list[0] ? list[0].id : "new"));
  }

  /* ================= zengin metin modeli =================
     el.text: duz metin (her zaman guncel). el.rich: null ya da [{ t, b?, i?, u?, s?, sz?, f? }] parcalari;
     parcadaki alan yoksa ogenin kendi ayari (bold, italic, underline, strike, size, font) gecerlidir. */
  var RUNK = ["b", "i", "u", "s", "sz", "f"], PT = 0.352778;
  var BASEK = { b: "bold", i: "italic", u: "underline", s: "strike", sz: "size", f: "font" };
  function baseOf(el, k) { var v = el[BASEK[k]]; return k === "sz" ? (+v || 4) : k === "f" ? (v || "") : !!v; }
  function eff(el, r, k) { return r && r[k] != null ? r[k] : baseOf(el, k); }
  function same(k, a, b) { return k === "sz" ? Math.abs((+a || 0) - (+b || 0)) < 0.005 : a === b; }
  function runsOf(el) { return el.rich && el.rich.length ? clone(el.rich) : [{ t: String(el.text == null ? "" : el.text) }]; }
  function setRuns(el, runs) {
    var out = [];
    runs.forEach(function (r) {
      if (!r.t) return;
      var n = { t: r.t };
      RUNK.forEach(function (k) { if (r[k] != null && !same(k, r[k], baseOf(el, k))) n[k] = r[k]; });
      var last = out[out.length - 1];
      if (last && RUNK.every(function (k) { return same(k, last[k] == null ? null : last[k], n[k] == null ? null : n[k]); })) last.t += n.t;
      else out.push(n);
    });
    el.text = out.map(function (r) { return r.t; }).join("");
    el.rich = out.some(function (r) { return RUNK.some(function (k) { return r[k] != null; }); }) ? out : null;
  }
  /* parcalari [a, b) araliginda bol; araliktakiler _in ile isaretlenir */
  function splitRuns(runs, a, b) {
    var pos = 0, out = [];
    runs.forEach(function (r) {
      var s0 = pos, s1 = pos + r.t.length, cuts = [s0, Math.max(s0, Math.min(a, s1)), Math.max(s0, Math.min(b, s1)), s1];
      pos = s1;
      for (var i = 0; i < 3; i++) if (cuts[i + 1] > cuts[i]) { var c = clone(r); c.t = r.t.slice(cuts[i] - s0, cuts[i + 1] - s0); c._in = i === 1; out.push(c); }
    });
    return out;
  }
  function formatRange(el, a, b, fn) {
    var parts = splitRuns(runsOf(el), a, b);
    parts.forEach(function (p) { if (p._in) fn(p); delete p._in; });
    setRuns(el, parts);
  }
  function rangeVal(el, a, b, k) {
    var parts = splitRuns(runsOf(el), a, b).filter(function (p) { return p._in; });
    if (!parts.length) return { v: baseOf(el, k), mixed: false };
    var v0 = eff(el, parts[0], k);
    return { v: v0, mixed: parts.some(function (p) { return !same(k, eff(el, p, k), v0); }) };
  }
  /* ogenin tamamina bir ayar: parcalardaki ayni ayarlar silinir */
  function setBase(el, k, v) {
    el[BASEK[k]] = v;
    if (el.rich) { var rr = clone(el.rich); rr.forEach(function (r) { delete r[k]; }); setRuns(el, rr); }
  }

  /* ================= yerinde yazi duzenleme (etiketin ustunde) ================= */
  var ted = $("ted"), editing = null, editDirty = false, edSel = null;
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function runCSS(el, r) {
    var b = eff(el, r, "b"), i = eff(el, r, "i"), u = eff(el, r, "u"), st = eff(el, r, "s"), f = eff(el, r, "f"), sz = eff(el, r, "sz");
    var dec = [u ? "underline" : "", st ? "line-through" : ""].join(" ").trim() || "none";
    var css = "font-family:" + (f ? Z.fontCSS(f) : Z.FONT).replace(/"/g, "'") + ";font-weight:" + (f ? (b ? 700 : 400) : 700) +
      ";font-style:" + (i ? "italic" : "normal") + ";text-decoration:" + dec + ";font-size:" + (sz / (+el.size || 4)) + "em";
    if (!f && b) css += ";-webkit-text-stroke:0.045em currentColor";
    return css;
  }
  function runsHTML(el) {
    var out = "";
    runsOf(el).forEach(function (r) {
      var ov = {}; RUNK.forEach(function (k) { if (r[k] != null) ov[k] = r[k]; });
      out += '<span data-r="' + esc(JSON.stringify(ov)) + '" style="' + runCSS(el, r) + '">' + r.t.split("\n").map(esc).join("<br>") + "</span>";
    });
    return out + '<br data-f="1">';
  }
  /* metindeki sirali "atomlar": metin dugumleri ve satir sonlari (bloklarin sonundaki gorunmez <br> haric) */
  function isTailBR(br) {
    for (var n = br; n && n !== ted; n = n.parentNode) {
      for (var sib = n.nextSibling; sib; sib = sib.nextSibling) {
        if (sib.nodeType === 3 && sib.nodeValue.length) return false;
        if (sib.nodeType === 1 && (sib.nodeName === "BR" || sib.textContent.length)) return false;
      }
      if (n.parentNode && /^(DIV|P)$/.test(n.parentNode.nodeName) && n.parentNode !== ted) return true;
    }
    return true;
  }
  function atoms() {
    var list = [];
    (function walk(node) {
      Array.prototype.forEach.call(node.childNodes, function (c) {
        if (c.nodeType === 3) { if (c.nodeValue.length) list.push({ node: c, len: c.nodeValue.length, kind: "t" }); }
        else if (c.nodeName === "BR") { if (!isTailBR(c)) list.push({ node: c, len: 1, kind: "br" }); }
        else if (c.nodeType === 1) {
          if (/^(DIV|P)$/.test(c.nodeName) && list.length && list[list.length - 1].kind !== "br") list.push({ node: c, len: 1, kind: "blk" });
          walk(c);
        }
      });
    })(ted);
    return list;
  }
  function ovOf(node) {
    for (var n = node; n && n !== ted; n = n.parentNode) if (n.nodeType === 1 && n.dataset && n.dataset.r) { try { return JSON.parse(n.dataset.r); } catch (e) { return {}; } }
    return {};
  }
  function domRuns() {
    var runs = [];
    atoms().forEach(function (a) {
      var t = a.kind === "t" ? a.node.nodeValue.replace(/ /g, " ").replace(/​/g, "") : "\n";
      var ov = ovOf(a.kind === "t" ? a.node.parentNode : a.node.parentNode), last = runs[runs.length - 1];
      var n = Object.assign({ t: t }, ov);
      if (last && RUNK.every(function (k) { return last[k] === n[k]; })) last.t += t; else runs.push(n);
    });
    return runs;
  }
  function pointOffset(container, offset) {
    var r = document.createRange(); r.setStart(container, offset);
    var acc = 0, list = atoms();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.kind === "t" && a.node === container) return acc + offset;
      var p = a.kind === "t" ? [a.node, 0] : [a.node.parentNode, Array.prototype.indexOf.call(a.node.parentNode.childNodes, a.node)];
      if (a.kind === "blk") p = [a.node, 0];
      if (r.comparePoint(p[0], p[1]) > 0) return acc;
      acc += a.len;
    }
    return acc;
  }
  function getOffsets() {
    var sl = window.getSelection(); if (!sl.rangeCount) return null;
    var rg = sl.getRangeAt(0); if (!ted.contains(rg.startContainer)) return null;
    var a = pointOffset(rg.startContainer, rg.startOffset), b = pointOffset(rg.endContainer, rg.endOffset);
    return { a: Math.min(a, b), b: Math.max(a, b) };
  }
  function pointAt(pos) {
    var acc = 0, list = atoms(), lastT = null;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.kind === "t") { lastT = a; if (pos <= acc + a.len) return [a.node, pos - acc]; }
      else if (pos <= acc) {
        if (a.kind === "br") return [a.node.parentNode, Array.prototype.indexOf.call(a.node.parentNode.childNodes, a.node)];
        return [a.node, 0];
      }
      acc += a.len;
      if (a.kind === "br" && pos === acc) return [a.node.parentNode, Array.prototype.indexOf.call(a.node.parentNode.childNodes, a.node) + 1];
    }
    return lastT ? [lastT.node, lastT.len] : [ted, 0];
  }
  function setOffsets(a, b) {
    try {
      var p = pointAt(a), q = pointAt(b), rg = document.createRange();
      rg.setStart(p[0], p[1]); rg.setEnd(q[0], q[1]);
      var sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(rg);
      edSel = { a: a, b: b };
    } catch (e) { /* secim geri yuklenemedi */ }
  }
  document.addEventListener("selectionchange", function () { if (editing && document.activeElement === ted) edSel = getOffsets() || edSel; });

  function startEdit(el, selectAll) {
    if (!el || el.type !== "text" || el.locked) return;
    if (editing && editing !== el) finishEdit();
    if (!$("bs").hidden) closeBackstage();
    editing = el; editDirty = false;
    sel = [el.id]; selectionChanged();
    ted.innerHTML = runsHTML(el);
    ted.hidden = false;
    positionEditor();
    ted.focus();
    var n = (el.text || "").length;
    if (selectAll) setOffsets(0, n); else setOffsets(n, n);
    status(__("Yazıyı düzenliyorsun: seçtiğin kelimelere Giriş sekmesinden biçim verebilirsin. Bitirmek için Esc ya da dışarı tıkla."));
    schedule();
  }
  function finishEdit() {
    if (!editing) return;
    var el = editing; editing = null; ted.hidden = true; edSel = null;
    if (byId(el.id)) {
      var rr = runsOf(el);                                        /* sondaki bos satirlari at */
      while (rr.length && /\n$/.test(rr[rr.length - 1].t)) { rr[rr.length - 1].t = rr[rr.length - 1].t.replace(/\n+$/, ""); if (!rr[rr.length - 1].t) rr.pop(); }
      setRuns(el, rr);
    }
    if (byId(el.id) && !String(el.text || "").trim()) {
      if (!editDirty) checkpoint(true);
      doc.elements = doc.elements.filter(function (x) { return x.id !== el.id; });
      sel = []; selectionChanged(); changed({ layers: true });
    } else changed({ layers: true, inspector: true });
    status("");
    schedule();
  }
  function rerenderEditor(r) {
    if (!editing) return;
    ted.innerHTML = runsHTML(editing);
    positionEditor(); ted.focus();
    if (r) setOffsets(r.a, r.b);
  }
  function positionEditor() {
    if (!editing || ted.hidden) return;
    var el = editing, S = s();
    if (!byId(el.id)) { editing = null; ted.hidden = true; return; }
    var FL = Z.layout(el, doc, {}), L = FL.raster ? FL.local.L : FL, sx = (el.widthPct || 90) / 100;
    var basePx = Math.max(4, d(+el.size || 4)) * S, gapK = el.lineGap || 1.25;
    var lead = Math.max(0, (basePx * gapK - basePx * 1.17) / 2);
    var b = eff(el, null, "b"), f = eff(el, null, "f");
    ted.style.fontFamily = f ? Z.fontCSS(f) : Z.FONT;
    ted.style.fontWeight = String(f ? (b ? 700 : 400) : 700);
    ted.style.fontStyle = el.italic ? "italic" : "normal";
    ted.style.textDecoration = [el.underline ? "underline" : "", el.strike ? "line-through" : ""].join(" ").trim() || "none";
    ted.style.fontSize = basePx + "px";
    ted.style.lineHeight = String(gapK);
    ted.style.letterSpacing = ((+el.spacing || 0) * doc.dpi / 25.4 / sx * S) + "px";
    ted.style.width = L.block > 0 ? (L.block * S / sx) + "px" : "auto";
    ted.style.minHeight = basePx + "px";
    ted.style.textAlign = L.block > 0 ? (el.align || "left") : "left";
    ted.style.textTransform = { upper: "uppercase", lower: "lowercase", title: "capitalize" }[el.caseMode] || "none";
    ted.classList.toggle("wrap", !!(el.wrap && L.block > 0));
    ted.classList.toggle("rev", !!el.reverse);
    var top0 = -basePx * 0.06 - lead + (L.vy || 0) * S;
    ted.style.transformOrigin = "0 0";
    if (FL.raster && FL.angle) {
      var cx = origin.x + (d(el.x) + FL.box.w / 2) * S, cy = origin.y + (d(el.y) + FL.box.h / 2) * S;
      ted.style.left = cx + "px"; ted.style.top = cy + "px";
      ted.style.transform = "rotate(" + FL.angle + "deg) translate(" + (-L.box.w * S / 2) + "px," + (-L.box.h * S / 2 + top0) + "px) scaleX(" + sx + ")";
    } else {
      ted.style.left = Math.round(origin.x + d(el.x) * S) + "px";
      ted.style.top = Math.round(origin.y + d(el.y) * S + top0) + "px";
      ted.style.transform = "scaleX(" + sx + ")";
    }
  }
  ted.addEventListener("input", function () {
    if (!editing) return;
    if (!editDirty) { checkpoint(true); editDirty = true; } else { dirty = true; updateTitle(); }
    setRuns(editing, domRuns());
    changed({ layers: true, inspectorValues: true });
    positionEditor();
  });
  ted.addEventListener("blur", function () {
    setTimeout(function () {
      if (!editing) return;
      var a = document.activeElement;
      if (a === ted || (a && a.closest && a.closest(".ribbon, .popm, #modal"))) return;   /* seritte bir ayar degistiriliyor */
      finishEdit();
    }, 0);
  });
  /* duzenleyicinin, seridin ve acilir menulerin disina tiklaninca duzenleme biter */
  document.addEventListener("mousedown", function (e) {
    if (editing && !e.target.closest("#ted, .ribbon, .rtabs, .popm, #modal")) finishEdit();
  }, true);
  ted.addEventListener("paste", function (e) {
    e.preventDefault();
    var t = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
    t.replace(/\r/g, "").split("\n").forEach(function (line, i) { if (i) document.execCommand("insertLineBreak"); if (line) document.execCommand("insertText", false, line); });
  });
  ted.addEventListener("keydown", function (e) {
    var ctrl = e.ctrlKey || e.metaKey, k = e.key;
    if (k === "Enter" && !ctrl) { e.preventDefault(); document.execCommand("insertLineBreak"); return; }
    if (k === "Escape") { e.preventDefault(); finishEdit(); ted.blur(); return; }
    if (ctrl && (k === "b" || k === "B")) { e.preventDefault(); fmtToggle("b"); }
    else if (ctrl && (k === "i" || k === "I")) { e.preventDefault(); fmtToggle("i"); }
    else if (ctrl && (k === "u" || k === "U")) { e.preventDefault(); fmtToggle("u"); }
    else if (ctrl && e.shiftKey && (k === ">" || k === "<")) { e.preventDefault(); stepSize(k === ">" ? 1 : -1); }
  });

  /* ================= serit (ribbon) ================= */
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem("zebraapp." + k); localStorage.setItem("zebraapp." + k, v); } catch (e) { return null; } return null; }
  function showRt(t) {
    qsa(".rtab[data-rt]").forEach(function (b) { b.classList.toggle("on", b.dataset.rt === t); });
    qsa(".rpanel").forEach(function (p) { p.hidden = p.dataset.rp !== t; });
  }
  qsa(".rtab[data-rt]").forEach(function (b) {
    b.addEventListener("click", function () {
      showRt(b.dataset.rt);
      if (document.body.classList.contains("rcollapsed")) document.body.classList.add("rpeek");
    });
    b.addEventListener("dblclick", function () { $("ribbonPin").click(); });
  });
  $("fileTab").addEventListener("click", function () { openBackstage("home"); });
  $("ribbonPin").addEventListener("click", function () {
    var c = document.body.classList.toggle("rcollapsed"); document.body.classList.remove("rpeek");
    ls("ribbon", c ? "0" : "1"); schedule();
  });
  if (ls("ribbon") === "0") document.body.classList.add("rcollapsed");
  document.addEventListener("mousedown", function (e) {
    if (document.body.classList.contains("rpeek") && !e.target.closest(".ribbon, .rtabs, .popm")) document.body.classList.remove("rpeek");
  });
  /* seritteki dugmeler, duzenlenen yazidan odagi ve secimi almasin */
  $("ribbon").addEventListener("mousedown", function (e) { if (editing && e.target.closest("button")) e.preventDefault(); });

  /* kucuk acilir menu (serit kaydirilabildigi icin govdeye eklenir) */
  var popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
  function popMenu(anchor, items, grid) {
    closePop();
    var m = h("div", { class: "popm" + (grid ? " grid" : "") });
    items.forEach(function (it) {
      if (it.head) { m.appendChild(h("div", { class: "ph", text: it.head })); return; }
      m.appendChild(h("button", { type: "button", text: it.label, title: it.title || "", onclick: function () { closePop(); it.run(); } }));
    });
    m.addEventListener("mousedown", function (e) { e.preventDefault(); });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left)) + "px";
    m.style.top = (r.bottom + 4) + "px";
    popEl = m;
  }
  document.addEventListener("mousedown", function (e) { if (popEl && !e.target.closest(".popm")) closePop(); });
  window.addEventListener("keydown", function (e) { if (popEl && e.key === "Escape") closePop(); }, true);

  function textSel() { return selEls().filter(function (e) { return e.type === "text"; }); }
  function autoBox(el) { if (!(el.boxW > 0)) el.boxW = r2(Math.max(5, doc.w - 2 * el.x)); }
  function applyText(fn, soft) {
    var els = textSel(); if (!els.length) return;
    if (soft) checkpoint(); else checkpoint(true);
    if (editing) editDirty = true;
    els.forEach(fn);
    changed({ layers: true, inspector: true });
    if (editing) rerenderEditor(edSel);
  }
  /* duzenlenen yazida secim varsa sadece secime uygula; yoksa ogelerin tamamina */
  function editRange() {
    if (!editing) return null;
    var r = (document.activeElement === ted ? getOffsets() : null) || edSel;   /* canli secim; odak seritteyse son bilinen secim */
    return r && r.b > r.a ? r : null;
  }
  function fmtRange(fn) {
    var r = editRange(); if (!r) return false;
    checkpoint(true); editDirty = true;
    formatRange(editing, r.a, r.b, fn);
    changed({ layers: true, inspector: true });
    rerenderEditor(r);
    return true;
  }
  function fmtToggle(k) {
    var r = editRange();
    if (r) { var st = rangeVal(editing, r.a, r.b, k), v = !(st.v && !st.mixed); fmtRange(function (p) { p[k] = v; }); return; }
    var els = textSel(); if (!els.length) return;
    var nv = !baseOf(els[0], k);
    applyText(function (el) { setBase(el, k, nv); });
  }
  function fmtSet(k, v) {
    if (fmtRange(function (p) { p[k] = v; })) return;
    applyText(function (el) { setBase(el, k, v); });
  }
  function toggleText(key) {
    var map = { bold: "b", italic: "i", underline: "u", strike: "s" };
    if (map[key]) { fmtToggle(map[key]); return; }
    var els = textSel(); if (!els.length) return;
    var v = !els[0][key];
    applyText(function (el) { el[key] = v; if ((key === "wrap" || key === "fit") && v && !(key === "fit" && el.boxH > 0)) autoBox(el); });
  }
  var PTS = [5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 54, 60, 72, 80, 96, 120, 144, 180, 230];
  function nextPt(mmV, dir) {
    var pt = mmV / PT, i;
    if (dir > 0) { for (i = 0; i < PTS.length; i++) if (PTS[i] > pt + 0.05) return PTS[i] * PT; return mmV; }
    for (i = PTS.length - 1; i >= 0; i--) if (PTS[i] < pt - 0.05) return PTS[i] * PT;
    return mmV;
  }
  function stepSize(dir) {
    if (fmtRange(function (p) { p.sz = r2(nextPt(eff(editing, p, "sz"), dir)); })) return;
    applyText(function (el) {
      var cur = +el.size || 4, nx = r2(nextPt(cur, dir)), k = nx / cur;
      el.size = nx;
      if (el.rich) { var rr = clone(el.rich); rr.forEach(function (r) { if (r.sz) r.sz = r2(r.sz * k); }); setRuns(el, rr); }
    });
  }
  function ptOf(mmV) { return Math.round(mmV / PT * 2) / 2; }
  $("fSize").addEventListener("change", function () {
    var v = parseFloat(this.value); if (!(v > 0)) return;
    fmtSet("sz", r2(clamp(v, 2, 230) * PT));
  });
  $("fSize").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();   /* Enter, odak duzenleyiciye gecince secili yaziyi silmesin */
    var inp = this; setTimeout(function () { inp.dispatchEvent(new Event("change")); }, 0);
  });
  $("fFont").addEventListener("change", function () { fmtSet("f", this.value); });
  $("fWidth").addEventListener("input", function () { var v = parseFloat(this.value); if (v > 0) applyText(function (el) { el.widthPct = clamp(v, 30, 200); }, true); });
  $("fSpace").addEventListener("input", function () { var v = parseFloat(this.value); if (isFinite(v)) applyText(function (el) { el.spacing = clamp(v, -2, 20); }, true); });
  $("fBoxW").addEventListener("input", function () { var v = parseFloat(this.value); if (v >= 0) applyText(function (el) { el.boxW = clamp(v, 0, 500); }, true); });
  $("fBoxH").addEventListener("input", function () { var v = parseFloat(this.value); if (v >= 0) applyText(function (el) { el.boxH = clamp(v, 0, 500); }, true); });
  $("fFit").addEventListener("click", function () { toggleText("fit"); });
  $("fGap").addEventListener("change", function () { var v = +this.value; applyText(function (el) { el.lineGap = v; }); });
  $("fGrow").addEventListener("click", function () { stepSize(1); });
  $("fShrink").addEventListener("click", function () { stepSize(-1); });
  $("fBold").addEventListener("click", function () { fmtToggle("b"); });
  $("fItalic").addEventListener("click", function () { fmtToggle("i"); });
  $("fUnder").addEventListener("click", function () { fmtToggle("u"); });
  $("fStrike").addEventListener("click", function () { fmtToggle("s"); });
  $("fRev").addEventListener("click", function () { toggleText("reverse"); });
  $("fWrap").addEventListener("click", function () { toggleText("wrap"); });
  qsa("[data-falign]").forEach(function (b) {
    b.addEventListener("click", function () { var a = b.dataset.falign; applyText(function (el) { el.align = a; if (a !== "left") autoBox(el); }); });
  });
  qsa("[data-fvalign]").forEach(function (b) {
    b.addEventListener("click", function () {
      var a = b.dataset.fvalign;
      applyText(function (el) {
        el.vAlign = a;
        if (a !== "top" && !(el.boxH > 0)) { var L = Z.layout(Object.assign({}, el, { rot: 0 }), doc, currentRec()); el.boxH = r2(Math.max(5, mm(L.H) * 1.6)); }
      });
    });
  });
  /* buyuk/kucuk harf: secimde metnin kendisi degisir ({ALAN} adlarina dokunulmaz); secim yoksa gorunum ayari */
  function caseText(t, mode) {
    return t.split(/(\{[^{}]*\})/).map(function (part) { return /^\{[^{}]*\}$/.test(part) ? part : Z.caseT(part, mode); }).join("");
  }
  $("fCase").addEventListener("click", function () {
    var btn = this;
    function run(mode) {
      if (fmtRange(function (p) { p.t = caseText(p.t, mode); })) return;
      applyText(function (el) { el.caseMode = mode === "none" ? "" : mode; });
    }
    popMenu(btn, [
      { label: __("Normal (yazdığın gibi)"), run: function () { run("none"); } },
      { label: __("BÜYÜK HARF"), run: function () { run("upper"); } },
      { label: __("küçük harf"), run: function () { run("lower"); } },
      { label: __("Her Kelimenin İlk Harfi Büyük"), run: function () { run("title"); } }
    ]);
  });
  $("fClear").addEventListener("click", function () {
    if (fmtRange(function (p) { RUNK.forEach(function (k) { delete p[k]; }); })) return;
    applyText(function (el) {
      el.rich = null; el.bold = false; el.italic = false; el.underline = false; el.strike = false; el.font = "";
      el.spacing = 0; el.caseMode = ""; el.widthPct = 90; el.reverse = false;
    });
    status(__("Biçimlendirme temizlendi."));
  });

  function setIf(id, v) { var e = $(id); if (document.activeElement !== e) e.value = v == null ? "" : v; }
  function updateRibbon() {
    if (!doc) return;
    var ts = textSel(), on = ts.length > 0, t = ts[0], n = sel.length;
    qsa("#gFont button, #gFont input, #gFont select, #gPara button, #gPara input, #gPara select").forEach(function (x) { x.disabled = !on; });
    qsa("#gFont .rin, #gPara .rin").forEach(function (x) { x.classList.toggle("dis", !on); });
    /* duzenlenen yazida secim varsa dugmeler secimin durumunu gosterir */
    var r = editing && t === editing ? editRange() : null;
    function val(k) { if (!on) return null; if (r) { var st = rangeVal(t, r.a, r.b, k); return st.mixed ? null : st.v; } var rv = rangeVal(t, 0, (t.text || "").length, k); return rv.mixed ? null : rv.v; }
    if (on) {
      var szv = val("sz");
      setIf("fSize", szv == null ? "" : ptOf(szv)); setIf("fWidth", t.widthPct); setIf("fSpace", +t.spacing || 0);
      setIf("fBoxW", t.boxW); setIf("fBoxH", t.boxH);
      if (document.activeElement !== $("fFont")) { fillFontSel(); var fv = val("f"); $("fFont").value = fv == null ? "" : fv; }
      var best = "1.25", diff = 99;
      qsa("#fGap option").forEach(function (o) { var dd = Math.abs(+o.value - (+t.lineGap || 1.25)); if (dd < diff) { diff = dd; best = o.value; } });
      $("fGap").value = best;
    } else { setIf("fSize", ""); setIf("fWidth", ""); setIf("fSpace", ""); setIf("fBoxW", ""); setIf("fBoxH", ""); $("fFont").value = ""; }
    $("fBold").classList.toggle("on", val("b") === true);
    $("fItalic").classList.toggle("on", val("i") === true);
    $("fUnder").classList.toggle("on", val("u") === true);
    $("fStrike").classList.toggle("on", val("s") === true);
    $("fFit").classList.toggle("on", !!(on && t.fit));
    $("fRev").classList.toggle("on", !!(on && t.reverse));
    $("fWrap").classList.toggle("on", !!(on && t.wrap));
    qsa("[data-falign]").forEach(function (b) { b.classList.toggle("on", !!(on && (t.align || "left") === b.dataset.falign)); });
    qsa("[data-fvalign]").forEach(function (b) { b.classList.toggle("on", !!(on && (t.vAlign || "top") === b.dataset.fvalign)); });
    $("rPaste").disabled = !clipboard;
    qsa("#rCut, #rCopy, #dupBtn, #delBtn, #toFront, #toBack, #rLock, #rHide, [data-al]").forEach(function (b) { b.disabled = n === 0; });
    $("rFmt").disabled = n !== 1 && !painter;
    $("rFmt").classList.toggle("on", !!painter);
    $("rRotate").disabled = !selEls().some(function (e) { return !e.locked; });
    $("rEditText").disabled = !(n === 1 && on);
    var els = selEls(), allLocked = els.length && els.every(function (e) { return e.locked; }), allHid = els.length && els.every(function (e) { return e.hidden; });
    $("rLock").querySelector("span").textContent = allLocked ? __("Kilidi aç") : __("Kilitle");
    $("rHide").querySelector("span").textContent = allHid ? __("Göster") : __("Gizle");
  }
  document.addEventListener("selectionchange", function () { if (editing) updateRibbon(); });
  $("rPaste").addEventListener("click", function () { paste(); updateRibbon(); });
  $("rCopy").addEventListener("click", function () { copySel(); updateRibbon(); });
  $("rCut").addEventListener("click", function () { copySel(); deleteSel(); updateRibbon(); });
  $("rSelAll").addEventListener("click", function () { sel = doc.elements.filter(function (x) { return !x.hidden; }).map(function (x) { return x.id; }); selectionChanged(); schedule(); });
  $("rEditText").addEventListener("click", function () { var t = textSel()[0]; if (t) startEdit(t, false); });
  $("rRotate").addEventListener("click", function () {
    var els = selEls().filter(function (e) { return !e.locked; }); if (!els.length) return;
    checkpoint(true); els.forEach(function (e) { setRotKeep(e, (Z.normRot(e.rot) + 90) % 360); }); changed({ inspector: true });
  });
  $("rLock").addEventListener("click", function () {
    var els = selEls(); if (!els.length) return; var v = !els.every(function (e) { return e.locked; });
    checkpoint(true); els.forEach(function (e) { e.locked = v; }); changed({ layers: true, inspector: true });
  });
  $("rHide").addEventListener("click", function () {
    var els = selEls(); if (!els.length) return; var v = !els.every(function (e) { return e.hidden; });
    checkpoint(true); els.forEach(function (e) { e.hidden = v; }); changed({ layers: true, inspector: true });
  });

  /* ---------- Bicim Boyacisi ---------- */
  var painter = null;
  var PAINT = { text: ["font", "size", "bold", "italic", "underline", "strike", "widthPct", "spacing", "lineGap", "align", "vAlign", "caseMode", "reverse", "wrap", "fit"],
    box: ["t", "filled", "round", "reverse"], ellipse: ["t", "filled", "reverse"], line: ["t"],
    barcode: ["kind", "h", "module", "ratio", "human", "humanAbove"], qr: ["mag", "ec"], image: ["threshold", "dither", "invert"] };
  function setPainter(p) { painter = p; cv.classList.toggle("painter", !!p); updateRibbon(); }
  function pickPainter(sticky) {
    var el = selEls()[0]; if (!el) return;
    var props = {}; (PAINT[el.type] || []).forEach(function (k) { props[k] = clone(el[k] === undefined ? null : el[k]); });
    setPainter({ type: el.type, props: props, sticky: !!sticky });
    status(__("Biçim Boyacısı: biçimi uygulamak için aynı türden bir öğeye tıkla. Bitirmek için Esc."));
  }
  $("rFmt").addEventListener("click", function () { if (painter && !painter.sticky) { setPainter(null); status(""); } else pickPainter(false); });
  $("rFmt").addEventListener("dblclick", function () { pickPainter(true); });
  function paintOn(el) {
    if (!painter || el.type !== painter.type) { status(__("Biçim Boyacısı yalnızca aynı türden öğelere uygulanır."), true); return; }
    checkpoint(true);
    Object.keys(painter.props).forEach(function (k) { if (painter.props[k] !== null) el[k] = clone(painter.props[k]); });
    if (el.type === "text" && el.rich) { var rr = clone(el.rich); rr.forEach(function (r) { RUNK.forEach(function (k) { delete r[k]; }); }); setRuns(el, rr); }
    if (!painter.sticky) { setPainter(null); status(__("Biçim uygulandı.")); }
    changed({ layers: true, inspector: true });
  }
  window.addEventListener("keydown", function (e) { if (painter && e.key === "Escape") { setPainter(null); status(""); } }, true);

  /* ---------- Bul ve degistir ---------- */
  function openFind() {
    if (editing) finishEdit();
    var fi = h("input", { type: "text" }), ri = h("input", { type: "text" }), mc = h("input", { type: "checkbox" }), out = h("p", { class: "note", role: "status" });
    var cur = textSel()[0]; if (cur && window.getSelection && String(window.getSelection())) fi.value = String(window.getSelection());
    function rx() {
      var q = fi.value; if (!q) return null;
      return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), mc.checked ? "g" : "gi");
    }
    function count() {
      var re = rx(); if (!re) { out.textContent = ""; return 0; }
      var n = 0;
      doc.elements.forEach(function (el) { var t = el.type === "text" ? el.text : (el.type === "qr" || el.type === "barcode") ? el.data : ""; n += (String(t || "").match(re) || []).length; });
      out.textContent = n ? __("{n} yerde bulundu.").replace("{n}", n) : __("Bulunamadı.");
      return n;
    }
    function replaceAll() {
      var re = rx(); if (!re || !count()) return;
      checkpoint(true);
      var n = 0, rep = ri.value;
      doc.elements.forEach(function (el) {
        if (el.type === "text") {
          var rr = runsOf(el);
          rr.forEach(function (r) { r.t = r.t.replace(re, function () { n++; return rep; }); });
          setRuns(el, rr);
        } else if (el.type === "qr" || el.type === "barcode") {
          el.data = String(el.data || "").replace(re, function () { n++; return rep; });
        }
      });
      changed({ layers: true, inspector: true });
      out.textContent = __("{n} yerde değiştirildi.").replace("{n}", n);
    }
    function selectHits() {
      var re = rx(); if (!re) return;
      sel = doc.elements.filter(function (el) { var t = el.type === "text" ? el.text : el.data; return re.test(String(t || "")); }).map(function (el) { return el.id; });
      selectionChanged(); schedule(); count();
    }
    fi.addEventListener("input", count); mc.addEventListener("change", count);
    fi.addEventListener("keydown", function (e) { if (e.key === "Enter") selectHits(); });
    openModal(__("Bul ve değiştir"), [h("div", { class: "findbox" }, [
      h("label", {}, [document.createTextNode(__("Aranan")), fi]),
      h("label", {}, [document.createTextNode(__("Yeni metin")), ri]),
      h("label", { class: "chk" }, [mc, document.createTextNode(__("Büyük/küçük harfe dikkat et"))]),
      h("div", { class: "row wrap" }, [
        h("button", { type: "button", class: "tb", text: __("Bul ve seç"), onclick: selectHits }),
        h("button", { type: "button", class: "tb primary", text: __("Tümünü değiştir"), onclick: replaceAll })
      ]),
      out,
      h("p", { class: "note", text: __("Metinlerde, QR kodlarda ve barkodlarda arar. Kelime kelime biçim korunur, ama birden çok biçime bölünmüş bir ifade bulunamayabilir.") })
    ])]);
    setTimeout(function () { fi.focus(); fi.select(); }, 0);
  }
  $("rFind").addEventListener("click", openFind);

  /* ---------- Simge ekle ---------- */
  var SYMBOLS = [
    [__("Sık kullanılanlar"), "° ± × ÷ € ₺ $ £ © ® ™ § • … – — ½ ¼ ¾ ² ³ µ Ω ‰"],
    [__("Oklar ve işaretler"), "← → ↑ ↓ ↔ ⇒ ✓ ✗ ☐ ☑ ★ ☆ ♥ ⚠ ♻ ☎ ✉ ⌀ ∞ ≈ ≠ ≤ ≥ √"],
    [__("Tırnak ve harfler"), "« » ‹ › “ ” ‘ ’ „ ¡ ¿ Ç ç Ğ ğ İ ı Ö ö Ş ş Ü ü ß é è"]
  ];
  $("rSym").addEventListener("click", function () {
    var items = [];
    SYMBOLS.forEach(function (g) {
      items.push({ head: g[0] });
      g[1].split(" ").forEach(function (ch) { items.push({ label: ch, run: function () { insertToken(ch); symbolWarn(ch); } }); });
    });
    popMenu(this, items, true);
  });
  function symbolWarn(ch) {
    var t = textSel()[0];
    if (t && !eff(t, null, "f") && ch.charCodeAt(0) > 0x24f) status(__("Bu simge yazıcının kendi yazı tipinde olmayabilir. Basılmazsa metne bir bilgisayar yazı tipi seç."));
  }

  /* {SAYAC} gibi alanlari ve simgeleri ekle */
  function insertToken(tok) {
    if (editing) {
      ted.focus();
      if (edSel) setOffsets(edSel.a, edSel.b);
      document.execCommand("insertText", false, tok);
      return;
    }
    if (lastContentField && document.activeElement === lastContentField.inp) { insertVar(tok); return; }
    var els = selEls();
    if (els.length === 1 && els[0].type === "text" && !els[0].locked) { startEdit(els[0], false); insertToken(tok); return; }
    if (els.length === 1 && (els[0].type === "qr" || els[0].type === "barcode")) {
      checkpoint(true); els[0].data = String(els[0].data || "") + tok; changed({ layers: true, inspector: true }); return;
    }
    var el = newEl("text", 3, 3, { text: tok, size: 4 });
    addElement(el); startEdit(el, false);
  }
  qsa("[data-token]").forEach(function (b) { b.addEventListener("click", function () { insertToken(b.dataset.token); }); });

  /* paneller */
  function setPane(cls, btn, on) {
    $("ws").classList.toggle(cls, !on); $(btn).classList.toggle("on", on); ls(cls, on ? "1" : "0"); schedule();
  }
  $("vLayers").addEventListener("click", function () { setPane("noLayers", "vLayers", $("ws").classList.contains("noLayers")); });
  $("vProps").addEventListener("click", function () { setPane("noProps", "vProps", $("ws").classList.contains("noProps")); });
  $("propsClose").addEventListener("click", function () { setPane("noProps", "vProps", false); });
  if (ls("noLayers") === "0") setPane("noLayers", "vLayers", false);
  if (ls("noProps") === "0") setPane("noProps", "vProps", false);

  $("qPrint").addEventListener("click", function () { printJob(); });
  $("hPrint").addEventListener("click", function () { openBackstage("print"); });

  /* ================= Dosya ekrani (backstage) ================= */
  var curBs = null;
  function openBackstage(page) {
    if (editing) finishEdit();
    if (drag) drag = null;
    $("bs").hidden = false; showBs(page || "home");
  }
  function closeBackstage() { if ($("bs").hidden) return; $("bs").hidden = true; curBs = null; schedule(); }
  function showBs(p) {
    curBs = p;
    qsa(".bsnav [data-bs]").forEach(function (b) { b.classList.toggle("on", b.dataset.bs === p); });
    qsa(".bspage").forEach(function (x) { x.hidden = x.dataset.bp !== p; });
    $("bs").querySelector(".bsmain").scrollTop = 0;
    if (p === "home") renderHome();
    else if (p === "new") renderNew();
    else if (p === "open") renderOpenPage();
    else if (p === "print") { updatePrintSummary(); requestAnimationFrame(drawPrintPreview); }
  }
  qsa(".bsnav [data-bs]").forEach(function (b) { b.addEventListener("click", function () { showBs(b.dataset.bs); }); });
  $("bsBack").addEventListener("click", closeBackstage);
  $("bsPrinters").addEventListener("click", function () { var ap = activePrinter(); openPrinters(ap ? ap.id : "new"); });

  function paintDoc(dd, maxW, maxH, crisp) {
    var c = document.createElement("canvas"), k = Math.min(maxW / dd.w, maxH / dd.h);
    var w = Math.max(1, Math.round(dd.w * k)), hh = Math.max(1, Math.round(dd.h * k)), dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); c.style.width = w + "px"; c.style.height = hh + "px";
    var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var recs = Z.records({ copies: 1, count: 1, start: dd.job.start, step: dd.job.step, digits: dd.job.digits, rows: Z.parseCSV(dd.job.csv).rows });
    try { R.drawDoc(g, dd, k * 25.4 / dd.dpi, 0, 0, recs[0], { outline: !crisp }); } catch (e) { /* bos birak */ }
    return c;
  }
  function tile(title, sub, visual, onclick) {
    return h("button", { type: "button", class: "tile", onclick: onclick }, [h("span", { class: "tv" }, [visual]), h("b", { text: title }), h("small", { text: sub || "" })]);
  }
  function paper(w, hh, blank) {
    var k = Math.min(120 / w, 104 / hh);
    var p = h("span", { class: "paper" + (blank ? " blank" : ""), text: blank ? "+" : "" });
    p.style.width = Math.round(w * k) + "px"; p.style.height = Math.round(hh * k) + "px";
    return p;
  }
  function newFromSize(w, hh, dpi) {
    if (!confirmDiscard()) return;
    var n = blankDoc(); n.w = w; n.h = hh; if (dpi) n.dpi = dpi;
    loadDoc(n);
  }
  function newFromTemplate(t) { useTemplate(t); }

  /* ---------- Sablon kutuphanesi ---------- */
  var myTemplates = [];
  function loadTemplates() {
    return api("/api/templates").then(function (l) { myTemplates = Array.isArray(l) ? l.map(migrate) : []; return myTemplates; })
      .catch(function () { return myTemplates; });
  }
  function saveTemplates(list) {
    return api("/api/templates", list).then(function (j) { if (!j.ok) throw new Error(j.message); myTemplates = list; });
  }
  /* {Ad Soyad} gibi doldurulacak alanlar (yazdirma degiskenleri ve sablonun CSV sutunlari haric) */
  function templateFields(t) {
    var skip = ["SAYAC", "SAYAÇ", "TARIH", "TARİH", "SAAT"].concat(Z.parseCSV((t.job || {}).csv).cols), out = [];
    t.elements.forEach(function (e) {
      [e.text, e.data].forEach(function (v) {
        String(v || "").replace(/\{([^{}]+)\}/g, function (m, k) {
          if (skip.indexOf(k.trim().toLocaleUpperCase("tr")) < 0 && skip.indexOf(k) < 0 && out.indexOf(k) < 0) out.push(k);
        });
      });
    });
    return out;
  }
  function useTemplate(t) {
    if (!confirmDiscard()) return;
    var fields = templateFields(t);
    function open(values) {
      var n = clone(t); n.id = uid();
      if (values) {
        var fill = function (str) { return String(str).replace(/\{([^{}]+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : m; }); };
        n.elements.forEach(function (e) {
          if (typeof e.data === "string") e.data = fill(e.data);
          if (e.type === "text") { var rr = runsOf(e); rr.forEach(function (r) { r.t = fill(r.t); }); setRuns(e, rr); }
        });
      }
      closeModal(); loadDoc(n); dirty = !!values; updateTitle();
      if (values) status(__("Şablondan yeni etiket oluşturuldu. Kaynak şablon değişmedi."));
    }
    if (!fields.length) { open(null); return; }
    var inputs = {}, form = h("div", { class: "tplform" });
    form.appendChild(h("p", { class: "note", text: __("Alanları doldur. Uzun adreslerde açılan tasarımı kontrol et.") }));
    fields.forEach(function (k) {
      var inp = h(/adres|address|açıklama/i.test(k) ? "textarea" : "input", { placeholder: k });
      inputs[k] = inp; form.appendChild(h("label", {}, [document.createTextNode(k), inp]));
    });
    form.appendChild(h("div", { class: "row wrap" }, [
      h("button", { type: "button", class: "tb primary", text: __("Etiketi oluştur"), onclick: function () {
        var v = {}; Object.keys(inputs).forEach(function (k) { v[k] = inputs[k].value; }); open(v);
      } }),
      h("button", { type: "button", class: "tb", text: __("Boş şablonu düzenle"), onclick: function () { open(null); } })
    ]));
    openModal(t.name + " — " + __("bilgileri doldur"), [form]);
    setTimeout(function () { var f = form.querySelector("input, textarea"); if (f) f.focus(); }, 0);
  }
  function thumb(t) {
    var c = paintDoc(t, 120, 104), imgs = t.elements.filter(function (e) { return e.type === "image" && e.src; });
    if (imgs.length) Promise.all(imgs.map(function (e) { return Z.loadImage(e.src); })).then(function () { var c2 = paintDoc(t, 120, 104); if (c.parentNode) c.parentNode.replaceChild(c2, c); });
    return c;
  }
  function mineTile(t) {
    var wrapT = h("div", { class: "tilew" }, [tile(t.name, t.w + " × " + t.h + " mm", thumb(t), function () { useTemplate(t); })]);
    wrapT.appendChild(h("div", { class: "tacts" }, [
      h("button", { type: "button", class: "tb", text: __("Dışa aktar"), onclick: function () { download((t.name || "sablon").replace(/[^\wçğıöşüÇĞİÖŞÜ\- ]+/g, "") + ".zebra", JSON.stringify(Object.assign({ format: "ZebraApp", formatVersion: 1 }, t), null, 2), "application/json"); } }),
      h("button", { type: "button", class: "tb", text: __("Sil"), onclick: function () {
        if (!confirm(__("'{a}' silinsin mi?").replace("{a}", t.name))) return;
        saveTemplates(myTemplates.filter(function (x) { return x.id !== t.id; })).then(renderNew).catch(function (e) { status(e.message, true); });
      } })
    ]));
    return wrapT;
  }
  function saveCurrentAsTemplate() {
    var name = prompt(__("Şablon adı"), doc.name); if (!name || !name.trim()) return;
    var copy = clone(doc); copy.id = uid(); copy.name = name.trim();
    saveTemplates(myTemplates.concat([copy])).then(function () { status(__("Şablon kaydedildi: ") + copy.name); if (curBs === "new") renderNew(); })
      .catch(function (e) { status(__("Şablon kaydedilemedi: ") + e.message, true); });
  }
  $("fSaveTpl").addEventListener("click", saveCurrentAsTemplate);
  $("tplSaveCur").addEventListener("click", saveCurrentAsTemplate);
  $("tplImport").addEventListener("click", function () { $("tplFile").click(); });
  $("tplFile").addEventListener("change", function () {
    var files = Array.prototype.slice.call(this.files), inp = this, added = [];
    var seq = files.reduce(function (pr, f) {
      return pr.then(function () {
        if (f.size > MAX_FILE) throw new Error(__("Etiket dosyası en fazla 20 MB olabilir."));
        var get = isNlbl(f.name) ? readNlbl(f) : f.text().then(function (t) { return JSON.parse(String(t).replace(/^\uFEFF/, "")); });
        return get.then(function (v) {
          (Array.isArray(v) ? v : [v]).forEach(function (x) { checkDoc(x); var m = migrate(x); m.id = uid(); added.push(m); });
        });
      });
    }, Promise.resolve());
    seq.then(function () { if (added.length) return saveTemplates(myTemplates.concat(added)); })
      .then(function () { if (added.length) status(added.length + " " + __("şablon eklendi.")); renderNew(); })
      .catch(function (e) { if (e.name !== "AbortError") status(__("Şablon eklenemedi: ") + e.message, true); })
      .then(function () { inp.value = ""; });
  });
  var PRESETS = [[80, 40], [100, 50], [100, 150], [100, 100], [58, 40], [50, 30], [40, 30], [50, 25]];
  function renderHome() {
    var hr = new Date().getHours();
    $("bsGreet").textContent = hr < 5 ? __("İyi geceler") : hr < 12 ? __("Günaydın") : hr < 18 ? __("İyi günler") : __("İyi akşamlar");
    var box = $("homeTiles"); box.innerHTML = "";
    box.appendChild(tile(__("Boş etiket"), "80 × 40 mm", paper(80, 40, true), function () { newFromSize(80, 40); }));
    samples().slice(0, 3).forEach(function (t) { box.appendChild(tile(t.name, t.w + " × " + t.h + " mm", paintDoc(t, 120, 104), function () { newFromTemplate(t); })); });
    myTemplates.slice(-3).forEach(function (t) { box.appendChild(tile(t.name, __("Şablonlarım"), thumb(t), function () { useTemplate(t); })); });
    box.appendChild(tile(__("Diğer şablonlar…"), __("Hazır boyutlar, şablonlar, şablonlarım"), paper(60, 60, true), function () { showBs("new"); }));
    var rb = $("homeRecent"); rb.innerHTML = "";
    if (!haveFS) { rb.appendChild(h("div", { class: "empty", text: __("Bu tarayıcı son kullanılan dosyaları hatırlayamıyor. Chrome ya da Edge kullan.") })); return; }
    Recent.list().then(function (items) {
      if (curBs !== "home") return;
      rb.innerHTML = "";
      if (!items.length) rb.appendChild(h("div", { class: "empty", text: __("Henüz son kullanılan dosya yok. Kaydettiğin ve açtığın dosyalar burada görünür.") }));
      items.slice(0, 10).forEach(function (it) {
        var row = h("div", { class: "rrowi", html: '<svg><use href="#i-new"/></svg>' }, [h("b", { text: it.name }), h("small", { text: new Date(it.t).toLocaleString() })]);
        row.appendChild(h("span", {}));
        row.addEventListener("click", function () { if (confirmDiscard()) openHandle(it.handle, it.key); });
        rb.appendChild(row);
      });
      rb.appendChild(h("button", { type: "button", class: "tb", text: __("Bilgisayardan aç…"), onclick: function () { if (confirmDiscard()) pickAndOpen(); } }));
    });
  }
  function renderNew() {
    var a = $("newSizes"); a.innerHTML = "";
    PRESETS.forEach(function (p) { a.appendChild(tile(p[0] + " × " + p[1] + " mm", p[0] === 100 && p[1] === 150 ? __("kargo") : "", paper(p[0], p[1], true), function () { newFromSize(p[0], p[1]); })); });
    var b = $("newTemplates"); b.innerHTML = "";
    samples().forEach(function (t) { b.appendChild(tile(t.name, t.w + " × " + t.h + " mm", paintDoc(t, 120, 104), function () { newFromTemplate(t); })); });
    var m = $("newMine"); m.innerHTML = "";
    if (!myTemplates.length) m.appendChild(h("p", { class: "note", text: __("Henüz kendi şablonun yok. Bir tasarımı şablon olarak kaydet ya da dosyadan ekle; {Ad Soyad} gibi alanlar açılırken sorulur.") }));
    myTemplates.forEach(function (t) { m.appendChild(mineTile(t)); });
    var ap = activePrinter(); $("nDpi").value = String(ap && ap.dpi ? ap.dpi : doc.dpi);
  }
  $("nCreate").addEventListener("click", function () {
    var w = parseFloat($("nW").value), hh = parseFloat($("nH").value);
    if (!(w >= 5 && hh >= 5)) { status(__("Geçerli bir genişlik ve yükseklik gir."), true); return; }
    newFromSize(w, hh, +$("nDpi").value);
  });
  function drawPrintPreview() {
    if (curBs !== "print" || !doc) return;
    var c = $("ppCanvas"), box = c.parentNode;
    var maxW = Math.max(200, box.clientWidth - 48), maxH = Math.max(200, window.innerHeight - 280);
    var k = Math.min(maxW / doc.w, maxH / doc.h, 14), w = Math.round(doc.w * k), hh = Math.round(doc.h * k), dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); c.style.width = w + "px"; c.style.height = hh + "px";
    var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    R.drawDoc(g, doc, k * 25.4 / doc.dpi, 0, 0, currentRec(), {});
    var n = Z.records(jobForRecords()).length;
    $("ppInfo").textContent = __("Kayıt {a} / {b}").replace("{a}", clamp(previewIdx, 0, n - 1) + 1).replace("{b}", n);
    $("ppPrev").disabled = previewIdx <= 0; $("ppNext").disabled = previewIdx >= n - 1;
  }

  /* ================= dil ================= */
  $("langSel").addEventListener("change", function () {
    var v = this.value;
    if (dirty && !confirm(__("Kaydedilmemiş değişiklikler var. Devam edersen kaybolacak."))) { this.value = window.I18N.lang; return; }
    saveSettings({ language: v }).then(function () { dirty = false; location.reload(); });
  });

  /* ================= baslat ================= */
  function start(list) {
    docs = (list || []).map(migrate);
    doc = blankDoc();
    $("zoomVal").textContent = "100%";
    renderPrinterSel();
    refreshAll(); renderOpen(); preloadImages();
    requestAnimationFrame(fit);
    refreshState();
    fetch("/api/ping").catch(function () {});
    loadTemplates().then(function () { if (curBs === "home") renderHome(); });
    openBackstage("home");
    loadFonts();
    if (window.I18N && window.I18N.lang === "en") $("fUnder").innerHTML = "<u>U</u>";
    if (!settings.printers.length) setTimeout(function () { status(__("Başlamak için sağ üstten bir yazıcı ekle.")); }, 300);
  }
  var fontsReady = document.fonts && document.fonts.load ? Promise.all([
    document.fonts.load("700 20px ZFont", "AaŞşİıĞğÜüÖöÇç"), document.fonts.load("400 20px ZFont", "AaŞş")
  ]).catch(function () {}) : Promise.resolve();
  api("/api/settings").catch(function () { return {}; }).then(function (st) {
    settings = Object.assign(settings, st || {});
    settings.printers = settings.printers || [];
    var langv = settings.language || ((navigator.language || "tr").toLowerCase().indexOf("tr") === 0 ? "tr" : "en");
    if (window.I18N) window.I18N.setLang(langv);
    $("langSel").value = langv;
    if (!settings.language) saveSettings({ language: langv }).catch(function () {});
    $("verLbl").textContent = settings.version ? "v" + settings.version : "";
    $("aboutVer").textContent = "ZebraApp " + (settings.version ? "v" + settings.version : "");
    return Promise.all([fontsReady, api("/api/labels").catch(function () { return []; })]);
  }).then(function (res) { start(res[1]); });

  window.ZebraApp = { toScreen: function (x, y) { var r = cv.getBoundingClientRect(); return { x: r.left + origin.x + x * s(), y: r.top + origin.y + y * s() }; }, get doc() { return doc; }, get sel() { return sel; }, select: function (ids) { sel = ids; selectionChanged(); schedule(); }, zpl: buildJobZPL, undo: undo, redo: redo, align: align, setTool: setTool };
})();
