/* Node regression tests for the real PDF picker/import flow, without a printer. */
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../../zebraapp/static/js/editor.js"), "utf8");
const block = source.slice(source.indexOf("  /* ---------- PDF:"), source.indexOf("  /* ZebraDesigner'in bilmedigi"));
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const controls = [], calls = [], opened = [], recent = [];
  const context = {
    MAX_FILE: 20 * 1024 * 1024, inApp: false, dirty: false, fileHandle: {name: "old.zebra"},
    __: s => s, r2: n => Math.round(n * 100) / 100,
    activePrinter: () => ({dpi: 300}), toB64: b => Buffer.from(b).toString("base64"),
    document: {createTextNode: s => s},
    h(tag, attrs = {}, kids = []) {
      const element = {tag, attrs, children: kids, value: "", appendChild(e) { this.children.push(e); }};
      controls.push(element); return element;
    },
    openModal(title, nodes) { context.pdfOpenId++; context.modal = {title, nodes}; },
    closeModal() { context.pdfOpenId++; },
    checkDoc(label) { assert.equal(label.w, 80); },
    loadDoc(label, handle) { opened.push(label); context.fileHandle = handle || null; },
    updateTitle() {}, status(s) { context.message = s; }, Recent: {add: hd => recent.push(hd)},
    api(url, body) {
      calls.push({url, body});
      if (url.endsWith("info")) return Promise.resolve({ok: true, pages: [{page: 1, w: 80, h: 40}, {page: 2, w: 60, h: 80}]});
      return context.render ? context.render() : Promise.resolve({ok: true, label: {w: 80, name: "Imported"}});
    }
  };
  vm.createContext(context); vm.runInContext(block, context);
  const file = {name: "ECN-example.PDF", size: 10, arrayBuffer: async () => new Uint8Array([1, 2]).buffer};
  const button = () => controls.find(e => e.tag === "button");
  return {context, controls, calls, opened, recent, file, button};
}
(async () => {
  let t = setup();
  assert(t.context.isPdf("LABEL.PDF")); assert(!t.context.isPdf("label.pdf.zebra"));
  const original = {name: t.file.name};
  await t.context.importPdf(t.file, original);
  assert.equal(t.opened.length, 0, "Choosing a PDF must not discard the current label before rendering succeeds");
  const selects = t.controls.filter(e => e.tag === "select");
  assert.equal(selects[1].value, "300");
  selects[0].value = "2"; selects[1].value = "600";
  t.button().attrs.onclick(); t.button().attrs.onclick(); await settle();
  assert.equal(t.calls.filter(c => c.url.endsWith("import")).length, 1, "Double click must not render twice");
  assert.equal(t.calls[1].body.page, 2); assert.equal(t.calls[1].body.dpi, 600);
  assert.equal(t.opened.length, 1); assert(t.context.dirty);
  assert.equal(t.context.fileHandle, null, "Save must ask for a new .zebra file, never overwrite the PDF");
  assert.equal(t.recent[0], original);
  assert(!t.calls.some(c => c.url.includes("print")), "Opening PDF must never print automatically");

  t = setup(); t.context.render = () => Promise.resolve({ok: false, message: "Bad PDF"});
  await t.context.importPdf(t.file); t.button().attrs.onclick(); await settle();
  assert.equal(t.opened.length, 0); assert.equal(t.context.fileHandle.name, "old.zebra");
  assert(!t.context.dirty); assert.equal(t.button().disabled, false);

  t = setup(); let finish;
  t.context.render = () => new Promise(resolve => { finish = resolve; });
  await t.context.importPdf(t.file); t.button().attrs.onclick(); t.context.closeModal();
  finish({ok: true, label: {w: 80}}); await settle();
  assert.equal(t.opened.length, 0, "Closing the dialog must cancel a late result");

  t = setup(); t.context.inApp = true;
  await assert.rejects(t.context.importPdf(t.file), /Android/);
  assert.equal(t.calls.length, 0);
  t = setup(); t.file.size = t.context.MAX_FILE + 1;
  await assert.rejects(t.context.importPdf(t.file), /20 MB/);
  assert.equal(t.calls.length, 0);

  // The File System Access path needs only read permission on source PDFs.
  t = setup();
  Object.assign(t.context, {loadFromText() { throw Error("PDF must not be read as text"); },
    isNlbl: () => false, Recent: {add() {}, remove() {}},
    readNlbl() { throw Error("PDF must not be read as NLBL"); }});
  vm.runInContext(source.slice(source.indexOf("  function openHandle("), source.indexOf("  /* sunucudan gelen etiket nesnesi")), t.context);
  let permission;
  await t.context.openHandle({name: "sample.pdf", requestPermission: async opts => {permission = opts.mode; return "granted";}, getFile: async () => t.file});
  assert.equal(permission, "read"); assert(t.context.modal);
  console.log("OK: PDF page/dpi selection, FS/fallback routing, new-file save, cancellation, errors and no automatic printing.");
})().catch(e => {console.error(e); process.exitCode = 1;});
