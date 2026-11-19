import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fingerprint, type StoredDevice } from '../../src/infra/telemetry/device.ts';
import type { DeviceStore } from '../../src/infra/telemetry/receiver.ts';

/** Fiches trainer en un fichier JSON (développement et `tools/log-server.ts`) : une entrée par installation. */
export function createFileDeviceStore(path: string): DeviceStore {
  const load = async (): Promise<Record<string, StoredDevice>> => {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as Record<string, StoredDevice>;
    } catch {
      return {};
    }
  };
  let queue: Promise<unknown> = Promise.resolve();
  return {
    upsert(report, now) {
      const run = async () => {
        const all = await load();
        const known = all[report.install];
        if (known && fingerprint(known.trainer) === fingerprint(report.trainer)) return { created: false, changed: false };
        all[report.install] = {
          ...report,
          firstSeen: known?.firstSeen ?? now,
          updatedAt: now,
          changes: known ? known.changes + 1 : 0,
        };
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.tmp`, JSON.stringify(all, null, 2), 'utf8');
        await rename(`${path}.tmp`, path);
        return { created: !known, changed: !!known };
      };
      const result = queue.then(run, run); // une écriture à la fois : deux envois simultanés ne s'écrasent pas
      queue = result.catch(() => undefined);
      return result;
    },
    async list({ limit }) {
      return Object.values(await load())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
    },
  };
}
