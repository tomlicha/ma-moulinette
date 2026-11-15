import * as THREE from 'three/webgpu';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';

export type Backend = 'webgpu' | 'webgl2';

export interface RendererHandle {
  renderer: THREE.WebGPURenderer;
  backend: Backend;
}

export function webGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * WebGPU d'abord, repli WebGL2 : détection de capacité, jamais de navigateur.
 * `forceWebGL` sert aux comparaisons et aux appareils exclus.
 */
export async function createRenderer(canvas: HTMLCanvasElement, forceWebGL = false): Promise<RendererHandle> {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: forceWebGL || !webGpuAvailable(),
  });
  await renderer.init();
  renderer.library.addLight(SunLightNode, SunLight); // ombres en cascades
  // Rendu neutre : les couleurs de la palette arrivent à l'écran telles quelles (ACES les assombrit et les ternit).
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  // Filtre PCF simple : la variante douce tire ses échantillons au hasard et donne une ombre granuleuse sans
  // anticrénelage temporel.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}
