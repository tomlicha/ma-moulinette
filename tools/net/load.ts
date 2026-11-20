/**
 * Mesure de charge de la salle (ENF-08), sans réseau : la vraie `Room` avec N coureurs simulés, comptant les octets
 * envoyés et le temps de calcul d'un tick, avec et sans gestion d'intérêt. Le coût du réseau et du Durable Object
 * s'ajoute à ces chiffres ; ils bornent ce que la logique de la salle coûte.
 *
 *   npm run load                        tailles par défaut
 *   npm run load -- --sizes 100,1000    autres tailles
 *
 * Deuxième tableau : les messages de « rouler avec d'autres » (qui est en ligne, groupes), qui ne passent pas par le tick.
 *
 * Scénarios : « réparti » (coureurs uniformes sur les 28,8 km du réseau) et « peloton » (tous sur 300 m de route,
 * le pire cas pour un index spatial : tout le monde a des centaines de voisins).
 */
import { parseArgs } from 'node:util';
import { StateCodec } from '../../src/infra/net/protocol.ts';
import { COL_DES_ERABLES } from '../../src/domain/course/courses/col-des-erables.ts';
import type { Workout } from '../../src/domain/workout/model.ts';
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

// --- « Rouler avec d'autres » : `who`, créer et rejoindre un groupe, choix de route du créateur ---

class TextCounter implements Connection {
  bytes = 0;
  send(d: string | ArrayBuffer) {
    if (typeof d === 'string') this.bytes += d.length;
  }
  close() {}
}

const workout: Workout = {
  name: 'Sweet spot',
  steps: [
    { kind: 'warmup', durationS: 300, target: { kind: 'ftp', from: 0.5, to: 0.75 } },
    { kind: 'steady', durationS: 1200, target: { kind: 'ftp', from: 0.9, to: 0.9 } },
  ],
  messages: [],
  warnings: [],
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

function measureGroups(n: number) {
  let t = 1000;
  const room = new Room(COL_DES_ERABLES, () => t);
  const slots: number[] = [];
  const conns: TextCounter[] = [];
  for (let i = 0; i < n; i++) {
    const conn = new TextCounter();
    conns.push(conn);
    const slot = room.join({ id: `u${i}`, name: `Coureur ${i}` }, conn);
    slots.push(slot);
    if (i % 2 === 0) {
      const edge = edges[i % edges.length]!;
      room.receive(slot, codec.encodeState({ pos: { edgeId: edge.id, forward: true, s: 50 }, tMs: 1000, speedMs: 8, powerW: 200, cadenceRpm: 90, riding: true }));
    }
  }
  const say = (slot: number, msg: object) => room.receive(slot, JSON.stringify(msg));

  // Des groupes ouverts, pour que la réponse les porte : 10 groupes.
  for (let g = 0; g < 10; g++) say(slots[g]!, { type: 'groupCreate', workout, courseId: 'col', startInS: 600, ftpW: 250, massKg: 75 });

  // `who` : 200 coureurs différents le demandent (un par seconde et par coureur au plus), à vide puis avec une recherche.
  const whoTimes: number[] = [];
  const before = conns.slice(0, 200).reduce((a, c) => a + c.bytes, 0);
  for (let i = 0; i < 200; i++) {
    t += 1000;
    const t0 = performance.now();
    say(slots[i]!, { type: 'who', q: i % 2 ? 'Coureur 1' : '' });
    whoTimes.push(performance.now() - t0);
  }
  const whoBytes = (conns.slice(0, 200).reduce((a, c) => a + c.bytes, 0) - before) / 200;

  // Un groupe de 30 : le créateur choisit des routes, la salle les renvoie aux 30.
  const group = 'g1';
  for (let i = 10; i < 39 && i < n; i++) say(slots[i]!, { type: 'groupJoin', id: group });
  const routeTimes: number[] = [];
  for (let leg = 0; leg < 200; leg++) {
    const t0 = performance.now();
    say(slots[0]!, { type: 'groupRoute', leg, index: leg % 3 });
    routeTimes.push(performance.now() - t0);
  }
  const joinTimes: number[] = [];
  for (let i = 40; i < 60 && i < n; i++) {
    const t0 = performance.now();
    say(slots[i]!, { type: 'groupJoin', id: 'g2' });
    joinTimes.push(performance.now() - t0);
  }
  return { whoMs: median(whoTimes), whoMaxMs: Math.max(...whoTimes), whoBytes, routeMs: median(routeTimes), joinMs: median(joinTimes) };
}

console.log('\nRouler avec d\'autres : coût d\'un message dans la salle (médiane ; `who` : 200 demandes de coureurs différents).\n');
console.log('| Coureurs | `who` (ms) | pire `who` (ms) | réponse `who` (octets) | choix de route à 30 membres (ms) | arrivée dans un groupe (ms) |');
console.log('|---:|---:|---:|---:|---:|---:|');
for (const n of sizes.filter((x) => x >= 60)) {
  const g = measureGroups(n);
  console.log(`| ${n} | ${fmt(g.whoMs, 2)} | ${fmt(g.whoMaxMs, 2)} | ${Math.round(g.whoBytes)} | ${fmt(g.routeMs, 3)} | ${fmt(g.joinMs, 3)} |`);
}
