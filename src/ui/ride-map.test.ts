import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from '../sim/courses/col-des-erables';
import { Journey } from '../sim/journey';
import { mapNetwork, mapSvg, riderColor } from './ride-map';
import { buildScene, junctionScene } from './ride-map-scene';

const j = new Journey(COL_DES_ERABLES);
const net = mapNetwork(COL_DES_ERABLES);
const MOULIN = COL_DES_ERABLES.edges.get('vallee')!.lengthM;
const nearby = {
  ahead: [{ slot: 2, name: 'Nadia', gapM: 140, x: 300, z: 20 }],
  behind: [{ slot: 5, name: 'Paul D.', gapM: -265, x: -400, z: 50 }],
};

describe('mapNetwork', () => {
  it('prend toutes les routes et tous les lacs du réseau', () => {
    expect(net.roads).toHaveLength(COL_DES_ERABLES.edges.size);
    expect(net.water).toHaveLength(COL_DES_ERABLES.water.length);
    expect(net.roads.every((r) => r.length > 5)).toBe(true);
  });
});

describe('mapSvg', () => {
  it('produit un SVG complet à la taille demandée, sans valeur invalide', () => {
    const svg = mapSvg(buildScene(j, 30, nearby), net, 177, 206);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 177 206"');
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });
  it('dessine un point par coureur, du plus proche au plus éloigné', () => {
    const svg = mapSvg(buildScene(j, 30, nearby), net, 177, 206);
    expect(svg).toContain(riderColor(2));
    expect(svg).toContain(riderColor(5));
  });
  it('n’écrit aucun nom de route hors carrefour', () => {
    expect(mapSvg(buildScene(j, 30, nearby), net, 177, 206)).not.toContain('Le Col');
  });
  it('au carrefour, nomme les trois routes avec leur montée, la retenue en accent', () => {
    const p = j.pendingJunction(MOULIN - 210)!;
    const scene = buildScene(j, MOULIN - 210, undefined, junctionScene(j, p));
    const svg = mapSvg(scene, net, 158, 214);
    for (const name of ['Le Col', 'Les Collines', 'Les Prés']) expect(svg).toContain(`>${name}</text>`);
    expect(svg).toContain('>plat</text>');
    expect(svg).toMatch(/fill="#5BE3C9" stroke="#141C28"[^>]*>Le Col</);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });
  it('échappe les noms (ils viennent d’autres joueurs ou des données)', () => {
    const p = j.pendingJunction(MOULIN - 210)!;
    const js = junctionScene(j, p)!;
    js.options[0]!.label = '<b>&x';
    const svg = mapSvg(buildScene(j, MOULIN - 210, undefined, js), net, 158, 214);
    expect(svg).toContain('&lt;b>&amp;x');
    expect(svg).not.toContain('<b>');
  });
  it('montre flèches de sens et boussole sur un cadre large, pas sur un cadre étroit', () => {
    const wide = mapSvg(buildScene(j, 30, nearby), net, 177, 206);
    const narrow = mapSvg(buildScene(j, 30, nearby), net, 158, 198);
    expect(wide).toContain('>N</text>');
    expect(narrow).not.toContain('>N</text>');
    expect(wide).toContain('stroke="#0B1422" stroke-width="1.5"'); // flèches du sens de marche
    expect(narrow).not.toContain('stroke="#0B1422" stroke-width="1.5"');
  });
  it('garde un coureur hors cadre au bord, plus pâle', () => {
    const far = { ahead: [], behind: [{ slot: 7, name: 'Loin', gapM: -900, x: 0, z: 5000 }] };
    const svg = mapSvg(buildScene(j, 30, far), net, 177, 206);
    expect(svg).toContain('fill-opacity="0.7"');
  });
});
