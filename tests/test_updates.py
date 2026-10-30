import base64
import hashlib
import os
import tempfile
import unittest

from zebraapp import ed25519, updates


def _compress(pt):
    zi = pow(pt[2], ed25519._P - 2, ed25519._P)
    x, y = pt[0] * zi % ed25519._P, pt[1] * zi % ed25519._P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def make_keypair(seed):
    h = hashlib.sha512(seed).digest()
    a = (int.from_bytes(h[:32], "little") & ((1 << 254) - 8)) | (1 << 254)
    return a, h[32:], _compress(ed25519._mul(a, ed25519._B))


def sign(seed, message):
    a, prefix, pub = make_keypair(seed)
    r = int.from_bytes(hashlib.sha512(prefix + message).digest(), "little") % ed25519._Q
    R = _compress(ed25519._mul(r, ed25519._B))
    k = int.from_bytes(hashlib.sha512(R + pub + message).digest(), "little") % ed25519._Q
    return R + ((r + k * a) % ed25519._Q).to_bytes(32, "little")


ASSETS = [{"name": "ZebraApp-1.0.11-windows-x64.exe", "browser_download_url": "https://x/win64"},
          {"name": "ZebraApp-1.0.11-windows-arm64.exe", "browser_download_url": "https://x/winarm"},
          {"name": "ZebraApp-1.0.11-macos-arm64.dmg", "browser_download_url": "https://x/macarm"},
          {"name": "ZebraApp-1.0.11-macos-x64.dmg", "browser_download_url": "https://x/macx64"},
          {"name": "ZebraApp-1.0.11-x86_64.AppImage", "browser_download_url": "https://x/linx"},
          {"name": "ZebraApp-1.0.11-aarch64.AppImage", "browser_download_url": "https://x/lina"},
          {"name": "ZebraApp-1.0.11-android.apk", "browser_download_url": "https://x/apk"}]


class UpdateTests(unittest.TestCase):
    def setUp(self):
        updates._cache.update(t=0.0, data=None)

    def test_versions_compare_numerically(self):
        self.assertTrue(updates.newer("1.0.10", "1.0.9"))
        self.assertTrue(updates.newer("v1.1.0", "1.0.99"))
        self.assertFalse(updates.newer("1.0.9", "1.0.10"))
        self.assertFalse(updates.newer("1.0.9", "1.0.9"))

    def test_asset_for_each_system(self):
        pick = lambda s, m: updates.pick_asset(ASSETS, s, m)
        self.assertEqual(pick("win32", "x64"), "https://x/win64")
        self.assertEqual(pick("win32", "arm64"), "https://x/winarm")
        self.assertEqual(pick("darwin", "arm64"), "https://x/macarm")
        self.assertEqual(pick("darwin", "x64"), "https://x/macx64")
        self.assertEqual(pick("linux", "x64"), "https://x/linx")
        self.assertEqual(pick("linux", "arm64"), "https://x/lina")
        self.assertIsNone(pick("freebsd", "x64"))

    def test_check_available_current_and_error(self):
        rel = {"tag_name": "v99.0.0", "html_url": "https://x/rel", "assets": ASSETS}
        r = updates.check(force=True, fetch=lambda: rel)
        self.assertEqual((r["state"], r["latest"], r["page"]), ("available", "99.0.0", "https://x/rel"))
        self.assertIsNone(r["url"])          # not a packaged app: only the page is offered
        r = updates.check(force=True, fetch=lambda: {"tag_name": "v0.0.1", "assets": []})
        self.assertEqual(r["state"], "current")
        def boom():
            raise OSError("offline")
        updates._cache.update(t=0.0, data=None)
        self.assertEqual(updates.check(force=True, fetch=boom)["state"], "error")
        self.assertEqual(updates.check(force=True, fetch=lambda: ["bad"])["state"], "error")

    def test_cache_is_used_for_an_hour(self):
        calls = []
        def fetch():
            calls.append(1)
            return {"tag_name": "v99.0.0", "assets": []}
        updates.check(force=False, fetch=fetch, now=1000.0)
        updates.check(force=False, fetch=fetch, now=1500.0)
        self.assertEqual(len(calls), 1)
        updates.check(force=False, fetch=fetch, now=5000.0)
        self.assertEqual(len(calls), 2)
        updates.check(force=True, fetch=fetch, now=5001.0)
        self.assertEqual(len(calls), 3)


class InstallTests(unittest.TestCase):
    URL = updates.ALLOWED + "v9.9.9/ZebraApp-9.9.9-x86_64.AppImage"
    SUMS = updates.ALLOWED + "v9.9.9/SHA256SUMS.txt"
    SIG = updates.ALLOWED + "v9.9.9/SHA256SUMS.txt.sig"
    SEED = b"\x07" * 32

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.target = os.path.join(self.dir.name, "ZebraApp.AppImage")
        with open(self.target, "wb") as f:
            f.write(b"old-version")
        self.saved = (updates._get_bytes, updates._download, updates._relaunch)
        self.relaunched = []
        updates._relaunch = lambda t: self.relaunched.append(t)
        self.pub = make_keypair(self.SEED)[2]

    def tearDown(self):
        updates._get_bytes, updates._download, updates._relaunch = self.saved
        self.dir.cleanup()

    def fake(self, payload, digest=None, seed=None, sig=True):
        digest = digest or hashlib.sha256(payload).hexdigest()
        sums = ("%s  other.dmg\n%s  ZebraApp-9.9.9-x86_64.AppImage\n" % ("0" * 64, digest)).encode()
        sigb = base64.b64encode(sign(seed or self.SEED, sums))

        def get(url):
            if url == self.SUMS:
                return sums
            if url == self.SIG:
                if not sig:
                    raise ConnectionError("404")
                return sigb + b"\n"
            raise AssertionError(url)
        updates._get_bytes = get

        def dl(url, dest, report):
            with open(dest, "wb") as f:
                f.write(payload)
            report(len(payload), len(payload))
        updates._download = dl

    def run_it(self, url=None, sums=None, sig=None):
        updates.run_install(self.target, url or self.URL, sums or self.SUMS, sig or self.SIG, pubkey=self.pub)

    def test_good_download_replaces_the_file_keeps_a_backup_and_restarts(self):
        self.fake(b"new-version")
        self.run_it()
        self.assertEqual(updates.progress["state"], "restarting")
        self.assertEqual(self.read(self.target), b"new-version")
        self.assertEqual(self.read(self.target + ".old"), b"old-version")
        self.assertFalse(os.path.exists(self.target + ".new"))
        self.assertEqual(self.relaunched, [self.target])
        if os.name == "posix":
            self.assertTrue(os.access(self.target, os.X_OK))

    def test_wrong_checksum_changes_nothing(self):
        self.fake(b"tampered", digest="1" * 64)
        self.run_it()
        self.assertEqual((updates.progress["state"], updates.progress["code"]), ("error", "sha"))
        self.assertEqual(self.read(self.target), b"old-version")
        self.assertFalse(os.path.exists(self.target + ".new"))
        self.assertEqual(self.relaunched, [])

    def test_signed_by_someone_else_is_refused_before_downloading(self):
        self.fake(b"evil", seed=b"\x09" * 32)
        downloaded = []
        updates._download = lambda *a: downloaded.append(a)
        self.run_it()
        self.assertEqual(updates.progress["code"], "badsig")
        self.assertEqual(downloaded, [])
        self.assertEqual(self.read(self.target), b"old-version")

    def test_missing_signature_is_refused(self):
        self.fake(b"x", sig=False)
        self.run_it()
        self.assertEqual(updates.progress["code"], "net")      # no signature file: the request fails, nothing is installed
        self.assertEqual(self.read(self.target), b"old-version")
        updates._get_bytes = lambda url: b"not base64!!" if url == self.SIG else b"abc"
        self.run_it()
        self.assertEqual(updates.progress["code"], "nosig")

    def test_the_shipped_key_is_a_valid_public_key(self):
        self.assertEqual(len(updates.SIGNING_PUBKEY), 32)
        self.assertIsNotNone(ed25519._decode(updates.SIGNING_PUBKEY))

    def test_rfc8032_vector(self):
        pk = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        sg = bytes.fromhex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
        self.assertTrue(ed25519.verify(pk, b"", sg))
        self.assertFalse(ed25519.verify(pk, b"x", sg))
        self.assertFalse(ed25519.verify(pk, b"", sg[:-1] + bytes([sg[-1] ^ 1])))
        self.assertFalse(ed25519.verify(pk, b"", sg[:63]))

    def read(self, p):
        with open(p, "rb") as f:
            return f.read()

    def test_missing_checksum_line_is_refused(self):
        self.fake(b"x")
        sums = ("%s  somethingelse\n" % ("2" * 64)).encode()
        updates._get_bytes = lambda url: sums if url == self.SUMS else base64.b64encode(sign(self.SEED, sums))
        self.run_it()
        self.assertEqual(updates.progress["code"], "nosum")
        self.assertEqual(self.read(self.target), b"old-version")

    def test_only_github_release_downloads_are_accepted(self):
        self.fake(b"x")
        self.run_it(url="https://evil.example/ZebraApp.AppImage")
        self.assertEqual(updates.progress["code"], "source")
        self.run_it(sig="https://evil.example/SHA256SUMS.txt.sig")
        self.assertEqual(updates.progress["code"], "source")
        self.run_it(sums="https://github.com/someone/else/releases/download/v1/SHA256SUMS.txt")
        self.assertEqual(updates.progress["code"], "source")
        self.assertEqual(self.read(self.target), b"old-version")

    def test_network_failure_is_reported(self):
        def boom(url, dest, report):
            raise ConnectionError("down")
        self.fake(b"x")
        updates._download = boom
        self.run_it()
        self.assertEqual(updates.progress["code"], "net")

    def test_parse_sums_and_not_packaged(self):
        self.assertEqual(updates.parse_sums("%s  a.exe\n%s *b.dmg\nbad line\n" % ("a" * 64, "B" * 64)),
                         {"a.exe": "a" * 64, "b.dmg": "b" * 64})
        self.assertIsNone(updates.self_update_target())      # running from source
        real = updates.check
        updates.check = lambda force=False: {"state": "available", "latest": "9.9.9", "url": None, "self_update": False}
        try:
            self.assertEqual(updates.start_install(), {"ok": False, "code": "unsupported"})
        finally:
            updates.check = real


if __name__ == "__main__":
    unittest.main()
