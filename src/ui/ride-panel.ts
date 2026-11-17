/**
 * Encart de l'écran Sortie : les coureurs proches (`NearRiders`) et la carte de la position (`RideMap`) dans le même cadre,
 * avec une bascule Liste / Carte. Seul, sans coureur proche, l'encart n'a que la carte. À l'approche d'un carrefour il
 * passe seul sur la carte (`TabController`). Référence : docs/design/sortie.md.
 */
import type { NearbyRiders } from '../render/others-model';
import type { Journey, PendingJunction } from '../sim/journey';
import { NearRiders } from './near-riders';
import { RideMap } from './ride-map';
import { junctionHeader, rangeText, TabController, type Tab } from './ride-map-model';
import { buildScene, junctionScene, type MapJunction } from './ride-map-scene';

/** Onglet choisi par le coureur, gardé d'une sortie à l'autre. */
export const TAB_KEY = 'mamoulinette.nearTab';

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const LABELS: Record<Tab, string> = { list: 'Liste', map: 'Carte' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class RidePanel {
  private readonly list: NearRiders;
  private readonly map: RideMap;
  private readonly ctl: TabController;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly head = el('div', 'rn-head');
  private readonly tabBar = el('div', 'rn-tabs');
  private readonly junctionText = el('p', 'rn-junction');
  private readonly mapBox = el('div', 'rn-map');
  private readonly foot = el('p', 'rn-foot');
  private nearby: NearbyRiders | undefined;
  /** Le carrefour annoncé, gardé après le verrouillage tant qu'on ne l'a pas passé. */
  private lastJunction: MapJunction | undefined;
  /** Dernier état dessiné : un changement d'onglet redessine la carte sans attendre le prochain rafraîchissement. */
  private headerText: string | null = null;
  private lastDistance = 0;
  private lastShown: MapJunction | undefined;

  constructor(private readonly host: HTMLElement, private readonly o: { journey: Journey; prefs: Store }) {
    let pref: Tab = 'map';
    try {
      const saved = o.prefs.getItem(TAB_KEY);
      if (saved === 'list' || saved === 'map') pref = saved;
    } catch {
      // préférence illisible : la carte
    }
    this.ctl = new TabController(pref);

    this.tabBar.setAttribute('role', 'tablist');
    this.tabBar.setAttribute('aria-label', 'Contenu de l’encart');
    for (const tab of ['list', 'map'] as const) {
      const b = el('button', 'rn-tab', LABELS[tab]);
      b.type = 'button';
      b.dataset.tab = tab;
      b.setAttribute('role', 'tab');
      this.tabs.set(tab, b);
      this.tabBar.append(b);
    }
    this.head.append(this.tabBar, this.junctionText);

    const listBox = el('div', 'rn-list-box');
    const mapBox = el('div', 'rn-map-box');
    mapBox.append(this.mapBox, this.foot);
    const body = el('div', 'rn-body');
    body.append(listBox, mapBox);
    host.replaceChildren(this.head, body);
    host.hidden = false;
    this.list = new NearRiders(listBox);
    this.map = new RideMap(this.mapBox, o.journey.network);

    // Un toucher sur un onglet le choisit ; ailleurs sur l'encart, il passe à l'autre (seulement s'il y a une liste).
    host.addEventListener('click', (e) => {
      const hit = (e.target as Element).closest<HTMLElement>('[data-tab]');
      const next: Tab | undefined = hit ? (hit.dataset.tab as Tab) : this.list.hasRows ? (this.currentTab() === 'map' ? 'list' : 'map') : undefined;
      if (next) this.select(next);
    });
  }

  private currentTab(): Tab {
    return this.list.hasRows ? this.ctl.tab : 'map';
  }

  private select(tab: Tab): void {
    this.ctl.select(tab);
    try {
      this.o.prefs.setItem(TAB_KEY, tab);
    } catch {
      // stockage refusé : le choix vaut pour cette session
    }
    this.apply();
    this.drawMap(undefined);
  }

  /** Les coureurs proches (de la vue 3D). `draft` : part d'air épargnée par l'aspiration, montrée sur la ligne du joueur. */
  setNearby(n: NearbyRiders, draft: number): void {
    this.nearby = n;
    this.list.set(n, draft);
  }

  /** Plus personne autour (déconnecté de la salle) : il ne reste que la carte. */
  clearNearby(): void {
    this.nearby = undefined;
    this.list.clear();
  }

  /** À appeler 4 fois par seconde : bascule automatique, en-tête, carte. */
  update(i: { distanceM: number; pending: PendingJunction | undefined; now?: number }): void {
    this.ctl.tick({ distanceM: i.distanceM, pending: i.pending ? { atM: i.pending.atM } : undefined, now: i.now ?? performance.now() });
    if (i.pending) this.lastJunction = junctionScene(this.o.journey, i.pending);
    else if (!this.ctl.junction) this.lastJunction = undefined;
    // Le carrefour reste dessiné de l'annonce jusqu'au nœud, même une fois le choix verrouillé.
    const remaining = this.lastJunction ? this.lastJunction.atM - i.distanceM : -1;
    const shown = this.lastJunction && this.ctl.junction && remaining >= 0 ? this.lastJunction : undefined;
    this.apply(shown ? junctionHeader(shown.name, remaining) : null);
    this.drawMap(shown, i.distanceM);
  }

  private apply(header: string | null | undefined = undefined): void {
    if (header !== undefined) this.headerText = header;
    const hasList = this.list.hasRows;
    const tab = this.currentTab();
    this.host.dataset.tab = tab;
    this.host.dataset.solo = hasList ? '0' : '1';
    for (const [t, b] of this.tabs) {
      b.setAttribute('aria-selected', String(t === tab));
      b.tabIndex = t === tab ? 0 : -1;
    }
    const junction = this.headerText !== null;
    this.junctionText.hidden = !junction;
    if (junction && this.junctionText.textContent !== this.headerText) this.junctionText.textContent = this.headerText;
    this.tabBar.hidden = junction || !hasList;
    this.head.hidden = !junction && !hasList;
  }

  private drawMap(shown: MapJunction | undefined, distanceM?: number): void {
    if (distanceM !== undefined) {
      this.lastDistance = distanceM;
      this.lastShown = shown;
    }
    if (this.currentTab() !== 'map') return;
    this.map.render(buildScene(this.o.journey, this.lastDistance, this.nearby, this.lastShown));
    const t = rangeText(this.nearby);
    if (this.foot.textContent !== t) this.foot.textContent = t;
  }
}
