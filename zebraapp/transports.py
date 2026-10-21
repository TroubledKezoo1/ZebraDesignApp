"""Printer transports: how bytes reach the printer.

Every transport takes a printer dict (from config) and raw ZPL bytes.
Optional dependencies are imported lazily so the app runs without them:
  - BLE:     bleak     (pip install bleak)
  - Serial:  pyserial  (pip install pyserial)
  - Windows: pywin32   (pip install pywin32)
"""
from __future__ import annotations

import asyncio
import glob
import os
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time

# Zebra Link-OS BLE "parser" service (ZD/ZQ/ZT printers with Bluetooth LE)
ZEBRA_BLE_WRITE = "38eb4a82-c570-11e3-9507-0002a5d5c51b"
ZEBRA_BLE_READ = "38eb4a81-c570-11e3-9507-0002a5d5c51b"

TRANSPORTS = ("ble", "tcp", "system", "device", "serial", "command")


class TransportError(Exception):
    """A user-facing error. `template` is English; messages.py holds translations."""

    def __init__(self, template, *args):
        self.template = template
        self.params = args
        super().__init__(template % args if args else template)


def _has(mod: str) -> bool:
    try:
        __import__(mod)
        return True
    except Exception:  # noqa: BLE001
        return False


def available() -> dict:
    return {
        "ble": _has("bleak"),
        "tcp": True,
        "system": sys.platform == "win32" and _has("win32print") or bool(shutil.which("lp")),
        "device": sys.platform.startswith("linux"),
        "serial": _has("serial"),
        "command": True,
        "platform": sys.platform,
    }


# ------------------------------------------------------------------ BLE
class BleLink:
    """Keeps one BLE connection open per printer address, on a private event loop."""

    def __init__(self):
        self.loop = asyncio.new_event_loop()
        threading.Thread(target=self.loop.run_forever, daemon=True, name="ble-loop").start()
        self.lock = threading.Lock()
        self.client = None
        self.address = None
        self.name = ""
        self.wchar = None
        self.rchar = None
        self._rx = bytearray()

    def _run(self, coro, timeout=45):
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result(timeout)

    def connected_to(self, address=None):
        ok = bool(self.client and self.client.is_connected)
        return ok and (address is None or (self.address or "").upper() == (address or "").upper())

    async def _connect(self, p):
        try:
            from bleak import BleakClient, BleakScanner
        except ImportError as e:
            raise TransportError("BLE needs the 'bleak' package:  pip install bleak") from e
        addr = (p.get("address") or "").strip()
        prefix = (p.get("name_prefix") or "").strip().upper()
        dev = None
        if addr:
            dev = await BleakScanner.find_device_by_address(addr, timeout=10)
        if dev is None and prefix:
            for d in await BleakScanner.discover(timeout=8):
                if (d.name or "").upper().startswith(prefix):
                    dev = d
                    break
        if dev is None:
            raise TransportError("Printer not found over Bluetooth. It must be on, in range and not connected to another device (e.g. a phone).")
        client = BleakClient(dev, disconnected_callback=lambda c: setattr(self, "client", None))
        await client.connect()
        want = (p.get("write_uuid") or ZEBRA_BLE_WRITE).lower()
        wchar = rchar = fallback = None
        for svc in client.services:
            for ch in svc.characteristics:
                u = ch.uuid.lower()
                if u == want:
                    wchar = ch
                if u == ZEBRA_BLE_READ:
                    rchar = ch
                if fallback is None and ("write" in ch.properties or "write-without-response" in ch.properties):
                    fallback = ch
        wchar = wchar or fallback
        if wchar is None:
            await client.disconnect()
            raise TransportError("No writable Bluetooth characteristic found on this device.")
        self.client, self.wchar, self.rchar = client, wchar, rchar
        self.address, self.name = dev.address, (dev.name or dev.address)

    async def _disconnect(self):
        if self.client:
            try:
                await self.client.disconnect()
            finally:
                self.client = None

    async def _write(self, data: bytes):
        ch = self.wchar
        no_resp = "write-without-response" in ch.properties and "write" not in ch.properties
        mtu = getattr(self.client, "mtu_size", 23) or 23
        size = max(20, min(mtu - 3, 180))
        for i in range(0, len(data), size):
            await self.client.write_gatt_char(ch, data[i:i + size], response=not no_resp)
            await asyncio.sleep(0.02)
        await asyncio.sleep(0.3)

    async def _query(self, data: bytes, wait: float):
        if self.rchar is None or "notify" not in self.rchar.properties:
            raise TransportError("This printer does not report status over Bluetooth.")
        self._rx = bytearray()
        await self.client.start_notify(self.rchar, lambda _c, b: self._rx.extend(b))
        try:
            await self._write(data)
            await asyncio.sleep(wait)
        finally:
            try:
                await self.client.stop_notify(self.rchar)
            except Exception:  # noqa: BLE001
                pass
        return bytes(self._rx)

    def _ensure(self, p):
        if not self.connected_to(p.get("address") or None):
            if self.client:
                self._run(self._disconnect())
            self._run(self._connect(p))

    def connect(self, p):
        with self.lock:
            self._ensure(p)
            return self.name

    def disconnect(self):
        with self.lock:
            self._run(self._disconnect())

    def send(self, p, data):
        with self.lock:
            self._ensure(p)
            try:
                self._run(self._write(data), timeout=120)
            except TransportError:
                raise
            except Exception:  # noqa: BLE001  one reconnect attempt
                self._run(self._disconnect())
                self._ensure(p)
                self._run(self._write(data), timeout=120)
            return self.name

    def query(self, p, data, wait=1.5):
        with self.lock:
            self._ensure(p)
            return self._run(self._query(data, wait))

    def scan(self, seconds=6):
        try:
            from bleak import BleakScanner
        except ImportError as e:
            raise TransportError("BLE needs the 'bleak' package:  pip install bleak") from e

        async def go():
            found = await BleakScanner.discover(timeout=seconds)
            return [{"value": d.address, "label": "%s  (%s)" % (d.name or "?", d.address), "name": d.name or ""}
                    for d in sorted(found, key=lambda d: (d.name is None, d.name or ""))]
        return self._run(go(), timeout=seconds + 15)


ble = BleLink()


# ------------------------------------------------------------------ TCP
def _tcp(p, data: bytes, read_wait: float = 0.0) -> bytes:
    host = (p.get("host") or "").strip()
    if not host:
        raise TransportError("Enter the printer's IP address.")
    port = int(p.get("port") or 9100)
    try:
        with socket.create_connection((host, port), timeout=8) as s:
            s.sendall(data)
            if not read_wait:
                return b""
            s.settimeout(read_wait)
            buf = bytearray()
            end = time.time() + read_wait
            while time.time() < end:
                try:
                    chunk = s.recv(4096)
                except socket.timeout:
                    break
                if not chunk:
                    break
                buf.extend(chunk)
                if buf.count(b"\x03") >= 3:  # ~HS answers with 3 STX..ETX strings
                    break
            return bytes(buf)
    except OSError as e:
        raise TransportError("Could not reach %s:%d (%s)", host, port, e) from e


# ------------------------------------------------------------------ system queue / USB
def _system(p, data: bytes):
    queue = (p.get("queue") or "").strip()
    if not queue:
        raise TransportError("Choose a system printer (queue).")
    if sys.platform == "win32":
        try:
            import win32print  # type: ignore
        except ImportError as e:
            raise TransportError("Windows printing needs pywin32:  pip install pywin32") from e
        h = win32print.OpenPrinter(queue)
        try:
            win32print.StartDocPrinter(h, 1, ("ZebraApp label", None, "RAW"))
            try:
                win32print.StartPagePrinter(h)
                win32print.WritePrinter(h, data)
                win32print.EndPagePrinter(h)
            finally:
                win32print.EndDocPrinter(h)
        finally:
            win32print.ClosePrinter(h)
        return
    lp = shutil.which("lp")
    if not lp:
        raise TransportError("The 'lp' command (CUPS) was not found.")
    r = subprocess.run([lp, "-d", queue, "-o", "raw"], input=data, capture_output=True, timeout=60)
    if r.returncode != 0:
        raise TransportError("lp failed: %s", (r.stderr or r.stdout).decode("utf-8", "replace").strip())


def _list_system():
    if sys.platform == "win32":
        try:
            import win32print  # type: ignore
        except ImportError as e:
            raise TransportError("Windows printing needs pywin32:  pip install pywin32") from e
        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        return [{"value": pr[2], "label": pr[2]} for pr in win32print.EnumPrinters(flags)]
    lpstat = shutil.which("lpstat")
    if not lpstat:
        raise TransportError("The 'lpstat' command (CUPS) was not found.")
    r = subprocess.run([lpstat, "-e"], capture_output=True, timeout=10)
    names = [ln.strip() for ln in r.stdout.decode("utf-8", "replace").splitlines() if ln.strip()]
    if not names:
        r = subprocess.run([lpstat, "-a"], capture_output=True, timeout=10)
        names = [ln.split()[0] for ln in r.stdout.decode("utf-8", "replace").splitlines() if ln.strip()]
    return [{"value": n, "label": n} for n in names]


def _device(p, data: bytes):
    path = (p.get("path") or "").strip()
    if not path:
        raise TransportError("Enter the device path, e.g. /dev/usb/lp0")
    try:
        with open(path, "wb", buffering=0) as f:
            f.write(data)
    except PermissionError as e:
        raise TransportError("No permission for %s. Add yourself to the 'lp' group:  sudo usermod -aG lp $USER  (then log out and in)", path) from e
    except OSError as e:
        raise TransportError("Could not open %s (%s)", path, e) from e


# ------------------------------------------------------------------ serial / Bluetooth classic (SPP)
def _serial(p, data: bytes, read_wait: float = 0.0) -> bytes:
    try:
        import serial  # type: ignore
    except ImportError as e:
        raise TransportError("Serial ports need pyserial:  pip install pyserial") from e
    port = (p.get("path") or "").strip()
    if not port:
        raise TransportError("Choose a serial port (e.g. /dev/rfcomm0, /dev/ttyUSB0 or COM3).")
    try:
        with serial.Serial(port, int(p.get("baud") or 9600), timeout=read_wait or 2, write_timeout=30) as s:
            s.write(data)
            s.flush()
            if not read_wait:
                return b""
            time.sleep(read_wait)
            return s.read(s.in_waiting or 1)
    except serial.SerialException as e:
        raise TransportError("Serial port error: %s", e) from e


def _list_serial():
    items = []
    try:
        from serial.tools import list_ports  # type: ignore
        for pt in list_ports.comports():
            items.append({"value": pt.device, "label": "%s  %s" % (pt.device, pt.description or "")})
    except ImportError:
        pass
    for dev in sorted(glob.glob("/dev/rfcomm*")):
        if not any(i["value"] == dev for i in items):
            items.append({"value": dev, "label": dev + "  (Bluetooth)"})
    if not items and not _has("serial"):
        raise TransportError("Serial ports need pyserial:  pip install pyserial")
    return items


# ------------------------------------------------------------------ external command
def _command(p, data: bytes):
    cmd = (p.get("command") or "").strip()
    if not cmd:
        raise TransportError("Enter a command that reads ZPL from standard input, e.g. zebra-print")
    args = shlex.split(cmd, posix=os.name != "nt")
    if not shutil.which(args[0]) and not os.path.exists(args[0]):
        raise TransportError("Command not found: %s", args[0])
    r = subprocess.run(args, input=data, capture_output=True, timeout=120)
    out = (r.stdout + r.stderr).decode("utf-8", "replace").strip()
    if r.returncode != 0:
        raise TransportError("%s exited with code %d: %s", args[0], r.returncode, out)
    return out


# ------------------------------------------------------------------ public API
def send(p: dict, data: bytes) -> dict:
    """Send bytes; returns {"bytes": n, "printer": name, "output": text}."""
    kind = p.get("transport")
    name, out = p.get("name") or kind, ""
    if kind == "ble":
        name = ble.send(p, data) or name
    elif kind == "tcp":
        _tcp(p, data)
    elif kind == "system":
        _system(p, data)
    elif kind == "device":
        _device(p, data)
    elif kind == "serial":
        _serial(p, data)
    elif kind == "command":
        out = _command(p, data)
    else:
        raise TransportError("Unknown connection type: %s", kind)
    return {"bytes": len(data), "printer": name, "output": out}


def query(p: dict, data: bytes, wait: float = 1.5) -> bytes:
    kind = p.get("transport")
    if kind == "tcp":
        return _tcp(p, data, read_wait=wait)
    if kind == "serial":
        return _serial(p, data, read_wait=wait)
    if kind == "ble":
        return ble.query(p, data, wait)
    raise TransportError("Status can only be read over network, serial or Bluetooth LE.")


def discover(kind: str):
    if kind == "ble":
        return ble.scan()
    if kind == "system":
        return _list_system()
    if kind == "serial":
        return _list_serial()
    if kind == "device":
        return [{"value": d, "label": d} for d in sorted(glob.glob("/dev/usb/lp*"))]
    raise TransportError("Search is not available for this connection type.")


def parse_hs(raw: bytes) -> dict:
    """Parse the answer to ~HS (host status) into flags."""
    text = raw.decode("latin-1", "replace")
    parts = [s.strip() for s in text.replace("\x02", "").split("\x03") if s.strip()]
    if len(parts) < 2:
        raise TransportError("The printer did not answer the status request.")
    a = parts[0].split(",")
    b = parts[1].split(",")

    def flag(lst, i):
        try:
            return lst[i].strip() == "1"
        except IndexError:
            return False
    return {
        "paper_out": flag(a, 1), "paused": flag(a, 2), "buffer_full": flag(a, 5),
        "under_temp": flag(a, 10), "over_temp": flag(a, 11),
        "head_open": flag(b, 2), "ribbon_out": flag(b, 3),
        "raw": text.strip(),
    }
