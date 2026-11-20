import { formatGap, type Nearby, type NearbyRiders } from '../../render/riders/others-model';
import { riderColor } from './ride-map';

/** Icône « rattraper » du bouton de suivi : deux chevrons vers l'avant. */
const CATCH_UP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6l6 6-6 6M13 6l6 6-6 6"/></svg>';

/** Rafraîchissement de l'encart, en ms : les écarts bougent doucement, inutile de toucher au DOM à chaque image. */
const EVERY_MS = 250;

/** Couleur du point d'un coureur : celle de son maillot dans la vue 3D, et celle de son point sur la carte. */
const dotColor = riderColor;

/** « Aspiration 22 % » à partir de 3 % d'air épargné ; rien en dessous (une aspiration trop faible ne se sent pas). */
export function draftText(draft: number): string {
  const pct = Math.round(draft * 100);
  return pct >= 3 ? `Aspiration ${pct} %` : '';
}

interface Row {
  el: HTMLElement;
  name: HTMLElement;
  gap: HTMLElement;
  /** « Suivre » : absent sur la ligne du joueur. */
  follow?: HTMLButtonElement;
  slot?: number;
}

/**
 * Encart des coureurs proches (jusqu'à 7 devant, 3 derrière) : de l'avant vers l'arrière, le joueur au milieu. Un
 * élément par ligne, gardé tant que le coureur reste à la même place de la liste. Les noms viennent d'autres joueurs :
 * ils entrent par `textContent`, jamais comme HTML.
 */
export class NearRiders {
  private readonly list = document.createElement('ol');
  private readonly rows: Row[] = [];
  private signature = '';
  private last = -Infinity;
  /** Le coureur suivi en ce moment : il n'a plus de bouton « Suivre ». */
  private followed: number | undefined;
  /** Faux en séance : on n'y rattrape personne, les lignes n'offrent pas « Suivre ». */
  private followEnabled = true;
  /** Appelée par « Suivre » avec le numéro et le nom du coureur. */
  onFollow?: (slot: number, name: string) => void;

  /** Vrai quand la liste a des lignes : sans coureur proche, l'encart n'a que la carte. */
  get hasRows(): boolean {
    return this.rows.length > 0;
  }

  constructor(private readonly host: HTMLElement) {
    this.list.className = 'rn-list';
    host.append(this.list);
  }

  /** `draft` : part de la traînée de l'air épargnée par l'aspiration (0 à 1), montrée sur la ligne du joueur. */
  set(n: NearbyRiders, draft = 0, now = performance.now()): void {
    if (now - this.last < EVERY_MS) return;
    this.last = now;
    if (!n.ahead.length && !n.behind.length) return this.clear();
    const lines: (Nearby | 'me')[] = [...n.ahead, 'me', ...n.behind];
    const signature = lines.map((l) => (l === 'me' ? 'me' : l.slot)).join(',');
    if (signature !== this.signature) this.rebuild(lines, signature);
    lines.forEach((l, i) => {
      const row = this.rows[i]!;
      if (l === 'me') {
        const text = draftText(draft);
        if (row.gap.textContent !== text) row.gap.textContent = text;
        row.el.classList.toggle('rn-drafting', text !== '');
        return;
      }
      if (row.name.textContent !== l.name) row.name.textContent = l.name;
      this.markFollowed(row);
      const g = formatGap(l.gapM);
      if (row.gap.textContent !== g) row.gap.textContent = g;
    });
    this.host.hidden = false;
  }

  /** Le coureur suivi (`undefined` : personne) : sa ligne s'en souvient et n'offre plus « Suivre ». */
  setFollowed(slot: number | undefined): void {
    this.followed = slot;
    for (const r of this.rows) this.markFollowed(r);
  }

  /** Offre ou retire « Suivre » sur toutes les lignes (pas de suivi pendant une séance). */
  setFollowEnabled(on: boolean): void {
    this.followEnabled = on;
    for (const r of this.rows) this.markFollowed(r);
  }

  private markFollowed(row: Row): void {
    if (!row.follow) return;
    const on = row.slot === this.followed;
    row.follow.hidden = on || !this.followEnabled;
    row.el.classList.toggle('rn-followed', on);
  }

  clear(): void {
    this.host.hidden = true;
    this.signature = '';
    this.list.replaceChildren();
    this.rows.length = 0;
  }

  private rebuild(lines: (Nearby | 'me')[], signature: string) {
    this.signature = signature;
    this.rows.length = 0;
    const items = lines.map((l) => {
      const el = document.createElement('li');
      const dot = document.createElement('i');
      const name = document.createElement('span');
      const gap = document.createElement('span');
      el.className = l === 'me' ? 'rn-row rn-me' : 'rn-row';
      dot.className = 'rn-dot';
      name.className = 'rn-name';
      gap.className = 'rn-gap';
      if (l === 'me') {
        name.textContent = 'Toi';
        el.append(dot, name, gap);
        this.rows.push({ el, name, gap });
        return el;
      }
      dot.style.background = dotColor(l.slot);
      const follow = document.createElement('button');
      follow.type = 'button';
      follow.className = 'rn-follow';
      follow.title = 'Rejoindre et suivre';
      follow.setAttribute('aria-label', `Rejoindre et suivre ${l.name}`);
      follow.innerHTML = CATCH_UP_ICON; // gabarit statique, aucune donnée du joueur
      follow.addEventListener('click', (e) => {
        e.stopPropagation(); // pas de bascule Liste / Carte
        this.onFollow?.(l.slot, name.textContent ?? l.name);
      });
      el.append(dot, name, gap, follow);
      const row: Row = { el, name, gap, follow, slot: l.slot };
      this.rows.push(row);
      this.markFollowed(row);
      return el;
    });
    this.list.replaceChildren(...items);
  }
}
