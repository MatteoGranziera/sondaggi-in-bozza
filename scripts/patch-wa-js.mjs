// Small edits to the bundled WA-JS for places where it lags behind WhatsApp Web. Each one changes
// only what WA-JS reports, never what runs. update-wa-js.sh applies them after every update; when a
// new release no longer has the code an edit expects, this fails so the edit gets checked and dropped.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'wa-js', 'wppconnect-wa.js');
const NOTICE = '/*! Modified by Sondaggi in bozza: see scripts/patch-wa-js.mjs */\n';

const PATCHES = [
  // WhatsApp Web removed Lid1X1MigrationUtils.isLidMigrated. WA-JS wraps it at startup only to
  // swallow its exceptions, and logs two errors when it is missing.
  {
    name: 'isLidMigrated is an expected miss',
    find: 't.IGNORE_FAIL_MODULES=new Set([',
    replace: 't.IGNORE_FAIL_MODULES=new Set(["isLidMigrated",',
  },
  {
    name: 'isLidMigrated is wrapped only if present',
    find: '(0,c.wrapModuleFunction)(l.isLidMigrated,',
    replace: 'l.isLidMigrated&&(0,c.wrapModuleFunction)(l.isLidMigrated,',
  },
];

const count = (s, part) => s.split(part).length - 1;
let src = readFileSync(FILE, 'utf8');
const stale = [];
for (const p of PATCHES) {
  if (count(src, p.replace) === 1) continue;
  if (count(src, p.find) !== 1) { stale.push(p.name); continue; }
  src = src.replace(p.find, p.replace);
  console.log(`WA-JS patched: ${p.name}`);
}
if (stale.length) {
  console.error(`This WA-JS no longer has the code these patches expect:\n- ${stale.join('\n- ')}\n`
    + 'Check whether the release fixes them; then drop or adapt them in scripts/patch-wa-js.mjs.');
  process.exit(1);
}
if (!src.startsWith(NOTICE)) src = NOTICE + src;
writeFileSync(FILE, src);
