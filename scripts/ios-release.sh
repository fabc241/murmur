#!/usr/bin/env bash
# Builds a Release version of Murmur (JS bundle embedded, no Metro needed) and
# installs it on a connected iPhone. Uses xcodebuild + devicectl directly because
# `expo run:ios` aborts when the Simulator app isn't installed, even for devices.
set -euo pipefail

export LANG="${LANG:-en_US.UTF-8}" LC_ALL="${LC_ALL:-en_US.UTF-8}" # CocoaPods needs UTF-8

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_ID="com.fabianacordella.murmur"

if [[ ! -d "$ROOT/ios" ]]; then
  npx expo prebuild --platform ios
fi
(cd "$ROOT/ios" && pod install)

DEVICE="${1:-}"
if [[ -z "$DEVICE" ]]; then
  JSON="$(mktemp)"
  xcrun devicectl list devices --json-output "$JSON" >/dev/null
  DEVICE="$(node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).result.devices
      .filter(x => x.hardwareProperties?.platform === "iOS" && x.hardwareProperties?.reality === "physical")
      .filter(x => x.connectionProperties?.pairingState === "paired");
    if (d.length) console.log(d[0].hardwareProperties.udid);
  ' "$JSON")"
  rm -f "$JSON"
fi
if [[ -z "$DEVICE" ]]; then
  echo "No paired iPhone found. Connect it (cable or same Wi-Fi), unlock it, or pass its UDID as an argument." >&2
  exit 1
fi
echo "Building Release for device $DEVICE (takes a few minutes)…"
mkdir -p "$ROOT/ios/build"

xcodebuild -workspace "$ROOT/ios/Murmur.xcworkspace" -scheme Murmur -configuration Release \
  -destination "id=$DEVICE" -derivedDataPath "$ROOT/ios/build" -allowProvisioningUpdates build \
  > "$ROOT/ios/build/release.log" 2>&1 || {
  grep -E "error:" "$ROOT/ios/build/release.log" | head -20 >&2
  echo "Build failed. Full log: ios/build/release.log" >&2
  exit 1
}

APP="$ROOT/ios/build/Build/Products/Release-iphoneos/Murmur.app"
if [[ ! -f "$APP/main.jsbundle" ]]; then
  echo "Build finished but $APP/main.jsbundle is missing." >&2
  exit 1
fi

xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE_ID" \
  || echo "Installed. Unlock the iPhone and open Murmur."
