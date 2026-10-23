/* Etiket belgesi -> yerlesim (nokta) ve ZPL uretimi. */
(function (G) {
  "use strict";

  var ORI = { 0: "N", 90: "R", 180: "I", 270: "B" };
  var FONT = "ZFont, 'Roboto Condensed', 'Arial Narrow', Arial, sans-serif";
  var mctx = document.createElement("canvas").getContext("2d");

  function dots(mm, dpi) { return Math.round((+mm || 0) * dpi / 25.4); }
  function clean(s) { return String(s == null ? "" : s).replace(/[\^~]/g, ""); }
  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }

  /* Degiskenler: {SAYAC} {TARIH} {SAAT} {kolon} */
  function subst(str, rec) {
    str = String(str == null ? "" : str);
    if (!rec) return str;
    return str.replace(/\{([^{}]+)\}/g, function (m, key) {
      var k = key.trim();
      var up = k.toLocaleUpperCase("tr");
      if (up === "SAYAC" || up === "SAYAÇ") return rec.__counter != null ? rec.__counter : m;
      if (up === "TARIH" || up === "TARİH") return rec.__date || m;
      if (up === "SAAT") return rec.__time || m;
      if (Object.prototype.hasOwnProperty.call(rec, k)) return rec[k];
      return m;
    });
  }

  /* el.font bos = yazicinin kendi yazi tipi (^A0); dolu = bilgisayardaki yazi tipi, bitmap olarak basilir */
  function fontCSS(font) { return font ? '"' + String(font).replace(/["\\]/g, "") + '", ' + FONT : FONT; }
  function measure(text, h, w, css, weight) {
    mctx.font = (weight || 700) + " " + h + "px " + (css || FONT);
    return mctx.measureText(text).width * (w / h);
  }

  /* Hangi acilari yazici kendi komutlariyla basabiliyor; digerleri bitmap */
  var NATIVE = { text: [0, 90, 180, 270], barcode: [0, 90, 180, 270], image: [0, 90, 180, 270], qr: [0],
    line: [0, 90, 180, 270], box: [0, 90, 180, 270], ellipse: [0, 90, 180, 270] };
  function normRot(r) { r = Math.round(+r || 0) % 360; return r < 0 ? r + 360 : r; }
  /* Yazicinin kendi yazi tipiyle basilamayan metin ayarlari: bunlar varsa metin bitmap olarak gider */
  function textRaster(el) {
    return !!(el.font || (el.rich && el.rich.length) || el.italic || el.underline || el.strike || (+el.spacing) || el.align === "justify");
  }
  function isNative(el) { return (NATIVE[el.type] || [0]).indexOf(normRot(el.rot)) >= 0 && !(el.type === "text" && textRaster(el)); }
  /* Buyuk/kucuk harf (Turkce kurallariyla) */
  function caseT(str, mode) {
    if (mode === "upper") return str.toLocaleUpperCase("tr");
    if (mode === "lower") return str.toLocaleLowerCase("tr");
    if (mode === "title") return str.toLocaleLowerCase("tr").replace(/(^|[\s\-\/(."'])(\S)/g, function (m, a, b) { return a + b.toLocaleUpperCase("tr"); });
    return str;
  }

  function wrapLines(lines, h, w, maxW, css, weight) {
    var out = [];
    lines.forEach(function (line) {
      if (!line) { out.push(""); return; }
      var words = line.split(/(\s+)/), cur = "";
      words.forEach(function (wd) {
        var next = cur + wd;
        if (cur && measure(next.trimEnd(), h, w, css, weight) > maxW && wd.trim()) {
          out.push(cur.trimEnd());
          cur = wd.replace(/^\s+/, "");
        } else cur = next;
      });
      out.push(cur.trimEnd());
    });
    return out;
  }

  /* Yerel kutu (W,H; donmemis) -> donmus global kutu */
  function rotBox(x, y, W, H, rot) {
    if (rot === 90 || rot === 270) return { x: x, y: y, w: H, h: W };
    return { x: x, y: y, w: W, h: H };
  }
  /* Yerel dikdortgen (lx,ly,lw,lh) -> global sol-ust nokta (ZPL ^FO) */
  function mapRect(x, y, W, H, rot, lx, ly, lw, lh) {
    if (rot === 90) return { x: x + H - (ly + lh), y: y + lx };
    if (rot === 180) return { x: x + W - (lx + lw), y: y + H - (ly + lh) };
    if (rot === 270) return { x: x + ly, y: y + W - (lx + lw) };
    return { x: x + lx, y: y + ly };
  }

  var qrCache = {};
  function qrMatrix(data, ec) {
    var key = ec + "|" + data;
    if (qrCache[key]) return qrCache[key];
    var m = null;
    try {
      if (G.qrcode) {
        var q = G.qrcode(0, ec || "M");
        q.addData(String(data || " "), "Byte");
        q.make();
        var n = q.getModuleCount(), rows = [];
        for (var r = 0; r < n; r++) {
          var row = [];
          for (var c = 0; c < n; c++) row.push(q.isDark(r, c));
          rows.push(row);
        }
        m = { n: n, rows: rows };
      }
    } catch (e) { m = null; }
    if (!m) {
      var len = String(data || "").length, cap = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213], v = 1;
      while (v < 10 && len > cap[v - 1]) v++;
      m = { n: 21 + 4 * (v - 1), rows: null };
    }
    qrCache[key] = m;
    return m;
  }

  function hrHeight(module) { return Math.max(18, Math.round(module * 9)) + 6; }

  /* Bir ogenin nokta cinsinden yerlesimi. local=true: donmemis, (0,0) konumlu, bitmap kararini verme */
  function layout(el, doc, rec, local) {
    if (!local && !isNative(el)) return rasterLayout(el, doc, rec);
    var dpi = doc.dpi, x = dots(el.x, dpi), y = dots(el.y, dpi), rot = local ? 0 : normRot(el.rot), L = { x: x, y: y, rot: rot };
    if (el.type === "text" && textRaster(el)) return richLayout(el, doc, rec, L);
    if (el.type === "text") {
      var css = fontCSS(el.font), weight = el.font ? (el.bold ? 700 : 400) : 700;
      var block = dots(el.boxW, dpi), limH = dots(el.boxH, dpi), raw = caseT(subst(el.text, rec), el.caseMode).split("\n").map(clean);
      var lay = function (h) {
        h = Math.max(6, Math.round(h));
        var w = Math.max(6, Math.round(h * (el.widthPct || 90) / 100)), gap = Math.round(h * (el.lineGap || 1.25));
        var lines = (el.wrap && block > 0) ? wrapLines(raw, h, w, block, css, weight) : raw;
        var widths = lines.map(function (t) { return measure(t, h, w, css, weight); });
        return { h: h, w: w, gap: gap, lines: lines, widths: widths, maxW: Math.max.apply(null, widths.concat([0])), H: (lines.length - 1) * gap + h };
      };
      var r = lay(dots(el.size, dpi)), guard = 0;
      /* kutuya sigdir: genislik ya da yukseklik tasarsa kucult */
      if (el.fit && (block > 0 || limH > 0)) {
        while (guard++ < 80 && r.h > 6 && ((block > 0 && r.maxW > block + 0.5) || (limH > 0 && r.H > limH))) r = lay(r.h * 0.95);
      }
      var W = block > 0 ? block : Math.max(1, r.maxW);
      var H = Math.max(r.H, limH > 0 ? limH : 0);
      L.kind = "text"; L.lines = r.lines; L.widths = r.widths; L.h = r.h; L.w = r.w; L.gap = r.gap; L.block = block; L.W = W; L.H = H;
      L.css = css; L.weight = weight; L.printerFont = !el.font; L.shrunk = r.h < Math.max(6, dots(el.size, dpi));
      L.vy = vOffset(el, limH, r.H);
      L.box = rotBox(x, y, W, H, rot);
      return L;
    }
    if (el.type === "qr") {
      var data = clean(subst(el.data, rec));
      var mat = qrMatrix(data, el.ec || "M"), mag = Math.max(1, Math.min(10, Math.round(+el.mag || 4)));
      L.kind = "qr"; L.data = data; L.mat = mat; L.mag = mag; L.W = L.H = mat.n * mag;
      L.box = { x: x, y: y, w: L.W, h: L.H };
      return L;
    }
    if (el.type === "barcode") {
      var bd = clean(subst(el.data, rec)), module = Math.max(1, Math.min(10, Math.round(+el.module || 2)));
      var ratio = Math.max(2, Math.min(3, +el.ratio || 3));
      var enc = G.Barcodes.encode(el.kind || "code128", bd, ratio);
      var units = 0;
      enc.bars.forEach(function (b) { units += b.w; });
      var bh = Math.max(4, dots(el.h, dpi)), hr = el.human ? hrHeight(module) : 0;
      L.kind = "barcode"; L.data = bd; L.enc = enc; L.module = module; L.ratio = ratio; L.bh = bh; L.hr = hr;
      L.W = Math.round(units * module); L.H = bh + hr;
      L.box = rotBox(x, y, L.W, L.H, rot);
      return L;
    }
    if (el.type === "line") {
      var len = Math.max(1, dots(el.len, dpi)), t = Math.max(1, dots(el.t, dpi));
      var vert = (el.dir === "v") !== (rot === 90 || rot === 270);
      L.kind = "line";
      L.W = el.dir === "v" ? t : len; L.H = el.dir === "v" ? len : t;
      L.box = vert ? { x: x, y: y, w: t, h: len } : { x: x, y: y, w: len, h: t };
      L.t = t;
      return L;
    }
    if (el.type === "box" || el.type === "ellipse") {
      var bw = Math.max(1, dots(el.w, dpi)), bhh = Math.max(1, dots(el.h, dpi));
      var th = el.filled ? Math.min(bw, bhh) : Math.max(1, dots(el.t, dpi));
      if (el.type === "ellipse" && el.filled) th = Math.ceil(Math.min(bw, bhh) / 2) + 1;
      L.kind = el.type; L.t = Math.min(th, Math.min(bw, bhh)); if (el.type === "ellipse") L.t = th;
      L.round = Math.max(0, Math.min(8, Math.round(+el.round || 0)));
      L.W = bw; L.H = bhh;
      L.box = rotBox(x, y, bw, bhh, rot);
      return L;
    }
    if (el.type === "image") {
      L.kind = "image";
      L.box = { x: x, y: y, w: Math.max(8, dots(el.w, dpi)), h: Math.max(1, dots(el.h, dpi)) };
      L.W = L.box.w; L.H = L.box.h;
      return L;
    }
    L.box = { x: x, y: y, w: 1, h: 1 };
    return L;
  }

  function vOffset(el, limH, textH) {
    if (!(limH > textH) || !el.vAlign || el.vAlign === "top") return 0;
    return Math.round((limH - textH) * (el.vAlign === "bottom" ? 1 : 0.5));
  }

  /* Zengin metin: kelime kelime kalin/italik/alti cizili/ustu cizili, boyut ve yazi tipi; karakter araligi,
     iki yana yaslama. Her zaman donmemis (yerel) cizilir, bitmap olarak basilir. */
  function richLayout(el, doc, rec, L) {
    var dpi = doc.dpi, sx = Math.max(0.3, Math.min(2, (el.widthPct || 90) / 100));
    var block = dots(el.boxW, dpi), limH = dots(el.boxH, dpi), gapK = el.lineGap || 1.25;
    var spD = (+el.spacing || 0) * dpi / 25.4;                      /* karakter araligi, nokta */
    var base = { b: !!el.bold, i: !!el.italic, u: !!el.underline, s: !!el.strike, sz: +el.size || 4, f: el.font || "" };
    var src = el.rich && el.rich.length ? el.rich : [{ t: el.text }];
    var runs = src.map(function (r) {
      return { t: caseT(clean(subst(r.t, rec)), el.caseMode), b: r.b != null ? !!r.b : base.b, i: r.i != null ? !!r.i : base.i,
        u: r.u != null ? !!r.u : base.u, s: r.s != null ? !!r.s : base.s, sz: +r.sz || base.sz, f: r.f != null ? r.f : base.f };
    });
    function style(r, k) {
      var h = Math.max(4, r.sz * dpi / 25.4 * k), css = r.f ? fontCSS(r.f) : FONT, weight = r.f ? (r.b ? 700 : 400) : 700;
      return { h: h, css: css, weight: weight, i: r.i, u: r.u, s: r.s, fake: !r.f && r.b, font: (r.i ? "italic " : "") + weight + " " + h + "px " + css };
    }
    var spU = spD / sx;                                              /* olceklenmeden onceki aralik */
    function width(t, st) { mctx.font = st.font; return (mctx.measureText(t).width + spU * t.length) * sx; }
    function build(k) {
      var toks = [];
      runs.forEach(function (r) {
        var st = style(r, k);
        r.t.split(/(\n|[ \t]+)/).forEach(function (piece) {
          if (piece) toks.push({ t: piece, st: st, nl: piece === "\n", sp: /^[ \t]+$/.test(piece) });
        });
      });
      var lines = [], cur = [], curW = 0, lastSt = style(runs[runs.length - 1] || base, k);
      function flush(par) { lines.push({ items: cur, w: curW, par: par }); cur = []; curW = 0; }
      toks.forEach(function (tk) {
        lastSt = tk.st;
        if (tk.nl) { flush(true); return; }
        var w = width(tk.t, tk.st);
        if (el.wrap && block > 0 && !tk.sp && curW > 0 && curW + w > block + 0.5) {
          while (cur.length && cur[cur.length - 1].sp) curW -= cur.pop().w;
          flush(false);
        }
        if (tk.sp && !cur.length && lines.length && !lines[lines.length - 1].par) return;   /* kaydirilan satirin basindaki bosluk */
        cur.push({ t: tk.t, st: tk.st, w: w, sp: tk.sp }); curW += w;
      });
      flush(true);
      var top = 0, maxW = 0, H = 0;
      lines.forEach(function (ln, i) {
        ln.h = ln.items.reduce(function (m, it) { return Math.max(m, it.st.h); }, 0) || lastSt.h;
        if (i) top += lines[i - 1].h * gapK;
        ln.top = top; H = top + ln.h; maxW = Math.max(maxW, ln.w);
      });
      return { lines: lines, maxW: maxW, H: H, k: k };
    }
    var r = build(1), guard = 0;
    if (el.fit && (block > 0 || limH > 0)) {
      while (guard++ < 80 && r.k > 0.05 && ((block > 0 && r.maxW > block + 0.5) || (limH > 0 && r.H > limH))) r = build(r.k * 0.95);
    }
    var W = block > 0 ? block : Math.max(1, r.maxW), H = Math.max(r.H, limH > 0 ? limH : 0);
    r.lines.forEach(function (ln) {
      var extra = 0, nsp = 0;
      if (el.align === "justify" && block > 0 && !ln.par) ln.items.forEach(function (it) { if (it.sp) nsp++; });
      if (nsp) extra = (W - ln.w) / nsp;
      ln.x = !block ? 0 : el.align === "center" ? (W - ln.w) / 2 : el.align === "right" ? W - ln.w : 0;
      var x = 0;
      ln.items.forEach(function (it) { it.x = x; if (it.sp && nsp) it.w += extra; x += it.w; });
    });
    var first = r.lines[0], h0 = first ? first.h : style(base, r.k).h;
    L.kind = "text"; L.rich = true; L.rl = r.lines; L.sx = sx; L.spU = spU; L.W = W; L.H = H; L.block = block;
    L.h = Math.round(h0); L.w = Math.round(h0 * sx); L.gap = Math.round(h0 * gapK);
    L.lines = r.lines.map(function (ln) { return ln.items.map(function (it) { return it.t; }).join(""); });
    L.widths = r.lines.map(function (ln) { return ln.w; });
    L.css = base.f ? fontCSS(base.f) : FONT; L.weight = base.f ? (base.b ? 700 : 400) : 700; L.printerFont = !base.f;
    L.shrunk = r.k < 0.999; L.vy = vOffset(el, limH, r.H);
    L.box = { x: L.x, y: L.y, w: W, h: H };
    return L;
  }

  /* Serbest aci ya da bilgisayar yazi tipi: oge donmemis haliyle cizilir, sonra dondurulur, bitmap olarak basilir.
     (x, y) donmus ogenin cevreleyen kutusunun sol ust kosesidir. */
  function rasterLayout(el, doc, rec) {
    var dpi = doc.dpi, x = dots(el.x, dpi), y = dots(el.y, dpi), ang = normRot(el.rot);
    var lel = Object.assign({}, el, { x: 0, y: 0, rot: 0 });
    var LL = layout(lel, doc, rec, true), lw = LL.box.w, lh = LL.box.h;
    var a = ang * Math.PI / 180, c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
    var bw = Math.max(1, Math.ceil(lw * c + lh * sn)), bh = Math.max(1, Math.ceil(lw * sn + lh * c));
    return { kind: "raster", raster: true, angle: ang, x: x, y: y, rot: ang, local: { el: lel, L: LL }, lw: lw, lh: lh,
      box: { x: x, y: y, w: bw, h: bh }, mat: LL.mat, W: LL.W, H: LL.H, module: LL.module, hr: LL.hr, shrunk: LL.shrunk };
  }
  /* Donmus ogenin dort kosesi (nokta), secim cercevesi icin */
  function corners(L) {
    var b = L.box;
    if (!L.raster) return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2, a = L.angle * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    return [[-L.lw / 2, -L.lh / 2], [L.lw / 2, -L.lh / 2], [L.lw / 2, L.lh / 2], [-L.lw / 2, L.lh / 2]].map(function (p) {
      return [cx + p[0] * co - p[1] * si, cy + p[0] * si + p[1] * co];
    });
  }
  /* Bitmap ogeyi 1 bitlik resme cevir (tarayicida, render.js ile) */
  function rasterBitmap(el, L) {
    if (!G.R || !G.R.drawRaster) return null;
    var w = Math.max(1, L.box.w), h = Math.max(1, L.box.h);
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    var c = cv.getContext && cv.getContext("2d"); if (!c || !c.getImageData) return null;
    c.fillStyle = "#000000"; c.strokeStyle = "#000000";
    var shifted = Object.assign({}, L, { box: { x: 0, y: 0, w: w, h: h } });
    G.R.drawRaster(c, el, shifted);
    var px = c.getImageData(0, 0, w, h).data, bpr = Math.ceil(w / 8), bytes = new Uint8Array(bpr * h), bits = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) {
      var on = px[i * 4 + 3] >= 128 && (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) < 384;
      if (on) { bits[i] = 1; bytes[Math.floor(i / w) * bpr + ((i % w) >> 3)] |= 0x80 >> ((i % w) & 7); }
    }
    return { w: w, h: h, bpr: bpr, bytes: bytes, bits: bits };
  }

  /* ---------------- gorsel -> ^GFA ---------------- */
  var imgCache = {}, bmpCache = {};
  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (imgCache[src] && imgCache[src].ok) return Promise.resolve(imgCache[src].img);
    if (imgCache[src] && imgCache[src].p) return imgCache[src].p;
    var img = new Image();
    var p = new Promise(function (res) {
      img.onload = function () { imgCache[src] = { ok: true, img: img }; res(img); };
      img.onerror = function () { imgCache[src] = { ok: false }; res(null); };
    });
    imgCache[src] = { p: p };
    img.src = src;
    return p;
  }
  function imageReady(src) { return imgCache[src] && imgCache[src].ok ? imgCache[src].img : null; }

  function bitmap(el, w, h) {
    var img = imageReady(el.src);
    if (!img) return null;
    var key = [el.src.length, el.src.slice(-40), w, h, el.threshold, el.dither, el.invert, el.rot].join("|");
    if (bmpCache[key]) return bmpCache[key];
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var c = cv.getContext("2d");
    c.fillStyle = "#fff"; c.fillRect(0, 0, w, h);
    var rot = +el.rot || 0;
    c.save();
    if (rot === 90) { c.translate(w, 0); c.rotate(Math.PI / 2); c.drawImage(img, 0, 0, h, w); }
    else if (rot === 180) { c.translate(w, h); c.rotate(Math.PI); c.drawImage(img, 0, 0, w, h); }
    else if (rot === 270) { c.translate(0, h); c.rotate(-Math.PI / 2); c.drawImage(img, 0, 0, h, w); }
    else c.drawImage(img, 0, 0, w, h);
    c.restore();
    var px = c.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) {
      var a = px[i * 4 + 3] / 255;
      var lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      g[i] = lum * a + 255 * (1 - a);
    }
    var thr = el.threshold == null ? 128 : +el.threshold, bits = new Uint8Array(w * h);
    for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
      var k = yy * w + xx, old = g[k], nv = old < thr ? 0 : 255;
      bits[k] = nv === 0 ? 1 : 0;
      if (el.dither) {
        var err = old - nv;
        if (xx + 1 < w) g[k + 1] += err * 7 / 16;
        if (yy + 1 < h) {
          if (xx > 0) g[k + w - 1] += err * 3 / 16;
          g[k + w] += err * 5 / 16;
          if (xx + 1 < w) g[k + w + 1] += err * 1 / 16;
        }
      }
    }
    if (el.invert) for (var q = 0; q < bits.length; q++) bits[q] ^= 1;
    var bpr = Math.ceil(w / 8), bytes = new Uint8Array(bpr * h);
    for (var r = 0; r < h; r++) for (var cx = 0; cx < w; cx++)
      if (bits[r * w + cx]) bytes[r * bpr + (cx >> 3)] |= 0x80 >> (cx & 7);
    var out = { w: w, h: h, bpr: bpr, bytes: bytes, bits: bits };
    bmpCache[key] = out;
    return out;
  }

  function countChars(n) {
    var s = "";
    while (n >= 20) { var k = Math.min(400, Math.floor(n / 20) * 20); s += String.fromCharCode(103 + k / 20 - 1); n -= k; }
    if (n > 0) s += String.fromCharCode(71 + n - 1);
    return s;
  }
  function compressRow(hex) {
    var m = hex.match(/0+$/), tail = "";
    if (m && m[0].length > 1) { hex = hex.slice(0, hex.length - m[0].length); tail = ","; }
    else { var f = hex.match(/F+$/); if (f && f[0].length > 1) { hex = hex.slice(0, hex.length - f[0].length); tail = "!"; } }
    var out = "", i = 0;
    while (i < hex.length) {
      var c = hex[i], j = i;
      while (j < hex.length && hex[j] === c) j++;
      var n = j - i;
      out += (n > 1 ? countChars(n) : "") + c;
      i = j;
    }
    return out + tail;
  }
  function gfa(bmp) {
    var H = "0123456789ABCDEF", rows = [], prev = null, out = "";
    for (var r = 0; r < bmp.h; r++) {
      var hex = "";
      for (var b = 0; b < bmp.bpr; b++) { var v = bmp.bytes[r * bmp.bpr + b]; hex += H[v >> 4] + H[v & 15]; }
      if (hex === prev) out += ":";
      else out += compressRow(hex);
      prev = hex;
    }
    var total = bmp.bpr * bmp.h;
    return "^GFA," + total + "," + total + "," + bmp.bpr + "," + out;
  }

  /* ---------------- ZPL ---------------- */
  function elementZPL(el, doc, rec) {
    if (el.hidden) return [];
    var L = layout(el, doc, rec), o = [], ori = ORI[L.rot] || "N";
    if (L.raster) {
      var rb = rasterBitmap(el, L);
      if (rb) o.push("^FO" + L.box.x + "," + L.box.y + (el.reverse ? "^FR" : "") + gfa(rb) + "^FS");
      return o;
    }
    if (L.kind === "text") {
      var bold = el.bold && !el.reverse ? Math.max(1, Math.round(L.h / 28)) : 0;
      L.lines.forEach(function (t, i) {
        if (!t) return;
        var lw = L.block > 0 ? L.block : L.widths[i];
        var p = mapRect(L.x, L.y, L.W, L.H, L.rot, 0, (L.vy || 0) + i * L.gap, lw, L.h);
        var fb = L.block > 0 ? "^FB" + L.block + ",1,0," + ({ center: "C", right: "R" }[el.align] || "L") + ",0" : "";
        var fr = el.reverse ? "^FR" : "";
        var f = "^A0" + ori + "," + L.h + "," + L.w + fb + fr + "^FD" + t + "^FS";
        o.push("^FO" + p.x + "," + p.y + f);
        if (bold) {
          var dx = { 0: [bold, 0], 90: [0, bold], 180: [-bold, 0], 270: [0, -bold] }[L.rot] || [bold, 0];
          o.push("^FO" + (p.x + dx[0]) + "," + (p.y + dx[1]) + f);
        }
      });
    } else if (L.kind === "qr") {
      o.push("^FO" + L.x + "," + L.y + "^BQN,2," + L.mag + "^FD" + (el.ec || "M") + "A," + L.data + "^FS");
    } else if (L.kind === "barcode") {
      o.push("^BY" + L.module + "," + L.ratio.toFixed(1) + "," + L.bh);
      var hr = el.human ? "Y" : "N", ab = el.humanAbove ? "Y" : "N", cmd;
      if (el.kind === "code39") cmd = "^B3" + ori + ",N," + L.bh + "," + hr + "," + ab;
      else if (el.kind === "ean13") cmd = "^BE" + ori + "," + L.bh + "," + hr + "," + ab;
      else cmd = "^BC" + ori + "," + L.bh + "," + hr + "," + ab + ",N,A";
      var data = el.kind === "ean13" ? L.enc.text.slice(0, 12) : L.data;
      o.push("^FO" + L.x + "," + L.y + cmd + "^FD" + data + "^FS");
    } else if (L.kind === "line") {
      o.push("^FO" + L.box.x + "," + L.box.y + "^GB" + L.box.w + "," + L.box.h + "," + L.t + "^FS");
    } else if (L.kind === "box") {
      o.push("^FO" + L.box.x + "," + L.box.y + (el.reverse ? "^FR" : "") + "^GB" + L.box.w + "," + L.box.h + "," + L.t + ",B," + L.round + "^FS");
    } else if (L.kind === "ellipse") {
      o.push("^FO" + L.box.x + "," + L.box.y + (el.reverse ? "^FR" : "") + "^GE" + L.box.w + "," + L.box.h + "," + L.t + ",B^FS");
    } else if (L.kind === "image") {
      var bmp = bitmap(el, L.box.w, L.box.h);
      if (bmp) o.push("^FO" + L.box.x + "," + L.box.y + gfa(bmp) + "^FS");
    }
    return o;
  }

  function header(doc) {
    var s = doc.settings || {}, W = dots(doc.w, doc.dpi), H = dots(doc.h, doc.dpi), o = ["^XA", "^CI28"];
    o.push("^MN" + ({ gap: "Y", continuous: "N", mark: "M" }[s.media] || "Y"));
    o.push("^MMT", "^PW" + W, "^LL" + H, "^LH0,0");
    o.push("^LS" + dots(s.shiftX || 0, doc.dpi), "^LT" + dots(s.shiftY || 0, doc.dpi));
    o.push("^PO" + (s.rotate180 ? "I" : "N"));
    if (s.speed) o.push("^PR" + s.speed);
    if (s.darkness !== "" && s.darkness != null) o.push("~SD" + pad(Math.max(0, Math.min(30, +s.darkness)), 2));
    return o;
  }

  function today() {
    var d = new Date();
    return { date: pad(d.getDate(), 2) + "." + pad(d.getMonth() + 1, 2) + "." + d.getFullYear(), time: pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2) };
  }

  /* Yazdirma kayitlari: CSV satirlari x sayac */
  function records(job) {
    job = job || {};
    var t = today(), out = [], rows = job.rows && job.rows.length ? job.rows : [{}];
    var n = Math.max(1, Math.round(+job.count || 1)), start = Math.round(+job.start || 1), step = Math.round(+job.step || 1), w = Math.round(+job.digits || 0);
    var c = start;
    rows.forEach(function (row) {
      for (var i = 0; i < (job.rows && job.rows.length ? 1 : n); i++) {
        var r = Object.assign({}, row, { __counter: pad(c, w), __date: t.date, __time: t.time });
        out.push(r);
        c += step;
      }
    });
    return out;
  }

  function labelZPL(doc, rec, copies) {
    var o = header(doc);
    doc.elements.forEach(function (el) { o = o.concat(elementZPL(el, doc, rec)); });
    o.push("^PQ" + Math.max(1, Math.round(+copies || 1)) + ",0,1,Y", "^XZ");
    return o.join("\n");
  }

  function docZPL(doc, job) {
    job = job || {};
    var recs = records(job), parts = [], copies = Math.max(1, Math.round(+job.copies || 1));
    recs.forEach(function (rec) { parts.push(labelZPL(doc, rec, copies)); });
    return parts.join("\n");
  }

  function parseCSV(text) {
    text = String(text || "").replace(/\r/g, "").trim();
    if (!text) return { cols: [], rows: [] };
    var first = text.split("\n")[0];
    var sep = [";", "\t", ","].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    function split(line) {
      var out = [], cur = "", q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true;
        else if (ch === sep) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out.map(function (s) { return s.trim(); });
    }
    var lines = text.split("\n").filter(function (l) { return l.trim(); });
    var cols = split(lines[0]), rows = [];
    for (var i = 1; i < lines.length; i++) {
      var v = split(lines[i]), r = {};
      cols.forEach(function (c, k) { r[c] = v[k] == null ? "" : v[k]; });
      rows.push(r);
    }
    return { cols: cols, rows: rows };
  }

  G.Z = {
    dots: dots, layout: layout, elementZPL: elementZPL, docZPL: docZPL, labelZPL: labelZPL, records: records,
    subst: subst, measure: measure, mapRect: mapRect, normRot: normRot, textRaster: textRaster, caseT: caseT, isNative: isNative, corners: corners, fontCSS: fontCSS, NATIVE: NATIVE, loadImage: loadImage, imageReady: imageReady,
    bitmap: bitmap, gfa: gfa, compressRow: compressRow, parseCSV: parseCSV, FONT: FONT, ORI: ORI
  };
})(window);
