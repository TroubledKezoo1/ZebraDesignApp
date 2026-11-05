"""Make .zebra and .nlbl files open in ZebraApp on double-click, like a word processor.

Downloaded apps (AppImage, Windows .exe) are not installed by a package manager, so on their first
start they register the file types for the current user only: no administrator rights, nothing outside
the user's own settings. It runs again only when the app has moved (a new path) or the version changed.
The .deb registers the same types system-wide; the macOS .app declares them in its Info.plist.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import __version__

MIME_ZEBRA = "application/x-zebraapp-label"
MIME_NLBL = "application/x-zebradesigner-label"
MIME_XML = """<?xml version="1.0" encoding="UTF-8"?>
<!-- File types ZebraApp opens from the file manager. -->
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="%s">
    <comment>ZebraApp label</comment>
    <comment xml:lang="tr">ZebraApp etiketi</comment>
    <glob pattern="*.zebra" weight="80"/>
  </mime-type>
  <mime-type type="%s">
    <comment>ZebraDesigner label</comment>
    <comment xml:lang="tr">ZebraDesigner etiketi</comment>
    <glob pattern="*.nlbl" weight="80"/>
  </mime-type>
</mime-info>
""" % (MIME_ZEBRA, MIME_NLBL)
DESKTOP_KEYS = "MimeType=%s;%s;\n" % (MIME_ZEBRA, MIME_NLBL)
ICON = Path(__file__).parent / "static" / "icon.svg"
SYSTEM_DESKTOP = Path("/usr/share/applications/zebraapp.desktop")     # written by the .deb


def desktop_entry(exec_cmd: str) -> str:
    return ("[Desktop Entry]\nType=Application\nName=ZebraApp\nComment=Label designer for Zebra / ZPL printers\n"
            "Exec=%s %%F\nIcon=zebraapp\nTerminal=false\nCategories=Office;Graphics;\nStartupWMClass=localhost\n"
            % exec_cmd) + DESKTOP_KEYS


def _quote_exec(path: str) -> str:
    """A path as one Exec= argument (Desktop Entry spec quoting)."""
    for ch in ("\\", '"', "`", "$"):
        path = path.replace(ch, "\\" + ch)
    return '"%s"' % path


def _run(cmd):
    exe = shutil.which(cmd[0])
    if not exe:
        return
    try:
        subprocess.run([exe] + cmd[1:], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    except (OSError, subprocess.SubprocessError):
        pass


def _linux(app_path: str, home: Path):
    if SYSTEM_DESKTOP.exists():
        return "deb"                                   # the .deb already registered everything
    share = Path(os.environ.get("XDG_DATA_HOME") or home / ".local" / "share")
    for sub in ("applications", "mime/packages", "icons/hicolor/scalable/apps"):
        (share / sub).mkdir(parents=True, exist_ok=True)
    (share / "applications" / "zebraapp.desktop").write_text(desktop_entry(_quote_exec(app_path)), encoding="utf-8")
    (share / "mime" / "packages" / "zebraapp.xml").write_text(MIME_XML, encoding="utf-8")
    if ICON.exists():
        shutil.copyfile(ICON, share / "icons" / "hicolor" / "scalable" / "apps" / "zebraapp.svg")
    _run(["update-mime-database", str(share / "mime")])
    _run(["update-desktop-database", str(share / "applications")])
    _run(["xdg-mime", "default", "zebraapp.desktop", MIME_ZEBRA, MIME_NLBL])
    return "linux"


def _windows(exe: str):
    import ctypes
    import winreg  # type: ignore
    progid = "ZebraApp.Label"
    root = winreg.HKEY_CURRENT_USER
    base = r"Software\Classes"
    with winreg.CreateKey(root, base + "\\" + progid) as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "ZebraApp label")
    with winreg.CreateKey(root, base + "\\" + progid + r"\DefaultIcon") as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, '"%s",0' % exe)
    with winreg.CreateKey(root, base + "\\" + progid + r"\shell\open\command") as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, '"%s" "%%1"' % exe)
    for ext in (".zebra", ".nlbl"):
        with winreg.CreateKey(root, base + "\\" + ext + r"\OpenWithProgids") as k:
            winreg.SetValueEx(k, progid, 0, winreg.REG_NONE, b"")
        # .zebra is ours. .nlbl belongs to ZebraDesigner: become its default only if nothing else is,
        # otherwise ZebraApp is just listed under "Open with".
        if ext == ".zebra" or not _windows_has_default(winreg, ext, progid):
            with winreg.CreateKey(root, base + "\\" + ext) as k:
                winreg.SetValueEx(k, "", 0, winreg.REG_SZ, progid)
    ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)     # SHCNE_ASSOCCHANGED
    return "windows"


def _windows_has_default(winreg, ext, progid):
    try:
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, ext) as k:
            value = winreg.QueryValueEx(k, "")[0]
            return bool(value) and value != progid
    except OSError:
        return False


def app_path():
    """Path of the downloaded app to register, or None when running from source / pip / the .deb."""
    if not getattr(sys, "frozen", False):
        return None
    if sys.platform.startswith("linux"):
        return os.environ.get("APPIMAGE") or None     # set by the AppImage runtime
    if sys.platform == "win32":
        return sys.executable
    return None                                       # macOS: Info.plist does it


def register(data_dir: Path, path=None, home=None):
    """Register once per app path and version. Returns what was done, or "" if nothing was needed."""
    path = path or app_path()
    if not path:
        return ""
    marker = Path(data_dir) / "file-types.json"
    want = {"path": str(path), "version": __version__}
    try:
        if json.loads(marker.read_text(encoding="utf-8")) == want:
            return ""
    except (OSError, ValueError):
        pass
    try:
        done = _windows(str(path)) if sys.platform == "win32" else _linux(str(path), Path(home or Path.home()))
    except Exception:  # noqa: BLE001  - never stop the app from starting over this
        return ""
    try:
        marker.write_text(json.dumps(want), encoding="utf-8")
    except OSError:
        pass
    return done
