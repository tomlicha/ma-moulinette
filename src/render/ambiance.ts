import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { PALETTE } from './palette';

/**
 * L'ambiance d'un parcours : où est le soleil, de quelle couleur sont sa lumière, le ciel, la brume et les nuages.
 * Le monde est le même ; seule la lumière change, et elle peut changer pendant que la vue tourne (le choix du parcours
 * sur l'accueil).
 */
export interface Ambiance {
  /** Direction du soleil vue du sol, normalisée. */
  sunDirection: THREE.Vector3;
  sunColor: number;
  sunIntensity: number;
  /** Lumière du ciel (d'en haut) et du sol (d'en bas). */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** Ciel au zénith et à l'horizon ; la brume prend la couleur de l'horizon. */
  zenith: THREE.Color;
  horizon: THREE.Color;
  /** Lueur autour du soleil : sa couleur, sa part large et sa part serrée. */
  glow: THREE.Color;
  haloWide: number;
  haloTight: number;
  cloudTop: THREE.Color;
  cloudUnder: THREE.Color;
  /** Densité de la brume : 0,00013 donne 7 % à 2 km, un quart à 4 km, les deux tiers à 8 km. */
  fogDensity: number;
  /** Étoiles et Voie lactée dans le ciel, de 0 (jour) à 1 (nuit noire). */
  stars: number;
  /**
   * Lumière propre de la Route arc-en-ciel, de 0 (de jour : des bandes pastel, translucides, comme un vrai arc-en-ciel)
   * à 1 (de nuit : elle brille).
   */
  skyRoadGlow: number;
}

/** Plein jour d'automne : le soleil à 47°, un ciel bleu franc. */
export const DAY: Ambiance = {
  sunDirection: new THREE.Vector3(0.55, 0.78, 0.35).normalize(),
  sunColor: 0xfff1dc,
  sunIntensity: 2.7,
  hemiSky: 0xcfe2ff,
  hemiGround: 0x9fc27a,
  hemiIntensity: 2.0,
  zenith: PALETTE.sky,
  horizon: PALETTE.horizon,
  glow: PALETTE.sunGlow,
  haloWide: 0.16,
  haloTight: 0.4,
  cloudTop: PALETTE.cloudTop,
  cloudUnder: PALETTE.cloudUnder,
  fogDensity: 0.00013,
  stars: 0,
  skyRoadGlow: 0,
};

/** Coucher de soleil, d'après la maquette « Rive du lac » : soleil bas à l'ouest, ciel pêche et lilas, nuages roses. */
export const SUNSET: Ambiance = {
  sunDirection: new THREE.Vector3(-0.8, 0.27, 0.42).normalize(),
  sunColor: 0xffc08a,
  sunIntensity: 3.1,
  hemiSky: 0xe6d2dc,
  hemiGround: 0xa89472,
  hemiIntensity: 2.0,
  zenith: new THREE.Color(0x9f93d6),
  horizon: new THREE.Color(0xf5d9c2),
  glow: new THREE.Color(0xfff0c4),
  haloWide: 0.42,
  haloTight: 0.6,
  cloudTop: new THREE.Color(0xffd6c4),
  cloudUnder: new THREE.Color(0xc795ad),
  fogDensity: 0.00016,
  stars: 0,
  skyRoadGlow: 0.25,
};

/**
 * Nuit étoilée, pour la Route arc-en-ciel : une lune basse au sud-est tient lieu de soleil (lumière froide et faible),
 * un ciel bleu nuit, des étoiles et une Voie lactée, des nuages gris-bleu éclairés par la lune. Assez de lumière pour
 * lire le relief et la route au sol ; la route du ciel, elle, brille.
 */
export const NIGHT: Ambiance = {
  sunDirection: new THREE.Vector3(0.45, 0.42, 0.62).normalize(),
  sunColor: 0xb9c8ff,
  sunIntensity: 1.05,
  hemiSky: 0x5a6aa8,
  hemiGround: 0x4b3a6e,
  hemiIntensity: 1.35,
  zenith: new THREE.Color(0x070a1f),
  horizon: new THREE.Color(0x26305e),
  glow: new THREE.Color(0xdfe6ff),
  haloWide: 0.12,
  haloTight: 0.35,
  cloudTop: new THREE.Color(0x6b74a8),
  cloudUnder: new THREE.Color(0x272c55),
  fogDensity: 0.00011,
  stars: 1,
  skyRoadGlow: 1,
};

export type Mood = 'day' | 'sunset' | 'night';

export function ambianceFor(mood: Mood | undefined): Ambiance {
  return mood === 'sunset' ? SUNSET : mood === 'night' ? NIGHT : DAY;
}

/** Les couleurs du ciel que lisent les matières (ciel, nuages, eau) : on les change sans rien reconstruire. */
export function createTones(a: Ambiance) {
  const tones = {
    zenith: uniform(a.zenith.clone()),
    horizon: uniform(a.horizon.clone()),
    glow: uniform(a.glow.clone()),
    cloudTop: uniform(a.cloudTop.clone()),
    cloudUnder: uniform(a.cloudUnder.clone()),
    sunDirection: uniform(a.sunDirection.clone()),
    haloWide: uniform(a.haloWide),
    haloTight: uniform(a.haloTight),
    stars: uniform(a.stars),
    skyRoadGlow: uniform(a.skyRoadGlow),
    apply(next: Ambiance) {
      tones.zenith.value.copy(next.zenith);
      tones.horizon.value.copy(next.horizon);
      tones.glow.value.copy(next.glow);
      tones.cloudTop.value.copy(next.cloudTop);
      tones.cloudUnder.value.copy(next.cloudUnder);
      tones.sunDirection.value.copy(next.sunDirection);
      tones.haloWide.value = next.haloWide;
      tones.haloTight.value = next.haloTight;
      tones.stars.value = next.stars;
      tones.skyRoadGlow.value = next.skyRoadGlow;
    },
  };
  return tones;
}

export type Tones = ReturnType<typeof createTones>;
