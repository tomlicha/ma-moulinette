import type { EditorSession } from '../../app/editor-session';
import { BLOCK_LABEL } from '../../domain/workout/blocks';
import { blockIndexAt, blockRanges } from '../../domain/workout/block-ops';
import { targetWatts, type Workout } from '../../domain/workout/model';
import { profilePeakW, profileShapes, zoneOf, type Zone } from '../../domain/workout/profile';
import { ZONES, zoneName } from '../../domain/workout/zones';
import { formatDuration } from '../shared/duration';
import { byId, el, fmtLong, svg } from './dom';

/** Taille du dessin du profil, en unités de son viewBox. */
const W = 1000;
const H = 120;

export interface ProfileChartContext {
  session: EditorSession;
  ftp: () => number;
  /** Le cadre du profil : on y survole (info-bulle) et on y clique (sélection d'un bloc). */
  plot: HTMLElement;
  tip: HTMLElement;
}

/**
 * Le profil de la séance : bandes de zones, paliers, ligne de FTP, cadre du bloc sélectionné, axes ; l'info-bulle qui suit
 * la souris (temps, effort ou récupération, watts, zone) ; un clic sélectionne le bloc survolé.
 */
export class ProfileChart {
  constructor(private readonly c: ProfileChartContext) {
    const { plot, tip, session } = c;
    plot.addEventListener('mousemove', (e) => this.showTip(e));
    plot.addEventListener('mouseleave', () => (tip.hidden = true));
    plot.addEventListener('click', (e) => {
      if (session.draft?.blocks.length) session.select(blockIndexAt(session.draft.blocks, this.timeAt(e)));
    });
  }

  private selectedZone(): Zone | undefined {
    const { session } = this.c;
    const b = session.draft?.blocks[session.selected];
    if (!b || b.type === 'free') return undefined;
    const main = b.type === 'steady' ? b.power : b.type === 'intervals' ? b.onPower : (b.from + b.to) / 2;
    return zoneOf(main);
  }

  /** Dessine le profil de `w` pour une FTP de `f`. */
  render(w: Workout, f: number): void {
    const { session } = this.c;
    const peak = profilePeakW(w, f);
    const y = (watts: number) => H - (watts / peak) * H;
    const top = (watts: number) => `${(1 - watts / peak) * 100}%`;
    const total = w.steps.reduce((t, s) => t + s.durationS, 0) || 1;

    // Axe vertical : % de FTP et watts, FTP en gras.
    const yaxis = byId('ed-yaxis');
    yaxis.replaceChildren(
      ...[
        [peak, `${Math.round((peak / f) * 100)} % · ${Math.round(peak)} W`, ''],
        [f, `FTP · ${f} W`, 'ftp'],
        [0.75 * f, `75 % · ${Math.round(0.75 * f)} W`, ''],
        [0.5 * f, `50 % · ${Math.round(0.5 * f)} W`, ''],
        [0, '0', ''],
      ].map(([watts, label, cls]) => {
        const s = el('span', { textContent: label as string, className: cls as string });
        s.style.top = top(watts as number);
        return s;
      }),
    );

    // Bandes de zones, puis paliers, ligne de FTP et cadre du bloc sélectionné.
    const root = byId('ed-svg');
    const bands = svg('g', {});
    const labels: HTMLElement[] = [];
    const selZone = this.selectedZone();
    ZONES.forEach((z, i) => {
      const lo = z.from * f;
      const hi = Math.min(peak, (ZONES[i + 1]?.from ?? Infinity) * f);
      if (lo >= peak) return;
      bands.append(svg('rect', { x: 0, y: y(hi), width: W, height: y(lo) - y(hi), fill: `var(--${z.id})`, 'fill-opacity': 0.1 }));
      const label = el('span', { textContent: z.name, className: z.id === selZone ? 'on' : '' });
      label.style.top = top((lo + hi) / 2);
      labels.push(label);
    });
    byId('ed-zone-labels').replaceChildren(...labels);

    const bars = svg('g', { class: 'ed-svg-bars' });
    for (const s of profileShapes(w, f, W, H)) bars.append(svg('path', { d: s.d, class: s.zone }));
    const ftpLine = svg('line', { x1: 0, x2: W, y1: y(f), y2: y(f), stroke: 'currentColor', 'stroke-opacity': 0.55, 'stroke-dasharray': '8 6', 'vector-effect': 'non-scaling-stroke' });
    root.replaceChildren(bands, bars, ftpLine);
    const r = blockRanges(session.draft!.blocks)[session.selected];
    if (r) {
      root.append(
        svg('rect', {
          x: (r.start / total) * W,
          y: 0.5,
          width: ((r.end - r.start) / total) * W,
          height: H - 1,
          fill: 'none',
          stroke: 'var(--accent)',
          'stroke-width': 2,
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }
    root.setAttribute('aria-label', `Profil de la séance, ${session.draft!.blocks.length} blocs, ${fmtLong(total)}`);

    byId('ed-xaxis').replaceChildren(...[0, 0.25, 0.5, 0.75, 1].map((k) => el('span', { textContent: fmtLong(Math.round(k * total)) })));
  }

  /** Instant de la séance sous la souris, en secondes. */
  private timeAt(e: MouseEvent): number {
    const r = this.c.plot.getBoundingClientRect();
    const total = this.c.session.workout().steps.reduce((t, s) => t + s.durationS, 0);
    return Math.max(0, Math.min(total - 0.001, ((e.clientX - r.left) / r.width) * total));
  }

  private showTip(e: MouseEvent): void {
    const { session, plot, tip } = this.c;
    if (!session.draft?.blocks.length) return;
    const f = this.c.ftp();
    const t = this.timeAt(e);
    const bi = blockIndexAt(session.draft.blocks, t);
    const b = session.draft.blocks[bi]!;
    const range = blockRanges(session.draft.blocks)[bi]!;
    const w = session.workout();
    let acc = 0;
    let stepLeft = 0;
    let watts: number | undefined;
    for (const s of w.steps) {
      if (t < acc + s.durationS) {
        watts = targetWatts(s, t - acc, f);
        stepLeft = acc + s.durationS - t;
        break;
      }
      acc += s.durationS;
    }
    let what: string = BLOCK_LABEL[b.type];
    if (b.type === 'intervals') {
      const inRep = t - range.start;
      const rep = Math.floor(inRep / (b.onS + b.offS)) + 1;
      what = `${inRep % (b.onS + b.offS) < b.onS ? 'effort' : 'récupération'} ${rep} sur ${b.repeat}`;
    }
    tip.replaceChildren(
      el('strong', { textContent: formatDuration(Math.floor(t)) }),
      ` · ${what}`,
      el('br'),
      watts === undefined ? 'sans consigne' : `${watts} W · ${Math.round((watts / f) * 100)} % · ${zoneName(zoneOf(watts / f))}`,
      el('br'),
      el('span', { className: 'muted', textContent: `encore ${formatDuration(Math.ceil(stepLeft))} dans ce palier` }),
    );
    tip.hidden = false;
    const r = plot.getBoundingClientRect();
    const x = e.clientX - r.left;
    tip.style.left = x > r.width * 0.6 ? '' : `${x + 12}px`;
    tip.style.right = x > r.width * 0.6 ? `${r.width - x + 12}px` : '';
  }
}
