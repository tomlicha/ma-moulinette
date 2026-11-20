import type { FollowState, Follower, FollowStopReason } from '../../app/follow-session';
import { formatGap } from '../../render/riders/others-model';

/** Combien de temps un message passager reste affiché, en ms. */
const NOTICE_MS = 6000;
/** Suiveurs montrés au plus : au-delà, « + N ». */
const MAX_FOLLOWERS_SHOWN = 2;

/** « 14 m · 3 s » devant, « −20 m » derrière ; les secondes seulement devant et quand elles ont un sens. */
export function followGapText(s: Pick<FollowState, 'gapM' | 'gapS'>): string {
  const gap = formatGap(Math.abs(s.gapM) < 1 ? 0 : s.gapM);
  return s.gapS !== undefined && s.gapM > 0 && s.gapS >= 1 ? `${gap} · ${Math.round(s.gapS)} s` : gap;
}

/** Ce que dit le bandeau selon l'état du suivi. */
export function followStatusText(s: FollowState): string {
  switch (s.phase) {
    case 'requesting':
      return `Rejoindre ${s.name}…`;
    case 'dropped':
      return `${s.name} est loin devant`;
    case 'leader-paused':
      return `${s.name} a fait une pause`;
    case 'following':
      return `Suit ${s.name} · ${followGapText(s)}`;
  }
}

/** La phrase d'un suivi qui se termine ; vide quand c'est le coureur qui l'a voulu. */
export function followEndText(reason: FollowStopReason, name: string): string {
  switch (reason) {
    case 'manual':
      return '';
    case 'denied':
      return `${name} n'accepte pas d'être rejoint`;
    case 'refused':
      return `${name} préfère rouler seul`;
    case 'unavailable':
      return `${name} ne roule plus`;
    case 'left':
    case 'leader-lost':
      return `${name} est parti : le suivi est terminé`;
    case 'leader-stopped':
      return `${name} s'est arrêté : le suivi est terminé`;
    case 'self-stopped':
      return 'Tu t’es arrêté : le suivi est terminé';
    case 'offline':
      return 'Connexion perdue : le suivi est terminé';
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * Le bandeau du suivi, sur l'écran Sortie : qui on suit et l'écart, qui nous suit (avec « Refuser »), et les messages
 * passagers (« Lucie est parti »). Passif : il affiche et signale des intentions (`onStop`, `onRefuse`). Les noms viennent
 * d'autres joueurs : ils entrent par `textContent`, jamais comme HTML.
 */
export class FollowView {
  onStop?: () => void;
  onRefuse?: (slot: number) => void;

  private readonly status = el('div', 'rf-status');
  private readonly statusText = el('span', 'rf-text');
  private readonly stopBtn = el('button', 'rf-btn', 'Arrêter');
  private readonly followersBox = el('div', 'rf-followers');
  private readonly noticeText = el('p', 'rf-notice');
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private state: FollowState | undefined;
  private followers: readonly Follower[] = [];

  constructor(private readonly host: HTMLElement) {
    this.stopBtn.type = 'button';
    this.stopBtn.addEventListener('click', () => this.onStop?.());
    this.status.append(this.statusText, this.stopBtn);
    this.noticeText.setAttribute('role', 'status');
    host.replaceChildren(this.status, this.followersBox, this.noticeText);
    this.refresh();
  }

  render(state: FollowState | undefined): void {
    this.state = state;
    if (state) {
      const text = followStatusText(state);
      if (this.statusText.textContent !== text) this.statusText.textContent = text;
    }
    this.refresh();
  }

  setFollowers(followers: readonly Follower[]): void {
    this.followers = followers;
    this.followersBox.replaceChildren(
      ...followers.slice(0, MAX_FOLLOWERS_SHOWN).map((f) => {
        const row = el('div', 'rf-row');
        const text = el('span', 'rf-text', `${f.name} te suit`);
        const refuse = el('button', 'rf-btn', 'Refuser');
        refuse.type = 'button';
        refuse.addEventListener('click', () => this.onRefuse?.(f.slot));
        row.append(text, refuse);
        return row;
      }),
      ...(followers.length > MAX_FOLLOWERS_SHOWN ? [el('p', 'rf-more', `+ ${followers.length - MAX_FOLLOWERS_SHOWN} autres`)] : []),
    );
    this.refresh();
  }

  /** Un message passager, qui s'efface seul. Vide : rien. */
  notice(text: string): void {
    clearTimeout(this.noticeTimer);
    this.noticeText.textContent = text;
    if (text) this.noticeTimer = setTimeout(() => this.notice(''), NOTICE_MS);
    this.refresh();
  }

  private refresh(): void {
    this.status.hidden = !this.state;
    this.followersBox.hidden = this.followers.length === 0;
    this.noticeText.hidden = !this.noticeText.textContent;
    this.host.hidden = !this.state && this.followers.length === 0 && !this.noticeText.textContent;
  }
}
