#!/usr/bin/env bash
# Builds orbit-rally.apk from the web game, without Android Studio.
# Needs: Java (JDK 11+), Python 3, and these tool files (paths set below or via env vars):
#   ANDROID_JAR  - android.jar for API 30  (github.com/Sable/android-platforms)
#   DX_JAR       - dx-30.0.2.jar           (in the dex2jar release zip, lib/)
#   APKTOOL_JAR  - apktool 2.9.x jar       (apktool.org)
#   APKSIGNER_JAR- apksigner jar           (Android build-tools)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GAME="$(dirname "$HERE")"
OUT="$HERE/build"
: "${ANDROID_JAR:?set ANDROID_JAR}" "${DX_JAR:?set DX_JAR}" "${APKTOOL_JAR:?set APKTOOL_JAR}" "${APKSIGNER_JAR:?set APKSIGNER_JAR}"

rm -rf "$OUT" && mkdir -p "$OUT/classes" "$OUT/app/assets/www"

echo "1/5 Compile the Java wrapper"
javac --release 8 -nowarn -cp "$ANDROID_JAR" -d "$OUT/classes" "$HERE/src/com/bserc/orbitrally/MainActivity.java" 2>&1 | grep -v "warning" || true

echo "2/5 Convert to Android bytecode (classes.dex)"
java -cp "$DX_JAR" com.android.dx.command.Main --dex --min-sdk-version=24 --output="$OUT/app/classes.dex" "$OUT/classes"

echo "3/5 Copy the game into the app"
cp "$GAME"/index.html "$GAME"/style.css "$GAME"/game.js "$GAME"/manifest.webmanifest "$OUT/app/assets/www/"
cp -r "$GAME/fonts" "$GAME/icons" "$OUT/app/assets/www/"
cp "$HERE/AndroidManifest.xml" "$OUT/app/"
cp -r "$HERE/res" "$OUT/app/"
cat > "$OUT/app/apktool.yml" <<'YML'
!!brut.androlib.meta.MetaInfo
apkFileName: orbit-rally.apk
compressionType: false
doNotCompress:
- resources.arsc
- png
- woff2
isFrameworkApk: false
packageInfo:
  forcedPackageId: '127'
  renameManifestPackage: null
sdkInfo:
  minSdkVersion: '24'
  targetSdkVersion: '34'
sharedLibrary: false
sparseResources: false
usesFramework:
  ids:
  - 1
  tag: null
version: 2.9.3
versionInfo:
  versionCode: '1'
  versionName: '1.0'
YML

echo "4/5 Package and align"
java -jar "$APKTOOL_JAR" b "$OUT/app" -o "$OUT/unsigned.apk" --frame-path "$OUT/framework" >/dev/null
python3 "$HERE/zipalign.py" "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "5/5 Sign"
KS="$HERE/orbit-rally.keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -alias orbitrally -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass orbitrally -keypass orbitrally -dname "CN=Orbit Rally, O=BSERC GenAI Internship, C=IN" >/dev/null 2>&1
fi
java -jar "$APKSIGNER_JAR" sign --ks "$KS" --ks-pass pass:orbitrally --key-pass pass:orbitrally \
  --ks-key-alias orbitrally --min-sdk-version 24 --out "$GAME/orbit-rally.apk" "$OUT/aligned.apk"
java -jar "$APKSIGNER_JAR" verify --verbose "$GAME/orbit-rally.apk" | head -5
echo "Done: $GAME/orbit-rally.apk"
