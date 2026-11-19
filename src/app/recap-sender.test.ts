import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_S, RecapSender, type SendState } from './recap-sender';
import type { StravaOutcome } from './ride-export';

const OK: StravaOutcome = { ok: true, name: 'Ma sortie', activityUrl: 'https://www.strava.com/activities/1' };
const REFUSED: StravaOutcome = { ok: false, message: 'refusé', kept: true, login: false };

function setup(outcome: StravaOutcome | (() => Promise<StravaOutcome>) = OK, name = () => 'Ma sortie') {
  const send = vi.fn(typeof outcome === 'function' ? outcome : async () => outcome);
  const sender = new RecapSender({ send, name });
  const states: SendState[] = [];
  const ticks: number[] = [];
  sender.on('state', (s) => states.push(s));
  sender.on('tick', (n) => ticks.push(n));
  return { sender, send, states, ticks };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('RecapSender : début', () => {
  it('Strava prêt : compte à rebours, la première seconde est annoncée tout de suite', () => {
    const { sender, states, ticks } = setup();
    sender.begin('ready', 'Nom par défaut');
    expect(states).toEqual(['countdown']);
    expect(ticks).toEqual([COUNTDOWN_S]);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([COUNTDOWN_S, COUNTDOWN_S - 1]);
  });

  it('Strava à connecter : on attend un geste, sans compte à rebours', () => {
    const { sender, states, ticks, send } = setup();
    sender.begin('login', 'x');
    expect(states).toEqual(['manual']);
    vi.advanceTimersByTime(60_000);
    expect(ticks).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('pas de relais Strava : rien à envoyer', () => {
    const { sender, states } = setup();
    sender.begin('none', 'x');
    expect(states).toEqual(['none']);
    expect(sender.readiness).toBe('none');
  });

  it('un nouveau récapitulatif remplace le compte à rebours précédent', () => {
    const { sender, ticks } = setup();
    sender.begin('ready', 'x');
    vi.advanceTimersByTime(3000);
    ticks.length = 0;
    sender.begin('ready', 'y');
    expect(ticks).toEqual([COUNTDOWN_S]);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([COUNTDOWN_S, COUNTDOWN_S - 1]); // un seul décompte, pas deux
  });
});

describe('RecapSender : envoi automatique', () => {
  it('part tout seul au bout du compte à rebours, sous le nom saisi à ce moment-là', async () => {
    let name = 'Premier nom';
    const { sender, send, states } = setup(OK, () => name);
    sender.begin('ready', 'Nom par défaut');
    name = '  Nom choisi  ';
    await vi.advanceTimersByTimeAsync(COUNTDOWN_S * 1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('Nom choisi');
    expect(states).toEqual(['countdown', 'sending', 'sent']);
  });

  it('un nom vide donne le nom par défaut', async () => {
    const { sender, send } = setup(OK, () => '   ');
    sender.begin('ready', 'Nom par défaut');
    await sender.send();
    expect(send).toHaveBeenCalledWith('Nom par défaut');
  });

  it('le compte à rebours s’arrête une fois l’envoi parti', async () => {
    const { sender, ticks } = setup();
    sender.begin('ready', 'x');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ticks).toEqual(Array.from({ length: COUNTDOWN_S + 1 }, (_, i) => COUNTDOWN_S - i));
  });
});

describe('RecapSender : suspendre', () => {
  it('hold() arrête le compte à rebours : plus d’envoi automatique', async () => {
    const { sender, send, states } = setup();
    sender.begin('ready', 'x');
    sender.hold();
    expect(states).toEqual(['countdown', 'manual']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).not.toHaveBeenCalled();
  });

  it('hold() hors compte à rebours ne change rien', async () => {
    const { sender, states } = setup();
    sender.begin('login', 'x');
    sender.hold();
    expect(states).toEqual(['manual']);
    await sender.send();
    sender.hold();
    expect(states).toEqual(['manual', 'sending', 'sent']);
  });
});

describe('RecapSender : envoyer', () => {
  it('un geste envoie tout de suite et arrête le compte à rebours', async () => {
    const { sender, send, states } = setup();
    sender.begin('ready', 'x');
    await sender.send();
    expect(states).toEqual(['countdown', 'sending', 'sent']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('l’état « envoyé » porte le résultat', async () => {
    const { sender } = setup();
    const seen: Array<StravaOutcome | undefined> = [];
    sender.on('state', (_s, o) => seen.push(o));
    sender.begin('login', 'x');
    await sender.send();
    expect(seen.at(-1)).toEqual(OK);
  });

  it('pas de double envoi : pendant l’envoi, ni après', async () => {
    let finish!: (o: StravaOutcome) => void;
    const { sender, send } = setup(() => new Promise<StravaOutcome>((r) => (finish = r)));
    sender.begin('login', 'x');
    const first = sender.send();
    void sender.send();
    expect(send).toHaveBeenCalledTimes(1);
    finish(OK);
    await first;
    await sender.send();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('avant tout récapitulatif, rien ne part', async () => {
    const { sender, send } = setup();
    await sender.send();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('RecapSender : refus', () => {
  it('un refus garde la sortie : état « error », on peut réessayer', async () => {
    const outcomes = [REFUSED, OK];
    const { sender, send, states } = setup(async () => outcomes.shift()!);
    sender.begin('ready', 'x');
    await sender.send();
    expect(sender.state).toBe('error');
    await sender.send();
    expect(send).toHaveBeenCalledTimes(2);
    expect(states).toEqual(['countdown', 'sending', 'error', 'sending', 'sent']);
  });

  it('un refus définitif (sortie non gardée) : « none », plus d’envoi possible à proposer', async () => {
    const { sender, states } = setup({ ok: false, message: 'fichier refusé', kept: false, login: false });
    sender.begin('ready', 'x');
    await sender.send();
    expect(states.at(-1)).toBe('none');
  });

  it('accès Strava perdu : la préparation devient « login » avant l’état d’erreur', async () => {
    const { sender } = setup({ ok: false, message: 'expiré', kept: true, login: true });
    let readinessAtError: string | undefined;
    sender.on('state', (s) => {
      if (s === 'error') readinessAtError = sender.readiness;
    });
    sender.begin('ready', 'x');
    await sender.send();
    expect(readinessAtError).toBe('login');
  });
});

describe('RecapSender : fermeture', () => {
  it('release() pendant le compte à rebours envoie tout de suite', async () => {
    const { sender, send } = setup();
    sender.begin('ready', 'x');
    sender.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sender.state).toBe('sent');
  });

  it('release() hors compte à rebours n’envoie rien', async () => {
    const { sender, send } = setup();
    sender.begin('login', 'x');
    sender.release();
    sender.hold();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).not.toHaveBeenCalled();
  });

  it('release() après un « Ne pas envoyer » n’envoie rien non plus', async () => {
    const { sender, send } = setup();
    sender.begin('ready', 'x');
    sender.hold();
    sender.release();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).not.toHaveBeenCalled();
  });
});
