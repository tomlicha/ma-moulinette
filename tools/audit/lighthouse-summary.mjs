import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const r = JSON.parse(fs.readFileSync(f));
  console.log('=====', f, r.runtimeError?.message ?? '');
  for (const [k, c] of Object.entries(r.categories)) console.log(k, Math.round(c.score * 100));
  const a = r.audits;
  for (const id of ['first-contentful-paint','largest-contentful-paint','total-blocking-time','cumulative-layout-shift','speed-index','interactive','max-potential-fid','server-response-time','total-byte-weight','dom-size','bootup-time','mainthread-work-breakdown','unused-javascript','unused-css-rules','render-blocking-resources','uses-long-cache-ttl','font-display','largest-contentful-paint-element'])
    if (a[id]) console.log(' ', id, a[id].score, a[id].displayValue ?? '');
  console.log(' -- failing (score<0.9):');
  for (const [id, x] of Object.entries(a)) if (x.score !== null && x.score < 0.9 && x.scoreDisplayMode !== 'informative' && x.scoreDisplayMode !== 'notApplicable') console.log('   ', id, x.score, '|', x.title, '|', x.displayValue ?? '');
}
