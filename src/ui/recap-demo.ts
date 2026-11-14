import type { Recording, Sample } from '../export/recorder';
import type { StravaOutcome, StravaReadiness } from '../export/wiring';
import { targetWatts, type Workout } from '../workout/model';
import { setupRecap } from './recap';
import { summarize } from './recap-model';

/**
 * Aperçu du récapitulatif sans rouler, en développement seulement : `?recap` (séance, Strava connecté),
 * `?recap=libre` (sortie libre), `?recap=connexion` (Strava à connecter), `?recap=echec` (envoi refusé),
 * `?recap=aucun` (pas de relais Strava). L'envoi est simulé : rien ne part chez Strava.
 */
export function showRecapDemo(host: HTMLElement, mode: string, workout: Workout, ftpW: number, place: string) {
  const free = mode === 'libre';
  const rec = demoRecording(free ? undefined : workout, ftpW);
  const strava: StravaReadiness = mode === 'connexion' ? 'login' : mode === 'aucun' ? 'none' : 'ready';
  const dialog = document.createElement('dialog');
  host.append(dialog);
  const name = `Ma Moulinette - ${free ? place : workout.name}`;
  const recap = setupRecap(dialog, {
    send: (n) =>
      new Promise<StravaOutcome>((resolve) =>
        setTimeout(
          () =>
            resolve(
              mode === 'echec'
                ? { ok: false, message: 'échec (relais injoignable : Failed to fetch), la sortie est gardée en mémoire', kept: true, login: false }
                : { ok: true, name: n, activityUrl: 'https://www.strava.com/' },
            ),
          1200,
        ),
      ),
    downloadFit: () => {},
    onContinue: () => {},
    onFinish: () => {},
  });
  recap.show({
    summary: summarize(rec, { ftpW, ...(free ? {} : { workout }) }),
    eyebrow: free ? 'Sortie terminée' : 'Séance terminée',
    title: free ? place : workout.name,
    place,
    startMs: rec.startMs,
    defaultName: name,
    strava,
    rideRunning: !free,
  });
}

/** Sortie inventée, déterministe : la consigne de la séance (ou une sortie vallonnée) avec un peu de bruit. */
function demoRecording(workout: Workout | undefined, ftpW: number): Recording {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const start = Date.now() - 3_600_000;
  const samples: Sample[] = [];
  let noise = 0;
  let dist = 0;
  const push = (targetW: number | undefined, stepIndex: number | undefined, base: number, stepT: number) => {
    noise = noise * 0.85 + rnd() * 9;
    const p = Math.max(0, Math.round(base + noise + (stepT < 6 && targetW !== undefined && targetW > 0.8 * ftpW ? 20 - stepT * 3 : 0)));
    const i = samples.length;
    dist += 8 + p / 60;
    samples.push({
      t: start + i * 1000,
      powerW: p,
      cadenceRpm: 86 + Math.round(rnd() * 6),
      heartRateBpm: Math.round(118 + (p / ftpW) * 40 + Math.min(12, i / 300)),
      distanceM: dist,
      altitudeM: 120 + 18 * Math.sin(i / 400),
      ...(targetW !== undefined ? { targetW } : {}),
      ...(stepIndex !== undefined ? { stepIndex } : {}),
    });
  };
  if (workout) {
    workout.steps.forEach((s, k) => {
      for (let t = 0; t < s.durationS; t++) {
        const tg = targetWatts(s, t, ftpW);
        push(tg, k, tg ?? 0.6 * ftpW, t);
      }
    });
  } else {
    for (let t = 0; t < 3000; t++) push(undefined, undefined, ftpW * (0.68 + 0.22 * Math.sin(t / 240) ** 3), t);
  }
  const endMs = start + samples.length * 1000;
  return { startMs: start, endMs, elapsedS: samples.length, timerS: samples.length, samples, pauses: [] };
}
