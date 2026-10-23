#!/usr/bin/env python3
"""Build the ZebraApp desktop app for the system you are running on.

    python packaging/build.py package     # app + installer-style file in dist/release/
    python packaging/build.py build       # only the PyInstaller output in dist/
    python packaging/build.py deps        # only create .venv and install what is needed
    python packaging/build.py test        # backend and ZPL tests
    python packaging/build.py clean

Needs Python 3.9+. A virtual environment (.venv) is created and filled automatically;
use --system-python to build with the interpreter that runs this script (CI does that).
Windows: dist/release/ZebraApp-<version>-windows-<x64|arm64>.exe
macOS:   dist/release/ZebraApp-<version>-macos-<x64|arm64>.dmg
Linux:   dist/release/ZebraApp-<version>-<x86_64|aarch64>.AppImage  (needs curl, downloads appimagetool)
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
        run(["hdiutil", "create", "-volname", "ZebraApp " + ver, "-srcfolder", stage, "-ov", "-format", "UDZO", dest])
    elif SYSTEM == "linux":
        env = dict(__import__("os").environ, ARCH=platform.machine())
        run(["sh", ROOT / "packaging" / "build-appimage.sh"], env=env)
        src = ROOT / "dist" / ("ZebraApp-%s-%s.AppImage" % (ver, platform.machine()))
        dest = out / src.name
        shutil.move(str(src), dest)
        dest.chmod(0o755)
    else:
        sys.exit("No packaging for this system.")
    print("\nReady:", dest)
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["package", "build", "deps", "test", "clean"])
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
    elif args.command == "deps":
        ensure_deps(args.system_python)
    else:
        py = ensure_deps(args.system_python)
        build(py)
        if args.command == "package":
            package()


if __name__ == "__main__":
    main()
