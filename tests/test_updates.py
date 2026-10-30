import hashlib
import os
import tempfile
import unittest

from zebraapp import updates


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

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.target = os.path.join(self.dir.name, "ZebraApp.AppImage")
        with open(self.target, "wb") as f:
            f.write(b"old-version")
        self.saved = (updates._get_text, updates._download, updates._relaunch)
        self.relaunched = []
        updates._relaunch = lambda t: self.relaunched.append(t)

    def tearDown(self):
        updates._get_text, updates._download, updates._relaunch = self.saved
        self.dir.cleanup()

    def fake(self, payload, digest=None):
        digest = digest or hashlib.sha256(payload).hexdigest()
        updates._get_text = lambda url: "%s  other.dmg\n%s  ZebraApp-9.9.9-x86_64.AppImage\n" % ("0" * 64, digest)

        def dl(url, dest, report):
            with open(dest, "wb") as f:
                f.write(payload)
            report(len(payload), len(payload))
        updates._download = dl

    def read(self, p):
        with open(p, "rb") as f:
            return f.read()

    def test_good_download_replaces_the_file_keeps_a_backup_and_restarts(self):
        self.fake(b"new-version")
        updates.run_install(self.target, self.URL, self.SUMS)
        self.assertEqual(updates.progress["state"], "restarting")
        self.assertEqual(self.read(self.target), b"new-version")
        self.assertEqual(self.read(self.target + ".old"), b"old-version")
        self.assertFalse(os.path.exists(self.target + ".new"))
        self.assertEqual(self.relaunched, [self.target])
        if os.name == "posix":
            self.assertTrue(os.access(self.target, os.X_OK))

    def test_wrong_checksum_changes_nothing(self):
        self.fake(b"tampered", digest="1" * 64)
        updates.run_install(self.target, self.URL, self.SUMS)
        self.assertEqual((updates.progress["state"], updates.progress["code"]), ("error", "sha"))
        self.assertEqual(self.read(self.target), b"old-version")
        self.assertFalse(os.path.exists(self.target + ".new"))
        self.assertEqual(self.relaunched, [])

    def test_missing_checksum_line_is_refused(self):
        self.fake(b"x")
        updates._get_text = lambda url: "%s  somethingelse\n" % ("2" * 64)
        updates.run_install(self.target, self.URL, self.SUMS)
        self.assertEqual(updates.progress["code"], "nosum")
        self.assertEqual(self.read(self.target), b"old-version")

    def test_only_github_release_downloads_are_accepted(self):
        self.fake(b"x")
        updates.run_install(self.target, "https://evil.example/ZebraApp.AppImage", self.SUMS)
        self.assertEqual(updates.progress["code"], "source")
        updates.run_install(self.target, self.URL, "https://github.com/someone/else/releases/download/v1/SHA256SUMS.txt")
        self.assertEqual(updates.progress["code"], "source")
        self.assertEqual(self.read(self.target), b"old-version")

    def test_network_failure_is_reported(self):
        def boom(url, dest, report):
            raise ConnectionError("down")
        self.fake(b"x")
        updates._download = boom
        updates.run_install(self.target, self.URL, self.SUMS)
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
