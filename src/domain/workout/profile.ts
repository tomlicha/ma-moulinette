import { targetWatts, totalDurationS, type Workout } from './model';

export type Zone = 'z1' | 'z2' | 'z3' | 'z4' | 'z5' | 'z6' | 'free';

/** Zones de puissance usuelles, en fraction de FTP (bornes hautes). */
export function zoneOf(fraction: number): Exclude<Zone, 'free'> {
  if (fraction < 0.56) return 'z1';
  if (fraction < 0.76) return 'z2';
  if (fraction < 0.91) return 'z3';
  if (fraction < 1.06) return 'z4';
  if (fraction < 1.21) return 'z5';
  return 'z6';
}

export interface ProfileShape {
  /** Chemin SVG d'un palier, dans un repère `width` × `height` (y vers le bas). */
  d: string;
  zone: Zone;
}

/**
 * Profil de la séance : un polygone par palier, hauteur proportionnelle à la consigne (rampes en trapèze).
 * Un palier libre est dessiné bas et neutre, faute de consigne.
 */
/** Haut de l'échelle verticale du profil, en W : 130 % de la FTP, ou plus si un palier dépasse. Les axes s'y alignent. */
export function profilePeakW(w: Workout, ftpW: number): number {
  return Math.max(
    1.3 * ftpW,
    ...w.steps.map((s) => {
      if (s.targetRange && s.target.kind !== 'free') return (s.target.kind === 'ftp' ? s.target.to * ftpW : s.target.to) * 1.08;
      return Math.max(targetWatts(s, 0, ftpW) ?? 0, targetWatts(s, s.durationS, ftpW) ?? 0) * 1.08;
    }),
  );
}

export function profileShapes(w: Workout, ftpW: number, width: number, height: number): ProfileShape[] {
  const total = totalDurationS(w) || 1;
  const peak = profilePeakW(w, ftpW);
  const y = (watts: number) => +(height - (watts / peak) * height).toFixed(2);
  const out: ProfileShape[] = [];
  let t = 0;
  for (const s of w.steps) {
    const x0 = +((t / total) * width).toFixed(2);
    const x1 = +(((t + s.durationS) / total) * width).toFixed(2);
    const from = targetWatts(s, 0, ftpW);
    const to = targetWatts(s, s.durationS, ftpW);
    const free = from === undefined || to === undefined;
    const [a, b] = free ? [0.3 * ftpW, 0.3 * ftpW] : [from, to];
    if (s.targetRange && s.target.kind !== 'free') {
      const low = s.target.kind === 'ftp' ? s.target.from * ftpW : s.target.from;
      const high = s.target.kind === 'ftp' ? s.target.to * ftpW : s.target.to;
      out.push({ d: `M${x0} ${y(high)}L${x1} ${y(high)}L${x1} ${y(low)}L${x0} ${y(low)}Z`, zone: zoneOf((low + high) / 2 / ftpW) });
    } else {
      out.push({
        d: `M${x0} ${height}L${x0} ${y(a)}L${x1} ${y(b)}L${x1} ${height}Z`,
        zone: free ? 'free' : zoneOf((a + b) / 2 / ftpW),
      });
    }
    t += s.durationS;
  }
  return out;
}
