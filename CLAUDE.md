# ZebraApp: notes for Claude Code

ZebraApp is a label designer for Zebra printers (ZPL). It targets the ZD421 at 300 dpi, printing over Bluetooth LE, network, USB or serial. The repository is public: github.com/TroubledKezoo1/ZebraDesignApp. Answer the owner in Turkish unless they write English.

## Layout
- `zebraapp/`: the desktop backend, Python stdlib only plus optional extras (bleak, pyserial, pyzipper, Pillow, pypdfium2).
  - `server.py`: local HTTP server on 127.0.0.1 and all `/api/*` routes. `transports.py`: BLE, TCP, USB, serial, CUPS and Windows printing. `updates.py` and `ed25519.py`: update check and signed self-update. `pdfimport.py`: PDF to label image. `nlbl.py`: ZebraDesigner file import/export. `storage.py`: data folder (`~/.config/zebraapp` on Linux). `messages.py`: Turkish translations of server messages.
- `zebraapp/static/`: the web UI shared by desktop and Android (`index.html`, `app.css`, `mobile.css`, `js/editor.js` is the large main file, `js/zpl.js`, `js/extras.js`, `js/i18n.js`, `js/scan.js`, `js/pdfjs-import.js`, `vendor/` for bundled libraries, `whatsnew.json`).
- `android/`: Capacitor 6 wrapper. `prepare.mjs` copies the web UI into `android/www`; `shim.js` replaces the backend inside the phone app.
- `packaging/`: PyInstaller spec, AppImage/.deb/apt, Homebrew/Scoop/winget generators. `tools/ble_test.py`: step-by-step Bluetooth check. `docs/`: user guide and `DISTRIBUTION.md`.
- `tests/`: Python unit tests (`python3 -m unittest discover tests`) and JS tests (`node tests/js/test_zpl.js`).

## Run and test
- Run from source: `python3 -m zebraapp` (or `make run`). Headless: `python3 -m zebraapp --no-browser`, which prints a one-time address.
- Test: `python3 -m unittest discover tests && node tests/js/test_zpl.js && node tests/js/test_pdfimport.js`.
- The UI is plain JavaScript with no build step. Turkish is the source language: UI strings are Turkish, English lives in `static/js/i18n.js` (and `messages.py` for server errors). Add both when adding text.

## Things that are easy to get wrong
- The local server needs a session cookie (`zebra_key`), given only to the app window through a single-use `?k=` code. Tests must send the cookie; POSTs also need the header `X-ZebraApp: 1`.
- Self-update installs only if `SHA256SUMS.txt` has a valid Ed25519 signature (`.sig`) from the key built into `updates.SIGNING_PUBKEY`. Never change that key casually: older apps could no longer update.
- Bluetooth: the ZD421 accepts one connection and stops advertising while connected. Linux needs the printer paired once (`bluetoothctl pair/trust <address>`). The write characteristic is write-with-response only, so packet size and timeouts matter; do not reintroduce a blocking write without a timeout.
- Bump the version in `zebraapp/__init__.py`, `pyproject.toml`, `npm/package.json` and `android/package.json` together, and add entries to `CHANGELOG.md` and `static/whatsnew.json`.
- Keep third-party libraries listed in `THIRD_PARTY_NOTICES.md` with their licenses.

## Releasing
1. Push to the `build-test` branch: CI builds every platform without publishing. Wait until all jobs are green.
2. Push to `main`.
3. The owner pushes the tag: `git tag -a vX.Y.Z -m "ZebraApp X.Y.Z" && git push origin vX.Y.Z`. The Release workflow builds, checksums and signs the downloads, then the Distribute workflow updates apt, Homebrew, Scoop and npm where their secrets exist.

## Never do these
- Do not put personal or company data in the repo: addresses, phone numbers, logos, real label files, printer MAC addresses, `veriler/config.json`. Test labels must be made up.
- Do not commit secrets, keystores or signing keys. The owner keeps them in `~/Documents/ZebraApp-imza`; never delete or move that folder (losing the signing key breaks update chains).
- Do not enter passwords or tokens on the owner's behalf and do not work around permission denials. GitHub secrets are added by the owner.
- Do not push or move release tags unless asked.
