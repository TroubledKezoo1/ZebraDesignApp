# Changelog

## 1.0.12

- Desktop: "Update now" in the update bar downloads the release, checks it against `SHA256SUMS.txt`, replaces the app (the old file stays next to it as `.old`) and restarts. Works for the Linux AppImage and the Windows `.exe` when the folder is writable; macOS, `.deb`, pip and source installs keep the download link. Only `github.com/TroubledKezoo1/ZebraDesignApp/releases/download/` is accepted as a source, and only if `SHA256SUMS.txt` carries a valid Ed25519 signature (`SHA256SUMS.txt.sig`, made in the release workflow from the `RELEASE_SIGNING_KEY` secret).
- Security: the local server now needs a session cookie, handed out only to the app's own window, so other programs and users on the same computer cannot print or run the "command" printer. `--no-browser` prints an address with a one-time code.
- New: Options > Appearance (automatic, light, dark).
- New: five templates (cable, shelf, price, carton/pallet, food/jar).
- New: "Recently printed" on Home, with one-click reprint (kept in the browser, 20 jobs).
- New: "Scan with camera" for QR and barcode fields (ZXing, offline; photo fallback). Android asks for the camera permission.
- New: printer status panel (`~HS`): paper, ribbon, cover, pause, buffer, temperature.
- Fix: CSV files saved by Turkish Excel (Windows-1254) are read correctly; UTF-8 with BOM too.

## 1.0.11

- Desktop: the app tells you when a newer release exists (a bar with a download link for your system) and Options has a "Check for updates" button and an off switch. One anonymous request to GitHub; nothing is sent about you.

## 1.0.10

- Desktop: open PDF label pages at their original size, choosing a page and printer resolution. Contents are imported as an embedded image; save as `.zebra` or export to `.nlbl` without overwriting the source PDF. Thanks to @buraktuzgen (#1).

## 1.0.9

- New colour theme: Slate.

## 1.0.8

- Android: before sending you to the settings, Update explains the "install unknown apps" permission and asks first; after you allow it and come back, the download starts by itself.

## 1.0.7

- Colour theme (green, blue, orange, purple, red) in Options.
- "What's new" window after an update (and a button in Options).
- Backup and restore of stored labels and templates (Options).
- Choosing a ZD421 sets 300 dpi.
- Android: Save keeps the label inside the app ("My saved labels"), Save as shares a file; connects to the printer by itself on start and when printing, retrying up to three times; `.zpl` / `.zebra` files open with ZebraApp.

## 1.0.6

- Android: **Update** downloads the new APK inside the app (progress shown, always the same file name) and opens the installer; the first time it sends you to the "install apps" permission screen.

## 1.0.5

- Android: better Bluetooth scan (asks to turn Bluetooth on, explains a missing permission, lists Zebra printers first with a star, nearest first).

## 1.0.4

- Android: the bottom bar (Layers, Properties, Ribbon) is hidden on the File screen, where it did nothing.
- README and release notes list the Android app and the `.deb` packages.

## 1.0.3

- **Android:** the update notice now appears every time you open the app or come back to it (not only every 6 hours), and Options has a "Check for updates" button.

## 1.0.2

- **Android:** real phone layout (the screen was a shrunken desktop window), the printer dialog opens again, one finger edits and two fingers pan and pinch-zoom; a bottom bar opens layers, properties and the ribbon.
- Narrow desktop windows use the same compact layout.

## 1.0.1

- **Android app (`.apk`)**: the same editor, no server, prints over Bluetooth LE. It tells you when a newer release is out and opens the download (`android/`).
- Debian/Ubuntu package (`.deb`, amd64 and arm64) and a signed apt repository.
- PyPI package, Homebrew cask and an npm launcher (`npx zebraapp`); every download is listed in `SHA256SUMS.txt`.
- Maintainer notes in `docs/DISTRIBUTION.md`.

## 1.0.0

First release with ready-to-run apps: no Python needed.

- **Downloads** for Windows (`.exe`, x64 and ARM), macOS (`.dmg`, Apple silicon and Intel) and Linux (`.AppImage`, x86_64 and ARM64).
- `make build` / `make dist` (and `scripts\build-windows.bat`) build the apps from source.
- Word-style interface: ribbon, File screen with templates and recent files, typing directly on the label.
- Rich text: format single words (bold, italic, underline, strikethrough, size in points, font), case, character spacing, justify, vertical alignment, Format Painter, Find and replace, symbols.
- Rotate items to any angle; any font installed on the computer; shrink text to fit its box.
- Open `.zpl` files and edit them.
- Template library with fill-in fields; ZebraDesigner 3 `.nlbl` open and save (experimental).
- Printing over Bluetooth LE, network, USB / system printer and serial; CSV batch printing and counters.
- Windows ARM and Linux ARM builds.
- `make package` (or `python packaging/build.py package`) builds the app for your own system.
- If port 8765 is taken by another program, the app uses the next free one. Errors of the packaged app are written to `zebraapp-error.log` in the data folder.
