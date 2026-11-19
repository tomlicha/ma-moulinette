'use strict';
// Lance les scénarios de bout en bout (voir README.md).
//   node tools/e2e/run.cjs [app] [gpu] [editor] [--out dossier] [--url adresse] [--port 5199]
// Sans nom de scénario, tous. Sans --url, le serveur de dev est lancé (et arrêté) ici.
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, loadPlaywright, startServer } = require('./lib.cjs');

const SCENARIOS = { app: './scenarios/app.cjs', autostart: './scenarios/autostart.cjs', gears: './scenarios/gears.cjs', recap: './scenarios/recap.cjs', gpu: './scenarios/gpu.cjs', editor: './scenarios/editor.cjs' };

function parseArgs(argv) {
  const args = { names: [], out: path.join(ROOT, '.e2e', 'last'), url: undefined, port: 5199 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a in SCENARIOS) args.names.push(a);
    else {
      console.error(`Argument inconnu : ${a}\nScénarios : ${Object.keys(SCENARIOS).join(', ')}`);
      process.exit(2);
    }
  }
  if (!args.names.length) args.names = Object.keys(SCENARIOS);
  return args;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const playwright = loadPlaywright();
  fs.mkdirSync(args.out, { recursive: true });
  const server = args.url ? { url: args.url, stop() {} } : await startServer(args.port);
  let failed = 0;
  try {
    for (const name of args.names) {
      const t0 = Date.now();
      let result;
      // Un navigateur par scénario : une page laissée ouverte (sortie en cours, rendu 3D) ralentirait le suivant.
      const browser = await playwright.chromium.launch();
      try {
        result = await require(SCENARIOS[name])({ playwright, browser, url: server.url });
      } catch (e) {
        result = { trace: { crash: String(e && e.stack ? e.stack : e) }, failures: [`le scénario a planté : ${e && e.message ? e.message : e}`] };
      } finally {
        await browser.close();
      }
      fs.writeFileSync(path.join(args.out, `${name}.json`), JSON.stringify(result.trace));
      const seconds = Math.round((Date.now() - t0) / 1000);
      if (result.failures.length) {
        failed += result.failures.length;
        console.log(`✗ ${name} (${seconds} s) : ${result.failures.length} échec(s)`);
        for (const f of result.failures) console.log(`    - ${f}`);
      } else {
        console.log(`✓ ${name} (${seconds} s)`);
      }
    }
  } finally {
    server.stop();
  }
  console.log(`\nTraces écrites dans ${args.out}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
