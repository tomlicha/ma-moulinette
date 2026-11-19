'use strict';
// Éditeur de séance (écran Séances) : une quarantaine de gestes, sur ordinateur puis sur iPhone en paysage (plein écran,
// 844 × 390). À chaque étape on garde le DOM complet de l'écran (pour comparer avant et après une refonte) et on vérifie
// ce que le geste doit avoir fait.
const { openPage, sleep, Steps } = require('../lib.cjs');

const PROFILES = (devices) => [
  { name: 'ordinateur', ctx: { viewport: { width: 1280, height: 800 } }, phone: false },
  { name: 'iphone-paysage', ctx: { ...devices['iPhone 13 landscape'], viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } }, phone: true },
];

/** « 55:15 » ou « 1 h 05 » (durée de la séance, affichée sous le titre) → secondes ; au-delà d'une heure, à la minute près. */
const seconds = (sub) => {
  const long = /^(\d+) h (\d+)/.exec(sub ?? '');
  if (long) return Number(long[1]) * 3600 + Number(long[2]) * 60;
  const short = /^(\d+):(\d+)/.exec(sub ?? '');
  return short ? Number(short[1]) * 60 + Number(short[2]) : undefined;
};

async function run({ playwright, browser, url }, profile) {
  const { page, errors, dialogs } = await openPage(browser, profile.ctx, url);
  await sleep(1200);
  await page.evaluate(() => (location.hash = '#seances'));
  await sleep(500);

  const click = async (sel, nth = 0) => {
    const loc = page.locator(sel).nth(nth);
    if (await loc.count()) await loc.evaluate((e) => e.click());
    await sleep(120);
  };
  const setVal = async (sel, v) => {
    await page.evaluate(
      ([s, val]) => {
        const e = document.querySelector(s);
        e.value = val;
        e.dispatchEvent(new Event('input', { bubbles: true }));
      },
      [sel, v],
    );
    await sleep(150);
  };
  const box = (sel) => page.locator(sel).first().boundingBox();
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    await page.mouse.up();
    await sleep(200);
  };
  const press = async (key) => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press(key);
    await sleep(120);
  };
  const evalClick = (fn) => page.evaluate(fn);

  const steps = new Steps(async (label) => {
    const raw = await page.evaluate(() => {
      const sea = document.querySelector('[data-view="seances"]');
      const copy = sea?.cloneNode(true);
      copy?.querySelector('#sea-scenes')?.remove(); // fond décoratif animé : change d'une exécution à l'autre
      const dlg = [...document.querySelectorAll('dialog[open]')].map((d) => d.id).join(',');
      return {
        html: (copy?.innerHTML ?? '') + '\n<!--dialogs:' + dlg + '-->',
        sub: document.getElementById('ed-sub')?.textContent?.trim() ?? '',
        saved: document.querySelectorAll('.sea-lib [data-key^="lib:"]').length,
        panel: sea?.querySelector('.sea')?.dataset.panel ?? document.querySelector('.sea')?.dataset.panel ?? '',
        draftName: document.querySelector('.sea-lib [data-key="draft"] strong')?.textContent ?? null,
        desc: document.getElementById('ed-desc')?.value ?? '',
        overlayButtons: document.querySelectorAll('#ed-over button').length,
        invalid: document.querySelectorAll('#ed-pop input.invalid').length,
        dialogs: dlg,
      };
    });
    return {
      label,
      ...raw,
      // Les UUID changent à chaque exécution ; les espaces ne comptent pas.
      html: raw.html.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID').replace(/\s+/g, ' '),
      durationS: seconds(raw.sub),
      load: Number(/charge (\d+)/.exec(raw.sub)?.[1]),
    };
  });

  const edited = { sub: /modifiée/ };

  await steps.mark('écran ouvert', { sub: /lecture seule/, saved: 0 });
  if (profile.phone) {
    await click('[data-open-panel="lib"]');
    await steps.mark('panneau bibliothèque', { panel: 'lib' });
    await click('[data-open-panel="lib"]');
  }
  await click('#ed-copy');
  await steps.mark('modèle dupliqué', { sub: (v) => /modifiée/.test(v) && !/lecture seule/.test(v) });
  await setVal('#ed-name', 'Ma séance de test');
  await steps.mark('nom saisi', { draftName: 'Ma séance de test', ...edited });
  await setVal('#ed-desc', 'Une description');
  await steps.mark('description saisie', { desc: 'Une description' });
  await click('.sh-card', 0);
  await steps.mark('bloc ajouté depuis l’étagère', (s, p) => (s.durationS > p.durationS ? undefined : 'le bloc ajouté n’allonge pas la séance'));
  await click('.sh-tab', 2);
  await click('.sh-card', 1);
  await steps.mark('autre onglet, autre bloc', (s, p) => (s.durationS > p.durationS ? undefined : 'le bloc ajouté n’allonge pas la séance'));
  await click('.sh-tab', 1);
  await click('.sh-card', 0);
  await steps.mark('bloc par zone', (s, p) => (s.durationS > p.durationS ? undefined : 'le bloc ajouté n’allonge pas la séance'));
  await click('#bb-prev');
  await steps.mark('bloc précédent (bouton)', (s, p) => (s.html !== p.html ? undefined : 'la sélection n’a pas changé'));
  await click('#bb-next');
  await steps.mark('bloc suivant (bouton)', (s, p) => (s.html !== p.html ? undefined : 'la sélection n’a pas changé'));
  if (!profile.phone) {
    const p = await box('#ed-plot');
    if (p) {
      await page.mouse.click(p.x + p.width * 0.2, p.y + p.height * 0.6);
      await sleep(150);
      await steps.mark('bloc choisi sur le profil', (s, prev) => (s.html !== prev.html ? undefined : 'un clic sur le profil n’a rien sélectionné'));
      await page.mouse.move(p.x + p.width * 0.6, p.y + p.height * 0.5);
      await sleep(150);
      await steps.mark('info-bulle du profil', (s, prev) => (s.html !== prev.html ? undefined : 'pas d’info-bulle'));
      await page.mouse.move(5, 5);
    }
    const card = await box('.sh-card');
    if (p && card) {
      await drag({ x: card.x + card.width / 2, y: card.y + card.height / 2 }, { x: p.x + p.width * 0.5, y: p.y + p.height * 0.5 });
      await steps.mark('carte glissée sur le profil', (s, prev) => (s.durationS > prev.durationS ? undefined : 'la carte déposée n’a rien ajouté'));
    }
    const handle = await box('#bb-handle');
    if (p && handle && (await page.locator('#bb-handle').isVisible())) {
      await drag({ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: p.x + p.width * 0.85, y: p.y + p.height * 0.5 });
      await steps.mark('bloc déplacé par sa poignée', (s, prev) => (s.html !== prev.html && s.durationS === prev.durationS ? undefined : 'le bloc n’a pas changé de place (ou la durée a changé)'));
    }
  }
  await click('#ed-inspector button', 0);
  await click('#ed-inspector button', 1);
  await steps.mark('boutons de l’inspecteur');
  await page.evaluate(() => {
    const i = document.querySelector('#ed-inspector input');
    if (i) {
      i.focus();
      i.value = '61';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(150);
  await steps.mark('champ de l’inspecteur modifié', (s, p) => (s.html !== p.html ? undefined : 'la saisie n’a rien changé'));
  await page.evaluate(() => document.activeElement?.blur?.());
  await sleep(150);
  await steps.mark('champ quitté');
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowUp']) await press(k);
  await steps.mark('puissance +15 %', (s, p) => (s.load >= p.load ? undefined : 'la charge a baissé'));
  await press('ArrowDown');
  await steps.mark('puissance -5 %', (s, p) => (s.load <= p.load ? undefined : 'la charge a monté'));
  await press('ArrowLeft');
  await steps.mark('bloc précédent sélectionné', (s, p) => (s.html !== p.html ? undefined : 'la sélection n’a pas changé'));
  await press('Shift+ArrowRight');
  await press('Shift+ArrowRight');
  await steps.mark('durée allongée', (s, p) => (s.html !== p.html && s.load >= p.load ? undefined : 'la durée du bloc n’a pas changé'));
  await press('Control+z');
  await press('Control+z');
  await steps.mark('deux annulations', (s, p, all) => (s.load === all.byLabel('bloc précédent sélectionné').load && s.html !== p.html ? undefined : 'les deux annulations n’ont pas rendu la séance d’avant'));
  await press('Control+y');
  await steps.mark('un rétablissement', (s, p) => (s.html !== p.html ? undefined : 'le rétablissement n’a rien rendu'));
  await click('#ed-undo');
  await click('#ed-redo');
  await steps.mark('annuler, rétablir par les boutons', (s, p) => (s.durationS === p.durationS ? undefined : 'annuler puis rétablir a changé la séance'));
  await click('#bb-prev');
  await steps.mark('bloc choisi dans la bande');
  await evalClick(() => [...document.querySelectorAll('#ed-inspector button')].find((b) => /Cadence/.test(b.textContent))?.click());
  await sleep(150);
  await steps.mark('cadence cible', (s) => (/ed-cadence/.test(s.dialogs) ? undefined : 'le dialogue de cadence ne s’est pas ouvert'));
  await page.evaluate(() => {
    const d = document.getElementById('ed-cadence');
    if (d?.open) d.close();
  });
  await press('Delete');
  await steps.mark('bloc supprimé', (s, p) => (s.durationS < p.durationS ? undefined : 'le bloc supprimé n’a pas raccourci la séance'));
  await click('#ed-undo');
  await steps.mark('suppression annulée', (s, p, all) => (s.durationS > p.durationS ? undefined : 'annuler n’a pas rendu le bloc'));
  await click('#ed-save');
  await sleep(250);
  await steps.mark('enregistrée', { saved: 1, sub: (v) => !/modifiée|lecture seule/.test(v) });
  const savedDuration = steps.last.durationS;
  await click('#ed-export');
  await steps.mark('exportée', { saved: 1 });
  await click('#lib-new');
  await sleep(200);
  await steps.mark('nouvelle séance', { saved: 1, draftName: 'Nouvelle séance', ...edited });
  await setVal('#ed-name', 'Brouillon');
  await steps.mark('brouillon nommé', { draftName: 'Brouillon' });
  await setVal('#lib-search', 'ma s');
  await steps.mark('recherche', { saved: 1 });
  await setVal('#lib-search', 'zzzz');
  await steps.mark('recherche sans résultat', { saved: 0 });
  await setVal('#lib-search', '');
  await click('.sea-lib [data-key^="lib:"]');
  await sleep(250);
  await steps.mark('séance enregistrée rouverte', { sub: (v) => !/modifiée|lecture seule/.test(v), durationS: savedDuration });
  await click('.sea-lib [data-key^="sample:"]', 1);
  await sleep(250);
  await steps.mark('autre modèle ouvert', { sub: /lecture seule/ });
  await page.evaluate(() => {
    const f = document.getElementById('wo-ftp');
    f.value = '250';
    f.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(300);
  await steps.mark('FTP changée', (s, p) => (s.html !== p.html ? undefined : 'la nouvelle FTP n’a rien changé à l’affichage'));
  if (profile.phone) {
    await click('#ed-copy'); // le modèle ouvert devient une séance à soi : ses commandes apparaissent sur le profil
    for (let i = 0; i < 4; i++) await click('#ed-over button', i);
    await steps.mark('commandes posées sur le bloc', { overlayButtons: (n) => n > 0 });
    await page.evaluate(() => document.querySelector('#ed-over .ov-val')?.click());
    await sleep(200);
    await steps.mark('saisie exacte ouverte', { panel: 'edit' });
    await page.evaluate(() => {
      const i = document.getElementById('pop-pct');
      i.value = '73';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(100);
    await steps.mark('pourcentage saisi (watts suivent)', { panel: 'edit' });
    await page.evaluate(() => {
      document.getElementById('pop-pct').value = '999';
      document.getElementById('ed-pop').requestSubmit();
    });
    await sleep(150);
    await steps.mark('saisie invalide refusée', { panel: 'edit', invalid: (n) => n > 0 });
    await page.evaluate(() => {
      document.getElementById('pop-pct').value = '73';
      document.getElementById('ed-pop').requestSubmit();
    });
    await sleep(200);
    await steps.mark('saisie validée', { panel: '', invalid: 0 });
    await click('[data-open-panel="more"]');
    await steps.mark('menu plus', { panel: 'more' });
    await click('[data-open-panel="more"]');
  }
  await click('.sea-lib [data-key^="lib:"]');
  await sleep(250);
  await steps.mark('retour à la séance enregistrée', { sub: (v) => !/modifiée|lecture seule/.test(v) });
  await click('.sea-lib .lib-del');
  await sleep(300);
  await steps.mark('séance supprimée', { saved: 0 });

  if (!dialogs.some((d) => /^confirm: Supprimer la séance/.test(d))) steps.fail('la suppression n’a pas demandé de confirmation');
  if (errors.length) steps.fail(`erreurs de la page : ${errors.join(' | ')}`);
  await page.context().close(); // le profil suivant repart d'un navigateur au repos
  return { trace: { name: profile.name, errors, dialogs, steps: steps.list }, failures: steps.failures.map((f) => `${profile.name} : ${f}`) };
}

module.exports = async function editor(ctx) {
  const traces = [];
  const failures = [];
  for (const profile of PROFILES(ctx.playwright.devices)) {
    const r = await run(ctx, profile);
    traces.push(r.trace);
    failures.push(...r.failures);
  }
  return { trace: traces, failures };
};
