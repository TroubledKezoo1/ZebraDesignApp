#!/usr/bin/env python3
"""Build the ZebraApp desktop app for the system you are running on.

    python packaging/build.py package     # app + installer-style file in dist/release/
    python packaging/build.py build       # only the PyInstaller output in dist/
    python packaging/build.py deb         # Linux: .deb from dist/zebraapp (package does this too)
    python packaging/build.py deps        # only create .venv and install what is needed
    python packaging/build.py test        # backend and ZPL tests
    python packaging/build.py clean

Needs Python 3.9+. A virtual environment (.venv) is created and filled automatically;
use --system-python to build with the interpreter that runs this script (CI does that).
Windows: dist/release/ZebraApp-<version>-windows-<x64|arm64>.exe
macOS:   dist/release/ZebraApp-<version>-macos-<x64|arm64>.dmg
Linux:   dist/release/ZebraApp-<version>-<x86_64|aarch64>.AppImage  (needs curl, downloads appimagetool)
         dist/release/zebraapp_<version>_<amd64|arm64>.deb          (needs dpkg-deb)
"""
import argparse
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYSTEM = {"Windows": "windows", "Darwin": "macos", "Linux": "linux"}.get(platform.system(), "other")
MACHINE = platform.machine().lower()
ARCH = "arm64" if MACHINE in ("arm64", "aarch64") else "x64"
VENV = ROOT / ".venv"


def version():
    m = re.search(r'__version__\s*=\s*"([^"]+)"', (ROOT / "zebraapp" / "__init__.py").read_text(encoding="utf-8"))
    return m.group(1)


def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], cwd=ROOT, check=True, **kw)


def venv_python():
    return VENV / ("Scripts/python.exe" if SYSTEM == "windows" else "bin/python")


def ensure_deps(system_python):
    if system_python:
        return Path(sys.executable)
    py = venv_python()
    if not py.exists():
        run([sys.executable, "-m", "venv", VENV])
    run([py, "-m", "pip", "install", "--upgrade", "pip"])
    run([py, "-m", "pip", "install", ".[all]", "pyinstaller"])
    return py


def build(py):
    for d in ("build", "dist"):
        shutil.rmtree(ROOT / d, ignore_errors=True)
    run([py, "-m", "PyInstaller", "--noconfirm", ROOT / "packaging" / "zebraapp.spec"])


DEB_ARCH = {"x86_64": "amd64", "aarch64": "arm64"}


def deb():
    """Debian/Ubuntu package: the PyInstaller folder under /opt/zebraapp, a launcher in /usr/bin and a menu entry."""
    ver, arch = version(), DEB_ARCH.get(platform.machine())
    if not arch or not shutil.which("dpkg-deb"):
        print("Skipping the .deb (needs dpkg-deb on x86_64 or aarch64).")
        return None
    root = ROOT / "build" / "deb" / "root"
    shutil.rmtree(root.parent, ignore_errors=True)
    shutil.copytree(ROOT / "dist" / "zebraapp", root / "opt" / "zebraapp", symlinks=True)
    (root / "usr" / "bin").mkdir(parents=True)
    (root / "usr" / "bin" / "zebraapp").symlink_to("/opt/zebraapp/zebraapp")
    apps = root / "usr" / "share" / "applications"
    apps.mkdir(parents=True)
    (apps / "zebraapp.desktop").write_text(
        "[Desktop Entry]\nType=Application\nName=ZebraApp\nComment=Label designer for Zebra / ZPL printers\n"
        "Exec=zebraapp\nIcon=zebraapp\nTerminal=false\nCategories=Office;Graphics;\nStartupWMClass=localhost\n", encoding="utf-8")
    icons = root / "usr" / "share" / "icons" / "hicolor" / "512x512" / "apps"
    icons.mkdir(parents=True)
    shutil.copy2(ROOT / "packaging" / "zebraapp.png", icons / "zebraapp.png")
    doc = root / "usr" / "share" / "doc" / "zebraapp"
    doc.mkdir(parents=True)
    shutil.copy2(ROOT / "LICENSE", doc / "copyright")
    size = sum(f.stat().st_size for f in root.rglob("*") if f.is_file() and not f.is_symlink()) // 1024
    ctl = root / "DEBIAN"
    ctl.mkdir()
    (ctl / "control").write_text(
        "Package: zebraapp\nVersion: %s\nSection: graphics\nPriority: optional\nArchitecture: %s\n"
        "Maintainer: Yunus Emre Sara\u00e7 <TroubledKezoo1@users.noreply.github.com>\nInstalled-Size: %d\n"
        "Depends: libc6 (>= 2.35)\nRecommends: chromium | chromium-browser | google-chrome-stable | microsoft-edge-stable\n"
        "Homepage: https://github.com/TroubledKezoo1/ZebraDesignApp\n"
        "Description: Label designer for Zebra / ZPL printers\n"
        " Design labels in a word-processor-like editor and print them over\n"
        " Bluetooth LE, network, USB or serial port. The editor opens in its own\n"
        " browser window.\n" % (ver, arch, size), encoding="utf-8")
    for d in [root, *[p for p in root.rglob("*") if p.is_dir()]]:
        d.chmod(0o755)
    out = ROOT / "dist" / "release"
    out.mkdir(parents=True, exist_ok=True)
    dest = out / ("zebraapp_%s_%s.deb" % (ver, arch))
    run(["dpkg-deb", "--root-owner-group", "--build", root, dest])
    print("Ready:", dest)
    return dest


def package():
    ver, out = version(), ROOT / "dist" / "release"
    out.mkdir(parents=True, exist_ok=True)
    if SYSTEM == "windows":
        dest = out / ("ZebraApp-%s-windows-%s.exe" % (ver, ARCH))
        shutil.copy2(ROOT / "dist" / "ZebraApp.exe", dest)
    elif SYSTEM == "macos":
        stage = ROOT / "build" / "dmg"
        shutil.rmtree(stage, ignore_errors=True)
        stage.mkdir(parents=True)
        run(["cp", "-R", ROOT / "dist" / "ZebraApp.app", stage])
        (stage / "Applications").symlink_to("/Applications")
        dest = out / ("ZebraApp-%s-macos-%s.dmg" % (ver, ARCH))
        for attempt in range(1, 4):   # hdiutil sometimes fails with "Resource busy" on the CI runners
            try:
                run(["hdiutil", "create", "-volname", "ZebraApp " + ver, "-srcfolder", stage, "-ov", "-format", "UDZO", dest])
                break
            except subprocess.CalledProcessError:
                if attempt == 3:
                    raise
                print("hdiutil failed (attempt %d), trying again" % attempt)
                __import__("time").sleep(10)
    elif SYSTEM == "linux":
        env = dict(__import__("os").environ, ARCH=platform.machine())
        run(["sh", ROOT / "packaging" / "build-appimage.sh"], env=env)
        src = ROOT / "dist" / ("ZebraApp-%s-%s.AppImage" % (ver, platform.machine()))
        dest = out / src.name
        shutil.move(str(src), dest)
        dest.chmod(0o755)
        deb()
    else:
        sys.exit("No packaging for this system.")
    print("\nReady:", dest)
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["package", "build", "deb", "deps", "test", "clean"])
    ap.add_argument("--system-python", action="store_true", help="no .venv; use this interpreter as it is")
    args = ap.parse_args()
    if args.command == "clean":
        for d in ("build", "dist"):
            shutil.rmtree(ROOT / d, ignore_errors=True)
    elif args.command == "test":
        run([sys.executable, ROOT / "packaging" / "run-tests.py"])
        if shutil.which("node"):
            run(["node", ROOT / "tests" / "js" / "test_zpl.js"])
        else:
            print("node not found: skipping the ZPL tests")
    elif args.command == "deb":
        deb()
    elif args.command == "deps":
        ensure_deps(args.system_python)
    else:
        py = ensure_deps(args.system_python)
        build(py)
        if args.command == "package":
            package()


if __name__ == "__main__":
    main()
