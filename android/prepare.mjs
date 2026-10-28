// Builds android/www from the desktop web UI: copies zebraapp/static, bundles shim.js, injects it into index.html.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const www = join(here, "www");
const version = /__version__\s*=\s*"([^"]+)"/.exec(readFileSync(join(root, "zebraapp", "__init__.py"), "utf8"))[1];

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(join(root, "zebraapp", "static"), join(www, "static"), { recursive: true });
cpSync(join(www, "static", "index.html"), join(www, "index.html"));
rmSync(join(www, "static", "index.html"));
cpSync(join(www, "static", "icon.svg"), join(www, "icon.svg"));

await build({
  entryPoints: [join(here, "shim.js")], bundle: true, minify: true, format: "iife", target: "es2020",
  outfile: join(www, "static", "js", "android-shim.js"),
  define: {}, banner: { js: "" },
  plugins: [{ name: "version", setup(b) {
    b.onLoad({ filter: /shim\.js$/ }, (a) => ({ contents: readFileSync(a.path, "utf8").replace("__VERSION__", version), loader: "js", resolveDir: here }));
  } }],
});

let html = readFileSync(join(www, "index.html"), "utf8");
const tag = '<script src="/static/js/android-shim.js"></script>';
const first = html.indexOf("<script");
html = html.slice(0, first) + tag + "\n" + html.slice(first);
html = html.replace("</head>", '<style>html.android body{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}</style>\n</head>');
writeFileSync(join(www, "index.html"), html);
console.log("android/www ready, version", version);
