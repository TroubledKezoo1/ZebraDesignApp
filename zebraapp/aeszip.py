"""WinZip AES zip files (the format of ZebraDesigner .nlbl) with the standard library only.

Reads stored, deflated, ZipCrypto and WinZip AES (AE-1/AE-2, 128/192/256 bit) entries and writes
AE-2 / AES-256 / deflate entries, the same layout pyzipper produced before.
AES here is a plain-Python block cipher used in CTR mode as the WinZip spec describes:
https://www.winzip.com/en/support/aes-encryption/
Fine for label files (a few hundred KB); the caller limits sizes.
"""
import hashlib
import hmac
import io
import os
import struct
import time
import zipfile
import zlib

AES_METHOD = 99
_SALT = {1: 8, 2: 12, 3: 16}          # strength -> salt length (key = 16/24/32 bytes)


# ---------- AES block cipher (encryption direction only; CTR mode never decrypts blocks) ----------
def _tables():
    sbox = [0] * 256
    p = q = 1
    while True:                        # walk the multiplicative group of GF(2^8)
        p ^= ((p << 1) ^ (0x1B if p & 0x80 else 0)) & 0xFF
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xFF
        if q & 0x80:
            q ^= 0x09
        x = q ^ (q << 1 | q >> 7) ^ (q << 2 | q >> 6) ^ (q << 3 | q >> 5) ^ (q << 4 | q >> 4)
        sbox[p] = (x ^ 0x63) & 0xFF
        if p == 1:
            break
    sbox[0] = 0x63
    t0 = []
    for s in sbox:
        s2 = ((s << 1) ^ (0x1B if s & 0x80 else 0)) & 0xFF
        t0.append((s2 << 24) | (s << 16) | (s << 8) | (s2 ^ s))
    rot = lambda t, n: [((v >> n) | (v << (32 - n))) & 0xFFFFFFFF for v in t]
    return sbox, t0, rot(t0, 8), rot(t0, 16), rot(t0, 24)


_S, _T0, _T1, _T2, _T3 = _tables()


def _expand(key):
    nk = len(key) // 4
    rounds = nk + 6
    w = list(struct.unpack(">%dI" % nk, key))
    rcon = 1
    for i in range(nk, 4 * (rounds + 1)):
        t = w[i - 1]
        if i % nk == 0:
            t = ((t << 8) | (t >> 24)) & 0xFFFFFFFF
            t = (_S[t >> 24] << 24) | (_S[(t >> 16) & 255] << 16) | (_S[(t >> 8) & 255] << 8) | _S[t & 255]
            t ^= rcon << 24
            rcon = ((rcon << 1) ^ (0x1B if rcon & 0x80 else 0)) & 0xFF
        elif nk > 6 and i % nk == 4:
            t = (_S[t >> 24] << 24) | (_S[(t >> 16) & 255] << 16) | (_S[(t >> 8) & 255] << 8) | _S[t & 255]
        w.append(w[i - nk] ^ t)
    return w, rounds


def _encrypt_block(w, rounds, block):
    S, T0, T1, T2, T3 = _S, _T0, _T1, _T2, _T3
    a, b, c, d = struct.unpack(">4I", block)
    a ^= w[0]; b ^= w[1]; c ^= w[2]; d ^= w[3]
    k = 4
    for _ in range(rounds - 1):
        a, b, c, d = (
            T0[a >> 24] ^ T1[(b >> 16) & 255] ^ T2[(c >> 8) & 255] ^ T3[d & 255] ^ w[k],
            T0[b >> 24] ^ T1[(c >> 16) & 255] ^ T2[(d >> 8) & 255] ^ T3[a & 255] ^ w[k + 1],
            T0[c >> 24] ^ T1[(d >> 16) & 255] ^ T2[(a >> 8) & 255] ^ T3[b & 255] ^ w[k + 2],
            T0[d >> 24] ^ T1[(a >> 16) & 255] ^ T2[(b >> 8) & 255] ^ T3[c & 255] ^ w[k + 3])
        k += 4
    out = []
    for x0, x1, x2, x3, wk in ((a, b, c, d, w[k]), (b, c, d, a, w[k + 1]), (c, d, a, b, w[k + 2]), (d, a, b, c, w[k + 3])):
        out.append(((S[x0 >> 24] << 24) | (S[(x1 >> 16) & 255] << 16) | (S[(x2 >> 8) & 255] << 8) | S[x3 & 255]) ^ wk)
    return struct.pack(">4I", *out)


def _ctr(key, data):
    """WinZip CTR: 16-byte little-endian counter starting at 1."""
    w, rounds = _expand(key)
    stream = b"".join(_encrypt_block(w, rounds, struct.pack("<QQ", n & 0xFFFFFFFFFFFFFFFF, n >> 64))
                      for n in range(1, (len(data) + 15) // 16 + 1))
    return (int.from_bytes(data, "little") ^ int.from_bytes(stream[:len(data)], "little")).to_bytes(len(data), "little")


def _keys(password, salt, strength):
    size = 8 * strength + 8           # 16, 24 or 32 bytes
    dk = hashlib.pbkdf2_hmac("sha1", password, salt, 1000, 2 * size + 2)
    return dk[:size], dk[size:2 * size], dk[2 * size:]


# ---------- reading ----------
def _ae_extra(extra):
    i = 0
    while i + 4 <= len(extra):
        hid, ln = struct.unpack("<HH", extra[i:i + 4])
        if hid == 0x9901 and ln >= 7:
            version, vendor, strength, method = struct.unpack("<H2sBH", extra[i + 4:i + 11])
            if vendor == b"AE" and strength in _SALT:
                return version, strength, method
        i += 4 + ln
    raise zipfile.BadZipFile("AES extra field missing")


def read_all(raw, password, limit):
    """{name: bytes} for every file in the archive; raises zipfile.BadZipFile/RuntimeError on bad data."""
    out = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        infos = z.infolist()
        if len(infos) > 100 or sum(i.file_size for i in infos) > limit:
            raise ValueError("too large")
        for info in infos:
            if info.is_dir():
                continue
            if info.compress_type != AES_METHOD:
                out[info.filename] = z.read(info, pwd=password if info.flag_bits & 1 else None)
                continue
            version, strength, method = _ae_extra(info.extra)
            start = info.header_offset
            head = raw[start:start + 30]
            if len(head) < 30 or head[:4] != b"PK\x03\x04":
                raise zipfile.BadZipFile("bad local header")
            n, m = struct.unpack("<HH", head[26:30])
            data = raw[start + 30 + n + m:start + 30 + n + m + info.compress_size]
            salt_len = _SALT[strength]
            if len(data) != info.compress_size or len(data) < salt_len + 12:
                raise zipfile.BadZipFile("truncated entry")
            salt, check, body, mac = data[:salt_len], data[salt_len:salt_len + 2], data[salt_len + 2:-10], data[-10:]
            enc, auth, verify = _keys(password, salt, strength)
            if not hmac.compare_digest(check, verify):
                raise RuntimeError("bad password")
            if not hmac.compare_digest(hmac.new(auth, body, hashlib.sha1).digest()[:10], mac):
                raise zipfile.BadZipFile("authentication failed")
            plain = _ctr(enc, body)
            if method == zipfile.ZIP_DEFLATED:
                d = zlib.decompressobj(-15)
                plain = d.decompress(plain, info.file_size + 1)
                if d.unconsumed_tail:
                    raise zipfile.BadZipFile("entry larger than declared")
            elif method != zipfile.ZIP_STORED:
                raise zipfile.BadZipFile("unsupported compression %d" % method)
            if len(plain) != info.file_size or (version == 1 and zlib.crc32(plain) != info.CRC):
                raise zipfile.BadZipFile("bad entry data")
            out[info.filename] = plain
    return out


# ---------- writing ----------
def write(entries, password):
    """A zip with each (name, bytes) as an AE-2 / AES-256 / deflate entry."""
    t = time.localtime()
    dos_time = (t.tm_hour << 11) | (t.tm_min << 5) | (t.tm_sec // 2)
    dos_date = ((max(t.tm_year, 1980) - 1980) << 9) | (t.tm_mon << 5) | t.tm_mday
    extra = struct.pack("<HHH2sBH", 0x9901, 7, 2, b"AE", 3, zipfile.ZIP_DEFLATED)
    buf, central = io.BytesIO(), []
    for name, data in entries:
        fname = name.encode("utf-8")
        flags = 0x0001 | (0x0800 if any(ch > 127 for ch in fname) else 0)
        co = zlib.compressobj(6, zlib.DEFLATED, -15)
        packed = co.compress(data) + co.flush()
        salt = os.urandom(16)
        enc, auth, verify = _keys(password, salt, 3)
        body = _ctr(enc, packed)
        payload = salt + verify + body + hmac.new(auth, body, hashlib.sha1).digest()[:10]
        common = struct.pack("<HHHHIIIHH", flags, AES_METHOD, dos_time, dos_date, 0, len(payload), len(data), len(fname), len(extra))
        offset = buf.tell()
        buf.write(b"PK\x03\x04" + struct.pack("<H", 20) + common + fname + extra + payload)
        central.append(b"PK\x01\x02" + struct.pack("<HH", 20, 20) + common + struct.pack("<HHHII", 0, 0, 0, 0, offset) + fname + extra)
    start = buf.tell()
    for c in central:
        buf.write(c)
    buf.write(b"PK\x05\x06" + struct.pack("<HHHHIIH", 0, 0, len(central), len(central), buf.tell() - start, start, 0))
    return buf.getvalue()
