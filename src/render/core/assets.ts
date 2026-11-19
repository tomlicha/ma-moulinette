import type * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Importés par leur adresse : Vite les publie sous un nom à empreinte (assets/bike-<hash>.glb), mis en cache sans limite.
import bikeUrl from '../../assets/bike.glb?url';
import avatarUrl from '../../assets/avatar.glb?url';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Modèles partagés par tous les coureurs ; chaque coureur en clone la scène. */
export interface RiderAssets {
  bike: THREE.Group;
  avatar: THREE.Group;
}

async function load(url: string): Promise<THREE.Group> {
  const gltf = await loader.loadAsync(url);
  return gltf.scene as unknown as THREE.Group;
}

let cache: Promise<RiderAssets> | undefined;

export function loadRiderAssets(): Promise<RiderAssets> {
  cache ??= Promise.all([load(bikeUrl), load(avatarUrl)]).then(([bike, avatar]) => ({ bike, avatar }));
  return cache;
}
