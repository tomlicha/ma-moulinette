import { connectFinalSurge, disconnectFinalSurge, finalSurgeStatus } from '../../infra/net/final-surge';
import type { FinalSurgeSyncResult } from '../../app/final-surge-sync';

function summary(result: FinalSurgeSyncResult): string {
  return `Final Surge : ${result.created} créée(s), ${result.updated} mise(s) à jour, ${result.unchanged} inchangée(s), ${result.skipped} ignorée(s).`;
}

export function setupFinalSurgeDialog(options: {
  syncWorkouts: () => Promise<FinalSurgeSyncResult>;
  onImported: () => void;
  log: (message: string) => void;
}): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'rider-dialog name-dialog';
  dialog.setAttribute('aria-labelledby', 'final-surge-title');
  dialog.innerHTML = `
    <form class="rider-card name-card final-surge-card">
      <div><span class="home-kicker">Synchronisation automatique</span><h2 id="final-surge-title">Final Surge</h2></div>
      <p class="note">Après connexion, les séances des 14 prochains jours sont importées automatiquement. Elles sont resynchronisées à chaque réouverture de l’application, sans créer de doublons.</p>
      <div class="fs-credentials">
        <label class="name-field"><span>Adresse courriel</span><input name="email" type="email" autocomplete="username" required maxlength="254"></label>
        <label class="name-field"><span>Mot de passe Final Surge</span><input name="password" type="password" autocomplete="current-password" required maxlength="1024"></label>
        <button type="button" data-act="connect">Connecter Final Surge</button>
      </div>
      <div class="fs-connected" hidden>
        <p class="note">Compte Final Surge connecté.</p>
        <button type="button" data-act="sync">Synchroniser maintenant</button>
        <button type="button" class="secondary" data-act="disconnect">Déconnecter Final Surge</button>
      </div>
      <p class="note fs-status" role="status" aria-live="polite"></p>
      <ul class="fs-errors" hidden></ul>
      <div class="row"><button type="button" class="secondary" data-act="close">Fermer</button></div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form')!;
  const credentials = dialog.querySelector<HTMLElement>('.fs-credentials')!;
  const connected = dialog.querySelector<HTMLElement>('.fs-connected')!;
  const status = dialog.querySelector<HTMLElement>('.fs-status')!;
  const errors = dialog.querySelector<HTMLUListElement>('.fs-errors')!;
  const email = form.elements.namedItem('email') as HTMLInputElement;
  const password = form.elements.namedItem('password') as HTMLInputElement;

  const showStatus = (message: string) => { status.textContent = message; };
  const setConnected = (value: boolean) => { credentials.hidden = value; connected.hidden = !value; };
  async function refresh() {
    try { const state = await finalSurgeStatus(); setConnected(state.connected); }
    catch { setConnected(false); showStatus('Service Final Surge indisponible.'); }
  }
  async function synchronize() {
    showStatus('Synchronisation des séances Final Surge…');
    const result = await options.syncWorkouts();
    options.onImported();
    errors.replaceChildren(...result.errors.map((message) => {
      const li = document.createElement('li');
      li.textContent = message;
      return li;
    }));
    errors.hidden = !result.errors.length;
    showStatus(summary(result));
    options.log(summary(result));
  }

  dialog.addEventListener('click', async (event) => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
    if (!action) return;
    if (action === 'close') { dialog.close(); return; }
    errors.hidden = true;
    errors.replaceChildren();
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')!;
    button.disabled = true;
    try {
      if (action === 'connect') {
        await connectFinalSurge(email.value, password.value);
        password.value = '';
        setConnected(true);
        await synchronize();
      } else if (action === 'disconnect') {
        await disconnectFinalSurge();
        showStatus('Compte Final Surge déconnecté.');
        await refresh();
      } else if (action === 'sync') {
        await synchronize();
      }
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Opération Final Surge impossible.');
    } finally {
      button.disabled = false;
    }
  });
  window.addEventListener('mm:final-surge-open', () => {
    showStatus('');
    errors.hidden = true;
    void refresh();
    if (!dialog.open) dialog.showModal();
  });
}
