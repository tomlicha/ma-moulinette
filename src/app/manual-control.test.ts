import { describe, expect, it, vi } from 'vitest';
import { ManualControl } from './manual-control';

function setup(over: { ergActive?: boolean; rideActive?: boolean; workoutRunning?: boolean } = {}) {
  const trainer = {
    ergActive: over.ergActive ?? false,
    setErgActive: vi.fn((on: boolean) => void (trainer.ergActive = on)),
    sendGradeAfterErg: vi.fn(async () => true),
    engageErg: vi.fn(async () => true),
    retargetErg: vi.fn(async () => true),
    setManualGrade: vi.fn(async () => true),
  };
  const rideSession = { active: over.rideActive ?? false };
  const workoutSession = { running: over.workoutRunning ?? false, optOutErg: vi.fn(), reengageErg: vi.fn() };
  const log = vi.fn();
  const control = new ManualControl({ trainer, rideSession, workoutSession, log });
  return { control, trainer, workoutSession, rideSession, log };
}

describe('ManualControl', () => {
  describe('bouton ERG', () => {
    it('engage l\'ERG à la cible demandée', async () => {
      const { control, trainer } = setup();
      await control.toggleErg(180, 2);
      expect(trainer.engageErg).toHaveBeenCalledWith(180);
      expect(trainer.setErgActive).not.toHaveBeenCalled();
    });

    it('relâché hors sortie : envoie une pente pour que le trainer quitte l\'ERG', async () => {
      const { control, trainer, log } = setup({ ergActive: true });
      await control.toggleErg(180, 3);
      expect(trainer.setErgActive).toHaveBeenCalledWith(false);
      expect(trainer.sendGradeAfterErg).toHaveBeenCalledWith('ERG désengagé', 3);
      expect(log).not.toHaveBeenCalled();
    });

    it('relâché pendant une sortie : la pente du parcours reprend, rien à envoyer', async () => {
      const { control, trainer, log } = setup({ ergActive: true, rideActive: true });
      await control.toggleErg(180, 3);
      expect(trainer.setErgActive).toHaveBeenCalledWith(false);
      expect(trainer.sendGradeAfterErg).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('ERG désengagé : pente du parcours reprise');
    });

    it('relâché pendant une séance : la séance continue sans consigne', async () => {
      const { control, workoutSession } = setup({ ergActive: true, workoutRunning: true, rideActive: true });
      await control.toggleErg(180, 3);
      expect(workoutSession.optOutErg).toHaveBeenCalledTimes(1);
    });

    it('réengagé pendant une séance : la séance reprend la main, sans consigne manuelle', async () => {
      const { control, trainer, workoutSession } = setup({ ergActive: false, workoutRunning: true });
      await control.toggleErg(180, 3);
      expect(workoutSession.reengageErg).toHaveBeenCalledTimes(1);
      expect(trainer.engageErg).not.toHaveBeenCalled();
    });
  });

  describe('cible de l\'ERG', () => {
    it('s\'applique aussitôt quand l\'ERG est engagé', () => {
      const { control, trainer } = setup({ ergActive: true });
      control.retargetErg(220);
      expect(trainer.retargetErg).toHaveBeenCalledWith(220);
    });

    it('ne fait rien si l\'ERG n\'est pas engagé', () => {
      const { control, trainer } = setup({ ergActive: false });
      control.retargetErg(220);
      expect(trainer.retargetErg).not.toHaveBeenCalled();
    });

    it('ne fait rien pendant une séance : c\'est elle qui fixe la consigne', () => {
      const { control, trainer } = setup({ ergActive: true, workoutRunning: true });
      control.retargetErg(220);
      expect(trainer.retargetErg).not.toHaveBeenCalled();
    });
  });

  it('une pente imposée est envoyée', async () => {
    const { control, trainer } = setup();
    await control.setGrade(4);
    expect(trainer.setManualGrade).toHaveBeenCalledWith(4);
  });
});
