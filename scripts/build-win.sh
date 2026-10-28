#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
ELECTRON_VERSION="38.8.6"
CACHE_DIR="$ROOT/build/electron-cache"
ZIP_NAME="electron-v${ELECTRON_VERSION}-win32-x64.zip"
ZIP_PATH="$CACHE_DIR/$ZIP_NAME"
DOWNLOAD_URL="https://npmmirror.com/mirrors/electron/${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-win32-x64.zip"
OUT_DIR="$ROOT/dist/TeyvatSleepReminder-win32-x64"
OUT_ZIP="$ROOT/dist/TeyvatSleepReminder-v${VERSION}-win64.zip"

command -v unzip >/dev/null || { echo "需要 unzip"; exit 1; }
command -v zip >/dev/null || { echo "需要 zip"; exit 1; }
command -v node >/dev/null || { echo "需要 Node.js"; exit 1; }

mkdir -p "$CACHE_DIR" "$ROOT/dist"
if [ ! -f "$ZIP_PATH" ]; then
  echo "下载 Electron ${ELECTRON_VERSION} win32-x64 ..."
  curl -L --fail --retry 3 "$DOWNLOAD_URL" -o "$ZIP_PATH"
fi

echo "清理旧构建..."
rm -rf "$OUT_DIR" "$OUT_ZIP"
mkdir -p "$OUT_DIR"
unzip -q "$ZIP_PATH" -d "$OUT_DIR"

echo "精简语言包与默认应用..."
find "$OUT_DIR/locales" -type f ! -name 'zh-CN.pak' ! -name 'en-US.pak' -delete
rm -f "$OUT_DIR/resources/default_app.asar"

echo "复制应用文件..."
mkdir -p "$OUT_DIR/resources/app"
cp -R src assets package.json "$OUT_DIR/resources/app/"
cp README.md LICENSE packaging/使用说明.txt "$OUT_DIR/"
if [ -d docs ]; then cp -R docs "$OUT_DIR/docs"; fi

echo "重命名可执行文件并写入图标..."
mv "$OUT_DIR/electron.exe" "$OUT_DIR/TeyvatSleepReminder.exe"
node scripts/apply-icon.js "$OUT_DIR/TeyvatSleepReminder.exe" assets/icon.ico

echo "打包 zip..."
(cd "$ROOT/dist" && zip -q -9 -r "$(basename "$OUT_ZIP")" "$(basename "$OUT_DIR")")
(cd "$ROOT/dist" && sha256sum "$(basename "$OUT_ZIP")" > TeyvatSleepReminder-v${VERSION}-win64.sha256.txt)

echo "完成:"
ls -lh "$OUT_ZIP" "$ROOT/dist/TeyvatSleepReminder-v${VERSION}-win64.sha256.txt"
