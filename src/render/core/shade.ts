import { float, mix, mx_noise_float, positionWorld, smoothstep, time, vec3 } from 'three/tsl';

/**
 * Ombres de nuages : de grandes taches qui glissent lentement sur le pays. Un facteur entre `CLOUD_SHADE` (à l'ombre) et
 * 1 (au soleil), à multiplier dans la couleur du sol et de la route. Purement décoratif : il ne suit pas les nuages
 * dessinés, mais il fait vivre les grands versants.
 */
const CLOUD_SHADE = 0.8;

export function cloudShade() {
  const p = positionWorld.xz.mul(0.0012);
  const n = mx_noise_float(vec3(p.x.add(time.mul(0.006)), p.y.add(time.mul(0.0035)), 0.5));
  return mix(float(CLOUD_SHADE), float(1), smoothstep(-0.25, 0.15, n));
}

/** Grain de l'asphalte : des plaques larges et un grain fin, quelques pour cent autour de 1. */
export function asphaltGrain() {
  const fine = mx_noise_float(vec3(positionWorld.x.mul(1.3), positionWorld.z.mul(1.3), 0.5));
  const wide = mx_noise_float(vec3(positionWorld.x.mul(0.11), positionWorld.z.mul(0.11), 3.5));
  return float(1).add(fine.mul(0.035)).add(wide.mul(0.05));
}
