import type { EditorSession } from '../../app/editor-session';
import { BLOCK_LABEL, blocksToWorkout, type EditorBlock } from '../../domain/workout/blocks';
import { blockRanges, blockShort } from '../../domain/workout/block-ops';
import type { BlockLibrary, SavedBlock } from '../../domain/workout/block-library';
import { BLOCK_PRESETS, ZONE_PRESETS, blankPresets, PRESET_CATEGORIES, summarizeBlocks, type PresetCategory } from '../../domain/workout/presets';
import { setBlocked } from '../shared/blocked';
import { byId, el, fmtLong, miniProfile, pct } from './dom';

type ShelfTab = 'all' | PresetCategory | 'zones' | 'blank' | 'mine';

interface ShelfItem {
  id: string;
  name: string;
  blocks: EditorBlock[];
  mine?: SavedBlock;
}

/** Glisser une carte sur le profil : un cadre en pointillés la suit, un repère montre où elle tombera ; la lâcher ailleurs annule. */
interface CardDrag {
  blocks: EditorBlock[];
  startX: number;
  startY: number;
  pointerId: number;
  mouse: boolean;
  active: boolean;
  inside: boolean;
  at: number;
  el: HTMLElement;
  ghostW: number;
  width: number;
  ranges: { start: number; end: number }[];
  total: number;
  ghost?: HTMLElement;
  line?: HTMLElement;
}

export interface BlockShelfContext {
  session: EditorSession;
  /** « Mes blocs » : blocs mis de côté par le coureur. */
  blocks: BlockLibrary;
  ftp: () => number;
  log: (message: string) => void;
  /** Message dans la bibliothèque (le journal est masqué sur cet écran). */
  say: (message?: string) => void;
  /** Le profil, où l'on dépose les cartes. */
  plot: HTMLElement;
  /** Les capsules posées sur le bloc (téléphone) : masquées pendant un glisser. */
  overlay: HTMLElement;
}

/**
 * L'étagère de blocs préfaits (docs/design/seances.md, piste S) : onglets, cartes (toucher pour ajouter après le bloc
 * sélectionné, ou glisser sur le profil), et « Mes blocs ».
 */
export class BlockShelf {
  private tab: ShelfTab = 'all';
  private items: ShelfItem[] = [];
  private cardDrag: CardDrag | undefined;
  private justDragged = false;
  private readonly tabsEl = byId('sh-tabs');
  private readonly cardsEl = byId('sh-cards');

  constructor(private readonly c: BlockShelfContext) {
    this.cardsEl.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.cardsEl.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.cardsEl.addEventListener('pointerup', (e) => this.endDrag(e));
    this.cardsEl.addEventListener('pointercancel', (e) => this.endDrag(e));
  }

  private currentItems(): ShelfItem[] {
    if (this.tab === 'blank') return blankPresets();
    if (this.tab === 'zones') return ZONE_PRESETS;
    if (this.tab === 'mine') return this.c.blocks.list().map((b) => ({ id: b.id, name: b.name, blocks: b.blocks, mine: b }));
    return BLOCK_PRESETS.filter((p) => this.tab === 'all' || p.category === this.tab);
  }

  /** Reconstruit les onglets et les cartes : à l'ouverture d'une séance, au changement d'onglet, de « Mes blocs » ou de FTP. */
  render(): void {
    const { session } = this.c;
    const ro = !!session.draft?.readOnly;
    const tab = (id: ShelfTab, label: string, zone?: string) => {
      const b = el('button', { type: 'button', className: 'sh-tab' });
      if (zone) {
        const dot = el('i');
        dot.style.background = `var(--${zone})`;
        b.append(dot);
      }
      b.append(label);
      b.setAttribute('aria-pressed', String(this.tab === id));
      b.addEventListener('click', () => {
        this.tab = id;
        this.cardsEl.scrollLeft = 0;
        this.render();
      });
      return b;
    };
    this.tabsEl.replaceChildren(tab('all', 'Tous'), tab('zones', 'Par zone'), ...PRESET_CATEGORIES.map((c) => tab(c.id, c.name, c.zone)), tab('blank', 'Vierges'), tab('mine', '★ Mes blocs'));

    this.items = this.currentItems();
    const cards = this.items.map((item, i) => {
      const sum = summarizeBlocks(item.blocks);
      const meta = `${fmtLong(sum.durationS)}${sum.power !== undefined ? ` · ${pct(sum.power)} %` : ''}`;
      const card = el(
        'button',
        { type: 'button', className: 'sh-card' },
        el('span', { className: 'sh-grip' }),
        miniProfile(blocksToWorkout('x', undefined, item.blocks), this.c.ftp(), 'sh-mini'),
        el('span', { className: 'sh-text' }, el('strong', { textContent: item.name }), el('small', { textContent: meta })),
      );
      card.dataset.i = String(i);
      card.title = `${item.name} : toucher pour l’ajouter après le bloc sélectionné, ou glisser sur le profil`;
      if (ro) setBlocked(card, 'Un modèle est en lecture seule : duplique-le pour le modifier.');
      else
        card.addEventListener('click', () => {
          if (this.justDragged || !session.draft) return;
          session.addBlocks(item.blocks, session.draft.blocks.length ? session.selected + 1 : 0);
        });
      const wrap = el('div', { className: 'sh-item' }, card);
      if (item.mine) {
        const mine = item.mine;
        const del = el('button', { type: 'button', className: 'sh-del', textContent: '✕', title: 'Retirer de Mes blocs' });
        del.setAttribute('aria-label', `Retirer « ${mine.name} » de Mes blocs`);
        del.addEventListener('click', () => {
          if (!confirm(`Retirer le bloc « ${mine.name} » de Mes blocs ?`)) return;
          this.c.blocks.remove(mine.id);
          this.render();
        });
        wrap.append(del);
      }
      return wrap;
    });
    this.cardsEl.replaceChildren(
      ...(cards.length ? cards : [el('p', { className: 'sh-empty', textContent: 'Aucun bloc ici : « Enregistrer comme bloc », dans le menu du bloc, le range sur l’étagère.' })]),
    );
  }

  /** Range le bloc dans « Mes blocs » et ouvre cet onglet. */
  saveAsBlock(b: EditorBlock): void {
    const name = prompt('Nom du bloc', `${BLOCK_LABEL[b.type]} ${blockShort(b)}`);
    if (name === null) return;
    try {
      this.c.blocks.save(name, [b]);
      this.c.log(`bloc enregistré : ${name.trim() || 'Bloc sans nom'}`);
      this.tab = 'mine';
      this.cardsEl.scrollLeft = 0;
      this.render();
    } catch (e) {
      this.c.say(`enregistrement du bloc impossible (stockage du navigateur plein ou bloqué) : ${e instanceof Error ? e.message : e}`);
    }
  }

  private onPointerDown(e: PointerEvent): void {
    const { session, plot } = this.c;
    const card = (e.target as HTMLElement).closest<HTMLElement>('.sh-card');
    if (!card || !session.draft || session.draft.readOnly || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const item = this.items[Number(card.dataset.i)];
    if (!item) return;
    const total = session.workout().steps.reduce((t, st) => t + st.durationS, 0) || 1;
    const width = plot.clientWidth;
    this.cardDrag = {
      blocks: item.blocks,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      mouse: e.pointerType === 'mouse',
      active: false,
      inside: false,
      at: session.draft.blocks.length,
      el: card,
      ghostW: Math.max(28, Math.min(width * 0.5, (summarizeBlocks(item.blocks).durationS / total) * width)),
      width,
      ranges: blockRanges(session.draft.blocks),
      total,
    };
  }

  private onPointerMove(e: PointerEvent): void {
    const { plot, overlay } = this.c;
    const d = this.cardDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      // Au doigt, un geste horizontal fait défiler l'étagère : on ne saisit la carte qu'en la tirant vers le haut.
      const start = d.mouse ? Math.hypot(dx, dy) > 6 : dy < -8 && Math.abs(dy) > Math.abs(dx);
      if (!start) return;
      d.active = true;
      d.el.setPointerCapture?.(e.pointerId);
      d.ghost = el('div', { className: 'dd-ghost' });
      d.line = el('div', { className: 'dd-line' });
      d.ghost.style.width = `${d.ghostW}px`;
      plot.append(d.ghost, d.line);
      overlay.style.visibility = 'hidden';
    }
    const r = plot.getBoundingClientRect();
    d.inside = e.clientY >= r.top - 24 && e.clientY <= r.bottom + 24 && e.clientX >= r.left - 12 && e.clientX <= r.right + 12;
    d.ghost!.hidden = d.line!.hidden = !d.inside;
    const px = (sec: number) => (sec / d.total) * d.width;
    const x = Math.max(0, Math.min(d.width, e.clientX - r.left));
    d.ghost!.style.left = `${Math.max(0, Math.min(d.width - d.ghostW, x - d.ghostW / 2))}px`;
    // Place visée : autant de blocs que de milieux déjà franchis.
    d.at = d.ranges.filter((b) => px((b.start + b.end) / 2) < x).length;
    const edge = d.ranges.length ? (d.at < d.ranges.length ? px(d.ranges[d.at]!.start) : px(d.ranges[d.ranges.length - 1]!.end)) : 0;
    d.line!.style.left = `${edge}px`;
  }

  private endDrag(e: PointerEvent): void {
    const d = this.cardDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.cardDrag = undefined;
    d.el.releasePointerCapture?.(e.pointerId);
    this.c.overlay.style.visibility = '';
    d.ghost?.remove();
    d.line?.remove();
    if (!d.active) return; // un simple appui : le clic ajoute après le bloc sélectionné
    this.justDragged = true;
    setTimeout(() => (this.justDragged = false));
    if (e.type === 'pointerup' && d.inside) this.c.session.addBlocks(d.blocks, d.at);
  }
}
