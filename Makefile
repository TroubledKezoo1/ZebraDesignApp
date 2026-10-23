# ZebraApp: build it yourself.   `make help` lists the targets.
# Needs Python 3.9+ (and for the tests, Node.js). Works on Linux and macOS;
# on Windows run scripts\build-windows.bat instead.

PY     ?= python3
VENV   ?= .venv
BIN    := $(VENV)/bin
OS     := $(shell uname -s)
ARCH   := $(shell uname -m)
VERSION = $(shell $(PY) -c "import re;print(re.search(r'__version__ = \"(.+?)\"', open('zebraapp/__init__.py').read()).group(1))")

.PHONY: help run test venv build appimage dmg dist clean

help:
	@echo "make run       start ZebraApp from the source folder"
	@echo "make test      Python and JavaScript tests"
	@echo "make build     app for this system in dist/ (Linux: folder, macOS: ZebraApp.app)"
	@echo "make appimage  Linux: dist/ZebraApp-$(VERSION)-$(ARCH).AppImage (downloads appimagetool once)"
	@echo "make dmg       macOS: dist/ZebraApp-$(VERSION)-$(ARCH).dmg"
	@echo "make dist      build plus the AppImage or the dmg, whichever fits this system"
	@echo "make clean     remove build/, dist/ and $(VENV)"

run:
	$(PY) -m zebraapp

test:
	$(PY) -m unittest discover -s tests
	@for f in zebraapp/static/js/*.js; do node --check "$$f" || exit 1; done
	node tests/js/test_zpl.js

# private Python environment with everything the app can use, plus PyInstaller
$(BIN)/pyinstaller:
	$(PY) -m venv $(VENV)
	$(BIN)/python -m pip install --upgrade pip
	$(BIN)/python -m pip install ".[all]" pyinstaller

venv: $(BIN)/pyinstaller

build: $(BIN)/pyinstaller
	$(BIN)/pyinstaller --noconfirm packaging/zebraapp.spec
	@echo "built in dist/"

appimage: build
	@[ "$(OS)" = "Linux" ] || { echo "AppImages are built on Linux"; exit 1; }
	PATH="$(abspath $(BIN)):$$PATH" PY=$(abspath $(BIN))/python ARCH=$(ARCH) ./packaging/build-appimage.sh

dmg: build
	@[ "$(OS)" = "Darwin" ] || { echo "dmg files are built on macOS"; exit 1; }
	rm -rf build/dmg && mkdir -p build/dmg
	cp -R dist/ZebraApp.app build/dmg/
	ln -s /Applications build/dmg/Applications
	hdiutil create -volname "ZebraApp $(VERSION)" -srcfolder build/dmg -ov -format UDZO "dist/ZebraApp-$(VERSION)-$(ARCH).dmg"

dist:
	@if [ "$(OS)" = "Darwin" ]; then $(MAKE) dmg; elif [ "$(OS)" = "Linux" ]; then $(MAKE) appimage; else $(MAKE) build; fi

clean:
	rm -rf build dist $(VENV) *.spec
