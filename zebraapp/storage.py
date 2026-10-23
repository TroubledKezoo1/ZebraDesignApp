"""Where settings and saved labels live, and how they are read and written."""
from __future__ import annotations

import json
import os
import shutil
import sys
import uuid
from pathlib import Path

PKG = Path(__file__).resolve().parent
REPO = PKG.parent


def data_dir() -> Path:
    env = os.environ.get("ZEBRAAPP_HOME")
    if env:
        d = Path(env).expanduser()
    elif sys.platform == "win32":
        d = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "ZebraApp"
    elif sys.platform == "darwin":
        d = Path.home() / "Library" / "Application Support" / "ZebraApp"
    else:
        d = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "zebraapp"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _write(path: Path, obj):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def new_id() -> str:
    return uuid.uuid4().hex[:10]


DEFAULT_CONFIG = {"language": None, "active": None, "printers": []}


class Store:
    def __init__(self, base: Path | None = None):
        self.base = base or data_dir()
        self.labels_path = self.base / "labels.json"
        self.config_path = self.base / "config.json"
        if base is None:  # only the real user folder picks up files from old versions
            self._migrate_legacy()

    # files from early versions lived next to app.py
    def _migrate_legacy(self):
        for name in ("labels.json", "config.json"):
            old, new = REPO / name, self.base / name
            if old.exists() and not new.exists() and old.resolve() != new.resolve():
                shutil.copy2(old, new)
                try:
                    old.rename(old.with_name(name + ".migrated"))
                except OSError:
                    pass

    def labels(self):
        data = _read(self.labels_path, [])
        return data if isinstance(data, list) else []

    def save_labels(self, labels):
        if not isinstance(labels, list):
            raise ValueError("labels must be a list")
        _write(self.labels_path, labels)

    # kullanicinin kendi sablonlari (Dosya > Yeni > Sablonlarim)
    def templates(self):
        data = _read(self.base / "templates.json", [])
        return data if isinstance(data, list) else []

    def save_templates(self, templates):
        if not isinstance(templates, list) or len(templates) > 500:
            raise ValueError("invalid template list")
        for item in templates:
            if not isinstance(item, dict) or not isinstance(item.get("elements"), list) or len(item["elements"]) > 2000:
                raise ValueError("invalid template items")
            for key in ("w", "h"):
                value = item.get(key)
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not 1 <= value <= 2000:
                    raise ValueError("invalid template size")
            if item.get("dpi") not in (203, 300, 600):
                raise ValueError("invalid template resolution")
        _write(self.base / "templates.json", templates)

    def config(self) -> dict:
        cfg = dict(DEFAULT_CONFIG)
        cfg.update(_read(self.config_path, {}) or {})
        # very first versions stored only a BLE address
        if not cfg.get("printers") and cfg.get("printer_address"):
            p = {"id": new_id(), "name": "Zebra (Bluetooth)", "model": "zd421", "dpi": 300,
                 "transport": "ble", "address": cfg["printer_address"], "name_prefix": cfg.get("printer_name_prefix", "")}
            cfg["printers"] = [p]
            cfg["active"] = p["id"]
        cfg.pop("printer_address", None)
        cfg.pop("printer_name_prefix", None)
        cfg.pop("write_char_uuid", None)
        for p in cfg["printers"]:
            p.setdefault("id", new_id())
        if cfg["printers"] and not any(p["id"] == cfg.get("active") for p in cfg["printers"]):
            cfg["active"] = cfg["printers"][0]["id"]
        return cfg

    def save_config(self, cfg: dict):
        keep = {k: cfg.get(k) for k in ("language", "active", "printers")}
        if not isinstance(keep["printers"], list):
            raise ValueError("printers must be a list")
        _write(self.config_path, keep)

    def printer(self, pid=None):
        cfg = self.config()
        pid = pid or cfg.get("active")
        for p in cfg["printers"]:
            if p.get("id") == pid:
                return p
        return None
