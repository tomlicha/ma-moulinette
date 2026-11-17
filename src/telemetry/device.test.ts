import { describe, expect, it } from 'vitest';
import { fingerprint, parseDeviceReport, type TrainerRecord } from './device';
import { createDeviceReporter } from './device-reporter';
import { createLogReceiver, type DeviceStore, type LogStore } from './receiver';

const kickr: TrainerRecord = { profile: 'wahoo-kickr', brand: 'wahoo', manufacturer: 'Wahoo Fitness', model: 'KICKR CORE', firmware: '1.5.36', protocol: 'wahoo', services: ['b', 'a'] };

describe('fiche trainer', () => {
  it("l'empreinte ignore l'ordre des services mais pas le firmware", () => {
    expect(fingerprint(kickr)).toBe(fingerprint({ ...kickr, services: ['a', 'b'] }));
    expect(fingerprint(kickr)).not.toBe(fingerprint({ ...kickr, firmware: '1.6.0' }));
  });

  it('valide et nettoie', () => {
    expect(parseDeviceReport({ install: 'i', trainer: { profile: 'p', services: [], extra: 'x' } })).toEqual({ install: 'i', trainer: { profile: 'p', services: [] } });
    for (const bad of [null, {}, { install: 'i' }, { install: 'i', trainer: { services: [] } }, { install: 'i', trainer: { profile: 'p', services: 'x' } }, { install: 'i', trainer: { profile: 'p', model: 'x'.repeat(200), services: [] } }])
      expect(parseDeviceReport(bad)).toBeUndefined();
  });
});

describe('envoi côté application', () => {
  const setup = (ok = true) => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const calls: { url: string; body: { install: string; trainer: TrainerRecord } }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return { ok } as Response;
    }) as unknown as typeof fetch;
    return { calls, reporter: createDeviceReporter({ endpoint: 'https://l/api/logs/device', storage, fetch: fetchImpl, newId: () => 'inst-1' }) };
  };

  it('envoie une fois, pas deux, puis de nouveau si le trainer change', async () => {
    const { calls, reporter } = setup();
    expect(await reporter.report(kickr)).toBe(true);
    expect(await reporter.report(kickr)).toBe(false);
    expect(await reporter.report({ ...kickr, firmware: '1.6.0' })).toBe(true);
    expect(calls.map((c) => c.body.install)).toEqual(['inst-1', 'inst-1']);
    expect(calls).toHaveLength(2);
  });

  it("réessaie à la connexion suivante si l'envoi a échoué", async () => {
    const { calls, reporter } = setup(false);
    expect(await reporter.report(kickr)).toBe(false);
    expect(await reporter.report(kickr)).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe('récepteur : route device', () => {
  const noLogs: LogStore = { append: async () => {}, read: async () => [] };
  const devices = (): DeviceStore & { rows: Map<string, string> } => {
    const rows = new Map<string, string>();
    return {
      rows,
      async upsert(r) {
        const known = rows.get(r.install);
        const print = fingerprint(r.trainer);
        rows.set(r.install, print);
        return { created: !known, changed: !!known && known !== print };
      },
      list: async () => [],
    };
  };
  const post = (body: unknown, h: Record<string, string> = {}) => new Request('http://h/api/logs/device', { method: 'POST', body: JSON.stringify(body), headers: h });

  it('enregistre, signale création puis changement', async () => {
    const r = createLogReceiver({ store: noLogs, devices: devices() });
    const send = async (t: TrainerRecord) => (await (await r(post({ install: 'i', trainer: t }))!)!.json()) as { created: boolean; changed: boolean };
    expect(await send(kickr)).toMatchObject({ created: true, changed: false });
    expect(await send(kickr)).toMatchObject({ created: false, changed: false });
    expect(await send({ ...kickr, firmware: '2' })).toMatchObject({ created: false, changed: true });
  });

  it('refuse un corps invalide, un jeton faux, et répond « non configuré » sans magasin', async () => {
    const r = createLogReceiver({ store: noLogs, devices: devices(), ingestToken: 't' });
    expect((await r(post({ nope: 1 }, { authorization: 'Bearer t' })))!.status).toBe(400);
    expect((await r(post({ install: 'i', trainer: kickr }, { authorization: 'Bearer x' })))!.status).toBe(403);
    expect((await createLogReceiver({ store: noLogs })(post({ install: 'i', trainer: kickr })))!.status).toBe(503);
  });

  it('relit les fiches avec le jeton de lecture seulement', async () => {
    const r = createLogReceiver({ store: noLogs, devices: devices(), readToken: 'r' });
    expect((await r(new Request('http://h/api/logs/devices')))!.status).toBe(403);
    expect((await r(new Request('http://h/api/logs/devices', { headers: { authorization: 'Bearer r' } })))!.status).toBe(200);
  });
});
