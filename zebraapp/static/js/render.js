/* Etiketi tuvale cizer. Koordinatlar nokta (dot); s = piksel/nokta. */
(function (G) {
  "use strict";
  var Z = G.Z;

  function localTransform(ctx, L) {
    var b = L.box, W = L.W, H = L.H;
    if (L.rot === 90) { ctx.translate(b.x + H, b.y); ctx.rotate(Math.PI / 2); }
    else if (L.rot === 180) { ctx.translate(b.x + W, b.y + H); ctx.rotate(Math.PI); }
    else if (L.rot === 270) { ctx.translate(b.x, b.y + W); ctx.rotate(-Math.PI / 2); }
    else ctx.translate(b.x, b.y);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    rrPath(ctx, x, y, w, h, r);
  }
  function rrPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawText(ctx, el, L) {
    ctx.save();
    localTransform(ctx, L);
    ctx.textBaseline = "top";
    ctx.font = "700 " + L.h + "px " + Z.FONT;
    var bold = el.bold && !el.reverse ? Math.max(1, Math.round(L.h / 28)) : 0, sx = L.w / L.h;
    L.lines.forEach(function (t, i) {
      var lw = L.widths[i], lx = 0;
      if (L.block > 0) {
        if (el.align === "center") lx = (L.block - lw) / 2;
        else if (el.align === "right") lx = L.block - lw;
      }
      ctx.save();
      ctx.translate(lx, i * L.gap - L.h * 0.06);
      ctx.scale(sx, 1);
      ctx.fillText(t, 0, 0);
      if (bold) ctx.fillText(t, bold / sx, 0);
      ctx.restore();
    });
    ctx.restore();
  }

  function drawQR(ctx, L) {
    var m = L.mag, b = L.box;
    if (L.mat.rows) {
      for (var r = 0; r < L.mat.n; r++) for (var c = 0; c < L.mat.n; c++)
        if (L.mat.rows[r][c]) ctx.fillRect(b.x + c * m, b.y + r * m, m, m);
    } else {
      ctx.save(); ctx.strokeStyle = "#111"; ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.font = "700 " + Math.round(b.h / 5) + "px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("QR", b.x + b.w / 2, b.y + b.h / 2); ctx.restore();
    }
  }

  function drawBarcode(ctx, el, L) {
    ctx.save();
    localTransform(ctx, L);
    var top = el.human && el.humanAbove ? L.hr : 0, x = 0;
    L.enc.bars.forEach(function (bar) {
      var w = bar.w * L.module;
      if (bar.bar) ctx.fillRect(x, top, w, L.bh);
      x += w;
    });
    if (el.human) {
      var fh = Math.max(14, L.hr - 6);
      ctx.font = "700 " + fh + "px " + Z.FONT;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      var txt = el.kind === "code39" ? L.enc.text : (el.kind === "ean13" ? L.enc.text : L.data);
      ctx.fillText(txt, L.W / 2, el.humanAbove ? 0 : L.bh + 4);
    }
    ctx.restore();
  }

  function drawImage(ctx, el, L) {
    var b = L.box, bmp = Z.bitmap(el, b.w, b.h);
    if (!bmp) {
      ctx.save(); ctx.strokeStyle = "#999"; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.restore();
      return;
    }
    if (!bmp.canvas) {
      var cv = document.createElement("canvas"); cv.width = bmp.w; cv.height = bmp.h;
      var c = cv.getContext("2d"), id = c.createImageData(bmp.w, bmp.h);
      for (var i = 0; i < bmp.bits.length; i++) {
        var v = bmp.bits[i] ? 17 : 255;
        id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
        id.data[i * 4 + 3] = bmp.bits[i] ? 255 : 0;
      }
      c.putImageData(id, 0, 0);
      bmp.canvas = cv;
    }
    ctx.drawImage(bmp.canvas, b.x, b.y);
  }

  function drawEl(ctx, el, L) {
    var b = L.box;
    if (L.kind === "text") return drawText(ctx, el, L);
    if (L.kind === "qr") return drawQR(ctx, L);
    if (L.kind === "barcode") return drawBarcode(ctx, el, L);
    if (L.kind === "line") { ctx.fillRect(b.x, b.y, b.w, b.h); return; }
    if (L.kind === "box") {
      var r = L.round / 8 * Math.min(b.w, b.h) / 2, t = L.t;
      ctx.beginPath();
      rrPath(ctx, b.x, b.y, b.w, b.h, r);
      if (t < Math.min(b.w, b.h) / 2) rrPath(ctx, b.x + t, b.y + t, b.w - 2 * t, b.h - 2 * t, Math.max(0, r - t));
      ctx.fill("evenodd");
      return;
    }
    if (L.kind === "ellipse") {
      var t2 = L.t;
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      if (t2 < Math.min(b.w, b.h) / 2) {
        var iw = b.w / 2 - t2, ih = b.h / 2 - t2;
        ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(0, iw), Math.max(0, ih), 0, 0, Math.PI * 2, true);
      }
      ctx.fill("evenodd");
      return;
    }
    if (L.kind === "image") return drawImage(ctx, el, L);
  }

  /* Etiketi ciz. Donus: her oge icin yerlesim dizisi (gizliler dahil) */
  function drawDoc(ctx, doc, s, ox, oy, rec, opts) {
    opts = opts || {};
    var W = Z.dots(doc.w, doc.dpi), H = Z.dots(doc.h, doc.dpi), layouts = [];
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.fillStyle = "#ffffff";
    var rad = Z.dots(1.5, doc.dpi);
    roundRect(ctx, 0, 0, W, H, rad);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 0, 0, W, H, rad);
    ctx.clip();
    doc.elements.forEach(function (el) {
      var L;
      try { L = Z.layout(el, doc, rec); } catch (e) { L = { box: { x: 0, y: 0, w: 1, h: 1 }, err: e }; }
      layouts.push(L);
      if (el.hidden || L.err) return;
      ctx.save();
      ctx.fillStyle = "#111111";
      if (el.reverse) { ctx.globalCompositeOperation = "difference"; ctx.fillStyle = "#ffffff"; }
      drawEl(ctx, el, L);
      ctx.restore();
    });
    ctx.restore();
    if (opts.outline !== false) {
      ctx.lineWidth = 1 / s; ctx.strokeStyle = "rgba(0,0,0,.35)";
      roundRect(ctx, 0, 0, W, H, rad); ctx.stroke();
    }
    ctx.restore();
    return layouts;
  }

  G.R = { drawDoc: drawDoc };
})(window);
