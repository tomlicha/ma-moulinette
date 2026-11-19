'use strict';
// Vitesses virtuelles du Zwift Cog : l'interrupteur et le plateau du menu de la sortie, les boutons et le clavier du
// sélecteur, le journal, et la mémoire des réglages d'un chargement à l'autre.
const { openPage, sleep, Steps } = require('../lib.cjs');

module.exports = async function gears({ browser, url }) {
  const { page, errors } = await openPage(browser, { viewport: { width: 1280, height: 800 } }, url);
  await sleep(1500);

  const go = (hash) => page.evaluate((h) => (location.hash = h), hash);
  const snapshot = (label) =>
    page.evaluate((label) => {
      const t = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
      const el = (id) => document.getElementById(id);
      return {
        label,
        toggle: el('cog-toggle')?.checked ?? null,
        ringRowHidden: el('cog-ring-row')?.hidden ?? null,
        ring: el('cog-ring')?.value ?? null,
        shifterHidden: el('ride-gears')?.hidden ?? null,
        gear: t('gear-out'),
        title: el('gear-out')?.title ?? null,
        upDisabled: el('gear-up')?.disabled ?? null,
        downDisabled: el('gear-down')?.disabled ?? null,
      };
    }, label);
  const steps = new Steps(snapshot);
  const setChecked = (id, on) =>
    page.evaluate(
      ({ id, on }) => {
        const e = document.getElementById(id);
        e.checked = on;
        e.dispatchEvent(new Event('change'));
      },
      { id, on },
    );
  const setValue = (id, v) =>
    page.evaluate(
      ({ id, v }) => {
        const e = document.getElementById(id);
        e.value = v;
        e.dispatchEvent(new Event('change'));
      },
      { id, v },
    );
  const click = (id) => page.evaluate((id) => document.getElementById(id)?.click(), id);

  await steps.mark('au départ : sans Cog', { toggle: false, shifterHidden: true, ringRowHidden: true, ring: '34' });

  await setChecked('cog-toggle', true);
  await steps.mark('Cog monté', { toggle: true, shifterHidden: false, ringRowHidden: false });

  await click('gear-up');
  await click('gear-up');
  await steps.mark('deux vitesses de plus', {});
  await click('gear-down');
  await steps.mark('une de moins', {});

  // Au clavier : seulement sur l'écran Sortie, hors boîte de dialogue.
  await go('#accueil');
  await sleep(300);
  await page.keyboard.press('ArrowUp');
  await steps.mark('flèche haut hors de la Sortie : rien', {});
  await go('#sortie');
  await sleep(300);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('+');
  await steps.mark('flèche haut et + sur la Sortie : deux vitesses', {});
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('-');
  await steps.mark('flèche bas et − : deux de moins', {});

  // Butées.
  for (let i = 0; i < 30; i++) await click('gear-down');
  await steps.mark('butée basse', { downDisabled: true, gear: '1' });
  for (let i = 0; i < 40; i++) await click('gear-up');
  await steps.mark('butée haute', { upDisabled: true, gear: '24' });

  // Plateau.
  await setValue('cog-ring', '52');
  await steps.mark('plateau 52', { ring: '52' });
  await setValue('cog-ring', '99');
  await steps.mark('plateau hors bornes : on garde 52', { ring: '52' });
  await setValue('cog-ring', '39.6');
  await steps.mark('plateau 39,6 arrondi à 40', { ring: '40' });

  // Mémoire : un rechargement retrouve le Cog et le plateau.
  await page.reload();
  await sleep(1500);
  await steps.mark('après rechargement : Cog et plateau retrouvés', { toggle: true, ring: '40', shifterHidden: false });

  await setChecked('cog-toggle', false);
  await steps.mark('Cog démonté', { toggle: false, shifterHidden: true });

  const raw = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
  const log = raw
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace(/^\d\d:\d\d:\d\d\s+/, ''));
  if (errors.length) steps.fail(`erreurs de la page : ${errors.join(' | ')}`);

  return { trace: { errors, steps: steps.list, log }, failures: steps.failures };
};
