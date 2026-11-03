#!/bin/sh
# Builds the zip to upload to the Chrome Web Store: only the files the extension runs.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$root/manifest.json').version")"
out="$root/dist/sondaggi-in-bozza-$version.zip"
mkdir -p "$root/dist"
rm -f "$out"
cd "$root"
zip -qr -X "$out" manifest.json background.js panel.html panel.css panel.js emoji.js content icons vendor \
  -x '*.DS_Store'
echo "$out"
