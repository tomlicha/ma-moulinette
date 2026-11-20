import { digestWorkout, type WorkoutCategory } from '../../domain/workout/summary';
import type { Workout } from '../../domain/workout/model';
import { profilePeakW, profileShapes, type ProfileShape } from '../../domain/workout/profile';
import { ZONES } from '../../domain/workout/zones';

export const PROFILE_W = 1000;
export const PROFILE_H = 120;

export type CategoryFilter = 'all' | WorkoutCategory;

export const FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'endurance', label: 'Endurance' },
  { id: 'seuil', label: 'Seuil' },
  { id: 'vo2', label: 'VO2' },
];

/** Une séance telle que l'accueil la présente : tout est déjà du texte ou des formes, la vue ne calcule rien. */
export interface WorkoutCardModel {
  /** `lib:<id>`, `sample:<id>` ; vide pour la sortie libre. */
  value: string;
  name: string;
  category: WorkoutCategory | undefined;
  /** « 50 min » */
  duration: string;
  /** « 50′ » */
  durationShort: string;
  /** « 50 min · 207 W » : sous le nom, quand la séance est repliée. */
  line: string;
  /** « 50 min · 2 × 20′ à 207 W » : la carte de l'iPhone. */
  phoneLine: string;
  shapes: ProfileShape[];
  /** FTP du coureur utilisée pour ce profil, en W. */
  ftpW: number;
  /** Position de la FTP dans le profil (0 en haut, `PROFILE_H` en bas). */
  ftpY: number;
  stats: { value: string; label: string }[];
  /** Part du temps dans chaque zone (0 à 1), pour la barre. */
  zoneShares: { zone: string; share: number }[];
}

export const fmtMinutes = (s: number) => `${Math.max(1, Math.round(s / 60))}`;

const FOLLOW: Record<string, string> = { z1: 'Z1', z2: 'Z2', z3: 'Z3', z4: 'Z4', z5: 'Z5', z6: 'Z6' };

/** La carte d'une séance pour la FTP du coureur. */
export function workoutCard(value: string, w: Workout, ftpW: number): WorkoutCardModel {
  const d = digestWorkout(w, ftpW);
  const min = fmtMinutes(d.totalS);
  const iv = d.intervals;
  const structure = iv ? `${iv.count} × ${fmtMinutes(iv.durationS)}′` : `${min}′ continu`;
  const recovery = iv?.recoveryS ? `récup ${fmtMinutes(iv.recoveryS)}′${iv.recoveryW ? ` à ${iv.recoveryW} W` : ''}` : 'sans pause';
  const peak = profilePeakW(w, ftpW);
  const share = (z: string) => d.zones[z as keyof typeof d.zones] / (d.totalS || 1);
  return {
    value,
    name: w.name,
    category: d.category,
    duration: `${min} min`,
    durationShort: `${min}′`,
    line: `${min} min · ${d.effortW} W`,
    phoneLine: `${min} min · ${iv ? `${structure} à ` : ''}${d.effortW} W · ERG`,
    shapes: profileShapes(w, ftpW, PROFILE_W, PROFILE_H),
    ftpW,
    ftpY: +(PROFILE_H - (ftpW / peak) * PROFILE_H).toFixed(2),
    stats: [
      { value: `${d.effortW} W`, label: `effort · ${d.effortPct} % FTP` },
      { value: structure, label: recovery },
      { value: FOLLOW[d.dominant.zone]!, label: `${Math.round(d.dominant.share * 100)} % du temps` },
    ],
    zoneShares: [...ZONES.map((z) => z.id), 'free'].map((z) => ({ zone: z, share: share(z) })).filter((z) => z.share > 0),
  };
}

/** Les cartes qui passent le filtre. */
export function filterCards(cards: WorkoutCardModel[], filter: CategoryFilter): WorkoutCardModel[] {
  return filter === 'all' ? cards : cards.filter((c) => c.category === filter);
}
