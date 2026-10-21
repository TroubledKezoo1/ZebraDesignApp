# ZebraApp user guide

[Türkçe kullanım kılavuzu](KULLANIM.md) · [Back to README](../README.md)

This guide walks through ZebraApp from first launch to a printed label.

![The editor](screenshot-en.png)

## 1. Start the app

Install as described in the README, then run `zebraapp` (or double-click the launcher for your system). The editor opens in its own window and closes itself a few seconds after you close that window.

The app always starts with an empty label called **Untitled label**. Type a name in the box at the top of the window to rename it.

## 2. Add your printer

1. Click **Printers…** at the top right (or choose **+ Add printer…** in the printer drop-down) and add a new printer.
2. Pick the **model** (for example *ZD421*) and the **resolution** (203 or 300 dpi; it is printed on the printer's box and on the configuration label).
3. Pick the **connection**:
   - **Bluetooth LE**: press **Scan**, choose your printer from the list. Only one device can be connected at a time, so turn off Bluetooth on your phone first.
   - **Network**: enter the printer's IP address (port 9100).
   - **System printer / USB**: press **List** and choose the raw queue.
   - **USB device file**, **Serial port**, **External command**: for special setups, see the README table.
4. Press **Print test label**. If a small test label comes out, you are set. **Read status** shows paper out, open head, paused and so on.

You can add several printers and switch between them in the drop-down at the top right.

## 3. Find your way around

| Area | What it does |
|---|---|
| Top bar | File menu, label name, Save, Undo / Redo, zoom, grid and snapping, printer selector, **Print** |
| Left, top | Tools: Select, Text, QR, Barcode, Line, Box, Ellipse, Image |
| Left, below | **Layers**: show / hide, lock, rename, drag to reorder |
| Middle | The label on a ruler (mm). The grid shows the printer's dots when you zoom in |
| Right | Tabs **Properties** (selected item), **Label** (size and printer settings), **Print** |

## 4. Set the label size

Open the **Label** tab and pick a preset (80 × 40, 100 × 150 …) or type width and height in millimetres. Set the resolution to match the printer.

Printer settings for this label live on the same tab:

- **Media type**: *Gap* for die-cut labels, *Continuous* for rolls without gaps, *Black mark* for rolls with a mark on the back.
- **Darkness** (0 to 30) and **Speed**: leave empty to use the printer's own setting.
- **Shift X / Y**: moves the whole design if it sits too close to an edge.
- **Rotate 180°**: for labels that come out upside down.

After you load a new roll, press **Calibrate** once on the **Print** tab so the printer learns the label length.

## 5. Design the label

Choose a tool on the left and click on the label (drag for lines, boxes and ellipses). Then use the **Properties** tab to fine-tune.

- **Text**: size in mm, bold, width, line spacing, left / centre / right, fixed box width with automatic wrapping, rotation in 90° steps, and **reverse** (white on black; it draws a black box behind it).
- **QR code**: content and module size. The preview is exact.
- **Barcode**: Code 128, Code 39 or EAN-13, height, bar width, human-readable text on or off.
- **Line, Box, Ellipse**: thickness, filled, rounded corners.
- **Image**: pick a logo or picture. It is converted to black and white for the printer. Use **threshold** to set the cut-off, **dither** to keep shades, **invert** to swap colours.

Handy actions:

- Drag to move, drag the eight handles to resize. Hold **Alt** to move without snapping.
- **Shift**-click or drag on empty space to select several items. The align and distribute buttons in the second toolbar then work between the items; with one item they align to the label.
- Arrow keys nudge; with **Shift** they move 10 times as far.
- **Ctrl+Z / Ctrl+Y** undo and redo, **Ctrl+C / V / D** copy, paste, duplicate, **Del** deletes.
- **Ctrl** + mouse wheel zooms, **0** fits the label in the window, **Space** + drag pans.

## 6. Save and open

Labels are ordinary files with the extension `.zebra` (JSON inside). You decide where they live.

| Action | Shortcut |
|---|---|
| **Save**: first time asks for a place and a name, later saves to the same file | Ctrl+S |
| **Save as…**: always asks | Ctrl+Shift+S |
| **Open…**: pick a file or choose from the recent list | Ctrl+O |
| **New label** (File menu) | |

The **Open** window also lists the sample labels and anything saved by older versions of the app. Opening one of those gives you a copy; Ctrl+S turns it into a file.

If you close the window with unsaved changes, the app asks first.

## 7. Print

Check the **Print** tab, then press **Print** at the top right.

- **Copies per label**: identical copies of each label.
- **Number of different labels**: how many different labels to print, used together with counters and data lists.

### Counters and dates

Type these in any text, QR or barcode field:

- `{SAYAC}` is a counter. Set start, step and number of digits under *Counter*. With 3 digits and start 1 you get 001, 002, 003…
- `{TARIH}` is today's date (dd.mm.yyyy) and `{SAAT}` the time.

### Print from a list (CSV)

1. In the **Print** tab, paste a table into *Data list*, or press **Load from file**. The first line holds the column names, separated by `;`, `,` or tabs.
2. Write `{column_name}` in any field. The column names appear as chips below the box.
3. One label is printed per row. Use *Record shown in preview* to check each row on the canvas.

Example:

```
name;city;phone
Example Machines;Istanbul;0212 000 00 00
```

Then a text field with `{name} - {city}` prints "Example Machines - Istanbul".

### Check before printing

- **Printer preview (Labelary)** sends the ZPL to labelary.com and shows how a Zebra renders it (needs internet).
- **Show ZPL code** opens the exact code that will be sent. You can edit it and send it by hand, or save it as a `.zpl` file.

## 8. Troubleshooting

**Only part of the label prints, or a label is cut off.** Check that the label size and resolution (Label tab) match the real labels and the printer. Choose the right media type, then press **Calibrate**.

**Prints too light or too dark.** Set *Darkness* on the Label tab (raise it a few steps at a time).

**The printer will not connect over Bluetooth.** Turn off Bluetooth on your phone and close other apps using the printer. Press Scan again and choose the printer. On Linux, make sure `bleak` is installed (`pip install ".[ble]"`) and the Bluetooth service is running.

**A blank label comes out between prints.** The media type is probably wrong, or the printer needs calibrating.

**Nothing happens when I press Print.** Look at the message in the bottom bar. If it says no printer is added, add one under **Printers…**.

**The window is tiny or in the wrong place.** Chrome remembers the size of app windows per address. Maximise it once, or start the app on another port: `zebraapp --port 8766`.

**Text looks different on the printer.** The preview uses the same font the printer gets, so differences usually come from the wrong resolution setting.

## 9. Where things are stored

- Your labels: wherever you saved them.
- Printer list and language: the folder named in the README (`~/.config/zebraapp/` on Linux).

Nothing leaves your computer except when you press **Printer preview (Labelary)**.
