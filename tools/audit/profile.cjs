const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const c = await p.context().newCDPSession(p);
  await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 200 }); await c.send('Profiler.start');
  await p.goto(process.argv[2], { waitUntil: 'load' }); await p.waitForTimeout(6000);
  const { profile } = await c.send('Profiler.stop');
  const byId = new Map(profile.nodes.map(n => [n.id, n])); const self = new Map();
  const dt = profile.timeDeltas; const counts = new Map();
  profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)));
  const parent = new Map(); profile.nodes.forEach(n => (n.children||[]).forEach(ch => parent.set(ch, n.id)));
  // inclusive time per file
  const incl = new Map(); const fnIncl = new Map();
  for (const [id, t] of counts) { const seenF = new Set(), seenFn = new Set(); let cur = id;
    while (cur) { const n = byId.get(cur); const u = n.callFrame.url.replace(/^.*5199\//,'').replace(/\?.*/,''); 
      if (u && !seenF.has(u)) { seenF.add(u); incl.set(u, (incl.get(u)||0)+t); }
      const fk = u + ':' + n.callFrame.functionName + ':' + n.callFrame.lineNumber; if (u && n.callFrame.functionName && !seenFn.has(fk)) { seenFn.add(fk); fnIncl.set(fk, (fnIncl.get(fk)||0)+t); }
      cur = parent.get(cur); } }
  const top = (m, k) => [...m].sort((a,b)=>b[1]-a[1]).slice(0,k).forEach(([u,t]) => console.log((t/1000).toFixed(0).padStart(6)+' ms  '+u));
  console.log('-- inclusive by file'); top(incl, 25); console.log('-- inclusive by function'); top(fnIncl, 40);
  await b.close();
})();
