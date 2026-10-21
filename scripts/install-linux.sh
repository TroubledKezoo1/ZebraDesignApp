#!/bin/sh
# Adds ZebraApp to the application menu and the desktop (Linux).
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS"
if command -v zebraapp >/dev/null 2>&1; then EXEC="zebraapp"; else EXEC="sh -c 'cd \"$DIR\" && exec python3 -m zebraapp'"; fi
cat > "$APPS/zebraapp.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=ZebraApp
Comment=Label designer for Zebra / ZPL printers
Exec=$EXEC
Icon=$DIR/zebraapp/static/icon.svg
Terminal=false
Categories=Office;Graphics;
StartupWMClass=localhost
DESK
chmod +x "$APPS/zebraapp.desktop"
DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [ -d "$DESKTOP" ]; then
  cp "$APPS/zebraapp.desktop" "$DESKTOP/ZebraApp.desktop"
  chmod +x "$DESKTOP/ZebraApp.desktop"
  gio set "$DESKTOP/ZebraApp.desktop" metadata::trusted true 2>/dev/null || true
fi
echo "Done. Start 'ZebraApp' from the application menu."
