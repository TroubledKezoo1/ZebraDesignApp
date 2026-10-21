/* node tests/js/test_zpl.js  — ZPL generator tests without a browser */
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const root = path.join(__dirname, "..", "..", "zebraapp", "static", "js");
global.window = global;
global.document = { createElement: () => ({ getContext: () => ({ font: "", measureText: (s) => ({ width: s.length * 10 }) }) }) };
for (const f of ["barcodes.js", "zpl.js"]) eval(fs.readFileSync(path.join(root, f), "utf8"));
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
console.log("\n" + n + " tests passed");
