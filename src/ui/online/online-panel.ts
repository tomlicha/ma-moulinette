import './online.css';
import type { GroupMember, GroupState, GroupSummary, OnlineRider } from '../../infra/net/group-protocol';
import { ICON_CLOSE } from '../whatsnew/whats-new-art';
import { START_DELAYS, countdownText, durationText, groupLine, riderStatus, ridersTitle } from './online-model';

/**
 * « Rouler avec d'autres » (docs/design/groupe.md) : un panneau qui glisse depuis la droite, ouvert depuis l'accueil. Les
 * coureurs en ligne (avec recherche) et leur bouton **Rejoindre**, les séances de groupe ouvertes, de quoi **créer** la sienne
 * (la séance et le parcours choisis sur l'accueil), et, une fois dans un groupe, la salle d'attente avec le décompte.
 * Il affiche et signale des intentions ; ce que la salle en fait est dans `GroupSession` et `FollowSession`.
 */

export interface OnlineActions {
  /** Demande la liste à la salle (`q` : filtre sur le nom). */
  search(q: string): void;
  /** Rejoindre un coureur en sortie : la sortie repart derrière lui. */
  joinRider(slot: number, name: string): void;
  joinGroup(id: string): void;
  /** Créer une séance de groupe qui démarre dans `startInS` secondes. */
  createGroup(startInS: number): void;
  leaveGroup(): void;
  /** Le panneau se ferme : plus besoin de rafraîchir la liste. */
  onClose(): void;
}

/** Ce que la création d'une séance de groupe va prendre : la séance et le parcours choisis sur l'accueil. */
export interface CreatePlan {
  workoutName?: string;
  courseName: string;
}

// Gabarit statique : aucune donnée n'y est écrite, le contenu passe par textContent.
const TEMPLATE = `
<aside class="op-panel">
  <header class="op-head">
    <h2 id="op-title" class="op-title">Rouler avec d’autres</h2>
    <button class="op-close" type="button" data-o="close" aria-label="Fermer">${ICON_CLOSE}</button>
  </header>
  <div class="op-scroll" data-o="scroll">
    <p class="op-block" data-o="block" role="status" hidden></p>
    <p class="op-notice" data-o="notice" role="status" hidden></p>

    <section class="op-lobby" data-o="lobby" aria-labelledby="op-lobby-title" hidden>
      <p class="op-kicker">Salle d’attente</p>
      <h3 id="op-lobby-title" class="op-name" data-o="lobby-name"></h3>
      <p class="op-sub" data-o="lobby-sub"></p>
      <p class="op-sub" data-o="lobby-leader"></p>
      <p class="op-count" data-o="lobby-count" aria-live="polite"></p>
      <ul class="op-list" data-o="lobby-members" aria-label="Coureurs du groupe"></ul>
      <button class="op-btn op-btn-quiet" type="button" data-o="leave">Quitter le groupe</button>
    </section>

    <div data-o="browse">
      <label class="op-search"><span class="op-sr">Chercher un coureur</span><input type="search" data-o="q" maxlength="40" placeholder="Chercher un coureur" autocomplete="off" enterkeyhint="search" /></label>

      <section aria-labelledby="op-groups-title">
        <h3 id="op-groups-title" class="op-kicker">Séances de groupe</h3>
        <ul class="op-list" data-o="groups"></ul>
        <p class="op-empty" data-o="groups-empty">Aucune séance de groupe ouverte.</p>
      </section>

      <section aria-labelledby="op-create-title" class="op-create">
        <h3 id="op-create-title" class="op-kicker">Créer une séance de groupe</h3>
        <p class="op-sub" data-o="plan"></p>
        <div class="op-create-row">
          <label class="op-select"><span class="op-sr">Départ</span><select data-o="delay"></select></label>
          <button class="op-btn" type="button" data-o="create">Créer</button>
        </div>
      </section>

      <section aria-labelledby="op-riders-title">
        <h3 id="op-riders-title" class="op-kicker" data-o="riders-title">En ligne</h3>
        <ul class="op-list" data-o="riders"></ul>
        <p class="op-empty" data-o="riders-empty">Personne d’autre en ligne pour l’instant.</p>
      </section>
    </div>
  </div>
</aside>`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Rafraîchissement de la liste tant que le panneau est ouvert, en ms. */
const REFRESH_MS = 5000;
/** Attente après la dernière frappe avant de chercher, en ms. */
const TYPING_MS = 300;

export function setupOnlinePanel(
  dialog: HTMLDialogElement,
  actions: OnlineActions,
  env: { serverNow: () => number; courseName: (id: string) => string },
) {
  dialog.className = 'op';
  dialog.setAttribute('aria-labelledby', 'op-title');
  dialog.innerHTML = TEMPLATE;
  const o = <T extends HTMLElement = HTMLElement>(key: string) => dialog.querySelector<T>(`[data-o="${key}"]`)!;

  const q = o<HTMLInputElement>('q');
  const delay = o<HTMLSelectElement>('delay');
  const createBtn = o<HTMLButtonElement>('create');
  for (const d of START_DELAYS) delay.append(Object.assign(el('option'), { value: String(d.s), textContent: d.label }));
  delay.value = String(START_DELAYS[1]!.s);

  let timer: ReturnType<typeof setInterval> | undefined;
  let typing: ReturnType<typeof setTimeout> | undefined;
  let tick: ReturnType<typeof setInterval> | undefined;
  let block: string | undefined;
  let plan: CreatePlan = { courseName: '' };
  let group: GroupState | undefined;
  let lastGroups: readonly GroupSummary[] = [];

  const search = () => actions.search(q.value.trim());

  function stopTimers() {
    clearInterval(timer);
    clearInterval(tick);
    clearTimeout(typing);
    timer = tick = typing = undefined;
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  function renderBlock() {
    const b = o('block');
    b.hidden = !block;
    b.textContent = block ?? '';
    renderControls();
  }

  /** Les boutons qui demandent un trainer (rejoindre, créer) : désactivés avec la raison dite en haut. */
  function renderControls() {
    const noWorkout = !plan.workoutName;
    createBtn.disabled = !!block || noWorkout;
    for (const b of dialog.querySelectorAll<HTMLButtonElement>('[data-needs-trainer]')) b.disabled = !!block;
    o('plan').textContent = noWorkout ? 'Choisis d’abord une séance sur l’accueil.' : `${plan.workoutName} · ${plan.courseName}`;
  }

  function renderLobby() {
    const inGroup = group !== undefined;
    o('lobby').hidden = !inGroup;
    o('browse').hidden = inGroup;
    if (!group) return;
    o('lobby-name').textContent = group.name;
    o('lobby-sub').textContent = `${group.workout.name} · ${env.courseName(group.courseId)}`;
    const g = group;
    const leader = g.members.find((m) => m.slot === g.leader)?.name;
    o('lobby-leader').textContent = leader ? `${leader} choisit la route à chaque carrefour ; les autres suivent. Le groupe roule à l’allure de son créateur.` : '';
    const members = o('lobby-members');
    members.replaceChildren(...group.members.map((m: GroupMember) => el('li', 'op-row', m.name)));
    renderCountdown();
  }

  function renderCountdown() {
    if (!group) return;
    const wait = group.t0 - env.serverNow();
    o('lobby-count').textContent = wait > 0 ? `Départ dans ${countdownText(wait)}` : 'C’est parti…';
  }

  o('close').addEventListener('click', close);
  // Toucher à côté du panneau (sur le voile) le ferme.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.addEventListener('close', () => {
    stopTimers();
    actions.onClose();
  });
  q.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(search, TYPING_MS);
  });
  createBtn.addEventListener('click', () => actions.createGroup(Number(delay.value)));
  o('leave').addEventListener('click', () => actions.leaveGroup());

  return {
    open(): void {
      if (!dialog.open) dialog.showModal();
      search();
      stopTimers();
      timer = setInterval(search, REFRESH_MS);
      tick = setInterval(() => {
        renderCountdown();
        renderGroups(lastGroups);
      }, 1000);
    },

    close,

    get isOpen(): boolean {
      return dialog.open;
    },

    /** Pourquoi on ne peut ni rejoindre ni créer (pas de trainer, sortie en cours) ; `undefined` : on peut. */
    setBlock(reason: string | undefined): void {
      block = reason;
      renderBlock();
    },

    setPlan(p: CreatePlan): void {
      plan = p;
      renderControls();
    },

    /** Un message passager en haut (« Ce groupe est complet »). Vide : rien. */
    notice(text: string): void {
      const n = o('notice');
      n.textContent = text;
      n.hidden = !text;
    },

    /** Le groupe où l'on est (salle d'attente), ou `undefined`. */
    setGroup(g: GroupState | undefined): void {
      group = g;
      renderLobby();
    },

    /** La réponse de la salle : coureurs en ligne, groupes ouverts. */
    render(riders: readonly OnlineRider[], groups: readonly GroupSummary[], total: number): void {
      renderRiders(riders, total);
      lastGroups = groups;
      renderGroups(groups);
      renderControls();
    },
  };

  function renderRiders(riders: readonly OnlineRider[], total: number) {
    o('riders-title').textContent = ridersTitle(riders.length, total);
    o('riders-empty').hidden = riders.length > 0;
    o('riders-empty').textContent = q.value.trim() ? 'Personne ne porte ce nom.' : 'Personne d’autre en ligne pour l’instant.';
    o('riders').replaceChildren(
      ...riders.map((r) => {
        const row = el('li', 'op-row');
        const dot = el('i', `op-dot${r.riding ? ' op-riding' : ''}`);
        dot.setAttribute('aria-hidden', 'true');
        const name = el('span', 'op-who', r.name);
        row.append(dot, name, el('span', 'op-state', riderStatus(r)));
        if (r.riding) {
          const join = el('button', 'op-btn', 'Rejoindre');
          join.type = 'button';
          join.dataset.needsTrainer = '';
          join.setAttribute('aria-label', `Rejoindre ${r.name}`);
          join.addEventListener('click', () => actions.joinRider(r.slot, r.name));
          row.append(join);
        }
        return row;
      }),
    );
  }

  function renderGroups(groups: readonly GroupSummary[]) {
    o('groups-empty').hidden = groups.length > 0;
    o('groups').replaceChildren(
      ...groups.map((g) => {
        const row = el('li', 'op-row op-group');
        const text = el('div', 'op-group-txt');
        text.append(el('b', 'op-who', g.name), el('span', 'op-state', groupLine(g, env.serverNow(), env.courseName(g.courseId))));
        const join = el('button', 'op-btn', 'Rejoindre');
        join.type = 'button';
        join.dataset.needsTrainer = '';
        join.setAttribute('aria-label', `Rejoindre ${g.name}, ${durationText(g.durationS)}`);
        join.disabled = !!block;
        join.addEventListener('click', () => actions.joinGroup(g.id));
        row.append(text, join);
        return row;
      }),
    );
  }
}

/** Ce que `setupOnlinePanel` rend. */
export type OnlinePanel = ReturnType<typeof setupOnlinePanel>;
