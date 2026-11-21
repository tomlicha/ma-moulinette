import type { Course, LiftState } from '../../domain/course/course';
import type { JunctionOption } from '../../domain/sim/journey';
import { targetWatts, type Target, type WorkoutStep } from '../../domain/workout/model';
import { zoneOf, type Zone } from '../../domain/workout/profile';
import { ZONES } from '../../domain/workout/zones';

/** Un palier tel que la liste « À suivre » l'affiche. */
export interface UpcomingStep {
  /** Watts au début et à la fin du palier (égaux hors rampe), absents sur un palier libre. */
  fromW?: number;
  toW?: number;
  durationS: number;
  /** Zone au début et à la fin du palier, `free` sur un palier libre. */
  zoneFrom: Zone;
  zoneTo: Zone;
  /** A fixed interval to follow manually, not a ramp. */
  targetRange?: boolean;
}

export type UpcomingItem =
  | { kind: 'step'; step: UpcomingStep }
  | {
      kind: 'series';
      /** Les deux paliers qui alternent, dans l'ordre de la séance (l'effort d'abord, en général). */
      steps: [UpcomingStep, UpcomingStep];
      /** Lequel des deux arrive, quand la série est en tête de liste. */
      nextIs?: 0 | 1;
      /** Répétition en cours ou sur le point de commencer, et nombre total de répétitions. */
      rep: number;
      reps: number;
    };

/** Série d'intervalles : paliers `start` à `end` (inclus), deux paliers A et B qui alternent, A répété `reps` fois. */
export interface Series {
  start: number;
  end: number;
  reps: number;
}

const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind === 'free' || (b.kind !== 'free' && a.from === b.from && a.to === b.to));
const sameStep = (a: WorkoutStep, b: WorkoutStep) =>
  a.kind === b.kind && a.durationS === b.durationS && a.cadenceRpm === b.cadenceRpm && a.targetRange === b.targetRange && sameTarget(a.target, b.target);

/** Séries d'une séance : A, B, A… avec A et B différents et A au moins deux fois. Un palier qui rompt l'alternance clôt la série. */
export function findSeries(steps: readonly WorkoutStep[]): Series[] {
  const out: Series[] = [];
  let i = 0;
  while (i + 2 < steps.length) {
    const a = steps[i]!;
    const b = steps[i + 1]!;
    if (!sameStep(a, b) && sameStep(steps[i + 2]!, a)) {
      let end = i + 2;
      while (end + 1 < steps.length && sameStep(steps[end + 1]!, (end + 1 - i) % 2 === 0 ? a : b)) end++;
      out.push({ start: i, end, reps: Math.floor((end - i) / 2) + 1 });
      i = end + 1;
    } else i++;
  }
  return out;
}

/** Répétition à laquelle appartient le palier `i` (A ou B), si ce palier fait partie d'une série. */
export function repetitionAt(series: readonly Series[], i: number): { rep: number; reps: number } | undefined {
  const s = series.find((x) => x.start <= i && i <= x.end);
  return s && { rep: Math.floor((i - s.start) / 2) + 1, reps: s.reps };
}

function upcomingStep(step: WorkoutStep, ftpW: number, intensity: number): UpcomingStep {
  const fromW = step.targetRange && step.target.kind !== 'free'
    ? Math.round((step.target.kind === 'ftp' ? step.target.from * ftpW : step.target.from) * intensity)
    : targetWatts(step, 0, ftpW, intensity);
  const toW = step.targetRange && step.target.kind !== 'free'
    ? Math.round((step.target.kind === 'ftp' ? step.target.to * ftpW : step.target.to) * intensity)
    : targetWatts(step, step.durationS, ftpW, intensity);
  const zone = (w: number | undefined): Zone => (w === undefined ? 'free' : zoneOf(w / ftpW));
  return { fromW, toW, durationS: step.durationS, zoneFrom: zone(fromW), zoneTo: zone(toW), ...(step.targetRange ? { targetRange: true } : {}) };
}

/**
 * Liste « À suivre » du HUD : au plus `max` éléments après le palier `stepIndex`, une série d'intervalles comptant pour un
 * (ses deux paliers une seule fois, avec le numéro de répétition). Un dernier palier isolé d'une série s'affiche seul.
 * `rest` : paliers de la séance qui viennent après la liste.
 */
export function upcoming(
  steps: readonly WorkoutStep[],
  series: readonly Series[],
  stepIndex: number,
  ftpW: number,
  intensity = 1,
  max = 4,
): { items: UpcomingItem[]; rest: number } {
  const items: UpcomingItem[] = [];
  let j = stepIndex + 1;
  while (j < steps.length && items.length < max) {
    const s = series.find((x) => x.start <= j && j <= x.end);
    if (s && s.end > j) {
      const onA = (j - s.start) % 2 === 0;
      items.push({
        kind: 'series',
        steps: [upcomingStep(steps[s.start]!, ftpW, intensity), upcomingStep(steps[s.start + 1]!, ftpW, intensity)],
        nextIs: items.length === 0 ? (onA ? 0 : 1) : undefined,
        rep: Math.floor((j - s.start - (onA ? 0 : 1)) / 2) + 1,
        reps: s.reps,
      });
      j = s.end + 1;
    } else {
      items.push({ kind: 'step', step: upcomingStep(steps[j]!, ftpW, intensity) });
      j++;
    }
  }
  return { items, rest: steps.length - j };
}

/** Montée minimale pour qu'un haut compte comme un sommet, et descente qui le confirme, en m. */
const SUMMIT_MIN_RISE_M = 8;
const SUMMIT_DROP_M = 2;

/**
 * Distance jusqu'au prochain sommet en avant sur le parcours (le trajet par défaut sur un réseau), `undefined` s'il n'y en
 * a pas dans les `horizonM` m. Un sommet est un haut atteint après au moins 8 m de montée, que 2 m de descente confirment.
 */
export function nextSummitM(course: Course, fromM: number, horizonM = 8000, stepM = 20): number | undefined {
  let valley = course.altitudeAt(fromM);
  let peak = valley;
  let peakAt = fromM;
  for (let d = fromM + stepM; d <= fromM + horizonM; d += stepM) {
    const a = course.altitudeAt(d);
    if (a < valley) {
      valley = peak = a;
      peakAt = d;
    } else if (a > peak) {
      peak = a;
      peakAt = d;
    }
    if (peak - valley >= SUMMIT_MIN_RISE_M && peak - a >= SUMMIT_DROP_M) return peakAt - fromM;
  }
  return undefined;
}

/** Fenêtre du profil d'altitude : derrière et devant le cycliste, en m. */
export const PROFILE_BEHIND_M = 400;
export const PROFILE_SPAN_M = 3000;
/** Plus petite hauteur d'altitude représentée par l'encart, en m : un plat y reste plat. */
export const PROFILE_MIN_RANGE_M = 40;

/**
 * Profil d'altitude d'une fenêtre de `spanM` m dont le cycliste occupe la position `behindM`, dans un repère `width` × `height`
 * (y vers le bas, 3 px de marge en haut et en bas). Au départ, la fenêtre ne recule pas avant 0.
 */
export function profileWindow(
  course: Course,
  fromM: number,
  width: number,
  height: number,
  spanM = PROFILE_SPAN_M,
  behindM = PROFILE_BEHIND_M,
  stepM = 20,
) {
  const startM = Math.max(0, fromM - behindM);
  const pts: [number, number][] = [];
  for (let d = startM; d <= startM + spanM + 1e-6; d += stepM) pts.push([d, course.altitudeAt(d)]);
  const alts = pts.map((p) => p[1]);
  const min = Math.min(...alts);
  // Échelle verticale d'au moins `PROFILE_MIN_RANGE_M` : sans elle, un plat (la piste d'un vélodrome, où l'écart n'est
  // qu'un bruit de calcul ; la Rive du lac, quelques mètres) s'étirait sur toute la hauteur en dents de scie.
  const range = Math.max(Math.max(...alts) - min, PROFILE_MIN_RANGE_M);
  const x = (d: number) => ((d - startM) / spanM) * width;
  const y = (alt: number) => height - 3 - ((alt - min) / range) * (height - 6);
  const line = pts.map(([d, a], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)} ${y(a).toFixed(1)}`).join(' ');
  return { line, area: `${line} L${width} ${height} L0 ${height} Z`, x, y, startM, endM: startM + spanM };
}

/** « Z3 · Tempo » pour une puissance et une FTP données. */
export function zoneLabel(powerW: number, ftpW: number): { id: string; label: string } {
  const id = zoneOf(powerW / ftpW);
  const n = id.slice(1);
  return { id, label: `Z${n} · ${ZONES.find((z) => z.id === id)!.name}` };
}

const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Un chiffre après la virgule, à la française : 18,4. */
export const fmt1 = (v: number) => nf1.format(v);
/** Signe toujours affiché, vrai signe moins : +4,2 ou −3. */
export const signed = (v: number, digits: 0 | 1 = 0) => {
  const abs = digits ? nf1.format(Math.abs(v)) : String(Math.round(Math.abs(v)));
  const zero = abs === '0' || abs === '0,0';
  return `${v < 0 && !zero ? '−' : '+'}${abs}`;
};

/**
 * Flèche selon l'écart de cap : tout droit, en biais (25 à 65°), à angle droit (65 à 115°), en épingle (au-delà).
 * Deux routes qui tournent du même côté ne se confondent pas.
 */
export function turnArrow(turnDeg: number): string {
  const a = Math.abs(turnDeg);
  const right = turnDeg > 0;
  if (a < 25) return '↑';
  if (a < 65) return right ? '↗' : '↖';
  if (a < 115) return right ? '→' : '←';
  return right ? '↘' : '↙';
}

/**
 * Flèche, nom et résumé d'une route qui part d'un carrefour : « Le Col · 6,4 km · +5,6 % · +357 m ». `base` est le résumé
 * sans la montée, `climb` la montée seule (vide sous 10 m) : le téléphone n'affiche que `base`, la carte de l'encart
 * porte la montée.
 */
export function junctionLabel(o: JunctionOption): { arrow: string; name: string; meta: string; base: string; climb: string } {
  const climb = o.climbM >= 10 ? ` · +${Math.round(o.climbM)} m` : '';
  const base = `${fmt1(o.lengthM / 1000)} km · ${signed(o.avgGradePct, 1)} %`;
  return { arrow: turnArrow(o.turnDeg), name: o.name, meta: base + climb, base, climb };
}

/**
 * Textes du bas du HUD dans un ascenseur : l'altitude à la place de la pente (nulle dans la cabine), le trajet de
 * l'ascenseur à la place du nom du parcours, et le temps qui reste avant l'arrivée (arrondi à la seconde au-dessus,
 * jamais « 0 s » tant que la cabine bouge).
 */
export function liftBanner(lift: LiftState): { label: string; value: string; unit: string; info: string; right: string } {
  const left = Math.max(1, Math.ceil((1 - lift.progress) * lift.durationS - 1e-9));
  return {
    label: 'Altitude',
    value: String(Math.round(lift.altitudeM)),
    unit: 'm',
    info: `${lift.name} · ${Math.round(lift.fromAltitudeM)} → ${Math.round(lift.toAltitudeM)} m`,
    right: `${lift.toName} dans ${left} s`,
  };
}
