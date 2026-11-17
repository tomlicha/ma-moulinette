import { describe, expect, it } from 'vitest';
import { Background, BackgroundStopped, drain, type Steps } from './background';

/** Étapes qui occupent chacune le processeur `ms` millisecondes et notent si le navigateur a eu la main entre-temps. */
function* busy(n: number, ms: number, log: string[], result = 'fini'): Steps<string> {
  for (let i = 0; i < n; i++) {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      /* travail */
    }
    log.push(`étape ${i}`);
    yield;
  }
  return result;
}

describe('drain', () => {
  it('déroule tout d’un coup et rend le résultat', () => {
    const log: string[] = [];
    expect(drain(busy(3, 0, log))).toBe('fini');
    expect(log).toEqual(['étape 0', 'étape 1', 'étape 2']);
  });
});

describe('Background', () => {
  it('rend le résultat des étapes', async () => {
    expect(await new Background().run(busy(3, 0, []))).toBe('fini');
  });

  it('rend la main entre deux tranches : une tâche en attente passe avant la fin', async () => {
    const log: string[] = [];
    setTimeout(() => log.push('autre tâche'), 0);
    await new Background().run(busy(6, 4, log)); // 24 ms de travail, tranches de 8 ms
    const other = log.indexOf('autre tâche');
    expect(other).toBeGreaterThan(0);
    expect(other).toBeLessThan(log.length - 1);
  });

  it('pressée, elle fait des tranches plus longues ; calmée, elle revient aux tranches courtes', async () => {
    const bg = new Background();
    bg.hurry();
    expect(bg.hurried).toBe(true);
    const log: string[] = [];
    setTimeout(() => log.push('autre tâche'), 0);
    await bg.run(busy(6, 4, log)); // 24 ms : tient dans une tranche de 40 ms
    expect(log.indexOf('autre tâche')).toBe(-1);
    bg.calm();
    expect(bg.hurried).toBe(false);
  });

  it('stop() fait échouer le travail en cours avant l’étape suivante, et celui qui suit', async () => {
    const bg = new Background();
    let done = 0;
    function* steps(): Steps<string> {
      for (; done < 10; done++) {
        if (done === 3) bg.stop(); // la vue est jetée pendant qu'elle se construit
        yield;
      }
      return 'fini';
    }
    await expect(bg.run(steps())).rejects.toBeInstanceOf(BackgroundStopped);
    expect(done).toBe(3);
    await expect(bg.run(busy(1, 0, []))).rejects.toBeInstanceOf(BackgroundStopped);
  });
});
