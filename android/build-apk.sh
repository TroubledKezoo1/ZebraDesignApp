#!/usr/bin/env bash
# Builds the Android app:  android/build-apk.sh  ->  dist/release/ZebraApp-<version>-android.apk
# Needs: Node 18+, JDK 17, the Android SDK (ANDROID_HOME) with build-tools 34.
# Signing (optional): ANDROID_KEYSTORE (path), ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS.
#   Without a keystore the APK is signed with a throw-away debug key and named *-debug.apk:
#   fine to try, but it can not be updated over a release build (Android needs the same key).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
VER="$(sed -n 's/^__version__ *= *"\(.*\)"/\1/p' "$ROOT/zebraapp/__init__.py")"
IFS=. read -r MA MI PA <<<"$VER"
CODE=$((MA * 10000 + MI * 100 + PA))
OUT="$ROOT/dist/release"; mkdir -p "$OUT"

npm install --no-audit --no-fund
node prepare.mjs
[ -d android ] || npx cap add android
# app version, so "newer than installed" works
sed -i -E "s/versionCode [0-9]+/versionCode $CODE/; s/versionName \"[^\"]*\"/versionName \"$VER\"/" android/app/build.gradle
# launcher icons (the template ships an adaptive icon; use plain PNGs everywhere)
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  for n in ic_launcher ic_launcher_round ic_launcher_foreground; do cp "resources/ic_launcher-$d.png" "android/app/src/main/res/mipmap-$d/$n.png"; done
done
rm -rf android/app/src/main/res/mipmap-anydpi-v26
npx cap sync android

cd android
chmod +x gradlew
if [ -n "${ANDROID_KEYSTORE:-}" ] && [ -f "${ANDROID_KEYSTORE}" ]; then
  ./gradlew --no-daemon assembleRelease
  BT="$(ls -d "${ANDROID_HOME:?}"/build-tools/* | sort -V | tail -1)"
  UNSIGNED="app/build/outputs/apk/release/app-release-unsigned.apk"
  "$BT/zipalign" -f -p 4 "$UNSIGNED" aligned.apk
  "$BT/apksigner" sign --ks "$ANDROID_KEYSTORE" --ks-key-alias "${ANDROID_KEY_ALIAS:-zebraapp}" \
    --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEYSTORE_PASSWORD \
    --out "$OUT/ZebraApp-$VER-android.apk" aligned.apk
  "$BT/apksigner" verify "$OUT/ZebraApp-$VER-android.apk"
else
  echo "No keystore: building a debug-signed APK (not updatable over releases)."
  ./gradlew --no-daemon assembleDebug
  cp app/build/outputs/apk/debug/app-debug.apk "$OUT/ZebraApp-$VER-android-debug.apk"
fi
ls -la "$OUT"/*.apk
