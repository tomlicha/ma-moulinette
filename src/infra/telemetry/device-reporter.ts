import { fingerprint, type TrainerRecord } from './device';
import { newId } from '../../shared/util/uuid';

export interface DeviceReporterOptions {
  /** Adresse de la route `device` du récepteur. */
  endpoint: string;
  token?: string;
  /** Stockage du navigateur : l'identifiant d'installation et l'empreinte de la dernière fiche acceptée. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  fetch?: typeof fetch;
  newId?: () => string;
  userAgent?: string;
}

const ID_KEY = 'mm.install';
const SENT_KEY = 'mm.trainerSent';

/**
 * Envoie la fiche du trainer au premier appairage, puis seulement quand elle change. L'empreinte n'est retenue qu'une fois
 * le serveur d'accord : un envoi raté (hors ligne) repart à la prochaine connexion. Ne lève jamais.
 */
export function createDeviceReporter(opts: DeviceReporterOptions) {
  const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const store = (): Pick<Storage, 'getItem' | 'setItem'> | undefined => {
    try {
      return opts.storage ?? localStorage;
    } catch {
      return undefined; // stockage refusé : on enverra à chaque connexion, le serveur dédoublonne
    }
  };
  const read = (k: string) => {
    try {
      return store()?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };
  const write = (k: string, v: string) => {
    try {
      store()?.setItem(k, v);
    } catch {
      // ignoré
    }
  };

  let inFlight = false;
  return {
    async report(trainer: TrainerRecord): Promise<boolean> {
      const print = fingerprint(trainer);
      if (inFlight || read(SENT_KEY) === print) return false;
      let install = read(ID_KEY);
      if (!install) {
        install = (opts.newId ?? newId)();
        write(ID_KEY, install);
      }
      inFlight = true;
      try {
        const res = await f(opts.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
          body: JSON.stringify({ install, trainer, userAgent: opts.userAgent }),
          keepalive: true,
        });
        if (!res.ok) return false;
        write(SENT_KEY, print);
        return true;
      } catch {
        return false;
      } finally {
        inFlight = false;
      }
    },
  };
}
