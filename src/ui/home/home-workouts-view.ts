import { setBlocked, type BlockReason } from '../shared/blocked';
import { byId } from '../shared/dom';
import { FILTERS, PROFILE_H, PROFILE_W, filterCards, type CategoryFilter, type WorkoutCardModel } from './home-workouts-model';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Ce que le coureur peut demander depuis la liste des séances de l'accueil. */
export interface HomeWorkoutsActions {
  /** Une séance est choisie (`lib:<id>`, `sample:<id>`, ou vide pour la sortie libre). */
  choose(value: string): void;
  /** « Démarrer la séance » : ouvre la sortie et lance la séance. */
  startFromHome(): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Profil par zones : barres colorées, et, si demandé, la ligne de FTP en pointillé. */
function profileSvg(c: WorkoutCardModel, withFtp: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'wo-profile');
  svg.setAttribute('viewBox', `0 0 ${PROFILE_W} ${PROFILE_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const s of c.shapes) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', s.d);
    p.setAttribute('class', s.zone);
    svg.append(p);
  }
  if (withFtp) {
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', '0');
    l.setAttribute('x2', String(PROFILE_W));
    l.setAttribute('y1', String(c.ftpY));
    l.setAttribute('y2', String(c.ftpY));
    l.setAttribute('class', 'ftp-line');
    svg.append(l);
  }
  return svg;
}

/**
 * La colonne des séances de l'accueil (docs/design/accueil-refonte.md) : filtres, sortie libre, puis chaque séance, dont la
 * choisie est dépliée. Sur téléphone la même liste est un panneau latéral, avec le détail à côté ; une carte « Séance » en
 * bas de l'accueil l'ouvre. Il affiche et demande (`HomeWorkoutsActions`) ; le calcul des cartes est dans `workoutCard`.
 */
export class HomeWorkoutsView {
  private readonly list = byId('home-wo-list');
  private readonly filters = byId('home-wo-filters');
  private readonly detail = byId('home-wo-detail');
  private readonly panel = byId('home-seances');
  private readonly scrim = byId('home-seances-scrim');
  private readonly card = byId<HTMLButtonElement>('home-seance-card');
  private cards: WorkoutCardModel[] = [];
  private selected = '';
  private filter: CategoryFilter = 'all';
  private startReason: string | BlockReason | undefined;
  private readonly startButtons: HTMLButtonElement[] = [];

  constructor(private readonly actions: HomeWorkoutsActions) {
    this.filters.replaceChildren(
      ...FILTERS.map((f) => {
        const b = h('button', 'chip', f.label);
        b.type = 'button';
        b.dataset.filter = f.id;
        b.addEventListener('click', () => {
          this.filter = f.id;
          this.render();
        });
        return b;
      }),
    );
    this.card.addEventListener('click', () => this.openPanel(true));
    byId('home-seances-close').addEventListener('click', () => this.openPanel(false));
    this.scrim.addEventListener('click', () => this.openPanel(false));
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panel.dataset.open !== undefined) this.openPanel(false);
    });
    this.render();
  }

  /** La séance choisie (`lib:<id>`, `sample:<id>`, ou vide). */
  get choice(): string {
    return this.selected;
  }

  /** Les séances à proposer, dans l'ordre ; le choix est gardé s'il existe encore. */
  showCards(cards: WorkoutCardModel[]): void {
    this.cards = cards;
    if (this.selected && !cards.some((c) => c.value === this.selected)) this.selected = '';
    this.render();
  }

  setChoice(value: string): void {
    this.selected = value;
    this.render();
  }

  /** « Démarrer la séance » dit pourquoi il est indisponible, ou ne dit rien. */
  setStartBlock(reason: string | BlockReason | undefined): void {
    this.startReason = reason;
    for (const b of this.startButtons) setBlocked(b, reason);
  }

  private openPanel(open: boolean): void {
    this.panel.toggleAttribute('data-open', open);
    this.scrim.toggleAttribute('data-open', open);
    this.card.setAttribute('aria-expanded', String(open));
  }

  private render(): void {
    for (const b of this.filters.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.filter === this.filter));
    this.startButtons.length = 0;
    const current = this.cards.find((c) => c.value === this.selected);

    // Sortie libre : toujours en premier.
    const items: HTMLElement[] = [this.item('', 'Sortie libre', 'Pas de consigne, la pente fait le reste', undefined, undefined)];
    for (const c of filterCards(this.cards, this.filter)) {
      items.push(this.item(c.value, c.name, c.line, c.durationShort, c));
    }
    if (items.length === 1 && this.filter !== 'all') items.push(h('p', 'wo-empty', 'Aucune séance de cette famille.'));
    this.list.replaceChildren(...items);

    // Détail à côté de la liste (panneau iPhone).
    this.detail.replaceChildren(...(current ? [this.detailBody(current, 'Choisir')] : [h('p', 'wo-empty', 'Sortie libre : pas de consigne, la pente du parcours fait le reste.')]));

    // Carte « Séance » de l'iPhone.
    this.renderPhoneCard(current);
    this.setStartBlock(this.startReason);
  }

  private item(value: string, name: string, line: string, short: string | undefined, c: WorkoutCardModel | undefined): HTMLElement {
    const on = value === this.selected;
    const wrap = h('div', 'wo-item');
    wrap.dataset.on = String(on);
    if (c) wrap.classList.add('has-detail');
    const head = h('button', 'wo-item-head');
    head.type = 'button';
    head.dataset.wo = value;
    head.setAttribute('aria-pressed', String(on));
    head.addEventListener('click', () => this.actions.choose(value));
    const txt = h('span', 'wo-item-txt');
    txt.append(h('b', 'wo-name', name));
    txt.append(h('span', 'wo-line', line));
    head.append(txt);
    if (c) {
      const mini = profileSvg(c, false);
      mini.classList.add('wo-mini');
      head.append(mini);
    }
    if (short) head.append(h('span', 'wo-dur', short));
    if (!c) head.prepend(this.freeIcon());
    wrap.append(head);
    // Déplié en place (ordinateur) ; sur téléphone, le détail est à côté de la liste.
    if (on && c) wrap.append(this.detailBody(c, null));
    return wrap;
  }

  private freeIcon(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'wo-free-ico');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', 'M3 17c3-9 6-9 9-9s6 0 9 9');
    svg.append(p);
    return svg;
  }

  /** Profil, trois chiffres, barre des zones, boutons. `choose` : texte du bouton qui valide dans le panneau (sinon « Démarrer la séance »). */
  private detailBody(c: WorkoutCardModel, choose: string | null): HTMLElement {
    const box = h('div', 'wo-detail');
    const top = h('div', 'wo-detail-top');
    top.append(h('b', 'wo-name', c.name), h('span', 'wo-dur', choose ? `${c.duration} · ERG` : c.duration));
    box.append(top, profileSvg(c, true));
    const axis = h('div', 'wo-axis');
    axis.append(h('span', undefined, '0'), h('span', 'ftp', `FTP ${c.ftpW} W`), h('span', undefined, c.duration));
    box.append(axis);
    const stats = h('div', 'wo-stats');
    for (const s of c.stats) {
      const cell = h('div');
      cell.append(h('b', undefined, s.value), h('span', undefined, s.label));
      stats.append(cell);
    }
    box.append(stats);
    const bar = h('div', 'wo-zonebar');
    bar.setAttribute('aria-hidden', 'true');
    for (const z of c.zoneShares) {
      const s = h('span');
      s.style.width = `${z.share * 100}%`;
      s.style.background = z.zone === 'free' ? 'var(--muted)' : `var(--${z.zone})`;
      bar.append(s);
    }
    box.append(bar);
    const row = h('div', 'wo-actions');
    if (choose) {
      const ok = h('button', 'wo-choose', choose);
      ok.type = 'button';
      ok.addEventListener('click', () => this.openPanel(false));
      row.append(ok);
    } else {
      const go = h('button', 'wo-start', 'Démarrer la séance');
      go.type = 'button';
      go.addEventListener('click', () => this.actions.startFromHome());
      this.startButtons.push(go);
      row.append(go);
    }
    const edit = h('a', 'wo-edit', 'Modifier');
    edit.setAttribute('href', '#seances');
    row.append(edit);
    box.append(row);
    return box;
  }

  private renderPhoneCard(c: WorkoutCardModel | undefined): void {
    const name = byId('home-seance-name');
    const body = byId('home-seance-body');
    name.textContent = c ? c.name : 'Sortie libre';
    body.replaceChildren();
    if (!c) {
      body.append(h('span', 'wo-line', 'Sans consigne'));
      return;
    }
    const prof = profileSvg(c, true);
    body.append(prof, h('span', 'wo-line', c.phoneLine));
  }
}
