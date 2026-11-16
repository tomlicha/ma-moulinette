/**
 * Robots de test pour la salle temps réel : N coureurs simulés qui roulent sur le Col des Érables, chacun avec sa
 * puissance, et qui choisissent parfois une autre route aux carrefours. Servent à voir du monde en développement et à
 * mesurer la charge (PoC 3). Exigent la connexion de développement (`DEV_LOGIN=1` dans `.dev.vars`).
 *
 *   npm run bots -- --count 5                         5 robots sur http://localhost:8787 (wrangler dev)
 *   npm run bots -- --count 1 --watch                 un robot, et la liste de ce qu'il voit toutes les 2 s
 *   npm run bots -- --url wss://…/api/world/ws        autre serveur
 */
import { parseArgs } from 'node:util';
import { WorldClient, WORLD_PATH } from '../../src/net/world-client.ts';
import { COL_DES_ERABLES } from '../../src/sim/courses/col-des-erables.ts';
import { Journey } from '../../src/sim/journey.ts';
import { DEFAULT_RIDER } from '../../src/sim/physics.ts';
import { Ride } from '../../src/sim/ride.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: `ws://localhost:8787${WORLD_PATH}` },
    count: { type: 'string', default: '3' },
    /** Écart entre deux robots au départ, en m. */
    gap: { type: 'string', default: '25' },
    watch: { type: 'boolean', default: false },
  },
});

const count = Math.max(1, Number(values.count) || 1);
const STEP_MS = 50;
const t0 = performance.now();

for (let i = 0; i < count; i++) {
  const name = `Robot ${i + 1}`;
  const journey = new Journey(COL_DES_ERABLES, COL_DES_ERABLES.courses[i % COL_DES_ERABLES.courses.length]?.id);
  const ride = new Ride(journey, { ...DEFAULT_RIDER, massKg: 65 + ((i * 7) % 25) });
  const basePower = 150 + ((i * 37) % 130);
  // Les robots partent en file : on les fait rouler hors temps jusqu'à leur place.
  for (let k = 0; k < 10_000 && ride.snapshot().distanceM < i * Number(values.gap); k++) ride.advance(STEP_MS / 1000, 250);

  const client = new WorldClient(COL_DES_ERABLES, {
    url: `${values.url}${values.url.includes('?') ? '&' : '?'}dev=${encodeURIComponent(name)}`,
    createSocket: (u) => new WebSocket(u) as never,
  });
  client.onStatus = (s) => console.log(`${name} : ${s}`);
  client.onRoster = (e, who) => i === 0 && console.log(`${who} ${e === 'join' ? 'arrive' : 'part'}`);
  client.connect();

  let junction: string | undefined;
  setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const power = Math.max(0, basePower * (1 + 0.15 * Math.sin(t / 20 + i)) + 10 * Math.sin(t * 1.7 + i * 3));
    const s = ride.advance(STEP_MS / 1000, power);
    // Un carrefour sur trois : une autre route que celle du parcours, au hasard.
    const p = journey.pendingJunction(s.distanceM);
    if (p && p.nodeId !== junction) {
      junction = p.nodeId;
      if (Math.random() < 1 / 3) journey.choose(Math.floor(Math.random() * p.options.length));
    }
    client.update({
      pos: journey.locate(s.distanceM),
      speedMs: s.speedKmh / 3.6,
      powerW: Math.round(power),
      cadenceRpm: 85 + Math.round(5 * Math.sin(t + i)),
      riding: true,
    });
  }, STEP_MS);

  if (values.watch && i === 0) {
    setInterval(() => {
      const seen = client.riders();
      const me = journey.pointAt(ride.snapshot().distanceM);
      console.log(
        `${name} voit ${seen.length} coureur(s) (salle : ${client.population}) : ` +
          seen
            .map((r) => `${r.name} à ${Math.round(Math.hypot(r.point.x - me.x, r.point.z - me.z))} m, ${(r.speedMs * 3.6).toFixed(1)} km/h`)
            .join(' ; '),
      );
    }, 2000);
  }
}
