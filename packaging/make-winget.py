#!/usr/bin/env python3
"""Writes the three winget manifest files for a release into a folder.

    make-winget.py <version> <ZebraApp-…-windows-x64.exe> <ZebraApp-…-windows-arm64.exe> <outdir>

The first submission to microsoft/winget-pkgs is done by hand (see docs/DISTRIBUTION.md);
later versions can be sent with `wingetcreate update` or komac.
"""
import hashlib
import os
import sys

ID = "TroubledKezoo1.ZebraApp"
URL = "https://github.com/TroubledKezoo1/ZebraDesignApp/releases/download/v%s/ZebraApp-%s-windows-%s.exe"
SCHEMA = "1.6.0"


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest().upper()


def main(version, x64, arm64, out):
    os.makedirs(out, exist_ok=True)
    head = "PackageIdentifier: %s\nPackageVersion: %s\n" % (ID, version)

    def write(name, text):
        with open(os.path.join(out, "%s.%s" % (ID, name)), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)

    write("yaml", "# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.%s.schema.json\n%sDefaultLocale: en-US\nManifestType: version\nManifestVersion: %s\n" % (SCHEMA, head, SCHEMA))
    write("installer.yaml", """# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.%(s)s.schema.json
%(head)sInstallerType: portable
Commands:
- zebraapp
Installers:
- Architecture: x64
  InstallerUrl: %(u1)s
  InstallerSha256: %(h1)s
- Architecture: arm64
  InstallerUrl: %(u2)s
  InstallerSha256: %(h2)s
ManifestType: installer
ManifestVersion: %(s)s
""" % {"s": SCHEMA, "head": head, "u1": URL % (version, version, "x64"), "h1": sha(x64), "u2": URL % (version, version, "arm64"), "h2": sha(arm64)})
    write("locale.en-US.yaml", """# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.%(s)s.schema.json
%(head)sPackageLocale: en-US
Publisher: TroubledKezoo1
PublisherUrl: https://github.com/TroubledKezoo1
PackageName: ZebraApp
PackageUrl: https://github.com/TroubledKezoo1/ZebraDesignApp
License: MIT
LicenseUrl: https://github.com/TroubledKezoo1/ZebraDesignApp/blob/main/LICENSE
ShortDescription: Label designer for Zebra and other ZPL printers
Description: Open-source label designer with Word-style editing, templates, CSV batch printing and printing over Bluetooth LE, network, USB or serial.
Tags:
- zebra
- zpl
- label
- printer
ManifestType: defaultLocale
ManifestVersion: %(s)s
""" % {"s": SCHEMA, "head": head})


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])
