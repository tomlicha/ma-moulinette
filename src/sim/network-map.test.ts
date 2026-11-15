import { describe, expect, it } from 'vitest';
import { COL_DES_ERABLES } from './courses/col-des-erables';
import { renderCourseProfile, renderCourseSparkline, renderNetworkMap } from './network-map';

describe('renderNetworkMap', () => {
  const { svg, width, height } = renderNetworkMap(COL_DES_ERABLES);

  it('produit un SVG complet aux dimensions annoncées', () => {
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
    expect(width).toBeGreaterThan(1000);
    expect(height).toBeGreaterThan(1000);
  });

  it('ne contient aucune valeur numérique invalide', () => {
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('nomme le monde, les parcours, les routes et les carrefours', () => {
    for (const name of [
      COL_DES_ERABLES.name,
      ...COL_DES_ERABLES.courses.map((c) => c.name),
      ...[...COL_DES_ERABLES.edges.values()].map((e) => e.name),
      ...[...COL_DES_ERABLES.nodes.values()].map((n) => n.name),
    ]) {
      expect(svg).toContain(name);
    }
  });

  it("donne la longueur, la montée et la pente maximale de chaque parcours", () => {
    expect(svg).toMatch(/16,0 km · \+3[67]0 m de montée · pente max 9,8 %/);
    expect(svg).toMatch(/9,2 km · \+\d+ m de montée · pente max 1,\d %/);
  });

  it('échappe le texte : une apostrophe ou une esperluette ne casse pas le document', () => {
    expect(svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });
});

describe('renderNetworkMap : variantes pour l\u2019écran', () => {
  it('la carte seule n\u2019a pas la colonne de droite de la planche', () => {
    const plan = renderNetworkMap(COL_DES_ERABLES, { layout: 'plan', labels: 'nodes' });
    expect(plan.width).toBe(820);
    expect(plan.svg).not.toContain('Profil');
    expect(plan.svg).not.toContain('npm run map');
    expect(renderNetworkMap(COL_DES_ERABLES).width).toBe(1400);
  });

  it('une miniature n\u2019écrit aucun texte et reste légère', () => {
    const thumb = renderNetworkMap(COL_DES_ERABLES, { layout: 'plan', labels: 'none', stepM: 60, selected: 'rive' });
    expect(thumb.svg).not.toMatch(/<text /);
    expect(thumb.svg.length).toBeLessThan(25_000);
  });

  it('met le parcours choisi en avant : l\u2019autre est en retrait, ses flèches et ses kilomètres disparaissent', () => {
    const all = renderNetworkMap(COL_DES_ERABLES, { layout: 'plan', labels: 'nodes' }).svg;
    const rive = renderNetworkMap(COL_DES_ERABLES, { layout: 'plan', labels: 'nodes', selected: 'rive' }).svg;
    expect(all).not.toContain('opacity=".3"');
    expect(rive).toContain('opacity=".3"'); // les routes propres au Col
    // Les kilomètres 10, 12 et 14 n'existent que sur le Col (16 km) ; la Rive du lac s'arrête à 9,2 km.
    expect(rive).not.toMatch(/>(10|12|14)<\/text>/);
    expect(all).toMatch(/>(10|12|14)<\/text>/);
  });

  it('grossit les textes avec fontScale', () => {
    const size = (svg: string) => Number(/font-size="([\d.]+)"[^>]*>Village</.exec(svg)![1]);
    const a = size(renderNetworkMap(COL_DES_ERABLES, { layout: 'plan', labels: 'nodes' }).svg);
    const b = size(renderNetworkMap(COL_DES_ERABLES, { layout: 'plan', labels: 'nodes', fontScale: 2 }).svg);
    expect(b).toBeCloseTo(a * 2, 1);
  });

  it('les noms des routes ne s\u2019écrivent qu\u2019au niveau « all »', () => {
    expect(renderNetworkMap(COL_DES_ERABLES, { layout: 'plan', labels: 'nodes' }).svg).not.toContain('La Descente');
    expect(renderNetworkMap(COL_DES_ERABLES, { layout: 'plan', labels: 'all' }).svg).toContain('La Descente');
  });
});

describe('renderCourseProfile', () => {
  it('décrit le parcours demandé, avec ses routes', () => {
    const { svg } = renderCourseProfile(COL_DES_ERABLES, 'rive');
    expect(svg).toContain('9,2 km');
    expect(svg).toContain('Les Prés');
    expect(svg).not.toContain('La Descente');
  });

  it('garde la même échelle d\u2019altitude pour tous les parcours', () => {
    const axis = (id: string) => [...renderCourseProfile(COL_DES_ERABLES, id).svg.matchAll(/>(\d+) m</g)].map((m) => m[1]);
    expect(axis('rive')).toEqual(axis('col'));
  });

  it('retombe sur le premier parcours si l\u2019identifiant est inconnu', () => {
    expect(renderCourseProfile(COL_DES_ERABLES, 'inconnu').svg).toContain('16,0 km');
  });
});

describe('renderNetworkMap : les arches', () => {
  const arches = (labels: 'none' | 'nodes' | 'all') =>
    (renderNetworkMap(COL_DES_ERABLES, { layout: 'plan', labels }).svg.match(/stroke-linecap="round"\/>/g) ?? []).length;

  it('ne sont tracées qu’au niveau « all » : sinon elles font des taches autour des carrefours', () => {
    expect(arches('all')).toBeGreaterThan(arches('nodes'));
  });
});

describe('renderCourseSparkline', () => {
  it('ne contient aucun texte et reste minuscule', () => {
    const { svg } = renderCourseSparkline(COL_DES_ERABLES, 'col');
    expect(svg).not.toMatch(/<text/);
    expect(svg.length).toBeLessThan(6_000);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('garde l\u2019échelle commune : le plat reste bas, la montagne monte haut', () => {
    const top = (id: string) => Math.min(...[...renderCourseSparkline(COL_DES_ERABLES, id).svg.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2])));
    expect(top('col')).toBeLessThan(10); // le sommet frôle le haut du cadre
    expect(top('rive')).toBeGreaterThan(40); // le plat reste près du bas (cadre de 52)
  });
});
