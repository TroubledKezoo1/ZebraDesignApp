/* Extras on the Options page: accent colour, "What's new", backup and restore.
   The colour is applied at once (this script sits in <head>) so the page does not flash green. */
(function () {
  "use strict";
  var KEY = "zebraapp.theme", SEEN = "zebraapp.seenVersion";
  var THEMES = {
    green:  { tr: "Yeşil", en: "Green", dot: "#0f6b5c" },
    blue:   { tr: "Mavi", en: "Blue", dot: "#1f5fbf",
      l: "--accent:#1f5fbf;--accent-fg:#fff;--accent-soft:#dbe7f8;--accent-dk:#174a96", d: "--accent:#6aa7ff;--accent-fg:#071a33;--accent-soft:#1b2d4a;--accent-dk:#4a85d6" },
    orange: { tr: "Turuncu", en: "Orange", dot: "#b4540a",
      l: "--accent:#b4540a;--accent-fg:#fff;--accent-soft:#f8e3d2;--accent-dk:#8f4208", d: "--accent:#ffa24d;--accent-fg:#331a02;--accent-soft:#43301a;--accent-dk:#d9822b" },
    purple: { tr: "Mor", en: "Purple", dot: "#6b3fb0",
      l: "--accent:#6b3fb0;--accent-fg:#fff;--accent-soft:#e8def6;--accent-dk:#54308c", d: "--accent:#b995f0;--accent-fg:#1c0b36;--accent-soft:#35294f;--accent-dk:#946ad6" },
    slate:  { tr: "Gri", en: "Slate", dot: "#455a64",
      l: "--accent:#455a64;--accent-fg:#fff;--accent-soft:#dde3e6;--accent-dk:#34454c", d: "--accent:#90a4ae;--accent-fg:#10181c;--accent-soft:#2a353a;--accent-dk:#7a919c" },
    red:    { tr: "Kırmızı", en: "Red", dot: "#b3261e",
      l: "--accent:#b3261e;--accent-fg:#fff;--accent-soft:#f8dcd9;--accent-dk:#8c1d17", d: "--accent:#ff8a80;--accent-fg:#3a0a07;--accent-soft:#4a2523;--accent-dk:#e0655a" }
  };
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function lang() { return (window.I18N && window.I18N.lang) || get("zebraapp.lang") || "tr"; }
  function L(tr, en) { return lang() === "en" ? en : tr; }

  function applyTheme(name) {
    var t = THEMES[name], el = document.getElementById("zTheme");
    if (!t || !t.l) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("style"); el.id = "zTheme"; (document.head || document.documentElement).appendChild(el); }
    el.textContent = ":root{" + t.l + "}@media (prefers-color-scheme: dark){:root:not([data-theme=\"light\"]){" + t.d + "}}:root[data-theme=\"dark\"]{" + t.d + "}";
  }
  applyTheme(get(KEY) || "green");

  /* light / dark / follow the system */
  var MODE = "zebraapp.mode";
  function applyMode(m) {
    var root = document.documentElement;
    if (m === "light" || m === "dark") root.setAttribute("data-theme", m); else root.removeAttribute("data-theme");
  }
  applyMode(get(MODE));

  /* ---------- what's new ---------- */
  function notesFor(version) {
    return fetch("/static/whatsnew.json").then(function (r) { return r.json(); }).then(function (all) { return all[version] || null; }).catch(function () { return null; });
  }
  function showNews(version, notes) {
    var old = document.getElementById("zNews"); if (old) old.remove();
    var wrap = document.createElement("div"); wrap.id = "zNews"; wrap.setAttribute("role", "dialog");
    wrap.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:grid;place-items:center;padding:16px";
    var box = document.createElement("div");
    box.style.cssText = "background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:12px;max-width:440px;width:100%;max-height:85vh;overflow:auto;padding:18px 20px;box-shadow:0 12px 40px rgba(0,0,0,.4);font:14px/1.45 var(--ui)";
    var h = document.createElement("h2"); h.textContent = L("Yenilikler", "What's new") + " · " + version; h.style.cssText = "margin:0 0 10px;font-size:20px";
    var ul = document.createElement("ul"); ul.style.cssText = "margin:0 0 14px;padding-left:20px;display:grid;gap:6px";
    (notes[lang()] || notes.tr || []).forEach(function (n) { var li = document.createElement("li"); li.textContent = n; ul.appendChild(li); });
    var ok = document.createElement("button"); ok.type = "button"; ok.className = "tb primary"; ok.textContent = L("Tamam", "Got it");
    ok.style.cssText = "height:38px;padding:0 18px"; ok.onclick = function () { wrap.remove(); };
    wrap.addEventListener("click", function (e) { if (e.target === wrap) wrap.remove(); });
    box.append(h, ul, ok); wrap.appendChild(box); document.body.appendChild(wrap);
  }
  function currentVersion() { return fetch("/api/settings").then(function (r) { return r.json(); }).then(function (s) { return s.version; }).catch(function () { return null; }); }
  function maybeShowNews() {
    currentVersion().then(function (v) {
      if (!v || get(SEEN) === v) return;
      notesFor(v).then(function (n) { set(SEEN, v); if (n) showNews(v, n); });
    });
  }


  /* ---------- desktop updates (the Android app has its own updater in the shell) ---------- */
  var AUTO = "zebraapp.autoUpdate", SKIP = "zebraapp.skipUpdate";
  function isAndroid() { return !!window.ZebraAndroid; }
  function checkUpdate(force) {
    return fetch("/api/update" + (force ? "?force=1" : "")).then(function (r) { return r.json(); }).catch(function () { return { state: "error" }; });
  }
  function updateBar(r) {
    var old = document.getElementById("zUpdate"); if (old) old.remove();
    var bar = document.createElement("div"); bar.id = "zUpdate"; bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;left:12px;bottom:36px;z-index:99990;max-width:min(560px,calc(100vw - 24px));background:var(--accent);color:var(--accent-fg);padding:10px 12px;border-radius:10px;font:13px/1.35 var(--ui);display:flex;gap:8px;align-items:center;flex-wrap:wrap;box-shadow:0 6px 24px rgba(0,0,0,.3)";
    var t = document.createElement("span"); t.style.flex = "1 1 200px";
    t.textContent = L("Yeni sürüm " + r.latest + " yayınlandı (sizde " + r.current + ").", "Version " + r.latest + " is available (you have " + r.current + ").");
    function btn(label, fn, primary) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = fn;
      b.style.cssText = "border:0;border-radius:7px;padding:6px 11px;font:inherit;cursor:pointer;" + (primary ? "background:var(--accent-fg);color:var(--accent);font-weight:700" : "background:rgba(255,255,255,.2);color:inherit");
      return b;
    }
    var go = r.url || r.page;
    if (r.self_update) bar.append(t, btn(L("Şimdi güncelle", "Update now"), function () { installUpdate(bar, t, r); }, true));
    else bar.append(t);
    bar.append(
      btn(r.url ? L("İndir", "Download") : L("Sürüm sayfası", "Release page"), function () { window.open(go, "_blank", "noopener"); }, !r.self_update),
      btn(L("Sonra", "Later"), function () { bar.remove(); }),
      btn(L("Atla", "Skip"), function () { set(SKIP, r.latest); bar.remove(); }));
    if (!r.frozen) { var hint = document.createElement("small"); hint.style.cssText = "flex:1 0 100%;opacity:.9"; hint.textContent = L("Kaynaktan ya da pip ile kurduysan: pip install -U zebraapp", "Installed from source or pip? Run: pip install -U zebraapp"); bar.appendChild(hint); }
    document.body.appendChild(bar);
  }
  var UPD_ERR = {
    busy: ["Bir güncelleme zaten sürüyor.", "An update is already running."],
    unsupported: ["Bu kurulumda otomatik güncelleme yok.", "Automatic update is not available for this install."],
    source: ["İndirme adresi güvenilir değil, durduruldu.", "The download address is not trusted; stopped."],
    nosig: ["Sürümün imza dosyası yok ya da okunamadı, kurulmadı.", "The release has no readable signature; not installed."],
    badsig: ["Sürümün imzası geçersiz, kurulmadı. Güvenliğin için bu sürümü elle indirme.", "The release signature is invalid; not installed. Do not download this release by hand either."],
    nosum: ["Sürümün doğrulama dosyası bulunamadı, kurulmadı.", "The release has no checksum for this file; not installed."],
    sha: ["İndirilen dosya doğrulanamadı (SHA-256), kurulmadı.", "The downloaded file failed its SHA-256 check; not installed."],
    net: ["İndirme sırasında bağlantı koptu.", "The connection dropped while downloading."],
    write: ["Dosya yazılamadı (klasör izni?).", "Could not write the file (folder permission?)."],
    restart: ["Yeni sürüm kendiliğinden açılmadı; uygulamayı elle başlat.", "The new version did not open by itself; start the app again."]
  };
  function installUpdate(bar, t, r) {
    var btns = bar.querySelectorAll("button");
    function lock(on) { for (var i = 0; i < btns.length; i++) btns[i].disabled = on; }
    function fail(code) {
      lock(false); var m = UPD_ERR[code] || ["Güncellenemedi.", "The update failed."];
      t.textContent = L(m[0], m[1]) + " " + L("İndirme düğmesini kullanabilirsin.", "You can use the download button instead.");
    }
    function waitForNew() {
      t.textContent = L("Yeniden başlatılıyor…", "Restarting…");
      var n = 0;
      (function tick() {
        fetch("/api/settings").then(function (x) { return x.json(); }).then(function (s) { if (s.version === r.latest) location.reload(); else again(); }).catch(again);
        function again() { if (++n > 90) fail("restart"); else setTimeout(tick, 1000); }
      })();
    }
    function poll() {
      fetch("/api/update/progress").then(function (x) { return x.json(); }).then(function (p) {
        if (p.state === "error") return fail(p.code);
        if (p.state === "restarting") return waitForNew();
        if (p.state === "downloading") t.textContent = L("İndiriliyor… ", "Downloading… ") + (p.total ? Math.round(p.done * 100 / p.total) + " %" : Math.round(p.done / 1048576) + " MB");
        else if (p.state === "verifying") t.textContent = L("Doğrulanıyor (SHA-256)…", "Verifying (SHA-256)…");
        else if (p.state === "installing") t.textContent = L("Kuruluyor…", "Installing…");
        setTimeout(poll, 500);
      }).catch(waitForNew);
    }
    lock(true); t.textContent = L("Güncelleme başlıyor…", "Starting the update…");
    jpost("/api/update/install", {}).then(function (j) { if (j && j.ok) poll(); else fail(j && j.code); }).catch(function () { fail("net"); });
  }
  function autoCheckUpdate() {
    if (isAndroid() || get(AUTO) === "0") return;
    checkUpdate(false).then(function (r) { if (r.state === "available" && get(SKIP) !== r.latest) updateBar(r); });
  }
  function updateSection(box) {
    var h = document.createElement("h2"); h.textContent = L("Güncellemeler", "Updates");
    var ver = document.createElement("p"); ver.className = "note"; ver.style.margin = "0";
    currentVersion().then(function (v) { ver.textContent = L("Kurulu sürüm: ", "Installed version: ") + (v || "?"); });
    var msg = document.createElement("p"); msg.className = "note"; msg.style.margin = "0";
    var b = document.createElement("button"); b.type = "button"; b.className = "tb"; b.textContent = L("Güncellemeleri denetle", "Check for updates");
    b.onclick = function () {
      b.disabled = true; msg.textContent = L("Denetleniyor…", "Checking…");
      checkUpdate(true).then(function (r) {
        b.disabled = false;
        if (r.state === "error") msg.textContent = L("GitHub'a ulaşılamadı (internet açık mı?).", "Could not reach GitHub (is the internet on?).");
        else if (r.state === "current") msg.textContent = L("En son sürümü kullanıyorsunuz.", "You have the latest version.");
        else { msg.textContent = L("Sürüm " + r.latest + " var.", "Version " + r.latest + " is available."); updateBar(r); }
      });
    };
    var lab = document.createElement("label"); lab.style.cssText = "display:flex;gap:8px;align-items:center;font-weight:400";
    var cb = document.createElement("input"); cb.type = "checkbox"; cb.style.width = "auto"; cb.checked = get(AUTO) !== "0";
    cb.onchange = function () { set(AUTO, cb.checked ? "1" : "0"); };
    lab.append(cb, document.createTextNode(L("Açılışta yeni sürüm var mı diye bak (yalnızca GitHub'a tek bir istek gider)", "Look for a new version on start (one request to GitHub, nothing else is sent)")));
    box.append(h, ver, b, msg, lab);
  }

  /* ---------- backup / restore ---------- */
  function jget(url) { return fetch(url).then(function (r) { return r.json(); }); }
  function jpost(url, body) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-ZebraApp": "1" }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  function backup(msg) {
    Promise.all([jget("/api/labels"), jget("/api/templates")]).then(function (a) {
      var data = { format: "ZebraApp-backup", formatVersion: 1, date: new Date().toISOString(), labels: a[0], templates: a[1] };
      var name = "ZebraApp-yedek-" + new Date().toISOString().slice(0, 10) + ".json";
      var link = document.createElement("a"), url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
      link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      msg.textContent = L("Yedek hazır: ", "Backup ready: ") + name + " (" + a[0].length + " " + L("etiket", "labels") + ", " + a[1].length + " " + L("şablon", "templates") + ")";
    }).catch(function (e) { msg.textContent = String(e); });
  }
  function restore(file, msg) {
    var rd = new FileReader();
    rd.onload = function () {
      var data;
      try { data = JSON.parse(String(rd.result)); } catch (e) { msg.textContent = L("Dosya okunamadı.", "Could not read the file."); return; }
      if (!data || data.format !== "ZebraApp-backup" || !Array.isArray(data.labels) || !Array.isArray(data.templates)) {
        msg.textContent = L("Bu bir ZebraApp yedeği değil.", "This is not a ZebraApp backup."); return;
      }
      Promise.all([jget("/api/labels"), jget("/api/templates")]).then(function (cur) {
        var ids = {}; data.labels.forEach(function (l) { if (l && l.id) ids[l.id] = 1; });
        var labels = cur[0].filter(function (l) { return !(l && l.id && ids[l.id]); }).concat(data.labels);
        var seen = {}; cur[1].forEach(function (t) { seen[JSON.stringify(t)] = 1; });
        var templates = cur[1].concat(data.templates.filter(function (t) { return !seen[JSON.stringify(t)]; }));
        return jpost("/api/labels", labels).then(function () { return jpost("/api/templates", templates); }).then(function (r) {
          if (r && r.ok === false) throw new Error(r.message);
          msg.textContent = L("Yedek yüklendi, yenileniyor…", "Backup restored, reloading…");
          setTimeout(function () { location.reload(); }, 900);
        });
      }).catch(function (e) { msg.textContent = L("Yüklenemedi: ", "Could not restore: ") + (e && e.message || e); });
    };
    rd.readAsText(file, "utf-8");
  }

  /* ---------- the Options section ---------- */
  function build() {
    var page = document.querySelector('.bspage[data-bp="options"]'); if (!page) return;
    var old = document.getElementById("zExtras"); if (old) old.remove();
    var box = document.createElement("div"); box.id = "zExtras"; box.style.cssText = "display:grid;gap:10px;margin-top:6px;justify-items:start";
    var cur = get(KEY) || "green";

    var h1 = document.createElement("h2"); h1.textContent = L("Renk teması", "Colour theme");
    var chips = document.createElement("div"); chips.style.cssText = "display:flex;gap:10px;flex-wrap:wrap";
    Object.keys(THEMES).forEach(function (k) {
      var b = document.createElement("button"); b.type = "button"; b.title = THEMES[k][lang()] || THEMES[k].tr;
      b.setAttribute("aria-label", b.title); b.setAttribute("aria-pressed", String(k === cur));
      b.style.cssText = "width:40px;height:40px;border-radius:50%;cursor:pointer;background:" + THEMES[k].dot + ";border:3px solid " + (k === cur ? "var(--fg)" : "var(--line)");
      b.onclick = function () { set(KEY, k); applyTheme(k); build(); };
      chips.appendChild(b);
    });

    var hm = document.createElement("h2"); hm.textContent = L("Görünüm", "Appearance");
    var modes = document.createElement("div"); modes.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    var curMode = get(MODE) === "light" || get(MODE) === "dark" ? get(MODE) : "auto";
    [["auto", "Otomatik (sistem)", "Automatic (system)"], ["light", "Açık", "Light"], ["dark", "Koyu", "Dark"]].forEach(function (m) {
      var b = document.createElement("button"); b.type = "button"; b.className = "tb" + (m[0] === curMode ? " primary" : "");
      b.textContent = L(m[1], m[2]); b.setAttribute("aria-pressed", String(m[0] === curMode));
      b.onclick = function () { set(MODE, m[0]); applyMode(m[0]); build(); };
      modes.appendChild(b);
    });

    var h2 = document.createElement("h2"); h2.textContent = L("Yedek", "Backup");
    var note = document.createElement("p"); note.className = "note"; note.style.margin = "0";
    note.textContent = L("Kayıtlı etiketlerini ve şablonlarını tek dosyaya yedekle; başka bir telefona ya da bilgisayara yükle.", "Save your stored labels and templates in one file; restore it on another phone or computer.");
    var msg = document.createElement("p"); msg.className = "note"; msg.style.margin = "0";
    var row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    var b1 = document.createElement("button"); b1.type = "button"; b1.className = "tb"; b1.textContent = L("Yedekle", "Back up"); b1.onclick = function () { backup(msg); };
    var b2 = document.createElement("button"); b2.type = "button"; b2.className = "tb"; b2.textContent = L("Yedeği yükle", "Restore backup");
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json"; inp.hidden = true;
    inp.onchange = function () { if (inp.files[0]) restore(inp.files[0], msg); inp.value = ""; };
    b2.onclick = function () { inp.click(); };
    row.append(b1, b2, inp);

    var h3 = document.createElement("h2"); h3.textContent = L("Yenilikler", "What's new");
    var b3 = document.createElement("button"); b3.type = "button"; b3.className = "tb"; b3.textContent = L("Bu sürümde neler var?", "What's in this version?");
    b3.onclick = function () { currentVersion().then(function (v) { notesFor(v).then(function (n) { if (n) showNews(v, n); }); }); };

    box.append(hm, modes, h1, chips, h2, note, row, msg, h3, b3);
    if (!isAndroid()) updateSection(box);
    var anchor = page.querySelector(".optgrid");
    if (anchor && anchor.nextSibling) page.insertBefore(box, anchor.nextSibling); else page.appendChild(box);
  }

  document.addEventListener("DOMContentLoaded", function () {
    build();
    var sel = document.getElementById("langSel");
    if (sel) sel.addEventListener("change", function () { setTimeout(build, 50); });
    setTimeout(maybeShowNews, 1200);
    setTimeout(autoCheckUpdate, 3000);
  });
})();
