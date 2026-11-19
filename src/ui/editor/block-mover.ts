import type { EditorSession } from '../../app/editor-session';
import { blockRanges } from '../../domain/workout/block-ops';
import { el } from './dom';

/** Déplacer un bloc : on tient la poignée de la barre et on la fait glisser sur le profil. */
interface BlockDrag {
  from: number;
  to: number;
  startX: number;
  pointerId: number;
  active: boolean;
  width: number;
  ranges: { start: number; end: number }[];
  total: number;
  ghost?: HTMLElement;
  line?: HTMLElement;
}

const DRAG_THRESHOLD_PX = 4;

export interface BlockMoverContext {
  session: EditorSession;
  /** La poignée de la barre du bloc sélectionné. */
  handle: HTMLElement;
  /** Le profil, sur lequel on glisse. */
  plot: HTMLElement;
  /** Les capsules posées sur le bloc (téléphone) : masquées pendant le glisser, de retour au dépôt. */
  overlay: HTMLElement;
}

/** Le glisser de la poignée : un cadre suit le doigt, un repère montre où le bloc tombera ; le lâcher ailleurs annule. */
export class BlockMover {
  private drag: BlockDrag | undefined;

  constructor(private readonly c: BlockMoverContext) {
    c.handle.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.handle.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.handle.addEventListener('pointerup', (e) => this.end(e));
    c.handle.addEventListener('pointercancel', (e) => this.end(e));
  }

  private onPointerDown(e: PointerEvent): void {
    const { session, handle, plot } = this.c;
    if (!session.draft || session.draft.readOnly || session.draft.blocks.length < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const w = session.workout();
    this.drag = {
      from: session.selected,
      to: session.selected,
      startX: e.clientX,
      pointerId: e.pointerId,
      active: false,
      width: plot.clientWidth,
      ranges: blockRanges(session.draft.blocks),
      total: w.steps.reduce((t, s) => t + s.durationS, 0) || 1,
    };
    handle.setPointerCapture?.(e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    const { handle, plot, overlay } = this.c;
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    if (!d.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      d.active = true;
      handle.classList.add('dragging');
      d.ghost = el('div', { className: 'dd-ghost' });
      d.line = el('div', { className: 'dd-line' });
      plot.append(d.ghost, d.line);
      overlay.style.visibility = 'hidden'; // les capsules du bloc reviennent au dépôt
    }
    const px = (s: number) => (s / d.total) * d.width;
    const me = d.ranges[d.from]!;
    const left = Math.max(0, Math.min(d.width - (px(me.end) - px(me.start)), px(me.start) + dx));
    d.ghost!.style.left = `${left}px`;
    d.ghost!.style.width = `${px(me.end) - px(me.start)}px`;
    // Place visée : autant de blocs que de milieux franchis par le centre du bloc tenu.
    const centre = left + (px(me.end) - px(me.start)) / 2;
    const others = d.ranges.filter((_, i) => i !== d.from);
    d.to = others.filter((r) => px((r.start + r.end) / 2) < centre).length;
    d.line!.style.left = `${d.to < others.length ? px(others[d.to]!.start) : px(others[others.length - 1]!.end)}px`;
  }

  private end(e: PointerEvent): void {
    const { session, handle, overlay } = this.c;
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = undefined;
    handle.releasePointerCapture?.(e.pointerId);
    handle.classList.remove('dragging');
    overlay.style.visibility = '';
    d.ghost?.remove();
    d.line?.remove();
    if (d.active && e.type === 'pointerup') session.moveBlock(d.from, d.to);
  }
}
