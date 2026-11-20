// Budget du lancement : poids compressé (gzip) du JS et du CSS que dist/index.html charge avant tout affichage
// (scripts d'entrée, modulepreload et feuilles de style). Les modules chargés à la demande (vue 3D, export FIT…)
// n'y comptent pas. Échoue si un budget est dépassé : relever le chiffre ici doit être une décision, pas un oubli.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// JS : 100 Kio jusqu'au 20 novembre 2026, relevé à 110 sur décision de Tom (nouveautés, marge de 0,1 Kio seulement).
const BUDGET_KIB = { js: 110, css: 30 };

// fileURLToPath, pas `.pathname` : sous Windows, `.pathname` donne « /C:/… », que `join` double en « C:\C:\… ».
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = { js: new Set(), css: new Set() };
for (const m of html.matchAll(/<script[^>]*\bsrc="\/([^"]+\.js)"/g)) refs.js.add(m[1]);
for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\/([^"]+\.js)"/g)) refs.js.add(m[1]);
for (const m of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\/([^"]+\.css)"/g)) refs.css.add(m[1]);

let failed = false;
for (const kind of /** @type {const} */ (['js', 'css'])) {
  let total = 0;
  for (const file of refs[kind]) {
    const kib = gzipSync(readFileSync(join(dist, file)), { level: 9 }).length / 1024;
    total += kib;
    console.log(`  ${file.padEnd(48)} ${kib.toFixed(1).padStart(7)} Kio`);
  }
  const ok = total <= BUDGET_KIB[kind];
  failed ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${kind.toUpperCase()} au lancement : ${total.toFixed(1)} Kio gzip (budget ${BUDGET_KIB[kind]} Kio)\n`);
}
if (refs.js.size === 0) {
  console.error('Aucun script trouvé dans dist/index.html : lancer `npm run build` d’abord.');
  failed = true;
}
process.exit(failed ? 1 : 0);
