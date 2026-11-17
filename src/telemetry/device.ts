/**
 * Trainer d'un utilisateur, tel que le récepteur le garde : une seule fiche par installation, mise à jour si le trainer change.
 * Envoyé même sans erreur (contrairement aux rapports de journal) : c'est ce qui dit quels trainers l'application a vus.
 */

export interface DeviceReport {
  /** Identifiant tiré au hasard à la première visite et gardé dans le navigateur : ni compte, ni nom, ni adresse Bluetooth. */
  install: string;
  trainer: TrainerRecord;
  userAgent?: string;
}

export interface TrainerRecord {
  /** Famille reconnue (`trainer-profiles.ts`). */
  profile: string;
  brand?: string;
  label?: string;
  manufacturer?: string;
  model?: string;
  hardware?: string;
  firmware?: string;
  software?: string;
  /** Protocole de pilotage retenu ; absent, le trainer est en lecture seule. */
  protocol?: string;
  /** UUID des services Bluetooth exposés. */
  services: string[];
}

export interface StoredDevice extends DeviceReport {
  firstSeen: number;
  updatedAt: number;
  /** Nombre de fois où la fiche a changé depuis la première (0 : jamais). */
  changes: number;
}

export const DEVICE_LIMITS = { bodyBytes: 8 * 1024, string: 80, services: 24 };

/** Ce qui fait qu'une fiche a changé : tout sauf l'installation. L'ordre des services ne compte pas. */
export function fingerprint(t: TrainerRecord): string {
  const { services, ...rest } = t;
  return JSON.stringify([rest, [...services].sort()]);
}

const text = (v: unknown): string | undefined | null => {
  if (v === undefined || v === null || v === '') return undefined;
  return typeof v === 'string' && v.length <= DEVICE_LIMITS.string ? v : null;
};

/** Valide un corps JSON inconnu ; `undefined` s'il ne ressemble pas à une fiche trainer. */
export function parseDeviceReport(raw: unknown): DeviceReport | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.install !== 'string' || !r.install || r.install.length > DEVICE_LIMITS.string) return undefined;
  const t = r.trainer;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return undefined;
  const o = t as Record<string, unknown>;
  const profile = text(o.profile);
  if (!profile) return undefined;
  if (!Array.isArray(o.services) || o.services.length > DEVICE_LIMITS.services) return undefined;
  if (!o.services.every((s) => typeof s === 'string' && s.length <= DEVICE_LIMITS.string)) return undefined;

  const trainer: TrainerRecord = { profile, services: o.services as string[] };
  for (const k of ['brand', 'label', 'manufacturer', 'model', 'hardware', 'firmware', 'software', 'protocol'] as const) {
    const v = text(o[k]);
    if (v === null) return undefined;
    if (v !== undefined) trainer[k] = v;
  }
  const ua = text(r.userAgent);
  if (ua === null) return undefined;
  return { install: r.install, trainer, ...(ua ? { userAgent: ua } : {}) };
}
