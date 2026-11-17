import './device-chooser.css';
import type { Candidate, Chooser } from '../sensors/native-bluetooth';

/**
 * Sélecteur d'appareil Bluetooth de la coquille native, à la place de la liste du plugin : il garde les règles de tri de
 * Chrome (services, nom, exclusions, voir `matchesRequest`) et la charte de l'application. La liste se remplit au fil
 * du balayage, les appareils les plus proches en tête.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Force du signal en 0 à 3 barres. */
export function signalBars(rssi: number | undefined): number {
  if (rssi === undefined) return 0;
  return rssi >= -60 ? 3 : rssi >= -75 ? 2 : rssi >= -90 ? 1 : 0;
}

export const openDeviceChooser: Chooser = (found) =>
  new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'rider-dialog chooser-dialog';
    dialog.setAttribute('aria-labelledby', 'chooser-title');
    dialog.innerHTML = `
      <form method="dialog" class="rider-card chooser-card">
        <div>
          <span class="home-kicker">Bluetooth</span>
          <h2 id="chooser-title">Choisis ton appareil</h2>
        </div>
        <p class="chooser-status" role="status">Recherche… Allume l’appareil et pédale quelques tours pour le réveiller.</p>
        <ul class="chooser-list" aria-labelledby="chooser-title"></ul>
        <div class="row"><button type="submit" class="secondary" value="">Annuler</button></div>
      </form>`;
    document.body.append(dialog);
    const list = dialog.querySelector<HTMLUListElement>('.chooser-list')!;
    const status = dialog.querySelector<HTMLElement>('.chooser-status')!;
    let choice: string | undefined;

    const render = (items: Candidate[]) => {
      status.hidden = items.length > 0;
      const focused = (document.activeElement as HTMLElement | null)?.dataset?.id;
      list.innerHTML = items
        .map((c) => {
          const bars = signalBars(c.rssi);
          return `<li><button type="button" class="chooser-item" data-id="${esc(c.id)}">
            <span class="chooser-name">${esc(c.name ?? 'Appareil sans nom')}</span>
            <span class="chooser-signal" data-bars="${bars}" aria-label="signal ${bars} sur 3"><i></i><i></i><i></i></span>
          </button></li>`;
        })
        .join('');
      // La liste se redessine à chaque annonce : on garde l'appareil qui avait le focus.
      if (focused) list.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused)}"]`)?.focus();
    };
    const unsubscribe = found.subscribe(render);

    list.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('.chooser-item')?.dataset.id;
      if (!id) return;
      choice = id;
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      unsubscribe();
      dialog.remove();
      resolve(choice);
    }, { once: true });
    dialog.showModal();
  });
