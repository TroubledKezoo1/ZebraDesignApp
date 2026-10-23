/* node tests/js/test_zpl.js  — ZPL generator tests without a browser */
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const root = path.join(__dirname, "..", "..", "zebraapp", "static", "js");
global.window = global;
global.document = { createElement: () => ({ getContext: () => ({ font: "", measureText(s) { const m = /(\d+(?:\.\d+)?)px/.exec(this.font); return { width: s.length * (m ? +m[1] : 20) * 0.5 }; } }) }) };
for (const f of ["barcodes.js", "zpl.js", "zplimport.js"]) eval(fs.readFileSync(path.join(root, f), "utf8"));
const Z = global.Z, B = global.Barcodes;
let n = 0;
function test(name, fn) { fn(); n++; console.log("ok -", name); }

function decodeGFA(data, bpr) {
  const rows = []; let cur = "", prev = null, cnt = 0;
  for (const ch of data) {
    const o = ch.charCodeAt(0);
    if (o >= 71 && o <= 89) { cnt += o - 70; continue; }
    if (o >= 103 && o <= 122) { cnt += (o - 102) * 20; continue; }
    if (ch === ",") cur += "0".repeat(bpr * 2 - cur.length);
    else if (ch === "!") cur += "F".repeat(bpr * 2 - cur.length);
    else if (ch === ":") cur = prev;
    else cur += ch.repeat(cnt || 1);
    cnt = 0;
    if (cur.length >= bpr * 2) { assert.strictEqual(cur.length, bpr * 2); rows.push(cur); prev = cur; cur = ""; }
  }
  return rows;
}

test("Code 128 patterns are 11 modules (stop 13)", () => {
  B._C128.forEach((p, i) => assert.strictEqual([...p].reduce((a, b) => a + +b, 0), i === 106 ? 13 : 11));
});
test("EAN-13 check digit", () => {
  assert.strictEqual(B.encode("ean13", "590123412345").text, "5901234123457");
  assert.strictEqual(B.encode("ean13", "400638133393").text, "4006381333931");
});
test("GFA ASCII compression round-trips", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 60; t++) {
    const w = 8 + Math.floor(rnd() * 250), h = 1 + Math.floor(rnd() * 40), bpr = Math.ceil(w / 8);
    const bytes = new Uint8Array(bpr * h);
    for (let i = 0; i < bytes.length; i++) bytes[i] = t % 3 === 0 ? (rnd() < 0.5 ? 0 : 255) : (t % 3 === 1 ? rnd() * 256 | 0 : (i >= bpr && rnd() < 0.8 ? bytes[i - bpr] : rnd() * 256 | 0));
    const g = Z.gfa({ w, h, bpr, bytes }), m = /^\^GFA,(\d+),(\d+),(\d+),(.*)$/s.exec(g);
    assert.strictEqual(+m[1], bpr * h);
    const hex = []; for (let r = 0; r < h; r++) { let s = ""; for (let b = 0; b < bpr; b++) s += bytes[r * bpr + b].toString(16).toUpperCase().padStart(2, "0"); hex.push(s); }
    assert.deepStrictEqual(decodeGFA(m[4], bpr), hex);
  }
});
const doc = { w: 80, h: 40, dpi: 300, settings: { media: "gap", darkness: 15, speed: 4, shiftX: 0, shiftY: 0, rotate180: true }, elements: [
  { type: "text", x: 3, y: 2, size: 4, widthPct: 90, lineGap: 1.25, bold: true, align: "left", boxW: 0, text: "Seri {SAYAC}\nİkinci satır", rot: 0 },
  { type: "text", x: 0, y: 20, size: 5, bold: true, reverse: true, align: "center", boxW: 80, text: "TERS", rot: 0 },
  { type: "qr", x: 50, y: 2, mag: 5, ec: "Q", data: "https://example.com/{SAYAC}" },
  { type: "barcode", kind: "code128", x: 3, y: 28, h: 8, module: 2, ratio: 3, human: true, data: "ZB{SAYAC}", rot: 90 },
  { type: "line", x: 3, y: 15, dir: "h", len: 60, t: 0.3 },
  { type: "box", x: 1, y: 1, w: 78, h: 38, t: 0.5, round: 2 },
  { type: "text", x: 3, y: 3, size: 3, text: "gizli", hidden: true }
] };
test("header uses printer settings", () => {
  const z = Z.labelZPL(doc, { __counter: "7" }, 2);
  for (const s of ["^XA", "^CI28", "^MNY", "^PW945", "^LL472", "^POI", "^PR4", "~SD15", "^PQ2,0,1,Y", "^XZ"]) assert.ok(z.includes(s), s);
});
test("elements and variables", () => {
  const z = Z.labelZPL(doc, { __counter: "007" }, 1);
  assert.ok(z.includes("^FDSeri 007^FS"));
  assert.ok(z.includes("^FDİkinci satır^FS"));
  assert.ok(z.includes("^BQN,2,5^FDQA,https://example.com/007^FS"));
  assert.ok(/\^BCR,94,Y,N,N,A\^FDZB007\^FS/.test(z));
  assert.ok(z.includes("^GB709,4,4^FS"));
  assert.ok(z.includes("^GB921,449,6,B,2^FS"));
  assert.ok(!z.includes("gizli"), "hidden element is not printed");
  assert.strictEqual((z.match(/\^FDTERS\^FS/g) || []).length, 1, "reverse text is not double-struck");
  assert.ok(z.includes("^FB945,1,0,C,0^FR^FDTERS"));
  assert.strictEqual((z.match(/\^FDSeri 007\^FS/g) || []).length, 2, "bold text is double-struck");
});
test("records: counter and CSV", () => {
  const recs = Z.records({ count: 3, start: 9, step: 2, digits: 3 });
  assert.deepStrictEqual(recs.map((r) => r.__counter), ["009", "011", "013"]);
  const csv = Z.parseCSV('ad;adres\n"Örnek; Ltd";İstanbul\nB;"A ""x"""');
  assert.deepStrictEqual(csv.cols, ["ad", "adres"]);
  assert.strictEqual(csv.rows[0].ad, "Örnek; Ltd");
  assert.strictEqual(csv.rows[1].adres, 'A "x"');
  assert.strictEqual(Z.subst("{ad} - {yok}", csv.rows[0]), "Örnek; Ltd - {yok}");
  assert.strictEqual(Z.docZPL(doc, { rows: csv.rows, copies: 1 }).split("^XA").length - 1, 2);
});
test("special ZPL characters are stripped from data", () => {
  const z = Z.labelZPL({ w: 50, h: 30, dpi: 203, settings: {}, elements: [{ type: "text", x: 1, y: 1, size: 3, text: "a^b~c" }] }, {}, 1);
  assert.ok(z.includes("^FDabc^FS"));
});

test("ZPL import reads back what ZebraApp writes", () => {
  const z = Z.labelZPL(doc, { __counter: "7" }, 3);
  const r = Z.parseZPL(z, 300);
  assert.strictEqual(r.w, 80); assert.strictEqual(r.h, 40); assert.strictEqual(r.copies, 3);
  assert.strictEqual(r.settings.media, "gap"); assert.strictEqual(r.settings.darkness, 15); assert.strictEqual(r.settings.rotate180, true);
  const types = r.elements.map(e => e.type).join(",");
  assert.strictEqual(types, "text,text,qr,barcode,line,box", types);
  const t = r.elements[0];
  assert.strictEqual(t.text, "Seri 7\nİkinci satır"); assert.strictEqual(t.bold, true);
  assert.ok(Math.abs(t.x - 3) < 0.1 && Math.abs(t.y - 2) < 0.1 && Math.abs(t.size - 4) < 0.1, JSON.stringify(t));
  assert.strictEqual(r.elements[1].reverse, true); assert.strictEqual(r.elements[1].align, "center"); assert.ok(Math.abs(r.elements[1].boxW - 80) < 0.05);
  assert.strictEqual(r.elements[2].data, "https://example.com/7"); assert.strictEqual(r.elements[2].ec, "Q"); assert.strictEqual(r.elements[2].mag, 5);
  assert.strictEqual(r.elements[3].rot, 90); assert.strictEqual(r.elements[3].data, "ZB7"); assert.strictEqual(r.elements[3].module, 2);
  assert.strictEqual(r.elements[4].dir, "h"); assert.ok(Math.abs(r.elements[4].len - 60) < 0.1);
  assert.strictEqual(r.elements[5].round, 2); assert.deepStrictEqual(r.unsupported, []);
});
test("ZPL import: hand-written label, ^FT, ^FB, ^GD, ^FH, ^GFA and unknown commands", () => {
  const z = "^XA^PW812^LL406^CF0,40\n^FO20,20^FDMerhaba^FS\n^FT20,140^A0N,50,40^FDAlt^FS\n^FO20,160^FB400,3,0,C^FH^FDCaf_C3_A9\\&2. satir^FS\n" +
            "^FO300,20^GD100,50,4,B,L^FS\n^FO500,20^GFA,8,8,1,FF00FF00FF00FF00^FS\n^FO20,300^BY3^BCN,60,Y,N,N^FD>:ABC123^FS\n^FO0,0^XGR:LOGO.GRF^FS^XZ";
  assert.strictEqual(Z.guessDpi(z), 203);
  const r = Z.parseZPL(z, 203), e = r.elements;
  assert.strictEqual(e[0].text, "Merhaba"); assert.ok(Math.abs(e[0].size - 5) < 0.05);
  assert.ok(Math.abs(e[1].y - (140 - 50) * 25.4 / 203) < 0.05); assert.strictEqual(e[1].widthPct, 80);
  assert.strictEqual(e[2].text, "Café\n2. satir"); assert.strictEqual(e[2].align, "center"); assert.strictEqual(e[2].wrap, true);
  assert.strictEqual(e[3].type, "line"); assert.strictEqual(e[3].rot, 27);
  assert.strictEqual(e[4].type, "image"); assert.strictEqual(e[4].bmp.h, 8); assert.strictEqual(e[4].bmp.bits[0], 1); assert.strictEqual(e[4].bmp.bits[8], 0);
  assert.strictEqual(e[5].kind, "code128"); assert.strictEqual(e[5].data, "ABC123"); assert.strictEqual(e[5].module, 3);
  assert.ok(r.unsupported.indexOf("^XG") >= 0, r.unsupported.join());
  assert.strictEqual(Z.guessDpi("^XA^PW945^XZ"), 300);
});
test("free rotation lays out the bounding box and keeps 90° steps native", () => {
  const d = { w: 80, h: 40, dpi: 300, elements: [] };
  const box = { type: "box", x: 10, y: 10, w: 20, h: 10, t: 0.5, rot: 90 };
  assert.ok(Z.isNative(box)); const Lb = Z.layout(box, d, {}); assert.strictEqual(Lb.box.w, Z.dots(10, 300)); assert.strictEqual(Lb.box.h, Z.dots(20, 300));
  const z90 = Z.elementZPL(box, d, {}).join(""); assert.ok(z90.includes("^GB" + Z.dots(10, 300) + "," + Z.dots(20, 300)), z90);
  const tilt = Object.assign({}, box, { rot: 45 }); assert.ok(!Z.isNative(tilt));
  const L = Z.layout(tilt, d, {}); assert.ok(L.raster); assert.strictEqual(L.angle, 45);
  const exp = Math.ceil((Z.dots(20, 300) + Z.dots(10, 300)) * Math.SQRT1_2);
  assert.ok(Math.abs(L.box.w - exp) <= 1 && Math.abs(L.box.h - exp) <= 1, JSON.stringify(L.box));
  assert.ok(!Z.isNative({ type: "text", rot: 0, font: "DejaVu Sans" }));
  assert.strictEqual(Z.normRot(-90), 270); assert.strictEqual(Z.normRot(450), 90);
});
test("fit to box shrinks long text", () => {
  const d = { w: 80, h: 40, dpi: 300, elements: [] };
  const el = { type: "text", x: 0, y: 0, size: 6, widthPct: 90, lineGap: 1.25, boxW: 20, fit: true, text: "Çok uzun bir müşteri adı burada" };
  const L = Z.layout(el, d, {}); assert.ok(L.shrunk); assert.ok(Math.max(...L.widths) <= L.block + 0.5);
  const L2 = Z.layout(Object.assign({}, el, { fit: false }), d, {}); assert.ok(!L2.shrunk);
});

test("rich text: word formatting, justify, case and vertical align", () => {
  const d = { w: 80, h: 40, dpi: 300, elements: [] };
  const plain = { type: "text", x: 0, y: 0, size: 4, widthPct: 90, lineGap: 1.25, text: "abc", caseMode: "upper" };
  assert.ok(Z.isNative(plain)); assert.ok(Z.elementZPL(plain, d, {}).join("").includes("^FDABC^FS"));
  assert.strictEqual(Z.caseT("istanbul ılık", "upper"), "İSTANBUL ILIK");
  assert.strictEqual(Z.caseT("ÇOK GÜZEL iş", "title"), "Çok Güzel İş");
  const rich = Object.assign({}, plain, { caseMode: "", text: "Kalın ve normal", rich: [{ t: "Kalın", b: true, sz: 6 }, { t: " ve normal" }] });
  assert.ok(Z.textRaster(rich) && !Z.isNative(rich));
  const L = Z.layout(Object.assign({}, rich, { rot: 0 }), d, {}, true);
  assert.ok(L.rich); assert.strictEqual(L.rl.length, 1);
  const items = L.rl[0].items; assert.strictEqual(items[0].t, "Kalın"); assert.ok(items[0].st.h > items[2].st.h); assert.ok(items[0].st.fake);
  const j = Object.assign({}, plain, { caseMode: "", align: "justify", wrap: true, boxW: 30, text: "bir iki üç dört beş altı yedi sekiz dokuz on" });
  const LJ = Z.layout(j, d, {}, true), first = LJ.rl[0], last = first.items[first.items.length - 1];
  assert.ok(LJ.rl.length > 1); assert.ok(Math.abs(last.x + last.w - LJ.block) < 1, "justified line reaches the box edge");
  const v = Object.assign({}, plain, { boxH: 20, vAlign: "bottom" });
  const LV = Z.layout(v, d, {}); assert.ok(LV.vy > 0); assert.ok(Z.elementZPL(v, d, {}).join("").includes("^FO0," + LV.vy));
  const u = Object.assign({}, plain, { underline: true });
  assert.ok(!Z.isNative(u)); assert.ok(Z.layout(u, d, {}).raster);
});

console.log("\n" + n + " tests passed");
