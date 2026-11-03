#!/usr/bin/env python3
"""Step-by-step Bluetooth check for a Zebra printer. Run from the project folder:

    python3 tools/ble_test.py              # uses the active printer from your settings
    python3 tools/ble_test.py AA:BB:CC:DD:EE:FF

It scans, connects, shows the packet size and characteristics, asks the printer for its status and
prints a tiny test label, timing every step. Paste the whole output if something fails."""
import asyncio, sys, time, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from zebraapp import transports, storage

ZPL = b"^XA^PW600^LL300^FO40,40^A0N,50,50^FDBLE TEST OK^FS^FO40,120^BQN,2,6^FDZebraApp^FS^XZ"


def step(name, fn):
    t = time.time()
    try:
        r = fn()
        print("OK   %-28s %.1fs  %s" % (name, time.time() - t, "" if r is None else r))
        return r
    except Exception as e:  # noqa: BLE001
        print("FAIL %-28s %.1fs  %s: %s" % (name, time.time() - t, type(e).__name__, e))
        raise SystemExit(1)


def main():
    addr = sys.argv[1] if len(sys.argv) > 1 else ""
    if not addr:
        cfg = storage.Store().config()
        pr = next((p for p in cfg.get("printers", []) if p.get("id") == cfg.get("active")), None) or {}
        addr = pr.get("address", "")
        print("active printer:", json.dumps({k: pr.get(k) for k in ("name", "transport", "address", "name_prefix")}))
    p = {"transport": "ble", "address": addr, "name_prefix": ""}
    ble = transports.ble
    found = step("scan (6 s)", lambda: [x["label"] for x in ble.scan(6)])
    for f in found:
        print("       ", f)
    step("connect", lambda: ble.connect(p))
    step("packet size / characteristics", lambda: "mtu=%s write=%s props=%s read=%s" % (
        getattr(ble.client, "mtu_size", "?"), ble.wchar.uuid, ble.wchar.properties, ble.rchar.uuid if ble.rchar else None))
    try:
        print("status:", ble.query(p, b"~HS", 1.5)[:120])
    except Exception as e:  # noqa: BLE001
        print("status not available:", e)

    def bench(size, total=3000):
        payload = b"^XA^FX" + b"x" * total + b"^FS^XZ"      # a comment only: prints nothing
        async def go():
            t = time.time(); n = 0
            for i in range(0, len(payload), size):
                await asyncio.wait_for(ble.client.write_gatt_char(ble.wchar, payload[i:i + size], response=True), 8)
                n += 1
            return "%d packets of %d bytes, %.1fs, %.0f bytes/s" % (n, size, time.time() - t, len(payload) / (time.time() - t))
        return ble._run(go(), timeout=60)
    for size in (20, 100, 180, 240):
        try:
            step("speed test, packet %d" % size, lambda: bench(size))
        except SystemExit:
            print("        (this packet size does not work)")
            ble._run(ble._disconnect(), timeout=15); ble.connect(p)
    step("send test label", lambda: ble.send(p, ZPL))
    big = b"^XA^FO0,0^GFA,60000,60000,100," + b"0" * 60000 + b"^FS^XZ"
    step("send 60 KB (blank) graphic", lambda: ble.send(p, big))
    print("done")


main()
