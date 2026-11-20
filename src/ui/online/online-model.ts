import type { GroupSummary, OnlineRider } from '../../infra/net/group-protocol';

/** Les délais proposés pour créer une séance de groupe : le temps de se réunir. */
export const START_DELAYS: readonly { s: number; label: string }[] = [
  { s: 120, label: 'dans 2 min' },
  { s: 300, label: 'dans 5 min' },
  { s: 600, label: 'dans 10 min' },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** « 3:05 » au-delà d'une minute, « 45 s » en dessous ; « maintenant » une fois l'heure passée. */
export function countdownText(ms: number): string {
  if (ms <= 0) return 'maintenant';
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${pad(s % 60)}` : `${s} s`;
}

/** Durée d'une séance : « 25 min », ou « 1 h 05 » au-delà d'une heure. */
export function durationText(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  return min >= 60 ? `${Math.floor(min / 60)} h ${pad(min % 60)}` : `${min} min`;
}

const people = (n: number) => `${n} coureur${n > 1 ? 's' : ''}`;

/** La ligne d'un groupe dans la liste : séance, parcours, durée, départ, nombre de coureurs. */
export function groupLine(g: GroupSummary, serverNowMs: number, courseName: string): string {
  const wait = g.t0 - serverNowMs;
  const when = wait > 0 ? `départ dans ${countdownText(wait)}` : `en cours depuis ${durationText(-wait / 1000)}`;
  return `${g.workoutName} · ${courseName} · ${durationText(g.durationS)} · ${when} · ${people(g.count)}`;
}

/** Ce que dit la ligne d'un coureur de la liste « En ligne ». */
export const riderStatus = (r: Pick<OnlineRider, 'riding' | 'open'>): string => (r.riding ? (r.open ? 'en sortie' : 'en sortie · amis seulement') : 'en ligne');

/** Pourquoi un ami n'a pas pu être ajouté ou retiré. */
export function friendErrorText(reason: string): string {
  switch (reason) {
    case 'too-many':
      return 'Tu as déjà 100 amis : retires-en un avant d’en ajouter.';
    case 'unknown':
      return 'Ce coureur n’est plus disponible.';
    case 'signed-out':
      return 'Connecte-toi avec Strava pour garder tes amis.';
    default:
      return 'Impossible de joindre le serveur : réessaie dans un instant.';
  }
}

/** En-tête de la liste des coureurs : combien il y en a, et combien la liste ne montre pas. */
export function ridersTitle(shown: number, total: number): string {
  if (total === 0) return 'En ligne';
  return total > shown ? `En ligne · ${shown} sur ${total}` : `En ligne · ${total}`;
}

/** « Séance de groupe · 6 coureurs » : la pastille de la sortie pendant la séance. */
export const groupPill = (count: number): string => `Séance de groupe · ${people(count)}`;

/** La phrase qui explique pourquoi on n'est plus dans le groupe ; vide quand c'est le coureur qui l'a voulu. */
export function leftText(reason: string, name: string): string {
  switch (reason) {
    case 'manual':
      return '';
    case 'self-stopped':
      return 'Tu ne pédalais plus : tu as quitté le groupe.';
    case 'offline':
      return 'Connexion perdue : tu as quitté le groupe.';
    case 'over':
      return name ? `${name} est terminée.` : 'Cette séance est terminée.';
    case 'full':
      return 'Ce groupe est complet.';
    case 'unknown':
    case 'empty':
      return 'Ce groupe n’existe plus.';
    case 'invalid':
      return 'Cette séance n’a pas pu être créée.';
    case 'missed':
      return 'Départ manqué : le trainer n’était pas prêt.';
    case 'busy':
      return 'Départ manqué : une sortie était déjà en cours.';
    default:
      return '';
  }
}
