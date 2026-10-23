/* ZPL -> ZebraApp belgesi. Yaygin komutlari duzenlenebilir ogelere cevirir; gerisini rapor eder.
   Z.parseZPL(text, dpi) -> { w, h, settings, copies, elements, unsupported, labels }
   Gorseller { type: "image", bmp: { w, h, bits } } olarak doner; editor bunlari PNG'ye cevirir. */
(function (G) {
  "use strict";

  var ORI = { N: 0, R: 90, I: 180, B: 270 };
  var SPEED = { A: 2, B: 3, C: 4, D: 6, E: 8 };
  var QUIET = ["XA", "XZ", "FS", "FX", "CI", "MM", "MT", "MD", "JU", "JM", "LR", "PM", "PF", "JZ", "JS", "MF", "SZ", "FN", "XB", "DF", "XF", "JC", "HH", "HS", "WC"];

  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function r2(n) { return Math.round(n * 100) / 100; }

  /* ^FH: _XX bicimindeki baytlari (UTF-8) coz */
  function unhex(s, ind) {
    var esc = (ind || "_").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("((?:" + esc + "[0-9A-Fa-f]{2})+)", "g");
    return s.replace(re, function (m) {
      var bytes = m.split(ind || "_").filter(Boolean).map(function (h) { return parseInt(h, 16); });
      try { return new TextDecoder("utf-8").decode(new Uint8Array(bytes)); } catch (e) { return String.fromCharCode.apply(null, bytes); }
    });
  }

  /* ^GFA veri alanini satirlara ac (ASCII hex + ZPL sikistirmasi) */
  function decodeGFA(data, bpr, rowsWanted) {
    var rows = [], cur = "", prev = "", cnt = 0, full = bpr * 2;
    data = String(data || "").replace(/\s+/g, "");
    for (var i = 0; i < data.length; i++) {
      var ch = data[i], o = ch.charCodeAt(0);
      if (o >= 71 && o <= 89) { cnt += o - 70; continue; }          /* G..Y = 1..19 */
      if (o >= 103 && o <= 122) { cnt += (o - 102) * 20; continue; } /* g..z = 20..400 */
      if (ch === ",") { cur += "0".repeat(Math.max(0, full - cur.length)); }
      else if (ch === "!") { cur += "F".repeat(Math.max(0, full - cur.length)); }
      else if (ch === ":") { cur = prev || "0".repeat(full); }
      else if (/[0-9A-Fa-f]/.test(ch)) { cur += ch.toUpperCase().repeat(cnt || 1); }
      cnt = 0;
      while (cur.length >= full) { var row = cur.slice(0, full); rows.push(row); prev = row; cur = cur.slice(full); }
      if (rows.length >= rowsWanted) break;
    }
    if (cur.length) rows.push((cur + "0".repeat(full)).slice(0, full));
    return rows;
  }

  function guessDpi(text) {
    var m = /\^PW\s*(\d+)/i.exec(text || "");
    if (!m) return 203;
    var pw = +m[1];
    if (pw * 25.4 / 203 <= 112) return 203;
    if (pw * 25.4 / 300 <= 172) return 300;
    return 600;
  }

  function parseZPL(text, dpi) {
    dpi = +dpi || 203;
    var mm = function (v) { return r2((+v || 0) * 25.4 / dpi); };
    text = String(text || "").replace(/\r/g, "");
    var labels = (text.match(/\^XA/gi) || []).length;
    var start = text.search(/\^XA/i), end = text.search(/\^XZ/i);
    var body = start >= 0 ? text.slice(start, end > start ? end + 3 : undefined) : text;
    var chunks = body.split(/(?=[\^~])/), out = { w: 0, h: 0, settings: {}, copies: 1, elements: [], unsupported: [], labels: Math.max(1, labels) };
    var unsup = {};
    var st = { lh: [0, 0], fo: null, ft: false, font: null, cf: { name: "0", h: 30, w: 0 }, fw: "N", by: { w: 2, r: 3, h: 10 },
      fb: null, fr: false, fh: null, pending: null, fd: null };

    function curFont() { return st.font || { name: st.cf.name, o: st.fw, h: st.cf.h, w: st.cf.w }; }
    function pos() { var p = st.fo || [0, 0]; return [p[0] + st.lh[0], p[1] + st.lh[1]]; }
    function push(el) { out.elements.push(el); }
    function finishField() {
      var p = pos(), data = st.fd;
      if (data != null && st.fh) data = unhex(data, st.fh);
      if (st.pending && data != null) {
        var pd = st.pending;
        if (pd.kind === "qr") {
          var m = /^([HQML])([AM]),?(.*)$/s.exec(data) || [null, "M", "A", data];
          push({ type: "qr", x: mm(p[0]), y: mm(p[1]), mag: Math.max(1, Math.min(10, pd.mag)), ec: m[1], data: m[3] });
        } else {
          var bd = data;
          if (pd.kind === "code128") bd = bd.replace(/>[0-9:;<=>]/g, "");
          if (pd.kind === "ean13") bd = bd.replace(/\D/g, "").slice(0, 12);
          if (pd.kind === "upca") { bd = ("0" + bd.replace(/\D/g, "")).slice(0, 12); pd.kind = "ean13"; }
          push({ type: "barcode", kind: pd.kind, x: mm(p[0]), y: mm(p[1] - (st.ft ? pd.h : 0)), h: mm(pd.h), module: st.by.w, ratio: Math.max(2, Math.min(3, st.by.r)),
            human: pd.human, humanAbove: pd.above, rot: ORI[pd.o] || 0, data: bd });
        }
      } else if (data != null && !st.pending) {
        var f = curFont(), h = Math.max(1, f.h || st.cf.h), w = f.w || 0;
        if (st.fb) data = data.replace(/\\&/g, "\n");
        var el = { type: "text", x: mm(p[0]), y: mm(p[1] - (st.ft ? h : 0)), size: mm(h), widthPct: w ? Math.max(30, Math.min(200, Math.round(w / h * 100))) : 90,
          lineGap: 1.25, bold: false, align: "left", boxW: 0, wrap: false, rot: ORI[f.o] || 0, reverse: st.fr, text: data };
        if (st.fb) {
          el.boxW = mm(st.fb.w); el.wrap = st.fb.lines > 1;
          el.align = { C: "center", R: "right" }[st.fb.j] || "left";
          if (st.fb.sp) el.lineGap = r2((h + st.fb.sp) / h);
        }
        if (f.name !== "0") unsup["^A" + f.name] = 1;
        push(el);
      }
      st.fo = null; st.ft = false; st.font = null; st.fb = null; st.fr = false; st.fh = null; st.pending = null; st.fd = null;
    }

    chunks.forEach(function (ch) {
      if (!ch || (ch[0] !== "^" && ch[0] !== "~")) return;
      var pre = ch[0], cmd = ch.substr(1, 2).toUpperCase(), rest = ch.slice(3);
      if (cmd !== "FD" && cmd !== "FV") rest = rest.replace(/\s+$/, "");
      if (cmd[0] === "A" && cmd !== "A@") {  /* ^A0N,30,30 -> yazi tipi '0', parametreler 'N,30,30' */
        var fp = (ch.slice(2)).split(",");
        var fname = ch[2] || "0", o = (fp[0] || "").slice(1, 2).toUpperCase() || st.fw;
        st.font = { name: fname.toUpperCase(), o: ORI[o] != null ? o : st.fw, h: num(fp[1], st.cf.h), w: num(fp[2], 0) };
        return;
      }
      var a = rest.split(",");
      switch (pre + cmd) {
        case "^FO": case "^FT": st.fo = [num(a[0], 0), num(a[1], 0)]; st.ft = cmd === "FT"; break;
        case "^LH": st.lh = [num(a[0], 0), num(a[1], 0)]; break;
        case "^PW": out.w = Math.round(mm(num(a[0], 0)) * 10) / 10; break;
        case "^LL": out.h = Math.round(mm(num(a[0], 0)) * 10) / 10; break;
        case "^CF": st.cf = { name: (a[0] || "0").toUpperCase() || "0", h: num(a[1], st.cf.h), w: num(a[2], num(a[1], st.cf.h)) }; break;
        case "^FW": st.fw = (a[0] || "N").toUpperCase(); break;
        case "^BY": st.by = { w: Math.max(1, Math.min(10, num(a[0], 2))), r: num(a[1], 3), h: num(a[2], st.by.h) }; break;
        case "^FB": st.fb = { w: num(a[0], 0), lines: num(a[1], 1), sp: num(a[2], 0), j: (a[3] || "L").toUpperCase() }; break;
        case "^FR": st.fr = true; break;
        case "^FH": st.fh = rest ? rest[0] : "_"; break;
        case "^FD": case "^FV": st.fd = rest.replace(/\n+$/, ""); break;
        case "^FS": finishField(); break;
        case "^BC": st.pending = { kind: "code128", o: (a[0] || st.fw).toUpperCase(), h: num(a[1], st.by.h), human: (a[2] || "Y").toUpperCase() !== "N", above: (a[3] || "N").toUpperCase() === "Y" }; break;
        case "^B3": st.pending = { kind: "code39", o: (a[0] || st.fw).toUpperCase(), h: num(a[2], st.by.h), human: (a[3] || "Y").toUpperCase() !== "N", above: (a[4] || "N").toUpperCase() === "Y" }; break;
        case "^BE": st.pending = { kind: "ean13", o: (a[0] || st.fw).toUpperCase(), h: num(a[1], st.by.h), human: (a[2] || "Y").toUpperCase() !== "N", above: (a[3] || "N").toUpperCase() === "Y" }; break;
        case "^BU": st.pending = { kind: "upca", o: (a[0] || st.fw).toUpperCase(), h: num(a[1], st.by.h), human: (a[2] || "Y").toUpperCase() !== "N", above: (a[3] || "N").toUpperCase() === "Y" }; break;
        case "^BQ": st.pending = { kind: "qr", mag: num(a[2], 2) }; break;
        case "^GB": {
          var p = pos(), w = num(a[0], 1), h = num(a[1], 1), t = num(a[2], 1), color = (a[3] || "B").toUpperCase(), rr = num(a[4], 0);
          w = Math.max(w, t); h = Math.max(h, t);
          if (color === "W") unsup["^GB (beyaz)"] = 1;
          if (h <= t) push({ type: "line", x: mm(p[0]), y: mm(p[1]), dir: "h", len: mm(w), t: mm(h) });
          else if (w <= t) push({ type: "line", x: mm(p[0]), y: mm(p[1]), dir: "v", len: mm(h), t: mm(w) });
          else push({ type: "box", x: mm(p[0]), y: mm(p[1]), w: mm(w), h: mm(h), t: mm(t), filled: t * 2 >= Math.min(w, h), round: Math.max(0, Math.min(8, rr)), reverse: st.fr });
          break;
        }
        case "^GE": case "^GC": {
          var pe = pos(), ew = num(a[0], 1), eh = cmd === "GC" ? ew : num(a[1], 1), et = num(cmd === "GC" ? a[1] : a[2], 1);
          push({ type: "ellipse", x: mm(pe[0]), y: mm(pe[1]), w: mm(ew), h: mm(eh), t: mm(et), filled: et * 2 >= Math.min(ew, eh), reverse: st.fr });
          break;
        }
        case "^GD": {
          var pg = pos(), gw = num(a[0], 1), gh = num(a[1], 1), gt = num(a[2], 1), lean = (a[4] || "R").toUpperCase();
          var deg = Math.atan2(gh, gw) * 180 / Math.PI, len = Math.sqrt(gw * gw + gh * gh);
          push({ type: "line", x: mm(pg[0]), y: mm(pg[1]), dir: "h", len: mm(len), t: mm(gt), rot: Math.round(lean === "L" ? deg : 360 - deg) % 360 });
          break;
        }
        case "^GF": {
          var fmt = (a[0] || "A").toUpperCase(), total = num(a[2], 0), bpr = num(a[3], 0);
          if (fmt !== "A" || !bpr) { unsup["^GF" + fmt] = 1; break; }
          var data = a.slice(4).join(","), nrows = Math.max(1, Math.round(total / bpr)), rows = decodeGFA(data, bpr, nrows);
          var bw = bpr * 8, bits = new Uint8Array(bw * rows.length);
          rows.forEach(function (row, y) {
            for (var b = 0; b < bpr; b++) {
              var v = parseInt(row.substr(b * 2, 2), 16) || 0;
              for (var k = 0; k < 8; k++) if (v & (0x80 >> k)) bits[y * bw + b * 8 + k] = 1;
            }
          });
          var pi = pos();
          push({ type: "image", x: mm(pi[0]), y: mm(pi[1]), w: mm(bw), h: mm(rows.length), threshold: 128, dither: false, invert: false, keepAspect: true, rot: 0,
            bmp: { w: bw, h: rows.length, bits: bits } });
          break;
        }
        case "^MN": out.settings.media = { Y: "gap", N: "continuous", M: "mark", W: "gap", A: "gap" }[(a[0] || "Y").toUpperCase()] || "gap"; break;
        case "^PR": { var sp = (a[0] || "").toUpperCase(); out.settings.speed = SPEED[sp] || (num(sp, 0) || ""); break; }
        case "~SD": out.settings.darkness = Math.max(0, Math.min(30, num(rest, 15))); break;
        case "^MD": break;
        case "^PO": out.settings.rotate180 = (a[0] || "N").toUpperCase() === "I"; break;
        case "^LS": out.settings.shiftX = mm(num(a[0], 0)); break;
        case "^LT": out.settings.shiftY = mm(num(a[0], 0)); break;
        case "^PQ": out.copies = Math.max(1, num(a[0], 1)); break;
        default:
          if (QUIET.indexOf(cmd) < 0) unsup[pre + cmd] = 1;
      }
    });

    /* ZebraApp kalin yaziyi iki kez, biraz kaydirarak basar: geri birlestir */
    var els = out.elements, merged = [];
    for (var i = 0; i < els.length; i++) {
      var e = els[i], n = els[i + 1];
      if (e.type === "text" && n && n.type === "text" && n.text === e.text && n.size === e.size && n.rot === e.rot &&
          Math.abs(n.x - e.x) + Math.abs(n.y - e.y) > 0 && Math.abs(n.x - e.x) <= e.size * 0.08 && Math.abs(n.y - e.y) <= e.size * 0.08) {
        e.bold = true; i++;
      }
      merged.push(e);
    }
    /* ZebraApp cok satirli metni satir satir yazar: ayni hizadaki ardisik satirlari birlestir */
    var joined = [];
    merged.forEach(function (e) {
      var last = joined[joined.length - 1];
      if (e.type === "text" && last && last.type === "text" && !last.boxW && !e.boxW && last.rot === 0 && e.rot === 0 &&
          last.size === e.size && last.bold === e.bold && last.reverse === e.reverse && Math.abs(last.x - e.x) < 0.2) {
        var lines = last.text.split("\n").length, step = (e.y - last.y) / lines;
        if (step > e.size * 0.95 && step < e.size * 2.2) {
          if (lines === 1) last.lineGap = r2(step / e.size);
          if (Math.abs(step / e.size - last.lineGap) < 0.08) { last.text += "\n" + e.text; return; }
        }
      }
      joined.push(e);
    });
    out.elements = joined;

    if (!out.w || !out.h) {
      var mx = 10, my = 10;
      out.elements.forEach(function (e) { mx = Math.max(mx, (e.x || 0) + (e.w || e.len || e.size * 4 || 10)); my = Math.max(my, (e.y || 0) + (e.h || e.size || 5)); });
      if (!out.w) out.w = Math.ceil(mx + 2);
      if (!out.h) out.h = Math.ceil(my + 2);
    }
    out.unsupported = Object.keys(unsup);
    return out;
  }

  G.Z = G.Z || {};
  G.Z.parseZPL = parseZPL;
  G.Z.guessDpi = guessDpi;
  G.Z.decodeGFA = decodeGFA;
})(window);
