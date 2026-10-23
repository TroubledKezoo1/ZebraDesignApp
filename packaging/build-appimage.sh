#!/bin/sh
# Builds dist/ZebraApp-<version>-x86_64.AppImage from the PyInstaller folder build.
# Run from the repository root after:  pyinstaller packaging/zebraapp.spec
set -e
PY=${PY:-python3}
VER=$($PY -c "import zebraapp; print(zebraapp.__version__)")
ARCH=${ARCH:-x86_64}
APPDIR=build/ZebraApp.AppDir
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/applications" "$APPDIR/usr/share/icons/hicolor/512x512/apps"
cp -a dist/zebraapp/. "$APPDIR/usr/bin/"
cp packaging/zebraapp.png "$APPDIR/usr/share/icons/hicolor/512x512/apps/zebraapp.png"
cp packaging/zebraapp.png "$APPDIR/zebraapp.png"
cat > "$APPDIR/zebraapp.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=ZebraApp
Comment=Label designer for Zebra / ZPL printers
Exec=zebraapp
Icon=zebraapp
Terminal=false
Categories=Office;Graphics;
StartupWMClass=localhost
DESK
cp "$APPDIR/zebraapp.desktop" "$APPDIR/usr/share/applications/"
cat > "$APPDIR/AppRun" <<'RUN'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/zebraapp" "$@"
RUN
chmod +x "$APPDIR/AppRun"
TOOL=${APPIMAGETOOL:-build/appimagetool}
if [ ! -x "$TOOL" ]; then
  curl -fsSL -o "$TOOL" "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-$ARCH.AppImage"
  chmod +x "$TOOL"
fi
mkdir -p dist
APPIMAGE_EXTRACT_AND_RUN=1 ARCH=$ARCH "$TOOL" --no-appstream "$APPDIR" "dist/ZebraApp-$VER-$ARCH.AppImage"
echo "dist/ZebraApp-$VER-$ARCH.AppImage"
