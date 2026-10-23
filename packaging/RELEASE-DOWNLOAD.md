
### Download / İndir

| System | File |
|---|---|
| Windows 10/11 | `ZebraApp-…-windows-x64.exe` |
| macOS, Apple silicon (M1–M4) | `ZebraApp-…-macos-arm64.dmg` |
| macOS, Intel | `ZebraApp-…-macos-x64.dmg` |
| Linux (Ubuntu 22.04+ and others) | `ZebraApp-…-x86_64.AppImage` |

The apps are not signed, so the system asks once:

- **Windows:** "Windows protected your PC" → **More info** → **Run anyway**.
- **macOS:** drag ZebraApp to Applications. On first start: right-click → **Open**, or System Settings → Privacy & Security → **Open Anyway**.
- **Linux:** make it executable (`chmod +x ZebraApp-*.AppImage`, or Properties → Allow executing) and double-click. If it does not start, install FUSE 2: `sudo apt install libfuse2` (Ubuntu 24.04: `libfuse2t64`).

The editor opens as a window in Chrome or Edge (or your default browser).

Uygulamalar imzasız olduğu için sistem ilk açılışta bir kez sorar: **Windows**'ta "Ek bilgi" → "Yine de çalıştır"; **macOS**'ta Uygulamalar'a sürükle, ilk açılışta sağ tık → **Aç**; **Linux**'ta dosyaya çalıştırma izni ver (`chmod +x`) ve çift tıkla, açılmazsa `sudo apt install libfuse2` (Ubuntu 24.04'te `libfuse2t64`).
