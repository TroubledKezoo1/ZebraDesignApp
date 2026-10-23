#!/usr/bin/env python3
"""Writes the Homebrew cask for a release.

    make-cask.py <version> <ZebraApp-…-macos-arm64.dmg> <ZebraApp-…-macos-x64.dmg>   > zebraapp.rb
"""
import hashlib
import sys

TEMPLATE = '''cask "zebraapp" do
  arch arm: "arm64", intel: "x64"

  version "{version}"
  sha256 arm:   "{arm}",
         intel: "{intel}"

  url "https://github.com/TroubledKezoo1/ZebraDesignApp/releases/download/v#{{version}}/ZebraApp-#{{version}}-macos-#{{arch}}.dmg"
  name "ZebraApp"
  desc "Label designer for Zebra / ZPL printers"
  homepage "https://github.com/TroubledKezoo1/ZebraDesignApp"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "ZebraApp.app"

  # the app is not signed with an Apple developer certificate
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{{appdir}}/ZebraApp.app"]
  end

  zap trash: "~/Library/Application Support/ZebraApp"
end
'''


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    print(TEMPLATE.format(version=sys.argv[1], arm=sha(sys.argv[2]), intel=sha(sys.argv[3])), end="")
