/**
 * Synchronisation des données du coureur avec son compte, côté page : envoie les modifications notées par le journal,
 * reçoit celles des autres appareils et les remet aux sources (réglages, séances, blocs) qui les appliquent.
 *
 * Quand : à la connexion, peu après chaque modification, au retour sur la page et au retour du réseau (branché par
 * l'appelant), et régulièrement tant que la page est visible. Sans compte, rien ne part : le journal garde tout pour
 * la connexion suivante.
 */
import { CSRF_HEADER } from '../net/csrf';
import type { SyncJournal } from './journal';
import { SYNC_LIMITS, SYNC_PATH, type SyncItem, type SyncKind, type SyncRequest, type SyncResponse } from './protocol';

/** Une espèce de données de l'appareil : ce qu'il a, et comment y appliquer ce qui vient d'ailleurs. */
export interface SyncSource {
  kind: SyncKind;
  /** Tous les éléments de l'appareil, avec leur version (pour la première synchronisation). */
  all(): SyncItem[];
  /** Éléments venus du compte, plus récents que ceux de l'appareil (`body: null` : supprimé). */
  apply(items: SyncItem[]): void;
  /** Un autre compte prend l'appareil : on efface les données de cette espèce. */
  clear(): void;
}

export type SyncStatus = 'off' | 'syncing' | 'ok' | 'error';

type Fetch = typeof fetch;

/** Tours au plus par synchronisation (100 modifications envoyées, 200 éléments reçus par tour). */
const MAX_ROUNDS = 20;

export function createSyncClient(o: {
  journal: SyncJournal;
  sources: SyncSource[];
  log: (msg: string) => void;
  fetch?: Fetch;
  /** Délai entre une modification et son envoi : plusieurs gestes rapprochés partent ensemble. */
  debounceMs?: number;
  onStatus?: (s: SyncStatus) => void;
}) {
  const f: Fetch = o.fetch ?? ((...a) => fetch(...a));
  const debounceMs = o.debounceMs ?? 1500;
  let userId: string | undefined;
  let running: Promise<void> | undefined;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let status: SyncStatus = 'off';

  const setStatus = (s: SyncStatus) => {
    if (s === status) return;
    status = s;
    o.onStatus?.(s);
  };

  async function round(owner: string): Promise<boolean> {
    const sent = o.journal.pending(SYNC_LIMITS.changesPerRequest);
    const body: SyncRequest = { since: o.journal.rev, changes: sent };
    const res = await f(SYNC_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new Error('session expirée');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = (await res.json()) as SyncResponse;
    // Compte changé pendant l'envoi : la réponse ne concerne plus l'appareil.
    if (userId !== owner || o.journal.owner !== owner) return false;
    const apply = o.journal.settle(sent, out);
    if (out.rejected.length) o.log(`synchronisation : ${out.rejected.length} élément(s) refusé(s) par le serveur (${out.rejected.join(', ')})`);
    if (apply.length) {
      for (const source of o.sources) {
        const mine = apply.filter((i) => i.kind === source.kind);
        if (mine.length) source.apply(mine);
      }
      o.log(`synchronisation : ${apply.length} élément(s) reçu(s) du compte`);
    }
    return out.more || o.journal.pending(1).length > 0;
  }

  async function run(): Promise<void> {
    const owner = userId;
    if (!owner) return;
    setStatus('syncing');
    try {
      for (let i = 0; i < MAX_ROUNDS && (await round(owner)); i++);
      setStatus('ok');
    } catch (e) {
      setStatus('error');
      o.log(`synchronisation impossible : ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Synchronise maintenant (ou juste après la synchronisation en cours). */
  function now(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    if (!userId) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = run().finally(() => {
      running = undefined;
      if (again) {
        again = false;
        void now();
      }
    });
    return running;
  }

  /** Une modification vient d'être notée : envoi un peu plus tard. */
  function schedule() {
    if (!userId) return;
    clearTimeout(timer);
    timer = setTimeout(() => void now(), debounceMs);
  }

  o.journal.onRecord = schedule;

  return {
    /**
     * Compte connecté (ou `undefined`). Premier passage d'un compte sur l'appareil : ses données le rejoignent ; un autre
     * compte que le précédent : les données de l'appareil sont effacées, puis remplacées par celles du compte.
     */
    setUser(user: { id: string } | undefined) {
      userId = user?.id;
      if (!user) {
        clearTimeout(timer);
        setStatus('off');
        return Promise.resolve();
      }
      if (o.journal.owner === null) {
        o.journal.adopt(user.id, o.sources.flatMap((s) => s.all()));
      } else if (o.journal.owner !== user.id) {
        for (const s of o.sources) s.clear();
        o.journal.reset(user.id);
        o.log('synchronisation : autre compte, données de l’appareil remplacées par celles du compte');
      }
      return now();
    },
    now,
    schedule,
    status: () => status,
  };
}
