# ZebraApp for Android

The same label editor as the desktop app, packaged as an APK with [Capacitor](https://capacitorjs.com).
There is no server: settings and labels stay on the phone, printing goes over **Bluetooth LE** (ZD421 and other
Link-OS printers), and the preview uses Labelary like on the desktop.

* `shim.js` answers the editor's `/api/...` calls inside the app (storage, Bluetooth, Labelary) and shows an
  **"update available"** bar when a newer release with an `.apk` exists on GitHub (checked at start, at most every 6 hours).
* `prepare.mjs` copies `zebraapp/static` into `www/` and injects the shim. The web UI is shared with the desktop app.
* `build-apk.sh` builds the APK (`make apk` from the repo root). Needs Node, JDK 17 and the Android SDK.

Not in the Android app: NLBL import/export, network/USB/serial printing (use the desktop app for those).

## Updates

The app compares its own version with the latest GitHub release. If the release has a newer `ZebraApp-<version>-android.apk`,
a bar offers **Update** (opens the download; tap the file to install). Android only installs an update when it is
signed with the **same key** as the installed app, so releases must always use the same keystore:

```sh
keytool -genkeypair -v -keystore zebraapp.jks -alias zebraapp -keyalg RSA -keysize 4096 -validity 36500
base64 -w0 zebraapp.jks      # macOS: base64 -i zebraapp.jks
```

Store it as repository secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD` (use the same password for the
store and the key) and optionally `ANDROID_KEY_ALIAS` (default `zebraapp`). **Keep a backup of the .jks**; if it is lost,
users have to uninstall and reinstall. Without these secrets CI only builds a debug-signed test APK that is not published.
