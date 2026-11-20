import type { AccountSession } from '../../app/account-session';

const html = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Fenêtre « Strava connecté », ouverte par la ligne Strava du menu du compte (événement `mm:strava-open`, comme Final Surge).
 * Elle dit ce que la connexion Strava donne et porte la seule déconnexion : la session Ma Moulinette s'ouvre avec Strava,
 * se déconnecter de Strava la ferme. Le menu du compte n'a aucun bouton de déconnexion direct.
 */
export function setupStravaDialog(o: { session: AccountSession }): void {
  const { session } = o;
  const dialog = document.createElement('dialog');
  dialog.className = 'rider-dialog name-dialog strava-dialog';
  dialog.setAttribute('aria-labelledby', 'strava-title');
  dialog.innerHTML = `
    <form method="dialog" class="rider-card name-card">
      <div class="strava-dialog-brand"><img class="strava-logo" src="/strava/strava-logo-orange.svg" alt="Strava" width="88" height="17"><span><span class="home-kicker">Compte</span><h2 id="strava-title">Strava connecté</h2></span></div>
      <p class="note" id="strava-who"></p>
      <p class="note">C’est avec Strava que tu ouvres ta session : elle te permet de rouler avec les autres et d’envoyer tes sorties sur Strava, d’un geste, à la fin de la sortie.</p>
      <p class="note">Te déconnecter ferme ta session sur cet appareil. Tu peux continuer à rouler seul et exporter le fichier FIT.</p>
      <div class="row">
        <button type="button" class="secondary" id="strava-logout">Se déconnecter de Strava</button>
        <button type="button" id="strava-close">Fermer</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const who = dialog.querySelector<HTMLElement>('#strava-who')!;
  const logout = dialog.querySelector<HTMLButtonElement>('#strava-logout')!;
  dialog.querySelector('#strava-close')!.addEventListener('click', () => dialog.close());
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await session.logout();
      dialog.close();
    } finally {
      logout.disabled = false;
    }
  });
  window.addEventListener('mm:strava-open', () => {
    const state = session.state;
    who.innerHTML = state.kind === 'signed-in' ? `Relié à ton coureur : <b>${html(state.user.displayName)}</b>` : '';
    if (!dialog.open) dialog.showModal();
  });
}
