import { DEFAULT_RIDER } from './physics';

/** Bornes des réglages du coureur : la fiche les impose à la saisie, la synchronisation à la réception. */
export const MASS_LIMITS = { min: 30, max: 200 } as const;
export const FTP_LIMITS = { min: 50, max: 600 } as const;
/** FTP supposée tant que le coureur n'a pas donné la sienne. */
export const DEFAULT_FTP_W = 200;

/** FTP utilisable : celle saisie si elle est plausible, sinon la FTP par défaut. */
export const normalizeFtp = (w: number): number => (w >= FTP_LIMITS.min ? w : DEFAULT_FTP_W);

/** Masse utilisable : celle saisie si elle est plausible, sinon la masse du coureur par défaut. */
export const normalizeMass = (kg: number): number => (kg >= MASS_LIMITS.min ? kg : DEFAULT_RIDER.massKg);
