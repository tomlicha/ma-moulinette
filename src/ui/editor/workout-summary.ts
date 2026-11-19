import type { EditorSession } from '../../app/editor-session';
import type { WorkoutStats } from '../../domain/workout/blocks';
import type { Zone } from '../../domain/workout/profile';
import { effortSeconds, intensityWord, ZONES, zoneName, zoneReading, type ZoneTimes } from '../../domain/workout/zones';
import { formatDuration } from '../shared/duration';
import { byId, el, fmtLong } from './dom';

export interface WorkoutSummaryContext {
  session: EditorSession;
  ftp: () => number;
}

/** Écart avec la version enregistrée, en texte (« +5 », « −0,03 min ») ; vide s'il n'y en a pas. */
function delta(now: number, before: number | undefined, digits = 0, unit = '') {
  if (before === undefined) return '';
  const d = +(now - before).toFixed(digits);
  if (d === 0) return '';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(digits).replace('.', ',')}${unit}`;
}

/** Le résumé de la séance (durée, puissance moyenne, intensité, charge) et le temps passé dans chaque zone, avec les écarts à la version enregistrée. */
export class WorkoutSummary {
  constructor(private readonly c: WorkoutSummaryContext) {}

  renderSummary(s: WorkoutStats, z: ZoneTimes): void {
    const { session } = this.c;
    const f = this.c.ftp();
    const cell = (k: string, v: string, h: string, d = '', small = '') =>
      el(
        'div',
        { title: h },
        el('div', { className: 'k', textContent: k }),
        el('div', { className: 'v' }, v, small ? el('small', { textContent: ` ${small}` }) : '', d ? el('span', { className: 'delta', textContent: d }) : ''),
      );
    byId('ed-summary').replaceChildren(
      cell('Durée', fmtLong(s.durationS), `dont ${fmtLong(effortSeconds(z))} d'effort`, delta(s.durationS / 60, session.baseStats && session.baseStats.durationS / 60, 0, ' min')),
      cell('Moyenne', `${s.avgW} W`, `${Math.round((s.avgW / f) * 100)} % de ta FTP (${f} W)`, delta(s.avgW, session.baseStats?.avgW)),
      cell('Intensité', s.intensity.toFixed(2).replace('.', ','), '1,00 = tenir sa FTP', delta(s.intensity, session.baseStats?.intensity, 2), intensityWord(s.intensity)),
      cell('Charge', String(s.load), '1 h à la FTP = 100', delta(s.load, session.baseStats?.load)),
    );
  }

  /** Une ligne : barre de répartition, puis le temps passé dans chaque zone. Le détail (écarts, lecture) est en info-bulle. */
  renderZones(z: ZoneTimes): void {
    const { session } = this.c;
    const total = Object.values(z).reduce((a, b) => a + b, 0) || 1;
    const ids = [...ZONES.map((x) => x.id), 'free'] as Zone[];
    const color = (id: Zone) => (id === 'free' ? 'var(--muted)' : `var(--${id})`);
    const bar = el('div', { className: 'zone-bar' });
    bar.setAttribute('aria-hidden', 'true');
    for (const id of ids) {
      if (!z[id]) continue;
      const s = el('span');
      s.style.width = `${(z[id] / total) * 100}%`;
      s.style.background = color(id);
      bar.append(s);
    }
    const items = ids
      .filter((id) => z[id] || session.baseZones?.[id])
      .sort((a, b) => z[b] - z[a])
      .map((id) => {
        const swatch = el('i');
        swatch.style.background = color(id);
        const was = session.baseZones && session.baseZones[id] !== z[id] ? ` (avant : ${formatDuration(session.baseZones[id])})` : '';
        return el('li', { title: `${zoneName(id)}${was}` }, swatch, `${zoneName(id)} `, el('strong', { textContent: formatDuration(z[id]) }));
      });
    const parts = [el('span', { className: 'k', textContent: 'Zones' }), bar, el('ul', {}, ...items)];
    for (const id of ['ed-zones', 'ed-zones-m']) {
      byId(id).title = zoneReading(z, formatDuration);
      byId(id).replaceChildren(...parts.map((n) => n.cloneNode(true)));
    }
  }
}
