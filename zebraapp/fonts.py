"""List the font families installed on this computer, for the font picker.

The editor draws text with these fonts on a canvas and sends it to the
printer as a bitmap, so any installed font works. Nothing is downloaded.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

_cache: list[str] | None = None


def _fc_list() -> list[str]:
    exe = shutil.which("fc-list")
    if not exe:
        return []
    try:
        out = subprocess.run([exe, ":", "family"], capture_output=True, text=True, timeout=8).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    names = set()
    for line in out.splitlines():
        # "DejaVu Sans,DejaVu Sans Condensed" -> first name is the family
        first = line.split(",")[0].strip().replace("\\-", "-")
        if first and not first.startswith("."):
            names.add(first)
    return sorted(names)


def _windows() -> list[str]:
    names = set()
    try:
        import winreg  # type: ignore
        for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                key = winreg.OpenKey(root, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts")
            except OSError:
                continue
            i = 0
            while True:
                try:
                    name = winreg.EnumValue(key, i)[0]
                except OSError:
                    break
                i += 1
                name = name.split(" (")[0]
                for suffix in (" Bold Italic", " Bold", " Italic", " Light", " Semibold", " Black", " Regular"):
                    if name.endswith(suffix):
                        name = name[: -len(suffix)]
                if " & " in name:
                    names.update(part.strip() for part in name.split(" & "))
                elif name:
                    names.add(name.strip())
    except ImportError:
        pass
    return sorted(names)


def _mac_files() -> list[str]:
    names = set()
    for d in ("/System/Library/Fonts", "/Library/Fonts", str(Path.home() / "Library" / "Fonts")):
        try:
            for f in os.listdir(d):
                if f.lower().endswith((".ttf", ".otf", ".ttc")):
                    stem = f.rsplit(".", 1)[0]
                    for suffix in ("-Bold", "-Regular", "-Italic", " Bold", " Italic"):
                        stem = stem.replace(suffix, "")
                    names.add(stem)
        except OSError:
            pass
    return sorted(names)


def families() -> list[str]:
    """Installed font family names (may be empty; the editor has its own fallback list)."""
    global _cache
    if _cache is not None:
        return _cache
    found = _fc_list()
    if not found and sys.platform == "win32":
        found = _windows()
    if not found and sys.platform == "darwin":
        found = _mac_files()
    _cache = found[:600]
    return _cache
