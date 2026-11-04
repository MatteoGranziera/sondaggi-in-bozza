#!/bin/sh
# Replaces the bundled WA-JS with another release from npm (default: latest).
set -eu
version="${1:-latest}"
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
npm pack "@wppconnect/wa-js@$version" --silent >/dev/null
tar -xzf wppconnect-wa-js-*.tgz
cp package/dist/wppconnect-wa.js package/dist/wppconnect-wa.js.LICENSE.txt "$root/vendor/wa-js/"
cp package/LICENSE "$root/vendor/wa-js/LICENSE"
node -p "require('./package/package.json').version" > "$root/vendor/wa-js/VERSION"
echo "WA-JS $(cat "$root/vendor/wa-js/VERSION") copiato."
node "$root/scripts/patch-wa-js.mjs"
echo "Ora ricarica l'estensione da chrome://extensions e poi la scheda di WhatsApp Web."
