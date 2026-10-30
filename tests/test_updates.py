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


if __name__ == "__main__":
    unittest.main()
