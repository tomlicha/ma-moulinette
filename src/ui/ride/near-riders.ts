import { formatGap, type Nearby, type NearbyRiders } from '../../render/riders/others-model';
import { riderColor } from './ride-map';

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
      const g = formatGap(l.gapM);
      if (row.gap.textContent !== g) row.gap.textContent = g;
    });
    this.host.hidden = false;
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
      } else {
        dot.style.background = dotColor(l.slot);
      }
      el.append(dot, name, gap);
      this.rows.push({ el, name, gap });
      return el;
    });
    this.list.replaceChildren(...items);
  }
}
