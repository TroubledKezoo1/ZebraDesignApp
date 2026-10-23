#!/usr/bin/env node
"use strict";
// Starts the ZebraApp desktop app. On the first run the app for this system is downloaded from
// the project's GitHub release, checked against that release's SHA256SUMS.txt and cached.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const cp = require("child_process");

const VERSION = require("../package.json").version;
const BASE = (process.env.ZEBRAAPP_DOWNLOAD_BASE ||
  `https://github.com/TroubledKezoo1/ZebraDesignApp/releases/download/v${VERSION}`).replace(/\/$/, "");

function fail(msg) {
  process.stderr.write(`zebraapp: ${msg}\n`);
  process.exit(1);
}

function asset() {
  const a = process.arch, p = process.platform;
  if (a !== "x64" && a !== "arm64") return null;
  if (p === "win32") return { name: `ZebraApp-${VERSION}-windows-${a}.exe`, kind: "exe" };
  if (p === "darwin") return { name: `ZebraApp-${VERSION}-macos-${a}.dmg`, kind: "dmg" };
  if (p === "linux") return { name: `ZebraApp-${VERSION}-${a === "x64" ? "x86_64" : "aarch64"}.AppImage`, kind: "appimage" };
  return null;
}

function cacheDir() {
  if (process.env.ZEBRAAPP_CACHE) return process.env.ZEBRAAPP_CACHE;
  let base;
  if (process.platform === "win32") base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  else if (process.platform === "darwin") base = path.join(os.homedir(), "Library", "Caches");
  else base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "zebraapp-npm", VERSION);
}

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const local = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url);
    if (!url.startsWith("https:") && !local) return reject(new Error("refusing a non-HTTPS download: " + url));
    (local ? http : https).get(url, { headers: { "User-Agent": "zebraapp-npm" } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (!redirects) return reject(new Error("too many redirects"));
        return resolve(get(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      resolve(res);
    }).on("error", reject);
  });
}

async function fetchText(url) {
  const res = await get(url);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function download(url, dest) {
  const res = await get(url);
  const total = Number(res.headers["content-length"]) || 0;
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(dest);
  let got = 0, last = 0;
  for await (const chunk of res) {
    hash.update(chunk);
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    if (total && process.stderr.isTTY && Date.now() - last > 250) {
      last = Date.now();
      process.stderr.write(`\r  ${(got / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`);
    }
  }
  await new Promise((r) => out.end(r));
  if (process.stderr.isTTY) process.stderr.write("\n");
  return hash.digest("hex");
}

function sumFor(text, name) {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/);
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return null;
}

async function ensure(a) {
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, a.kind === "dmg" ? "ZebraApp.app" : a.name);
  if (fs.existsSync(target)) return target;

  process.stderr.write(`ZebraApp ${VERSION}: first run, downloading ${a.name}\n`);
  const want = sumFor(await fetchText(`${BASE}/SHA256SUMS.txt`), a.name);
  if (!want) throw new Error(`${a.name} is not listed in SHA256SUMS.txt of this release`);
  const file = path.join(dir, a.name + ".download");
  const got = await download(`${BASE}/${a.name}`, file);
  if (got !== want) {
    fs.rmSync(file, { force: true });
    throw new Error(`checksum mismatch for ${a.name}; the download was discarded`);
  }
  if (a.kind === "dmg") {
    const mnt = fs.mkdtempSync(path.join(os.tmpdir(), "zebraapp-dmg-"));
    cp.execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-noverify", "-mountpoint", mnt, file], { stdio: "ignore" });
    try {
      cp.execFileSync("ditto", [path.join(mnt, "ZebraApp.app"), target]);
    } finally {
      cp.execFileSync("hdiutil", ["detach", "-force", mnt], { stdio: "ignore" });
      fs.rmSync(file, { force: true });
    }
  } else {
    fs.renameSync(file, target);
    if (a.kind === "appimage") fs.chmodSync(target, 0o755);
  }
  return target;
}

function hasFuse() {
  try {
    return /libfuse\.so\.2/.test(cp.execSync("ldconfig -p", { stdio: ["ignore", "pipe", "ignore"] }).toString());
  } catch (e) {
    return false;
  }
}

function launch(a, target) {
  const env = Object.assign({}, process.env);
  let cmd = target;
  if (a.kind === "dmg") cmd = path.join(target, "Contents", "MacOS", "ZebraApp");
  if (a.kind === "appimage" && !hasFuse()) env.APPIMAGE_EXTRACT_AND_RUN = "1";
  const child = cp.spawn(cmd, process.argv.slice(2), { stdio: "inherit", env });
  child.on("error", (e) => fail(`could not start ${cmd}: ${e.message}`));
  child.on("exit", (code, sig) => process.exit(code === null ? (sig ? 1 : 0) : code));
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
}

(async () => {
  const a = asset();
  if (!a) fail(`no ready-made app for ${process.platform}/${process.arch}. Install from source instead: pipx install zebraapp`);
  let target;
  try {
    target = await ensure(a);
  } catch (e) {
    fail(e.message);
  }
  launch(a, target);
})();
