import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrainerRecord } from '../../src/telemetry/device.ts';
import { createFileDeviceStore } from './device-store.ts';

const kickr: TrainerRecord = { profile: 'wahoo-kickr', brand: 'wahoo', manufacturer: 'Wahoo Fitness', model: 'KICKR CORE', firmware: '1.5.36', protocol: 'wahoo', services: ['b', 'a'] };

describe('magasin fichier', () => {
  it('une fiche par installation, remplacée au changement, premier passage conservé', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trainers-'));
    try {
      const s = createFileDeviceStore(join(dir, 't.json'));
      expect(await s.upsert({ install: 'i', trainer: kickr }, 10)).toEqual({ created: true, changed: false });
      expect(await s.upsert({ install: 'i', trainer: kickr }, 20)).toEqual({ created: false, changed: false });
      expect(await s.upsert({ install: 'i', trainer: { ...kickr, firmware: '2' } }, 30)).toEqual({ created: false, changed: true });
      const [d] = await s.list({ limit: 10 });
      expect(d).toMatchObject({ firstSeen: 10, updatedAt: 30, changes: 1, trainer: { firmware: '2' } });
      await Promise.all([s.upsert({ install: 'a', trainer: kickr }, 40), s.upsert({ install: 'b', trainer: kickr }, 41)]);
      expect(await s.list({ limit: 10 })).toHaveLength(3);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
