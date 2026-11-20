/**
 * Suivre un coureur : rester collé à celui qu'on a rejoint (docs/design/groupe.md, section 3). Règles pures, sans horloge
 * ni réseau : l'appelant donne le temps écoulé et ce qu'il voit du meneur, la règle dit où en est le suivi.
 *
 * Le suivi est une aide, pas un moteur : il ne fait jamais avancer plus vite que le meneur. Quand on est à plus de
 * `ASSIST_FROM_M` derrière lui (et à moins de `ASSIST_RANGE_M`), une aspiration de rappel s'ajoute, celle qu'on aurait à
 * `ASSIST_AS_IF_M` de sa roue ; plus près, la vraie aspiration (`draft.ts`) fait le travail.
 */
import { DRAFT_DECAY_M, DRAFT_MAX, DRAFT_MIN_SPEED_MS } from '../sim/draft';

/** Sous cet écart, l'aspiration normale suffit : pas d'aide en plus, en m. */
export const ASSIST_FROM_M = 15;
/** Au-delà, le coureur roule seul pour recoller : pas d'aide, en m. */
export const ASSIST_RANGE_M = 150;
/** L'aide vaut l'aspiration qu'on aurait à cet écart de roues, en m. */
export const ASSIST_AS_IF_M = 5;
/** Part de la traînée de l'air épargnée par l'aide (≈ 15 %). */
export const ASSIST_REDUCTION = DRAFT_MAX * Math.exp(-ASSIST_AS_IF_M / DRAFT_DECAY_M);
/** À plus de `ASSIST_RANGE_M` pendant ce temps, le coureur a décroché, en s. */
export const DROP_AFTER_S = 60;
/** Le meneur ne roule plus depuis ce temps : on le dit, en s. */
export const LEADER_PAUSE_NOTICE_S = 10;
/** Le meneur ne roule plus depuis ce temps : le suivi se termine, en s. */
export const LEADER_PAUSE_END_S = 120;
/** Le meneur n'est plus reçu depuis ce temps : le suivi se termine, en s. */
export const LEADER_LOST_END_S = 10;
/** Soi-même à l'arrêt depuis ce temps : le suivi se termine, en s. */
export const SELF_IDLE_END_S = 60;
/** Sous cette puissance, on ne pédale pas, en W. */
export const IDLE_POWER_W = 5;

export type FollowEnd = 'leader-stopped' | 'leader-lost' | 'self-stopped';

/** Où en est le suivi. */
export type FollowPhase = 'following' | 'dropped' | 'leader-paused';

export interface FollowSelf {
  x: number;
  z: number;
  /** Cap en rad, `atan2(dz, dx)`. */
  heading: number;
  powerW: number;
}

export interface FollowLeader {
  x: number;
  z: number;
  speedMs: number;
  riding: boolean;
}

export interface FollowStatus {
  phase: FollowPhase;
  /** Écart au meneur, en m : positif s'il est devant, négatif derrière (à vol d'oiseau, signé par le cap). */
  gapM: number;
  /** Même écart en secondes de sa vitesse ; `undefined` si le meneur est à l'arrêt. */
  gapS?: number;
  /** Aspiration de rappel à ajouter, 0 à `ASSIST_REDUCTION`. */
  assist: number;
  /** Renseigné quand le suivi vient de se terminer. */
  ended?: FollowEnd;
}

export class FollowTracker {
  private farS = 0;
  private lostS = 0;
  private pausedS = 0;
  private idleS = 0;

  /** `leader` vaut `undefined` quand le meneur n'est pas (ou plus) reçu. */
  update(dtS: number, self: FollowSelf, leader: FollowLeader | undefined): FollowStatus {
    this.idleS = self.powerW <= IDLE_POWER_W ? this.idleS + dtS : 0;
    if (this.idleS >= SELF_IDLE_END_S) return { phase: 'following', gapM: 0, assist: 0, ended: 'self-stopped' };

    if (!leader) {
      this.lostS += dtS;
      const ended = this.lostS >= LEADER_LOST_END_S ? 'leader-lost' : undefined;
      return { phase: 'following', gapM: 0, assist: 0, ...(ended ? { ended } : {}) };
    }
    this.lostS = 0;

    const dx = leader.x - self.x;
    const dz = leader.z - self.z;
    const dist = Math.hypot(dx, dz);
    const ahead = dx * Math.cos(self.heading) + dz * Math.sin(self.heading) >= 0;
    const gapM = ahead ? dist : -dist;
    const gapS = leader.speedMs >= DRAFT_MIN_SPEED_MS ? dist / leader.speedMs : undefined;

    this.pausedS = leader.riding ? 0 : this.pausedS + dtS;
    if (this.pausedS >= LEADER_PAUSE_END_S) return { phase: 'leader-paused', gapM, ...(gapS !== undefined ? { gapS } : {}), assist: 0, ended: 'leader-stopped' };
    const paused = this.pausedS >= LEADER_PAUSE_NOTICE_S;

    this.farS = dist > ASSIST_RANGE_M ? this.farS + dtS : 0;
    const dropped = this.farS >= DROP_AFTER_S;

    const canAssist = ahead && leader.riding && leader.speedMs >= DRAFT_MIN_SPEED_MS && dist > ASSIST_FROM_M && dist <= ASSIST_RANGE_M;
    return {
      phase: paused ? 'leader-paused' : dropped ? 'dropped' : 'following',
      gapM,
      ...(gapS !== undefined ? { gapS } : {}),
      assist: canAssist ? ASSIST_REDUCTION : 0,
    };
  }
}
