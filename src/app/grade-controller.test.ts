import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER } from '../domain/sim/physics';
import { trainerModelFor } from '../domain/sim/virtual-gears';
import { GradeController, type GradeUpdate } from './grade-controller';

const base: GradeUpdate = {
  nowMs: 0,
  courseGradePct: 4,
  speedMs: 6,
  cadenceRpm: 85,
  rider: DEFAULT_RIDER,
  gearing: { enabled: false, virtualRatio: 2.4, realRatio: 2.43 },
  trainerAppliesGears: false,
  canSimulate: true,
};
const at = (nowMs: number, over: Partial<GradeUpdate> = {}): GradeUpdate => ({ ...base, nowMs, ...over });

describe('GradeController', () => {
  it('envoie la pente du parcours au premier pas, avec la masse du coureur', () => {
    const g = new GradeController();
    expect(g.update(at(0))).toEqual({ gradePct: 4, massKg: DEFAULT_RIDER.massKg });
  });

  it('n\'envoie pas tant que la pente change peu ou que c\'est trop tôt', () => {
    const g = new GradeController();
    g.update(at(0));
    expect(g.update(at(500, { courseGradePct: 6 }))).toBeUndefined(); // trop tôt
    expect(g.update(at(1500, { courseGradePct: 4.2 }))).toBeUndefined(); // changement < 0,5 %
  });

  it('renvoie quand la pente a changé assez et que le délai est passé', () => {
    const g = new GradeController();
    g.update(at(0));
    expect(g.update(at(3000, { courseGradePct: 5 }))?.gradePct).toBeCloseTo(5.0, 1);
  });

  it('lisse la pente : elle ne saute pas de plus de 1,5 %/s', () => {
    const g = new GradeController();
    g.update(at(0, { courseGradePct: 8 }));
    const next = g.update(at(1000, { courseGradePct: 0 }));
    expect(next?.gradePct).toBeCloseTo(6.5, 2);
  });

  it('lisse la pente même quand rien n\'est envoyé (pas de saut au pas suivant)', () => {
    const g = new GradeController();
    g.update(at(0, { courseGradePct: 8 }));
    g.update(at(500, { courseGradePct: 0 })); // trop tôt pour envoyer, mais le lissage avance : 8 → 7,25
    const next = g.update(at(1000, { courseGradePct: 0 }));
    expect(next?.gradePct).toBeCloseTo(6.5, 2);
  });

  it('ne propose rien si le trainer ne simule pas', () => {
    expect(new GradeController().update(at(0, { canSimulate: false }))).toBeUndefined();
  });

  it('ne propose rien tant que l\'ERG est engagé, et renvoie la pente dès qu\'il est relâché', () => {
    const g = new GradeController();
    g.update(at(0));
    g.setErgActive(true);
    expect(g.ergActive).toBe(true);
    expect(g.update(at(5000))).toBeUndefined();
    g.setErgActive(false);
    expect(g.ergActive).toBe(false);
    expect(g.update(at(5100))).toBeDefined();
  });

  it('avec le Cog et un trainer qui applique les vitesses : pente réelle et braquet virtuel', () => {
    const g = new GradeController();
    const cmd = g.update(at(0, { gearing: { enabled: true, virtualRatio: 3.2, realRatio: 2.43 }, trainerAppliesGears: true }));
    expect(cmd).toEqual({ gradePct: 4, massKg: DEFAULT_RIDER.massKg, gearRatio: 3.2 });
  });

  it('avec le Cog sans protocole Zwift : pente corrigée et coefficients du modèle, sans braquet', () => {
    const g = new GradeController();
    const cmd = g.update(at(0, { gearing: { enabled: true, virtualRatio: 3.2, realRatio: 2.43 } }));
    const model = trainerModelFor(DEFAULT_RIDER);
    expect(cmd).toMatchObject({ massKg: DEFAULT_RIDER.massKg, crr: model.crr, cw: model.cw });
    expect(cmd?.gearRatio).toBeUndefined();
    expect(cmd?.gradePct).not.toBe(4); // un braquet plus grand que le réel demande plus d'effort : la pente est corrigée
    expect(cmd!.gradePct).toBeGreaterThan(4);
  });

  it('avec le Cog, la pente part à 0,2 % près et toutes les 500 ms', () => {
    const g = new GradeController();
    g.setVirtualGears(true);
    g.update(at(0));
    expect(g.update(at(500, { courseGradePct: 4.3 }))?.gradePct).toBeCloseTo(4.3, 1);
  });

  it('retry et reset font repartir un envoi tout de suite', () => {
    const g = new GradeController();
    g.update(at(0));
    expect(g.update(at(10))).toBeUndefined();
    g.retry();
    expect(g.update(at(20))).toBeDefined();
    g.reset();
    expect(g.update(at(30))).toBeDefined();
  });
});
