import * as THREE from 'three/webgpu';

/**
 * Monde « Col des Érables » d'après la planche de style : prairie verte, sapins à étages et feuillus en bulles,
 * rochers et nuages arrondis, clôture en bois, montagnes enneigées à l'horizon, route grise à ligne jaune.
 */
export const PALETTE = {
  sky: new THREE.Color(0x3d8fdc),
  /** Couleur du ciel à l'horizon, et de la brume : le relief lointain s'y fond. */
  horizon: new THREE.Color(0xa9d3ee),
  /** Lueur autour du soleil. */
  sunGlow: new THREE.Color(0xfff1d2),
  grassDark: new THREE.Color(0x58a03e),
  grassLight: new THREE.Color(0x96cc54),
  /** Herbe sèche, par plaques. */
  grassDry: new THREE.Color(0xb9cf5e),
  /** Sol des forêts : il assombrit le terrain sous les arbres, et se voit de loin avant eux. */
  forestFloor: new THREE.Color(0x3d8748),
  /** Roche à nu sur les pentes raides. */
  cliff: new THREE.Color(0x9a9fa0),
  sand: new THREE.Color(0xdcd0a4),
  /** Eau des lacs : claire sur les hauts-fonds, plus sombre au large. */
  waterShallow: new THREE.Color(0x5fc0cf),
  waterDeep: new THREE.Color(0x2f7fc0),
  /** Fond des lacs, là où le terrain affleure sous la surface. */
  lakeBed: new THREE.Color(0x4a9aa6),
  fir: new THREE.Color(0x4fb07e),
  leaf: new THREE.Color(0x78c452),
  /** Érables d'automne : roux, orangé, doré. */
  maple: [new THREE.Color(0xd8502a), new THREE.Color(0xe9872c), new THREE.Color(0xf2b93b)],
  /** Feuilles tombées au pied des érables. */
  leafLitter: new THREE.Color(0xc98f45),
  trunk: new THREE.Color(0x8a5c36),
  rock: new THREE.Color(0xb7bcc4),
  road: new THREE.Color(0x6e7488),
  centerLine: new THREE.Color(0xf2cf3a),
  edgeLine: new THREE.Color(0xf4f4f0),
  wood: new THREE.Color(0xc4965c),
  gantry: new THREE.Color(0x0e1726),
  accent: '#5BE3C9',
  mountainGrass: new THREE.Color(0x77ad55),
  /** Roche des montagnes de l'horizon, bleutée par la distance. */
  mountainRock: new THREE.Color(0x8797a6),
  /** Rocaille des alpages, au-dessus de la limite des arbres. */
  scree: new THREE.Color(0xa7aa8c),
  cloudTop: new THREE.Color(0xffffff),
  cloudUnder: new THREE.Color(0xb7c9e2),
  snow: new THREE.Color(0xf3f6f9),
};
