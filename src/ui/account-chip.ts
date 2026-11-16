import './account.css';
import { devLogin, fetchAccount, loginUrl, logout, saveDisplayName, type AccountState, type User } from '../net/account';
import type { WorldStatus } from '../net/world-client';

/**
 * Compte du joueur, en haut à droite des écrans plein écran (Accueil, Appareils, Séances), en face de la marque.
 * - Sans compte : le bouton officiel « Connect with Strava » et une ligne qui dit ce qu'on gagne, et ce qu'on garde sans
 *   compte (rouler seul, exporter le FIT). Aucune obligation : l'application marche entièrement sans.
 * - Connecté : une pastille avec l'initiale, le nom montré aux autres et l'état en ligne ; elle ouvre un petit menu
 *   (changer de nom, se déconnecter).
 * - Sans serveur de comptes : rien du tout.
 * Spécification : docs/design/compte.md.
 */
export interface AccountUi {
  state(): AccountState;
  /** État de la salle temps réel et nombre de coureurs, pour la ligne d'état de la pastille. */
  setWorld(status: WorldStatus, population: number): void;
}

const NAME_MAX = 32;

const initialOf = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '?';

const html = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function worldLine(status: WorldStatus, population: number): { text: string; tone: 'ok' | 'busy' | 'off' } {
  switch (status) {
    case 'online': {
      const others = Math.max(0, population - 1);
      return { text: others ? `En ligne · ${others} autre${others > 1 ? 's' : ''} coureur${others > 1 ? 's' : ''}` : 'En ligne · seul pour l’instant', tone: 'ok' };
    }
    case 'connecting':
      return { text: 'Connexion…', tone: 'busy' };
    case 'retrying':
      return { text: 'Connexion perdue, nouvel essai…', tone: 'busy' };
    case 'replaced':
      return { text: 'Connecté sur un autre appareil', tone: 'off' };
    case 'outdated':
      return { text: 'Mise à jour : recharger la page', tone: 'off' };
    case 'name-pending':
      return { text: 'Nom à valider', tone: 'off' };
    case 'signed-out':
      return { text: 'Session expirée', tone: 'off' };
    default:
      return { text: 'Hors ligne', tone: 'off' };
  }
}

export function setupAccount(o: {
  /** Les en-têtes `.home-top` des écrans plein écran : la pastille s'y ajoute, la même partout. */
  hosts: HTMLElement[];
  onChange: (s: AccountState) => void;
  log: (msg: string) => void;
}): AccountUi {
  let state: AccountState = { kind: 'unavailable' };
  let world: { status: WorldStatus; population: number } = { status: 'offline', population: 0 };

  const slots = o.hosts.map((host) => {
    const el = document.createElement('div');
    el.className = 'account';
    el.hidden = true;
    host.append(el);
    return el;
  });

  const dialog = document.createElement('dialog');
  dialog.className = 'rider-dialog name-dialog';
  dialog.setAttribute('aria-labelledby', 'name-title');
  dialog.innerHTML = `
    <form method="dialog" class="rider-card name-card">
      <div>
        <span class="home-kicker">Ton nom sur la route</span>
        <h2 id="name-title">Comment les autres te voient</h2>
      </div>
      <label class="name-field">
        <span>Nom affiché</span>
        <input id="name-input" name="name" type="text" maxlength="${NAME_MAX}" autocomplete="nickname" required />
      </label>
      <p class="note">Il s’affiche au-dessus de ton vélo et dans la liste des coureurs. Proposé d’après Strava : prénom et initiale. Rien d’autre de ton compte Strava n’est montré.</p>
      <p id="name-error" class="name-error" role="alert" hidden></p>
      <div class="row">
        <button type="button" class="secondary" id="name-later">Plus tard</button>
        <button type="submit" id="name-save">Valider</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const input = dialog.querySelector<HTMLInputElement>('#name-input')!;
  const error = dialog.querySelector<HTMLElement>('#name-error')!;
  const save = dialog.querySelector<HTMLButtonElement>('#name-save')!;
  dialog.querySelector('#name-later')!.addEventListener('click', () => dialog.close());
  dialog.querySelector('form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    save.disabled = true;
    try {
      const user = await saveDisplayName(input.value);
      if (state.kind === 'signed-in') set({ ...state, user });
      o.log(`compte : nom affiché « ${user.displayName} »`);
      dialog.close();
    } catch (err) {
      error.textContent =
        err instanceof Error && err.message === 'invalid_name'
          ? `Entre un nom de 1 à ${NAME_MAX} caractères.`
          : 'Enregistrement impossible, réessaie dans un instant.';
      error.hidden = false;
    } finally {
      save.disabled = false;
    }
  });

  function openNameDialog(user: User) {
    input.value = user.displayName;
    error.hidden = true;
    if (!dialog.open) dialog.showModal();
    input.select();
  }

  function renderOut(el: HTMLElement, s: Extract<AccountState, { kind: 'signed-out' }>) {
    el.className = 'account account-out';
    el.innerHTML = `
      <p class="account-pitch"><b>Rouler avec les autres</b><span>Sans compte : seul, export FIT</span></p>
      ${s.methods.strava ? `<a class="strava-connect" href="${loginUrl()}"><img src="/strava/connect-with-strava-orange.svg" alt="Connect with Strava" width="237" height="48" /></a>` : ''}
      ${s.methods.dev ? `<button type="button" class="secondary account-dev">Connexion de développement</button>` : ''}`;
    el.querySelector('.account-dev')?.addEventListener('click', async () => {
      const name = window.prompt('Nom du coureur (connexion de développement)', 'Tom L.');
      if (!name) return;
      try {
        const user = await devLogin(name);
        o.log(`compte : connecté en développement (${user.displayName})`);
        void refresh();
      } catch (e) {
        o.log(`compte : connexion de développement refusée (${e instanceof Error ? e.message : e})`);
      }
    });
  }

  function renderIn(el: HTMLElement, user: User) {
    const line = user.nameConfirmed ? worldLine(world.status, world.population) : worldLine('name-pending', 0);
    el.className = 'account account-in';
    el.innerHTML = `
      <button type="button" class="account-chip" data-tone="${line.tone}" aria-haspopup="menu" aria-expanded="false">
        <span class="account-avatar" aria-hidden="true">${html(initialOf(user.displayName))}</span>
        <span class="account-who"><b>${html(user.displayName)}</b><span class="account-status" data-tone="${line.tone}">${html(line.text)}</span></span>
        <svg class="account-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
      </button>
      <div class="account-menu" role="menu" hidden>
        <button type="button" role="menuitem" data-act="name">Changer de nom</button>
        <button type="button" role="menuitem" data-act="logout">Se déconnecter</button>
        <p class="account-note">Compatible with Strava</p>
      </div>`;
    const chip = el.querySelector<HTMLButtonElement>('.account-chip')!;
    const menu = el.querySelector<HTMLElement>('.account-menu')!;
    const toggle = (open: boolean) => {
      menu.hidden = !open;
      chip.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('button')?.focus();
    };
    chip.addEventListener('click', () => (user.nameConfirmed ? toggle(menu.hidden) : openNameDialog(user)));
    el.addEventListener('focusout', (e) => {
      if (!el.contains(e.relatedTarget as Node | null)) toggle(false);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        toggle(false);
        chip.focus();
      }
    });
    menu.addEventListener('click', async (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      toggle(false);
      if (act === 'name') openNameDialog(user);
      if (act === 'logout') {
        try {
          await logout();
          o.log('compte : déconnecté');
        } catch (err) {
          o.log(`compte : déconnexion impossible (${err instanceof Error ? err.message : err})`);
        }
        void refresh();
      }
    });
  }

  function render() {
    for (const el of slots) {
      el.hidden = state.kind === 'unavailable';
      if (state.kind === 'signed-out') renderOut(el, state);
      else if (state.kind === 'signed-in') renderIn(el, state.user);
      else el.innerHTML = '';
    }
  }

  function set(s: AccountState) {
    const firstSignIn = s.kind === 'signed-in' && !s.user.nameConfirmed && state.kind !== 'signed-in';
    state = s;
    render();
    o.onChange(s);
    if (firstSignIn && s.kind === 'signed-in') openNameDialog(s.user);
  }

  async function refresh() {
    set(await fetchAccount());
  }

  void refresh();

  return {
    state: () => state,
    setWorld(status, population) {
      if (status === world.status && population === world.population) return;
      world = { status, population };
      if (state.kind !== 'signed-in' || !state.user.nameConfirmed) return;
      const line = worldLine(status, population);
      for (const el of slots) {
        const s = el.querySelector<HTMLElement>('.account-status');
        if (!s) continue;
        s.textContent = line.text;
        s.dataset.tone = line.tone;
        el.querySelector<HTMLElement>('.account-chip')!.dataset.tone = line.tone;
      }
    },
  };
}
