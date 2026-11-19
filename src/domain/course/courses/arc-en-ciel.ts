import type { EdgeDef, NodeDef } from '../network';

/**
 * La Route arc-en-ciel : une route de lumière suspendue dans le ciel, au nord du Sommet du col. On y monte par
 * l'ascenseur céleste, au bout de la Jetée qui part du Lac, ou à la force des jambes par l'Envol depuis le Sommet.
 *
 *   Gare céleste ── L'Arche ──▶ Porte des nuages ── La Spirale (2 ¼ tours) ──▶ Le Zénith
 *        ▲ ascenseur                  ▲ L'Envol                                    │ La Crête des vagues
 *   Pied ◀── La Jetée ── Le Lac       Sommet du col ◀── La Grande Plongée ── La Bascule
 *
 * Tracé et pentes mesurés pour la spec (docs/design/route-arc-en-ciel.md) : les routes se croisent à 71 m de hauteur
 * au moins, la pente ne dépasse pas 8,8 %.
 */

/**
 * Profil fait de pentes constantes : `parts` = [[fin du tronçon en m, pente]…], la dernière pente étant ajustée pour
 * finir à l'altitude `b`. D'un tronçon à l'autre, la pente change sur 60 m ; aux bouts, après les 20 m plats de toute
 * route, elle s'installe sur 60 m. Sans ces raccords, l'interpolation du profil fait des bosses : une rampe à 6 %
 * posée telle quelle donnait 9,2 % au départ. `L` est la longueur prévue de la route.
 */
export function gradedProfile(L: number, a: number, b: number, parts: [number, number][]): [number, number][] {
  const slopeOf = (s: number, last: number) => {
    const gs = parts.map((p, i) => (i === parts.length - 1 ? last : p[1]));
    let g = gs[0]!;
    for (let i = 0; i < parts.length - 1; i++) {
      const t = Math.min(1, Math.max(0, (s - parts[i]![0] + 30) / 60));
      if (t > 0) g = gs[i]! + (gs[i + 1]! - gs[i]!) * t;
    }
    const ramp = Math.min(1, Math.max(0, (s - 20) / 60), Math.max(0, (L - 20 - s) / 60));
    return g * ramp;
  };
  const integrate = (last: number) => {
    const alts = [a];
    for (let s = 1; s <= L; s++) alts.push(alts[s - 1]! + slopeOf(s - 0.5, last));
    return alts;
  };
  let lo = -0.2;
  let hi = 0.2;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (integrate(mid)[Math.floor(L)]! < b) lo = mid;
    else hi = mid;
  }
  const alts = integrate(lo);
  const out: [number, number][] = [];
  for (let s = 40; s < L - 40; s += s < 120 || s > L - 160 ? 20 : 80) out.push([+(s / L).toFixed(4), +alts[Math.round(s)]!.toFixed(2)]);
  return out;
}

/** La Spirale : centre, rayon, nombre de tours (sens horaire vu du ciel, du point ouest au point nord). */
const SPIRAL = { x: 3350, z: -5900, r: 230, turns: 2.25 };
const SPIRAL_L = SPIRAL.turns * 2 * Math.PI * SPIRAL.r;
const PORTE: [number, number] = [SPIRAL.x - SPIRAL.r, SPIRAL.z];
const ZENITH: [number, number] = [SPIRAL.x, SPIRAL.z - SPIRAL.r];

function helix(): [number, number][] {
  const n = Math.round(SPIRAL_L / 8);
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.PI + (i / n) * SPIRAL.turns * 2 * Math.PI;
    pts.push([SPIRAL.x + SPIRAL.r * Math.cos(t), SPIRAL.z + SPIRAL.r * Math.sin(t)]);
  }
  pts[0] = PORTE;
  pts[n] = ZENITH;
  return pts;
}

/** L'ascenseur : son pied au nord du lac des Érables, au bout de la Jetée ; sa gare 380 m plus haut. */
export const LIFT_SITE = { x: -650, z: -3200, bottom: 100, top: 480 };

export const ARC_EN_CIEL_NODES: NodeDef[] = [
  { id: 'pied-ascenseur', name: 'Ascenseur céleste', x: LIFT_SITE.x, z: LIFT_SITE.z, altitude: LIFT_SITE.bottom },
  { id: 'gare-celeste', name: 'Gare céleste', x: LIFT_SITE.x, z: LIFT_SITE.z, altitude: LIFT_SITE.top },
  { id: 'porte-nuages', name: 'Porte des nuages', x: PORTE[0], z: PORTE[1], altitude: 455 },
  { id: 'zenith', name: 'Le Zénith', x: ZENITH[0], z: ZENITH[1], altitude: 650 },
  { id: 'bascule', name: 'La Bascule', x: 4100, z: -5180, altitude: 646 },
];

export const ARC_EN_CIEL_EDGES: EdgeDef[] = [
  {
    id: 'jetee',
    name: 'La Jetée',
    from: 'lac',
    to: 'pied-ascenseur',
    // Le long de la rive est du lac des Érables, à plus de 30 m de l'eau.
    plan: [[-470, -2960], [-520, -3110]],
    profile: [],
  },
  {
    id: 'ascenseur',
    name: 'Ascenseur céleste',
    from: 'pied-ascenseur',
    to: 'gare-celeste',
    plan: [],
    profile: [],
    surface: 'lift',
    lift: { lengthM: 20, durationS: 40 },
  },
  {
    id: 'arche',
    name: 'L’Arche',
    from: 'gare-celeste',
    to: 'porte-nuages',
    surface: 'sky',
    // Au-dessus de la vallée en dos d'âne, jusqu'à 552 m ; passe 84 m au-dessus de la Grande Plongée.
    plan: [[-300, -3500], [300, -3900], [1000, -4350], [1700, -4800], [2250, -5250], [2620, -5650], [2850, -5880]],
    profile: gradedProfile(4750, 480, 455, [[0.45 * 4750, 0.035], [4750, 0]]),
  },
  {
    id: 'envol',
    name: 'L’Envol',
    from: 'sommet',
    to: 'porte-nuages',
    surface: 'sky',
    plan: [[3215, -4750], [3170, -5150], [3125, -5550]],
    profile: gradedProfile(1510, 372, 455, [[1510, 0]]),
  },
  {
    id: 'spirale',
    name: 'La Spirale',
    from: 'porte-nuages',
    to: 'zenith',
    surface: 'sky',
    plan: [],
    path: helix(),
    profile: gradedProfile(SPIRAL_L, 455, 650, [[SPIRAL_L, 0]]),
  },
  {
    id: 'crete',
    name: 'La Crête des vagues',
    from: 'zenith',
    to: 'bascule',
    surface: 'sky',
    plan: [[3750, -6190], [4150, -6270], [4550, -6150], [4800, -5800], [4720, -5400], [4400, -5200]],
    // Six vagues de 12 m de creux à crête.
    profile: [[0.1, 658], [0.2, 648], [0.3, 660], [0.4, 649], [0.5, 661], [0.6, 650], [0.7, 662], [0.8, 652], [0.9, 655]],
  },
  {
    id: 'plongee',
    name: 'La Grande Plongée',
    from: 'bascule',
    to: 'sommet',
    surface: 'sky',
    // Passe sous la Crête, puis fait un détour à l'ouest pour croiser l'Arche bien plus bas qu'elle.
    plan: [[4030, -5600], [3930, -6050], [3800, -6450], [3400, -6700], [2800, -6450], [2400, -6050], [2280, -5500], [2420, -4980], [2800, -4700]],
    profile: gradedProfile(5110, 646, 372, [[1300, -0.085], [3300, -0.06], [5110, 0]]),
  },
];

export const ARC_EN_CIEL_COURSE = {
  id: 'arc-en-ciel',
  name: 'Route arc-en-ciel',
  description: 'Nuit · l’ascenseur céleste, puis une route de lumière dans le ciel : la Spirale, la Crête, la Grande Plongée.',
  ambiance: 'night' as const,
  guide: ['jetee', 'ascenseur', 'arche', 'spirale', 'crete', 'plongee', 'descente'],
};
