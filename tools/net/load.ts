/**
 * Mesure de charge de la salle (ENF-08), sans réseau : la vraie `Room` avec N coureurs simulés, comptant les octets
 * envoyés et le temps de calcul d'un tick, avec et sans gestion d'intérêt. Le coût du réseau et du Durable Object
 * s'ajoute à ces chiffres ; ils bornent ce que la logique de la salle coûte.
 *
 *   npm run load                        tailles par défaut
 *   npm run load -- --sizes 100,1000    autres tailles
 *
 * Scénarios : « réparti » (coureurs uniformes sur les 28,8 km du réseau) et « peloton » (tous sur 300 m de route,
 * le pire cas pour un index spatial : tout le monde a des centaines de voisins).
 */
import { parseArgs } from 'node:util';
import { StateCodec } from '../../src/net/protocol.ts';
import { COL_DES_ERABLES } from '../../src/sim/courses/col-des-erables.ts';
import { Room, TICK_MS, type Connection } from '../../src/server/room.ts';

const { values } = parseArgs({ options: { sizes: { type: 'string', default: '50,200,500,1000,2000' } } });
const sizes = values.sizes.split(',').map(Number);
const codec = new StateCodec(COL_DES_ERABLES);
const edges = [...COL_DES_ERABLES.edges.values()];
const TICKS = 20;

class Counter implements Connection {
  bytes = 0;
  send(d: string | ArrayBuffer) {
    if (typeof d !== 'string') this.bytes += d.byteLength;
  }
  close() {}
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

type Scenario = 'réparti' | 'peloton';

function build(n: number, scenario: Scenario, interestK: number) {
  const rnd = seeded(7);
  const room = new Room(COL_DES_ERABLES, () => 1000, { interestK });
  const conns: Counter[] = [];
  const longest = edges.reduce((a, b) => (b.lengthM > a.lengthM ? b : a));
  for (let i = 0; i < n; i++) {
    const conn = new Counter();
    conns.push(conn);
    const slot = room.join({ id: `u${i}`, name: `C${i}` }, conn);
    const edge = scenario === 'peloton' ? longest : edges[Math.floor(rnd() * edges.length)]!;
    const s = scenario === 'peloton' ? 100 + rnd() * 300 : rnd() * edge.lengthM;
    room.receive(slot, codec.encodeState({ pos: { edgeId: edge.id, forward: true, s }, tMs: 1000, speedMs: 8, powerW: 200, cadenceRpm: 90, riding: true }));
  }
  return { room, conns };
}

function measure(n: number, scenario: Scenario, interestK: number) {
  const { room, conns } = build(n, scenario, interestK);
  for (const c of conns) c.bytes = 0;
  const times: number[] = [];
  for (let k = 0; k < TICKS; k++) {
    const t0 = performance.now();
    room.tick();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const perClient = conns.reduce((a, c) => a + c.bytes, 0) / conns.length / TICKS; // octets par tick et par client
  return {
    tickMs: times[Math.floor(times.length / 2)]!,
    tickMaxMs: times[times.length - 1]!,
    kBps: (perClient * 1000) / TICK_MS / 1024,
    serverMBps: (perClient * n * 1000) / TICK_MS / 1024 / 1024,
  };
}

const fmt = (x: number, d = 1) => x.toFixed(d);
console.log(`Salle : tick toutes les ${TICK_MS} ms, médiane de ${TICKS} ticks. Débit en Ko/s par client (descendant) et en Mo/s pour le serveur (sortant).\n`);
console.log('| Scénario | Coureurs | Sans intérêt : tick (ms) | Ko/s client | Mo/s serveur | Avec intérêt (K=32) : tick (ms) | pire tick (ms) | Ko/s client | Mo/s serveur |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const scenario of ['réparti', 'peloton'] as const) {
  for (const n of sizes) {
    const off = measure(n, scenario, Infinity);
    const on = measure(n, scenario, 32);
    console.log(
      `| ${scenario} | ${n} | ${fmt(off.tickMs)} | ${fmt(off.kBps)} | ${fmt(off.serverMBps, 2)} | ${fmt(on.tickMs)} | ${fmt(on.tickMaxMs)} | ${fmt(on.kBps)} | ${fmt(on.serverMBps, 2)} |`,
    );
  }
}
