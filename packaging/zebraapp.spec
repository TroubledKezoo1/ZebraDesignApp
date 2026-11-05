# PyInstaller spec for the Windows .exe, the macOS .app and the Linux AppImage.
# Build from the repository root:  pyinstaller packaging/zebraapp.spec
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules, collect_data_files, collect_dynamic_libs

ROOT = Path(SPECPATH).parent
sys.path.insert(0, str(ROOT))
from zebraapp import __version__  # noqa: E402

hidden = ["zebraapp.nlbl", "zebraapp.aeszip", "zebraapp.integrate", "zebraapp.fonts", "zebraapp.pdfimport"]
for mod in ("bleak", "serial", "PIL", "pypdfium2", "pypdfium2_raw"):
    try:
        hidden += collect_submodules(mod)
    except Exception:
        pass
if sys.platform == "win32":
    hidden += ["win32print", "win32api", "winreg"]
    for mod in ("winrt", "bleak_winrt"):
        try:
            hidden += collect_submodules(mod)
        except Exception:
            pass

datas = [(str(ROOT / "zebraapp" / "static"), "zebraapp/static")]
datas += collect_data_files("pypdfium2") + collect_data_files("pypdfium2_raw")

a = Analysis(
    [str(ROOT / "packaging" / "launcher.py")],
    pathex=[str(ROOT)],
    datas=datas,
    binaries=collect_dynamic_libs("pypdfium2_raw"),
    hiddenimports=hidden,
    excludes=["tkinter", "test", "unittest", "pydoc_data", "numpy"],
    noarchive=False,
)
pyz = PYZ(a.pure)

if sys.platform == "win32":
    # one file, no console window
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, name="ZebraApp", console=False,
              icon=str(ROOT / "packaging" / "zebraapp.ico"), upx=False)
elif sys.platform == "darwin":
    # argv_emulation turns Finder's "open this file" event into a command-line argument
    exe = EXE(pyz, a.scripts, exclude_binaries=True, name="ZebraApp", console=False, upx=False, argv_emulation=True)
    coll = COLLECT(exe, a.binaries, a.datas, name="ZebraApp", upx=False)
    app = BUNDLE(
        coll,
        name="ZebraApp.app",
        icon=str(ROOT / "packaging" / "zebraapp.icns"),
        bundle_identifier="io.github.troubledkezoo1.zebraapp",
        version=__version__,
        info_plist={
            "CFBundleDisplayName": "ZebraApp",
            "CFBundleShortVersionString": __version__,
            # the window is a browser app window; no Dock icon of our own
            "LSUIElement": True,
            "NSBluetoothAlwaysUsageDescription": "ZebraApp connects to Zebra label printers over Bluetooth.",
            "NSHighResolutionCapable": True,
            # double-click .zebra / .nlbl in Finder
            "CFBundleDocumentTypes": [
                {"CFBundleTypeName": "ZebraApp label", "CFBundleTypeRole": "Editor", "LSHandlerRank": "Owner",
                 "LSItemContentTypes": ["io.github.troubledkezoo1.zebraapp.label"]},
                {"CFBundleTypeName": "ZebraDesigner label", "CFBundleTypeRole": "Editor", "LSHandlerRank": "Default",
                 "LSItemContentTypes": ["com.zebra.zebradesigner.nlbl"]},
            ],
            "UTExportedTypeDeclarations": [
                {"UTTypeIdentifier": "io.github.troubledkezoo1.zebraapp.label", "UTTypeDescription": "ZebraApp label",
                 "UTTypeConformsTo": ["public.json", "public.data"],
                 "UTTypeTagSpecification": {"public.filename-extension": ["zebra"]}},
            ],
            "UTImportedTypeDeclarations": [
                {"UTTypeIdentifier": "com.zebra.zebradesigner.nlbl", "UTTypeDescription": "ZebraDesigner label",
                 "UTTypeConformsTo": ["public.data"],
                 "UTTypeTagSpecification": {"public.filename-extension": ["nlbl"]}},
            ],
        },
    )
else:
    # folder build, wrapped into an AppImage by packaging/build-appimage.sh
    exe = EXE(pyz, a.scripts, exclude_binaries=True, name="zebraapp", console=True, upx=False)
    coll = COLLECT(exe, a.binaries, a.datas, name="zebraapp", upx=False)
