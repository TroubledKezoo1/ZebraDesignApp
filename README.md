# ZebraApp

**A label designer for Zebra and other ZPL printers.** Design labels in a desktop-style editor, then print over Bluetooth LE, the network, USB or a serial port. It runs on Linux, Windows and macOS and needs nothing but Python.

[Türkçe](README.tr.md)

![ZebraApp editor](docs/screenshot-en.png)

ZebraDesigner only runs on Windows, and most open-source label tools do not speak ZPL or Bluetooth LE. ZebraApp is a small local web app: a Python server talks to the printer, and the editor opens in its own window.

## Features

**Design**
- Text, QR code, barcodes (Code 128, Code 39, EAN-13), lines, boxes (rounded or filled), ellipses and images/logos (converted to a printer bitmap with threshold and dithering)
- Select, move and resize with the mouse (8 handles), multi-select and rubber-band selection
- Snapping to the grid and to other items with guide lines, mm rulers and zoom
- Layers you can hide, lock, rename and reorder by dragging
- Align and distribute, bring to front / send to back, rotation in 90° steps
- Bold text, character width, line spacing, centered or right-aligned text boxes, automatic line wrap, reverse print (white on black)
- Undo and redo, copy and paste, keyboard shortcuts

**Printing**
- Variables `{SAYAC}` (counter), `{TARIH}` (date) and `{SAAT}` (time) for numbered labels
- Batch printing from CSV: put `{column}` in any field and get one label per row
- Printer settings per label: media type (gap, continuous, black mark), darkness, speed, 180° rotation, offsets
- Several printers with models and resolutions; warnings when the label does not match the printer
- Printer preview through [Labelary](https://labelary.com) (needs internet), and a ZPL view where you can edit and send code by hand
- Calibrate, feed one label, print the configuration label, read printer status (paper out, head open, paused…)
- Labels are plain files (`.zebra`, JSON inside): Save, Save as and Open use your system's file dialog, with a recent-files list; export the ZPL as a `.zpl` file
- English and Turkish interface

## Supported connections

| Connection | Works on | Needs |
|---|---|---|
| Bluetooth LE | Linux, Windows, macOS | `pip install bleak` |
| Network (TCP port 9100) | everywhere | nothing |
| System printer / USB (CUPS raw queue, Windows printer) | Linux, macOS, Windows | CUPS (`lp`), or `pip install pywin32` on Windows |
| USB device file (`/dev/usb/lp0`) | Linux | membership of the `lp` group |
| Serial port / classic Bluetooth (SPP) | everywhere | `pip install pyserial` |
| External command (ZPL on standard input) | everywhere | your command |

Printer profiles are included for the ZD (ZD421, ZD621, ZD411, ZD420, ZD410, ZD220/230, ZD888), GK/GX, ZT (ZT230, ZT411, ZT421, ZT610, ZT620) and ZQ (ZQ320, ZQ520, ZQ620, ZQ630) families. Any other printer that understands ZPL works with the "Other ZPL printer" profile, including ZPL-compatible printers from other makers.

Labels made with ZebraApp have been printed on a ZD421 (300 dpi) over Bluetooth LE. The other models and connection types follow Zebra's documentation but have not been tested on real hardware yet, so reports are welcome.

## Install

Python 3.8 or newer is required.

```sh
git clone https://github.com/YOUR-USERNAME/zebraapp.git
cd zebraapp
pip install ".[ble]"        # or ".[all]" for Bluetooth, serial and Windows printing
zebraapp
```

You can also run it without installing: `python3 -m zebraapp` inside the folder.

The editor opens as an app window in Chrome, Chromium or Edge, or in your default browser. It quits by itself a few seconds after you close the window.

**Shortcuts for starting the app**
- Linux: `scripts/install-linux.sh` adds ZebraApp to the application menu and the desktop.
- Windows: double-click `scripts\ZebraApp.bat`.
- macOS: double-click `scripts/ZebraApp.command`.

On Ubuntu and other systems where pip refuses to install system-wide, use a virtual environment (`python3 -m venv .venv && . .venv/bin/activate`) or `pipx install ".[ble]"`.

## First steps

1. Click **Printers…** at the top right and add your printer. Use **Scan** to find Bluetooth printers or **List** for system printers and serial ports.
2. Use **Print test label** to check the connection.
3. Choose a preset size on the **Label** tab, or open one of the samples from **File → Add sample labels**.
4. If the printer reports a different resolution than the label, the **Print** tab offers to match it.
5. After loading a new roll, press **Calibrate** once.

A Bluetooth LE printer accepts one connection at a time. If it will not connect, turn off Bluetooth on your phone.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `V` `T` `Q` `B` `L` `R` `E` `I` | Select, Text, QR, Barcode, Line, Box, Ellipse, Image |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+C` `Ctrl+X` `Ctrl+V` `Ctrl+D` | Copy, cut, paste, duplicate |
| `Del` | Delete |
| Arrow keys (`Shift` for 10×) | Move |
| `Ctrl+S` / `Ctrl+P` | Save / print |
| `Ctrl` + wheel, `+` `-` `0` | Zoom, fit |
| `Space` + drag | Pan |
| `Alt` + drag | Move without snapping |

## Where data is stored

Labels are saved wherever you choose (`.zebra` files). Printer settings are a JSON file in:
- Linux: `~/.config/zebraapp/`
- macOS: `~/Library/Application Support/ZebraApp/`
- Windows: `%APPDATA%\ZebraApp\`

Use `--data-dir` or the `ZEBRAAPP_HOME` environment variable to keep them somewhere else, for example on a USB stick.

## Command line

```
zebraapp [--port 8765] [--data-dir PATH] [--no-browser]
```

`--no-browser` keeps the server running until you press Ctrl+C. Open `http://localhost:8765` yourself.

## Security

The server only listens on `127.0.0.1`. It checks the `Host` and `Origin` headers and requires a custom header on every request that changes something, so a website you visit cannot make your printer print. The Labelary preview is the only feature that sends data to the internet, and only when you press its button.

## How it works

```
zebraapp/
  server.py       local HTTP server, settings, Labelary proxy
  transports.py   Bluetooth LE, TCP, CUPS / Windows, USB device, serial, command
  storage.py      labels.json and config.json in the user data folder
  messages.py     Turkish translations of server messages
  static/
    js/zpl.js       label document -> ZPL (^GFA image compression, variables, CSV)
    js/render.js    canvas preview
    js/barcodes.js  Code 128 / Code 39 / EAN-13 encoders for the preview
    js/editor.js    the editor
    js/i18n.js      interface translations
    js/models.js    printer models
```

The ZPL produced in the editor is what goes to the printer, byte for byte.

## Development

```sh
python -m unittest discover -s tests -v   # backend
node tests/js/test_zpl.js                  # ZPL generator
```

**Adding a language:** copy the `EN` dictionary in `zebraapp/static/js/i18n.js`. Keys are the Turkish source strings. Server messages are in `zebraapp/messages.py`.

**Adding a printer model:** add a line to `zebraapp/static/js/models.js` with its resolutions and maximum print width.

Pull requests and issue reports are welcome, especially test results with other printers.

## License

MIT, see [LICENSE](LICENSE). Bundled third-party files (qrcode-generator, Roboto Condensed font) are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

ZebraApp is an independent project and is not affiliated with or endorsed by Zebra Technologies. Zebra, ZPL and the printer model names are trademarks of Zebra Technologies Corp.
