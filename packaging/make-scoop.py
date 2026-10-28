#!/usr/bin/env python3
"""Writes the Scoop manifest for a release.

    make-scoop.py <version> <ZebraApp-…-windows-x64.exe> <ZebraApp-…-windows-arm64.exe>   > zebraapp.json
"""
import hashlib
import json
import sys

BASE = "https://github.com/TroubledKezoo1/ZebraDesignApp/releases/download/v%s/ZebraApp-%s-windows-%s.exe"


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(version, x64, arm64):
    arch = lambda a, p: {"url": BASE % (version, version, a) + "#/ZebraApp.exe", "hash": sha(p)}
    manifest = {
        "version": version,
        "description": "Label designer for Zebra / ZPL printers (Bluetooth LE, network, USB)",
        "homepage": "https://github.com/TroubledKezoo1/ZebraDesignApp",
        "license": "MIT",
        "architecture": {"64bit": arch("x64", x64), "arm64": arch("arm64", arm64)},
        "bin": "ZebraApp.exe",
        "shortcuts": [["ZebraApp.exe", "ZebraApp"]],
        "checkver": "github",
        "autoupdate": {"architecture": {
            "64bit": {"url": "https://github.com/TroubledKezoo1/ZebraDesignApp/releases/download/v$version/ZebraApp-$version-windows-x64.exe#/ZebraApp.exe"},
            "arm64": {"url": "https://github.com/TroubledKezoo1/ZebraDesignApp/releases/download/v$version/ZebraApp-$version-windows-arm64.exe#/ZebraApp.exe"}}},
    }
    print(json.dumps(manifest, indent=4))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
