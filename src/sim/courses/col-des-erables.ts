import { RoadNetwork, type NetworkDef } from '../network';

/**
 * Le monde des Érables : ≈ 28,8 km de routes, six carrefours, pentes jusqu'à 10 %. x vers l'est, z vers le sud (en m).
 * Deux parcours s'y croisent : le **Col des Érables** (montagne, 16 km, 372 m de sommet) et la **Rive du lac** (plat,
 * 9,6 km). Ils partagent La Vallée et passent tous deux par le Village et le Moulin, où l'on peut changer de parcours.
 *
 *   Village ── La Vallée ── Moulin ── Le Col (épingles) ── Sommet
 *      │  ╲                   │ ╲                              │
 *      │   Le Mur ──────── Belvédère ── Les Collines ── Lac ──┘ La Descente
 *      │                      Les Prés
 *      └────── Route du Lac ─────┐        │
 *      └──────── Le Canal ── La Rive ─────┘
 *
 * Le contrôle de cohérence (`validateNetwork`) exige : pente ≤ 10 %, aucun cul-de-sac, routes éloignées d'au moins
 * 60 m quand elles ne se touchent pas, au moins 35° entre deux routes d'un carrefour.
 */
export const COL_DES_ERABLES_DEF: NetworkDef = {
  name: 'Les Érables',
  start: { edge: 'vallee', forward: true },
  courses: [
    {
      id: 'col',
      name: 'Col des Érables',
      description: 'Automne · la montée du col sous les érables roux, puis la descente vers le lac.',
      guide: ['vallee', 'col', 'descente', 'route-du-lac'],
    },
    {
      id: 'rive',
      name: 'Rive du lac',
      description: 'Un parcours régulier le long de l’eau, fait pour tenir une puissance.',
      ambiance: 'sunset',
      guide: ['vallee', 'pres', 'canal'],
    },
  ],
  landmarks: [
    { kind: 'arch', edge: 'vallee', s: 12, text: 'LES ÉRABLES' },
    { kind: 'arch', edge: 'pres', s: 8, text: 'RIVE DU LAC · À PLAT' },
    { kind: 'fence', edge: 'canal', from: 300, to: 1500 },
    { kind: 'arch', edge: 'col', s: 8, text: 'LE COL · 6,4 km à 5,6 %' },
    { kind: 'arch', edge: 'col', s: 6360, text: 'SOMMET · 372 m' },
    { kind: 'arch', edge: 'mur', s: 8, text: 'LE MUR · 2,0 km · jusqu’à 10 %' },
    { kind: 'arch', edge: 'collines-est', s: 8, text: 'LES COLLINES' },
    { kind: 'fence', edge: 'vallee', from: 150, to: 1100 },
    { kind: 'fence', edge: 'descente', from: 300, to: 1500 },
    // Les érables roux qui donnent son nom au col : du pied de la montée à la limite des arbres.
    { kind: 'grove', edge: 'col', from: 120, to: 3700, species: 'maple' },
    // Marie répare son vélo dans la première rampe du Col, loin des clôtures.
    { kind: 'marie', edge: 'col', s: 900 },
  ],
  water: [
    {
      // Le grand lac, dans la boucle de la Rive du lac : Les Prés longent sa rive est, Le Canal sa rive ouest. Son contour
      // suit ces deux routes à 25 à 50 m (d'autant plus loin qu'elles le dominent), calculé d'après leur tracé.
      id: 'lac-de-la-rive',
      name: 'Lac de la Rive',
      level: 2.5,
      shore: [
        [1169, 2848], [1105, 2722], [1041, 2597], [977, 2471], [912, 2346], [848, 2220], [783, 2095], [718, 1970],
        [650, 1845], [581, 1722], [513, 1599], [780, 1500], [1150, 1440], [1500, 1500], [1772, 1602], [1747, 1735],
        [1713, 1864], [1665, 1989], [1608, 2111], [1545, 2233], [1479, 2354], [1414, 2478], [1353, 2601], [1292, 2725],
        [1231, 2849],
      ],
    },
    {
      // Le lac d'altitude au carrefour du Lac, sur un replat à l'ouest : on le découvre en bas de La Descente.
      id: 'lac-des-erables',
      name: 'Lac des Érables',
      level: 97,
      shore: [
        [-540, -2905], [-548, -2786], [-660, -2738], [-790, -2732], [-840, -2850], [-869, -2970], [-778, -3057],
        [-663, -3058], [-552, -3021],
      ],
    },
    // Le canal : trois biefs de 12 m de large à droite de la route du Canal, à 20 m de son axe, du bout du lac au
    // village. Chacun est plus bas que le précédent, comme entre deux écluses, et reste 1 m sous la chaussée.
    {
      id: 'canal-haut',
      name: 'Canal',
      kind: 'canal',
      level: 0.9,
      shore: [
        [464, 1512], [433, 1447], [404, 1380], [376, 1313], [351, 1244], [327, 1176], [305, 1106], [316, 1103],
        [338, 1172], [362, 1240], [387, 1308], [415, 1375], [444, 1442], [475, 1507],
      ],
    },
    {
      id: 'canal-milieu',
      name: 'Canal',
      kind: 'canal',
      level: -0.45,
      shore: [
        [294, 1073], [275, 1005], [255, 937], [237, 869], [219, 801], [202, 732], [184, 663], [196, 661],
        [213, 729], [231, 798], [248, 866], [267, 934], [286, 1002], [306, 1069],
      ],
    },
    {
      id: 'canal-bas',
      name: 'Canal',
      kind: 'canal',
      level: -1.1,
      shore: [
        [176, 629], [159, 561], [143, 492], [126, 423], [110, 354], [93, 285], [76, 216], [88, 213],
        [105, 282], [121, 351], [138, 420], [155, 489], [171, 558], [188, 627],
      ],
    },
  ],
  nodes: [
    { id: 'village', name: 'Village', x: 0, z: 0, altitude: 0, place: 'village' },
    { id: 'moulin', name: 'Le Moulin', x: 2400, z: -300, altitude: 15, place: 'mill' },
    { id: 'sommet', name: 'Sommet du col', x: 3200, z: -4400, altitude: 372, place: 'summit' },
    { id: 'lac', name: 'Le Lac', x: -500, z: -2800, altitude: 100, place: 'tarn' },
    { id: 'belvedere', name: 'Belvédère', x: 1300, z: -1400, altitude: 110, place: 'viewpoint' },
    { id: 'rive', name: 'La Rive', x: 1200, z: 3000, altitude: 8, place: 'harbour' },
  ],
  edges: [
    {
      id: 'vallee',
      name: 'La Vallée',
      from: 'village',
      to: 'moulin',
      plan: [[500, 60], [1100, -60], [1700, -300], [2150, -280]],
      profile: [[0.3, 5], [0.6, 10], [0.85, 12]],
    },
    {
      id: 'col',
      name: 'Le Col',
      from: 'moulin',
      to: 'sommet',
      // Épingles : on monte en zigzag entre x ≈ 2300 et x ≈ 3100.
      // Pente homogène : elle croît régulièrement de 4,7 % à 6,6 %, sans replat ni rampe (un trainer rend chaque
      // creux comme un soulagement brutal). Altitudes d'une parabole, au dixième pour ne pas osciller.
      plan: [
        [2470, -570], [2900, -900], [2300, -1250], [2900, -1650], [2350, -2000],
        [3000, -2450], [2500, -2850], [3100, -3200],
      ],
      profile: [[0.05, 29.2], [0.10, 44.6], [0.15, 60.3], [0.20, 76.3], [0.25, 92.6], [0.30, 109.2], [0.35, 126.1], [0.40, 143.3], [0.45, 160.8], [0.50, 178.6], [0.55, 196.7], [0.60, 215.2], [0.65, 233.9], [0.70, 252.9], [0.75, 272.2], [0.80, 291.8], [0.85, 311.7], [0.90, 332.0], [0.95, 352.5]],
    },
    {
      id: 'descente',
      name: 'La Descente',
      from: 'sommet',
      to: 'lac',
      plan: [[2800, -4300], [2300, -3900], [1700, -3850], [1100, -3500], [500, -3400], [0, -3100]],
      profile: [[0.15, 350], [0.4, 270], [0.65, 190], [0.85, 125]],
    },
    {
      id: 'route-du-lac',
      name: 'Route du Lac',
      from: 'lac',
      to: 'village',
      plan: [[-440, -2550], [-700, -2000], [-600, -1400], [-300, -800], [-150, -350]],
      profile: [[0.3, 80], [0.6, 45], [0.85, 15]],
    },
    {
      id: 'collines-est',
      name: 'Les Collines',
      from: 'moulin',
      to: 'belvedere',
      plan: [[2250, -440], [1950, -560], [1800, -900], [1500, -1050], [1380, -1250]],
      profile: [[0.3, 40], [0.65, 75], [0.85, 95]],
    },
    {
      id: 'collines-ouest',
      name: 'Les Collines',
      from: 'belvedere',
      to: 'lac',
      plan: [[1050, -1550], [700, -1600], [300, -2000], [0, -2200], [-250, -2650]],
      profile: [[0.35, 135], [0.7, 90]],
    },
    {
      id: 'pres',
      name: 'Les Prés',
      from: 'moulin',
      to: 'rive',
      plan: [[2330, -100], [2150, 500], [1900, 1200], [1750, 1900], [1450, 2500]],
      profile: [[0.3, 12], [0.6, 10]],
    },
    {
      id: 'canal',
      name: 'Le Canal',
      from: 'rive',
      to: 'village',
      plan: [[1000, 2600], [700, 2000], [350, 1300]],
      profile: [[0.5, 4]],
    },
    {
      id: 'mur',
      name: 'Le Mur',
      from: 'village',
      to: 'belvedere',
      plan: [[230, -260], [500, -520], [650, -950], [1000, -1100], [1200, -1300]],
      profile: [[0.15, 6], [0.3, 14], [0.5, 47], [0.7, 78], [0.85, 97]],
    },
  ],
};

export const COL_DES_ERABLES = new RoadNetwork(COL_DES_ERABLES_DEF);
