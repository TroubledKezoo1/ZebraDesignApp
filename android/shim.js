/* ZebraApp for Android: the same web UI, but with no Python server.
   The editor talks to "/api/..." — this file answers those calls inside the app:
   settings and labels live in localStorage, printing goes over Bluetooth LE,
   Labelary is called directly, and a small updater looks for new releases on GitHub. */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { BleClient } from "@capacitor-community/bluetooth-le";
import { Browser } from "@capacitor/browser";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const VERSION = "__VERSION__";
const REPO = "TroubledKezoo1/ZebraDesignApp";
const SERVICE = "38eb4a80-c570-11e3-9507-0002a5d5c51b";
const WRITE = "38eb4a82-c570-11e3-9507-0002a5d5c51b";
const READ = "38eb4a81-c570-11e3-9507-0002a5d5c51b";
const realFetch = window.fetch.bind(window);
const ApkInstaller = registerPlugin("ApkInstaller");

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("zebraapp." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { localStorage.setItem("zebraapp." + k, JSON.stringify(v)); },
};
function config() {
  const c = Object.assign({ language: null, active: null, printers: [] }, store.get("config", {}));
  c.printers.forEach((p) => { if (!p.id) p.id = Math.random().toString(36).slice(2, 12); });
  if (c.printers.length && !c.printers.some((p) => p.id === c.active)) c.active = c.printers[0].id;
  return c;
}
function printerOf(id) { const c = config(); id = id || c.active; return c.printers.find((p) => p.id === id) || null; }

const T = { // the few messages the shim produces itself (Turkish first, English if the app language is en)
  noPrinter: ["Yazıcı seçilmedi. Yazıcılar bölümünden ekleyin.", "No printer selected. Add one under Printers."],
  onlyBle: ["Android sürümü yalnızca Bluetooth LE yazıcıları destekler.", "The Android app supports Bluetooth LE printers only."],
  nothing: ["Gönderilecek bir şey yok.", "Nothing to send."],
  notFound: ["Yazıcı Bluetooth'ta bulunamadı. Açık, yakında olmalı ve başka bir cihaza (ör. telefon) bağlı olmamalı.", "Printer not found over Bluetooth. It must be on, in range and not connected to another device."],
  noChar: ["Bu cihazda yazılabilir Bluetooth özelliği bulunamadı.", "No writable Bluetooth characteristic found on this device."],
  nlbl: ["NLBL alma/verme Android sürümünde yok (masaüstü uygulamasını kullanın).", "NLBL import/export is not in the Android app (use the desktop app)."],
  sent: ["%d bayt gönderildi: %s.", "Sent %d bytes to %s."],
  connected: ["Bağlandı: %s", "Connected: %s"],
  disconnected: ["Bağlantı kesildi.", "Disconnected."],
  btOff: ["Bluetooth kapalı. Açıp tekrar deneyin.", "Bluetooth is off. Turn it on and try again."],
  btPerm: ["Bluetooth izni verilmedi. Ayarlar > Uygulamalar > ZebraApp > İzinler > Yakındaki cihazlar'ı açın.", "Bluetooth permission was not granted. Settings > Apps > ZebraApp > Permissions > Nearby devices."],
  btFail: ["Tarama başarısız:", "Scan failed:"],
  noStatus: ["Yazıcı durum isteğine yanıt vermedi.", "The printer did not answer the status request."],
};
function tr(key, ...a) {
  const l = (config().language || "tr") === "en" ? 1 : 0;
  let i = 0; return T[key][l].replace(/%[ds]/g, () => a[i++]);
}
class AppErr extends Error {}

/* ---------- Bluetooth LE ---------- */
const ble = { id: null, name: "", write: null, read: null, noResp: false, ready: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function bleInit() {
  if (!ble.ready) ble.ready = BleClient.initialize({ androidNeverForLocation: true });
  return ble.ready;
}
const isZebra = (n) => /^(zebra|zd\d|zq\d|zt\d|gk\d|gx\d|zm\d)/i.test(n || "") || /zebra/i.test(n || "");
async function scan(seconds) {
  try {
    await bleInit();
    if (!(await BleClient.isEnabled())) {
      try { await BleClient.requestEnable(); } catch (e) { throw new AppErr(tr("btOff")); }
    }
  } catch (e) {
    if (e instanceof AppErr) throw e;
    throw new AppErr(tr("btPerm"));
  }
  const seen = new Map();
  try {
    await BleClient.requestLEScan({ allowDuplicates: false }, (r) => {
      const id = r.device.deviceId;
      const name = r.localName || r.device.name || "";
      const prev = seen.get(id);
      if (!prev || (name && !prev.name)) seen.set(id, { value: id, name, rssi: r.rssi });
    });
    await sleep(seconds * 1000);
  } catch (e) {
    throw new AppErr(/permission|denied|unauthor/i.test(String(e && e.message || e)) ? tr("btPerm") : tr("btFail") + " " + (e && e.message || e));
  } finally {
    try { await BleClient.stopLEScan(); } catch (e) { /* not scanning */ }
  }
  // Zebra printers first, then the other named devices (nearest first); nameless ones are left out
  const list = [...seen.values()].filter((d) => d.name).sort((a, b) => (isZebra(b.name) - isZebra(a.name)) || ((b.rssi || -999) - (a.rssi || -999)));
  return list.map((d) => ({ value: d.value, name: d.name, label: (isZebra(d.name) ? "★ " : "") + d.name + "  (" + d.value + ")" }));
}
async function bleConnect(p) {
  await bleInit();
  if (ble.id && (!p.address || ble.id.toUpperCase() === p.address.toUpperCase())) return ble.name;
  await bleDisconnect();
  let id = (p.address || "").trim();
  if (!id) {
    const prefix = (p.name_prefix || "").trim().toUpperCase();
    if (prefix) { const f = (await scan(8)).find((d) => d.name.toUpperCase().startsWith(prefix)); if (f) id = f.value; }
  }
  if (!id) throw new AppErr(tr("notFound"));
  try {
    await BleClient.connect(id, () => { ble.id = null; }, { timeout: 15000 });
  } catch (e) { throw new AppErr(tr("notFound") + " (" + (e && e.message || e) + ")"); }
  const want = (p.write_uuid || WRITE).toLowerCase();
  let w = null, fb = null, r = null;
  for (const s of await BleClient.getServices(id)) {
    for (const c of s.characteristics) {
      const u = c.uuid.toLowerCase();
      if (u === want) w = { s: s.uuid, c: c.uuid, p: c.properties };
      if (u === READ) r = { s: s.uuid, c: c.uuid, p: c.properties };
      if (!fb && (c.properties.write || c.properties.writeWithoutResponse)) fb = { s: s.uuid, c: c.uuid, p: c.properties };
    }
  }
  w = w || fb;
  if (!w) { await BleClient.disconnect(id); throw new AppErr(tr("noChar")); }
  ble.id = id; ble.write = w; ble.read = r; ble.noResp = !!w.p.writeWithoutResponse && !w.p.write;
  ble.name = (p.name && p.name !== "Zebra (Bluetooth)" ? p.name : "") || id;
  return ble.name;
}
async function bleDisconnect() {
  const id = ble.id; ble.id = null;
  if (id) { try { await BleClient.disconnect(id); } catch (e) { /* already gone */ } }
}
async function bleWrite(data) {
  let size = 20;
  try { size = Math.max(20, Math.min((await BleClient.getMtu(ble.id)) - 3, 180)); } catch (e) { /* keep 20 */ }
  const w = ble.write, fn = ble.noResp ? "writeWithoutResponse" : "write";
  for (let i = 0; i < data.length; i += size) {
    const chunk = data.slice(i, i + size);
    await BleClient[fn](ble.id, w.s, w.c, new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    await sleep(ble.noResp ? 12 : 4);
  }
  await sleep(300);
}
async function bleSend(p, text) {
  if (!text.trim()) throw new AppErr(tr("nothing"));
  if (p.transport !== "ble") throw new AppErr(tr("onlyBle"));
  await bleConnect(p);
  const bytes = new TextEncoder().encode(text);
  try { await bleWrite(bytes); }
  catch (e) { await bleDisconnect(); await bleConnect(p); await bleWrite(bytes); }   // one reconnect attempt
  return { bytes: bytes.length, name: ble.name };
}
async function bleStatus(p) {
  await bleConnect(p);
  if (!ble.read || !ble.read.p.notify) throw new AppErr(tr("noStatus"));
  let rx = new Uint8Array(0);
  await BleClient.startNotifications(ble.id, ble.read.s, ble.read.c, (v) => {
    const n = new Uint8Array(rx.length + v.byteLength); n.set(rx); n.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), rx.length); rx = n;
  });
  try { await bleWrite(new TextEncoder().encode("~HS")); await sleep(1500); }
  finally { try { await BleClient.stopNotifications(ble.id, ble.read.s, ble.read.c); } catch (e) { /* ignore */ } }
  const parts = new TextDecoder("latin1").decode(rx).replace(/\x02/g, "").split("\x03").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) throw new AppErr(tr("noStatus"));
  const a = parts[0].split(","), b = parts[1].split(","), f = (l, i) => (l[i] || "").trim() === "1";
  return { paper_out: f(a, 1), paused: f(a, 2), buffer_full: f(a, 5), under_temp: f(a, 10), over_temp: f(a, 11),
           head_open: f(b, 2), ribbon_out: f(b, 3), raw: parts.join(" ") };
}

/* ---------- Labelary (preview) ---------- */
async function labelary(d) {
  const dpmm = { 203: 8, 300: 12, 600: 24 }[+d.dpi || 300] || 12;
  const w = Math.min(15, Math.max(0.5, (+d.w || 80) / 25.4)), h = Math.min(15, Math.max(0.5, (+d.h || 40) / 25.4));
  try {
    const r = await realFetch("https://api.labelary.com/v1/printers/" + dpmm + "dpmm/labels/" + w.toFixed(2) + "x" + h.toFixed(2) + "/0/",
      { method: "POST", headers: { Accept: "image/png", "Content-Type": "application/x-www-form-urlencoded" }, body: String(d.zpl || "") });
    if (!r.ok) return { ok: false, message: "Labelary " + r.status + ": " + (await r.text()).slice(0, 200) };
    const buf = new Uint8Array(await r.arrayBuffer()); let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { ok: true, png: btoa(s) };
  } catch (e) { return { ok: false, message: "Labelary: " + e }; }
}

/* ---------- the /api router ---------- */
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
async function route(path, body) {
  const post = body !== undefined;
  const need = (p) => { if (!p) throw new AppErr(tr("noPrinter")); return p; };
  if (!post) {
    if (path === "/api/ping") return { ok: true };
    if (path === "/api/labels") return store.get("labels", []);
    if (path === "/api/templates") return store.get("templates", []);
    if (path === "/api/fonts") return { families: [] };
    if (path === "/api/settings") { const c = config(); return { version: VERSION, language: c.language, active: c.active, printers: c.printers,
      available: { ble: true, tcp: false, system: false, device: false, serial: false, command: false, platform: "android", android: true }, data_dir: "" }; }
    if (path === "/api/state") {
      const p = printerOf(), isBle = !!(p && p.transport === "ble");
      return { active: p ? p.id : null, transport: p ? p.transport : null, ble: isBle, connected: isBle && !!ble.id, name: ble.id ? ble.name : (p ? p.name : "") };
    }
    return null;
  }
  switch (path) {
    case "/api/labels": store.set("labels", body); return { ok: true };
    case "/api/templates": store.set("templates", body); return { ok: true };
    case "/api/settings": { const c = config(); ["language", "active", "printers"].forEach((k) => { if (k in body) c[k] = body[k]; }); store.set("config", { language: c.language, active: c.active, printers: c.printers }); return { ok: true }; }
    case "/api/print_raw": { const p = need(printerOf(body.printer)); const r = await bleSend(p, String(body.data || "")); return { ok: true, message: tr("sent", r.bytes, r.name) }; }
    case "/api/test_printer": { const r = await bleSend(body.printer || {}, String(body.data || "")); return { ok: true, message: tr("sent", r.bytes, r.name) }; }
    case "/api/status": return { ok: true, flags: await bleStatus(body.printer || need(printerOf(body.id))) };
    case "/api/discover": if (body.transport !== "ble") throw new AppErr(tr("onlyBle")); return { ok: true, items: await scan(6) };
    case "/api/connect": { const p = need(printerOf(body.printer)); if (p.transport !== "ble") throw new AppErr(tr("onlyBle")); return { ok: true, message: tr("connected", await bleConnect(p)) }; }
    case "/api/disconnect": await bleDisconnect(); return { ok: true, message: tr("disconnected") };
    case "/api/labelary": return labelary(body);
    case "/api/nlbl/import": case "/api/nlbl/export": return { ok: false, message: tr("nlbl") };
  }
  return null;
}
window.fetch = async function (input, init) {
  const url = typeof input === "string" ? input : input.url;
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  if (path.startsWith("/api/")) {
    let body; if (init && init.method === "POST") { try { body = JSON.parse(init.body || "{}"); } catch (e) { body = {}; } }
    try { const out = await route(path, body); if (out !== null) return json(out); return new Response("", { status: 404 }); }
    catch (e) { return json({ ok: false, message: e instanceof AppErr ? e.message : String(e && e.message || e) }); }
  }
  return realFetch(input, init);
};

/* ---------- saving files: the Android WebView cannot download blob links, so hand them to the share sheet ---------- */
const origClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  if (this.download && this.href.startsWith("blob:")) {
    const name = this.download;
    realFetch(this.href).then((r) => r.blob()).then((blob) => new Promise((res) => {
      const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob);
    })).then((b64) => Filesystem.writeFile({ path: name, data: b64, directory: Directory.Cache }))
      .then((f) => Share.share({ title: name, url: f.uri }))
      .catch((e) => { if (!/cancel/i.test(String(e && e.message || e))) console.error(e); });
    return;
  }
  return origClick.call(this);
};

/* ---------- updater ---------- */
const num = (v) => String(v).replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
function newer(a, b) { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
let lastCheck = 0, checking = false;
async function checkUpdate(manual) {
  if (checking || (!manual && Date.now() - lastCheck < 30000)) return null;   // at most every 30 s (GitHub's anonymous limit is 60/hour)
  checking = true; lastCheck = Date.now();
  try {
    const r = await realFetch("https://api.github.com/repos/" + REPO + "/releases/latest", { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!r.ok) return manual ? { state: "error" } : null;
    const rel = await r.json();
    if (!newer(rel.tag_name, VERSION)) return { state: "current" };
    const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
    if (!apk) return { state: "pending", version: rel.tag_name.replace(/^v/, "") };   // release exists, the APK is still being built
    if (!manual && store.get("skipVersion", "") === rel.tag_name) return { state: "skipped" };
    banner(rel.tag_name.replace(/^v/, ""), apk.browser_download_url, rel.html_url);
    return { state: "available", version: rel.tag_name.replace(/^v/, "") };
  } catch (e) { return manual ? { state: "error" } : null; }     // offline: no problem
  finally { checking = false; }
}
function banner(version, apkUrl, pageUrl) {
  const en = (config().language || "tr") === "en";
  const old = document.getElementById("zebra-update"); if (old) old.remove();
  const bar = document.createElement("div");
  bar.id = "zebra-update";
  bar.setAttribute("role", "status");
  bar.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#1F3A5F;color:#fff;padding:10px 12px;border-radius:10px;" +
    "font:14px/1.3 system-ui,sans-serif;display:flex;gap:8px;align-items:center;flex-wrap:wrap;box-shadow:0 4px 18px rgba(0,0,0,.35)";
  const t = document.createElement("span"); t.style.flex = "1 1 160px";
  const say = (txt) => { t.textContent = txt; };
  say(en ? "New version " + version + " is available (you have " + VERSION + ")." : "Yeni sürüm " + version + " yayınlandı (sizde " + VERSION + ").");
  const mk = (label, fn, primary) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn;
    b.style.cssText = "border:0;border-radius:8px;padding:8px 12px;font:inherit;" + (primary ? "background:#fff;color:#1F3A5F;font-weight:700" : "background:rgba(255,255,255,.18);color:#fff"); return b; };
  const row = [];
  let busy = false;
  const update = async () => {
    if (busy) return;
    if (!Capacitor.isNativePlatform()) { Browser.open({ url: apkUrl }); return; }
    try {
      if (!(await ApkInstaller.canInstall()).allowed) {
        say(en ? "Allow ZebraApp to install apps in the screen that opens, come back and press Update again."
               : "Açılan ekranda ZebraApp'e uygulama kurma izni verin, geri dönüp tekrar Güncelle'ye basın.");
        await ApkInstaller.openInstallSettings();
        return;
      }
      busy = true; upd.disabled = true;
      say(en ? "Downloading… 0%" : "İndiriliyor… %0");
      const h = await ApkInstaller.addListener("progress", (p) => {
        if (p.total > 0) say((en ? "Downloading… " : "İndiriliyor… %") + Math.round(100 * p.done / p.total) + (en ? "%" : ""));
      });
      try { await ApkInstaller.downloadAndInstall({ url: apkUrl }); } finally { h.remove(); }
      say(en ? "Installer opened. Tap Install, then open ZebraApp again." : "Kurulum ekranı açıldı. Kur'a dokunun, sonra ZebraApp'i yeniden açın.");
    } catch (e) {
      say((en ? "Could not update: " : "Güncellenemedi: ") + (e && e.message || e));
    } finally { busy = false; upd.disabled = false; }
  };
  const upd = mk(en ? "Update" : "Güncelle", update, true);
  bar.append(t, upd,
    mk(en ? "What's new" : "Neler yeni", () => Browser.open({ url: pageUrl })),
    mk(en ? "Later" : "Sonra", () => { bar.remove(); }),
    mk(en ? "Skip" : "Atla", () => { store.set("skipVersion", "v" + version); bar.remove(); }));
  document.body.appendChild(bar);
}
window.addEventListener("load", () => setTimeout(() => checkUpdate(false), 1500));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkUpdate(false); });

/* Options > "Check for updates" button (added here, the desktop page does not have it) */
function addUpdateButton() {
  const page = document.querySelector('.bspage[data-bp="options"]');
  if (!page || document.getElementById("zebra-upd-box")) return;
  const en = () => (config().language || "tr") === "en";
  const box = document.createElement("div"); box.id = "zebra-upd-box"; box.style.cssText = "margin-top:18px;display:grid;gap:6px;justify-items:start";
  const h = document.createElement("h3"); h.textContent = en() ? "App updates" : "Uygulama güncellemeleri";
  const ver = document.createElement("div"); ver.className = "note";
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "tb";
  const msg = document.createElement("div"); msg.className = "note";
  const paint = () => { ver.textContent = (en() ? "Installed version: " : "Kurulu sürüm: ") + VERSION; btn.textContent = en() ? "Check for updates" : "Güncellemeleri denetle"; };
  paint();
  btn.onclick = async () => {
    btn.disabled = true; msg.textContent = en() ? "Checking…" : "Denetleniyor…";
    const r = await checkUpdate(true) || { state: "error" };
    const t = {
      current: en() ? "You have the latest version." : "En son sürümü kullanıyorsunuz.",
      error: en() ? "Could not reach GitHub (is the internet on?)." : "GitHub'a ulaşılamadı (internet açık mı?).",
      pending: en() ? "Version " + r.version + " is being built. Try again in a few minutes." : "Sürüm " + r.version + " hazırlanıyor, birkaç dakika sonra tekrar deneyin.",
      available: en() ? "Version " + r.version + " is available (see the bar at the bottom)." : "Sürüm " + r.version + " var (alttaki çubuğa bakın).",
      skipped: "",
    }[r.state] || "";
    msg.textContent = t; btn.disabled = false;
  };
  box.append(h, ver, btn, msg); page.appendChild(box);
}
window.addEventListener("load", addUpdateButton);
window.ZebraAndroid = { version: VERSION, checkUpdate: () => checkUpdate(true) };
if (Capacitor.isNativePlatform()) document.documentElement.classList.add("android");
