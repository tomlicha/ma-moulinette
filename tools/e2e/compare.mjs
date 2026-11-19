// Compare deux séries de traces (dossiers écrits par run.cjs) : « le comportement a-t-il changé ? » après une refonte.
//   node tools/e2e/compare.mjs <avant> <après>
// - app, gpu : états des boutons et lignes du journal (chiffres neutralisés, ordre ignoré : les ordres de journal varient
//   d'une exécution à l'autre, la ligne « rendu 3D » surtout) ;
// - editor : le DOM complet de l'écran Séances, étape par étape.
import fs from 'node:fs';
import path from 'node:path';

const [dirA, dirB] = process.argv.slice(2);
if (!dirA || !dirB) {
  console.error('Usage : node tools/e2e/compare.mjs <dossier-avant> <dossier-après>');
  process.exit(2);
}

const read = (dir, name) => {
  const file = path.join(dir, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
};
// Les chiffres du journal, et les adresses `blob:` (le portrait du coureur en change à chaque exécution).
const neutral = (text) => text.replace(/blob:[^"')\s]+/g, 'blob:URL').replace(/\d+(\.\d+)?/g, '#');
const counts = (lines) => lines.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());

let diffs = 0;
const say = (message) => {
  diffs++;
  console.log(`  ${message}`);
};

function compareLogs(a, b, ignore = () => false) {
  const A = counts(a.filter((l) => !ignore(l)).map(neutral));
  const B = counts(b.filter((l) => !ignore(l)).map(neutral));
  for (const k of new Set([...A.keys(), ...B.keys()])) {
    if ((A.get(k) ?? 0) !== (B.get(k) ?? 0)) say(`journal « ${k} » : ${A.get(k) ?? 0} → ${B.get(k) ?? 0}`);
  }
}

function compareApp(a, b) {
  if (a.errors.length !== b.errors.length) say(`erreurs : ${a.errors.length} → ${b.errors.length}`);
  a.steps.forEach((x, i) => {
    const y = b.steps[i];
    if (!y) return say(`étape « ${x.label} » absente après`);
    for (const k of Object.keys(x)) {
      if (k === 'route') continue; // le HUD change à chaque instant
      const vx = typeof x[k] === 'string' ? neutral(x[k]) : x[k];
      const vy = typeof y[k] === 'string' ? neutral(y[k]) : y[k];
      if (vx === vy) continue;
      if (typeof x[k] === 'string' && x[k].length > 300) {
        // Un DOM entier : on montre où il diffère plutôt que tout le texte.
        let p = 0;
        while (p < x[k].length && x[k][p] === y[k][p]) p++;
        say(`étape « ${x.label} » : ${k} diffère à la position ${p}\n      avant : …${x[k].slice(Math.max(0, p - 60), p + 140)}\n      après : …${String(y[k]).slice(Math.max(0, p - 60), p + 140)}`);
      } else say(`étape « ${x.label} » : ${k} : ${JSON.stringify(x[k])} → ${JSON.stringify(y[k])}`);
    }
  });
  compareLogs(a.log, b.log, (l) => l.startsWith('rendu '));
}

function compareGpu(a, b) {
  if (JSON.stringify(a.steps) !== JSON.stringify(b.steps)) say(`étapes : ${JSON.stringify(a.steps)} → ${JSON.stringify(b.steps)}`);
  compareLogs(a.log, b.log);
}

function compareEditor(a, b) {
  a.forEach((x, p) => {
    const y = b[p];
    if (!y) return say(`profil ${x.name} absent après`);
    if (JSON.stringify(x.dialogs) !== JSON.stringify(y.dialogs)) say(`${x.name} : boîtes de dialogue ${JSON.stringify(x.dialogs)} → ${JSON.stringify(y.dialogs)}`);
    if (x.errors.length !== y.errors.length) say(`${x.name} : erreurs ${x.errors.length} → ${y.errors.length}`);
    x.steps.forEach((s, i) => {
      const t = y.steps[i];
      if (!t) return say(`${x.name} : étape « ${s.label} » absente après`);
      if (s.html === t.html) return;
      let k = 0;
      while (k < s.html.length && s.html[k] === t.html[k]) k++;
      say(`${x.name} · « ${s.label} » : le DOM diffère à la position ${k}\n      avant : …${s.html.slice(Math.max(0, k - 60), k + 140)}\n      après : …${t.html.slice(Math.max(0, k - 60), k + 140)}`);
    });
  });
}

const KINDS = { app: compareApp, gpu: compareGpu, editor: compareEditor };
let compared = 0;
for (const [name, fn] of Object.entries(KINDS)) {
  const a = read(dirA, name);
  const b = read(dirB, name);
  if (!a || !b) continue;
  compared++;
  const before = diffs;
  console.log(`${name} :`);
  fn(a, b);
  if (diffs === before) console.log('  identique');
}
if (!compared) {
  console.error('Aucun scénario en commun entre les deux dossiers.');
  process.exit(2);
}
console.log(diffs ? `\n${diffs} différence(s)` : '\nAucune différence.');
process.exit(diffs ? 1 : 0);
