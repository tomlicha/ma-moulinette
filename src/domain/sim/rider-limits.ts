import { DEFAULT_RIDER } from './physics';

/** Bornes des réglages du coureur : la fiche les impose à la saisie, la synchronisation à la réception. */
export const MASS_LIMITS = { min: 30, max: 200 } as const;
export const FTP_LIMITS = { min: 50, max: 600 } as const;
/** FTP supposée tant que le coureur n'a pas donné la sienne. */
export const DEFAULT_FTP_W = 200;

/** Rapport puissance / masse, à la française : « 2,95 ». */
export const wattsPerKg = (ftpW: number, massKg: number): string => (ftpW / massKg).toFixed(2).replace('.', ',');

/** Ramène une saisie dans les bornes, arrondie ; une saisie illisible redonne `fallback`. */
export function clampValue(raw: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

/** FTP utilisable : celle saisie si elle est plausible, sinon la FTP par défaut. */
export const normalizeFtp = (w: number): number => (w >= FTP_LIMITS.min ? w : DEFAULT_FTP_W);

/** Masse utilisable : celle saisie si elle est plausible, sinon la masse du coureur par défaut. */
export const normalizeMass = (kg: number): number => (kg >= MASS_LIMITS.min ? kg : DEFAULT_RIDER.massKg);
