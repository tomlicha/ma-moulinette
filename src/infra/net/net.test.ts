import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../../domain/course/courses/col-des-erables';
import { RoadNetwork } from '../../domain/course/network';
import { Interpolator, MAX_EXTRAPOLATION_MS, RENDER_DELAY_MS } from './interpolation';
import { MSG_SNAPSHOT, networkSignature, StateCodec, STATE_BYTES, type RiderState } from './protocol';

const codec = new StateCodec(COL_DES_ERABLES);
const edges = [...COL_DES_ERABLES.edges.keys()];

const state = (over: Partial<RiderState> = {}): RiderState => ({
  pos: { edgeId: edges[3]!, forward: false, s: 1234.56, next: { edgeId: edges[5]!, forward: true } },
  tMs: 987_654_321,
  speedMs: 9.87,
  powerW: 245,
  cadenceRpm: 88,
  riding: true,
  ...over,
});

describe('protocole', () => {
  it("un état fait 19 octets et se relit à l'identique, au centimètre près", () => {
    const buf = codec.encodeState(state());
    expect(buf.byteLength).toBe(STATE_BYTES);
    expect(codec.decodeState(buf)).toEqual(state());
  });

  it('sans route suivante ni sortie en cours', () => {
    const s = state({ pos: { edgeId: edges[0]!, forward: true, s: 0 }, riding: false, speedMs: 0, cadenceRpm: 0 });
    expect(codec.decodeState(codec.encodeState(s))).toEqual(s);
  });

  it('borne les valeurs hors format au lieu de les replier', () => {
    const s = codec.decodeState(codec.encodeState(state({ speedMs: -3, powerW: 99_999, cadenceRpm: 400 })))!;
    expect(s.speedMs).toBe(0);
    expect(s.powerW).toBe(0xffff);
    expect(s.cadenceRpm).toBe(255);
  });

  it('refuse un message mal formé ou une route inconnue', () => {
    expect(() => codec.encodeState(state({ pos: { edgeId: 'nulle-part', forward: true, s: 0 } }))).toThrow();
    expect(codec.decodeState(new ArrayBuffer(5))).toBeUndefined();
    const buf = codec.encodeState(state());
    new DataView(buf).setUint16(2, 999, true);
    expect(codec.decodeState(buf)).toBeUndefined();
    new DataView(buf).setUint8(0, 0x42);
    expect(codec.decodeState(buf)).toBeUndefined();
  });

  it('un instantané relaie les états sans les relire (chemin du serveur)', () => {
    const a = state();
    const b = state({ pos: { edgeId: edges[1]!, forward: true, s: 12 }, powerW: 180 });
    // Le serveur colle le numéro du coureur devant les 18 octets reçus.
    const parts = [
      [7, codec.encodeState(a)],
      [300, codec.encodeState(b)],
    ] as const;
    const relayed = new Uint8Array(2 + parts.length * 20);
    relayed[0] = MSG_SNAPSHOT;
    relayed[1] = parts.length;
    parts.forEach(([slot, buf], i) => {
      new DataView(relayed.buffer).setUint16(2 + i * 20, slot, true);
      relayed.set(StateCodec.bodyOf(buf), 4 + i * 20);
    });
    const direct = codec.encodeSnapshot([{ slot: 7, state: a }, { slot: 300, state: b }]);
    expect(new Uint8Array(direct)).toEqual(relayed);
    expect(codec.decodeSnapshot(direct)).toEqual([{ slot: 7, state: a }, { slot: 300, state: b }]);
  });

  it('rejette un instantané tronqué', () => {
    const buf = codec.encodeSnapshot([{ slot: 1, state: state() }]);
    expect(codec.decodeSnapshot(buf.slice(0, buf.byteLength - 1))).toBeUndefined();
    expect(codec.decodeSnapshot(codec.encodeSnapshot([]))).toEqual([]);
  });

  it("l'empreinte du réseau change dès qu'une route change", () => {
    expect(networkSignature(COL_DES_ERABLES)).toBe(networkSignature(new RoadNetwork(COL_DES_ERABLES.def)));
    const def = structuredClone(COL_DES_ERABLES.def);
    def.edges[0]!.plan.push([def.nodes[0]!.x + 5, def.nodes[0]!.z + 400]);
    expect(networkSignature(new RoadNetwork(def))).not.toBe(networkSignature(COL_DES_ERABLES));
  });
});

describe('Interpolator', () => {
  /** Coureur à 10 m/s, un message toutes les 250 ms, horloge de l'émetteur décalée d'une heure, réseau à 40–120 ms. */
  function feed(it: Interpolator, untilMs: number, jitter = (i: number) => 40 + ((i * 37) % 80)) {
    const skew = 3_600_000;
    for (let i = 0, t = 0; t <= untilMs; i++, t += 250) {
      it.push(t + jitter(i), { t: t + skew, d: t / 100, speedMs: 10, cadenceRpm: 90 });
    }
  }

  it('affiche la course régulière malgré la gigue, avec le retard prévu', () => {
    const it = new Interpolator();
    feed(it, 5000);
    // Écart d'horloge estimé = le message le plus rapide (40 ms) : instant affiché = maintenant − 40 − retard.
    for (const now of [3000, 3333, 3901, 4500]) {
      const r = it.at(now)!;
      expect(r.d).toBeCloseTo((now - 40 - RENDER_DELAY_MS) / 100, 6);
      expect(r.stale).toBe(false);
    }
  });

  it('prolonge la course quand les messages manquent, puis fige le coureur', () => {
    const it = new Interpolator();
    feed(it, 2000, () => 50);
    const lastD = 20;
    const now = 2000 + 50 + RENDER_DELAY_MS + 600;
    expect(it.at(now)!.d).toBeCloseTo(lastD + 6, 6);
    const late = it.at(now + MAX_EXTRAPOLATION_MS)!;
    expect(late.d).toBeCloseTo(lastD + 10, 6);
    expect(late.stale).toBe(true);
  });

  it('ignore les doublons et les messages en retard sur le dernier reçu', () => {
    const it = new Interpolator();
    it.push(100, { t: 0, d: 0, speedMs: 10, cadenceRpm: 90 });
    it.push(350, { t: 250, d: 2.5, speedMs: 10, cadenceRpm: 90 });
    it.push(400, { t: 100, d: 999, speedMs: 10, cadenceRpm: 90 });
    expect(it.at(100 + RENDER_DELAY_MS + 125)!.d).toBeCloseTo(1.25, 6);
  });

  it('repart de zéro après une remise à zéro', () => {
    const it = new Interpolator();
    feed(it, 1000);
    it.reset();
    expect(it.at(1200)).toBeUndefined();
    it.push(1300, { t: 3_601_250, d: 3, speedMs: 0, cadenceRpm: 0 });
    expect(it.at(1400)!.d).toBe(3);
  });
});
