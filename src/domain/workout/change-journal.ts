/**
 * Où les bibliothèques (séances, blocs) notent leurs modifications pour qu'elles suivent le coureur d'un appareil à
 * l'autre. Le journal de synchronisation (infra/sync) le remplit ; le domaine n'en sait pas plus.
 */
export interface ChangeJournal {
  /** Une modification (`body: null` : suppression). */
  record(kind: 'workout' | 'block', id: string, body: unknown, updatedAt?: number): void;
}
