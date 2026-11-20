// Résumé des rapports de `check.mjs` : textes sous 12 px réels, cibles sous 44 px, panneaux qui se chevauchent ou débordent.
import { readFileSync } from 'node:fs';
const dir = process.argv[2];
const MIN_TEXT = 12;
const MIN_TARGET = 44;
for (const d of (process.argv[3] ?? 'iphone13,pixel9').split(',')) {
  const r = JSON.parse(readFileSync(`${dir}/${d}-rapport.json`, 'utf8'));
  console.log(`\n===== ${r.device} =====  zones sûres émulées : ${r.safeAreaApplied}  erreurs JS : ${r.errors.length}`);
  for (const [name, s] of Object.entries(r.steps)) {
    console.log(`\n--- ${name} --- fenêtre ${s.viewport.W}×${s.viewport.H} · tactile ${s.coarse} · paysage ${s.landscape} · mode téléphone ${s.phone}`);
    const small = new Map();
    for (const t of s.texts) if (t.px < MIN_TEXT) small.set(`${t.cls}|${t.px}`, t);
    const smallList = [...small.values()].sort((a, b) => a.px - b.px);
    console.log(`textes : ${s.texts.length} · plus petit ${Math.min(...s.texts.map((t) => t.px))} px · sous ${MIN_TEXT} px : ${smallList.length}`);
    for (const t of smallList.slice(0, 12)) console.log(`   ${t.px} px  « ${t.t} »  (${t.cls})`);
    const tiny = s.targets.filter((t) => Math.min(t.w, t.h) < MIN_TARGET);
    console.log(`cibles tactiles : ${s.targets.length} · sous ${MIN_TARGET} px : ${tiny.length}`);
    for (const t of tiny.slice(0, 12)) console.log(`   ${t.w}×${t.h}  « ${t.t} »  (${t.id})`);
    const keys = Object.keys(s.panels);
    for (const k of keys) {
      const p = s.panels[k];
      const out = p.x < 0 || p.y < 0 || p.r > s.viewport.W || p.b > s.viewport.H;
      if (out) console.log(`   ⚠ ${k} déborde de la fenêtre : x ${p.x} y ${p.y} r ${p.r} b ${p.b}`);
    }
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = s.panels[keys[i]], b = s.panels[keys[j]];
      // Boîtes de dialogue modales (carte du monde, nouveautés) : elles recouvrent l'écran par construction.
      const DIALOGS = ['.map-card', '.course-card', '.wn-card', '.wnj-panel'];
      if (DIALOGS.includes(keys[i]) || DIALOGS.includes(keys[j])) continue;
      const w = Math.min(a.r, b.r) - Math.max(a.x, b.x), h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
      if (w > 2 && h > 2) console.log(`   ⚠ chevauchement ${keys[i]} / ${keys[j]} : ${w}×${h} px`);
    }
    if (name === 'carrefour' || name === 'carrefour-message') console.log('   panneaux :', JSON.stringify(s.panels));
  }
}
