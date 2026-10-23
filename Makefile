# ZebraApp: run, test and build the desktop app.   `make` shows the list.
# Without make (Windows): python packaging/build.py package
PYTHON ?= $(if $(filter Windows_NT,$(OS)),python,python3)
BUILD   = $(PYTHON) packaging/build.py

.DEFAULT_GOAL := help
.PHONY: help run test deps build package clean install-linux

help:
	@echo "ZebraApp"
	@echo "  make run            start the editor from the source folder"
	@echo "  make test           backend and ZPL tests"
	@echo "  make deps           create .venv and install what the build needs"
	@echo "  make build          PyInstaller output in dist/ (this system only)"
	@echo "  make package        the finished download in dist/release/"
	@echo "                      Windows .exe, macOS .dmg, Linux .AppImage (this system and CPU)"
	@echo "  make install-linux  add ZebraApp to the application menu (from source)"
	@echo "  make clean          remove build/ and dist/"
	@echo "Needs Python 3.9+; Linux packaging also needs curl."

run:
	$(PYTHON) -m zebraapp

test:
	$(BUILD) test

deps:
	$(BUILD) deps

build:
	$(BUILD) build

package:
	$(BUILD) package

clean:
	$(BUILD) clean

install-linux:
	sh scripts/install-linux.sh
