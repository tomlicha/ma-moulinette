/**
 * Identifiant aléatoire (UUID v4). `crypto.randomUUID` n'existe que dans un contexte sécurisé (https ou localhost) : sur
 * un téléphone qui ouvre l'app par l'adresse du réseau local (http://192.168…), il manque et l'app ne démarrait pas.
 * `getRandomValues`, lui, est disponible partout.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
