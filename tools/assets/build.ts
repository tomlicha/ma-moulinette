/**
 * Génère les modèles 3D du projet dans `src/assets/` (fichiers versionnés ; Vite les publie sous un nom à empreinte).
 * Lancer : `npm run assets`.
 */
import { mkdir } from 'node:fs/promises';
import { buildAvatar } from './avatar.ts';
import { buildBike } from './bike.ts';

const OUT = new URL('../../src/assets/', import.meta.url);
await mkdir(OUT, { recursive: true });

const kb = (n: number) => `${(n / 1024).toFixed(0)} Ko`;

const bike = await buildBike(new URL('bike.glb', OUT).pathname.replace(/^\/(\w:)/, '$1'));
const bikeTris = Object.values(bike.parts).reduce((a, b) => a + b, 0);
console.log(`bike.glb    ${kb(bike.bytes)}  ${bikeTris} triangles`, bike.parts);

const avatar = await buildAvatar(new URL('avatar.glb', OUT).pathname.replace(/^\/(\w:)/, '$1'));
console.log(`avatar.glb  ${kb(avatar.bytes)}  ${avatar.triangles} triangles, buste à ${avatar.torsoAngleDeg.toFixed(1)}°, corps ${avatar.implicit.dense} → ${avatar.implicit.simplified} triangles`);
