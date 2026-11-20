import { connectFinalSurge, disconnectFinalSurge, finalSurgeStatus, importFinalSurgeWorkouts } from '../../infra/net/final-surge';
import type { WorkoutLibrary } from '../../domain/workout/library';
import type { EditorBlock } from '../../domain/workout/blocks';
import type { Workout, WorkoutStep } from '../../domain/workout/model';

const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
const addDays = (date: string, days: number) => {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
};
function blocksFromWorkout(workout: Workout, ftpW: number): EditorBlock[] {
  return workout.steps.map((step: WorkoutStep): EditorBlock => {
    const cadenceRpm = step.cadenceRpm;
    if (step.kind === 'warmup' || step.kind === 'cooldown' || step.kind === 'ramp') {
      const from = step.target.kind === 'ftp' ? step.target.from : step.target.kind === 'watts' ? step.target.from / ftpW : 0.5;
      const to = step.target.kind === 'ftp' ? step.target.to : step.target.kind === 'watts' ? step.target.to / ftpW : from;
      return { type: step.kind, durationS: step.durationS, from, to, ...(cadenceRpm ? { cadenceRpm } : {}) };
    }
    if (step.target.kind === 'free') return { type: 'free', durationS: step.durationS };
    const from = step.target.kind === 'ftp' ? step.target.from : step.target.from / ftpW;
    return { type: 'steady', durationS: step.durationS, power: from, ...(cadenceRpm ? { cadenceRpm } : {}) };
  });
}

export function setupFinalSurgeDialog(options: { library: WorkoutLibrary; ftpW: () => number; onImported: () => void; log: (message: string) => void }): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'rider-dialog name-dialog';
  dialog.setAttribute('aria-labelledby', 'final-surge-title');
  dialog.innerHTML = `
    <form class="rider-card name-card final-surge-card">
      <div><span class="home-kicker">Synchronisation des séances</span><h2 id="final-surge-title">Final Surge</h2></div>
      <p class="note">Connecte ton compte Final Surge. Les identifiants sont chiffrés côté serveur et ne sont jamais conservés dans le navigateur.</p>
      <div class="fs-credentials">
        <label class="name-field"><span>Adresse courriel</span><input name="email" type="email" autocomplete="username" required maxlength="254"></label>
        <label class="name-field"><span>Mot de passe Final Surge</span><input name="password" type="password" autocomplete="current-password" required maxlength="1024"></label>
        <button type="button" class="secondary" data-act="connect">Connecter Final Surge</button>
      </div>
      <div class="fs-connected" hidden>
        <p class="note">Compte Final Surge connecté.</p>
        <label class="name-field"><span>Du</span><input name="startDate" type="date" required></label>
        <label class="name-field"><span>Au</span><input name="endDate" type="date" required></label>
        <button type="button" data-act="import">Importer les séances</button>
        <button type="button" class="secondary" data-act="disconnect">Déconnecter Final Surge</button>
      </div>
      <p class="note fs-status" role="status" aria-live="polite"></p>
      <ul class="fs-errors" hidden></ul>
      <div class="row"><button type="button" class="secondary" data-act="close">Fermer</button></div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form')!;
  const credentials = dialog.querySelector<HTMLElement>('.fs-credentials')!;
  const connected = dialog.querySelector<HTMLElement>('.fs-connected')!;
  const status = dialog.querySelector<HTMLElement>('.fs-status')!;
  const errors = dialog.querySelector<HTMLUListElement>('.fs-errors')!;
  const email = form.elements.namedItem('email') as HTMLInputElement;
  const password = form.elements.namedItem('password') as HTMLInputElement;
  const start = form.elements.namedItem('startDate') as HTMLInputElement;
  const end = form.elements.namedItem('endDate') as HTMLInputElement;
  start.value = addDays(today(), -7);
  end.value = today();

  const showStatus = (message: string) => { status.textContent = message; };
  const setConnected = (value: boolean) => { credentials.hidden = value; connected.hidden = !value; };
  async function refresh() {
    try { const state = await finalSurgeStatus(); setConnected(state.connected); }
    catch { setConnected(false); showStatus('Service Final Surge indisponible.'); }
  }
  dialog.addEventListener('click', async (event) => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
    if (!action) return;
    if (action === 'close') { dialog.close(); return; }
    errors.hidden = true; errors.replaceChildren();
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')!;
    button.disabled = true;
    try {
      if (action === 'connect') {
        await connectFinalSurge(email.value, password.value);
        password.value = '';
        showStatus('Compte Final Surge connecté.');
        await refresh();
      } else if (action === 'disconnect') {
        await disconnectFinalSurge(); showStatus('Compte Final Surge déconnecté.'); await refresh();
      } else if (action === 'import') {
        if (!start.value || !end.value || start.value > end.value) throw new Error('Vérifie la période sélectionnée.');
        showStatus('Lecture des séances Final Surge…');
        const result = await importFinalSurgeWorkouts(start.value, end.value);
        const ftp = Math.max(1, options.ftpW());
        let imported = 0;
        for (const item of result.workouts) {
          const mapped = item.workout;
          if (!mapped.steps.length) continue;
          const blocks = blocksFromWorkout(mapped, ftp);
          const warnings = [...mapped.warnings];
          if (mapped.steps.some((s) => s.kind === 'off' || s.kind === 'on' || s.kind === 'max')) warnings.push('Certains types d’intensité Final Surge sont représentés comme paliers dans l’éditeur.');
          options.library.save({ name: mapped.name, description: [mapped.description, ...warnings].filter(Boolean).join('\n\n'), blocks });
          imported++;
        }
        options.onImported();
        const issues = result.errors;
        errors.replaceChildren(...issues.map((message) => { const li = document.createElement('li'); li.textContent = message; return li; }));
        errors.hidden = !issues.length;
        showStatus(`${imported} séance(s) importée(s) dans Ma Moulinette.`);
        options.log(`Final Surge : ${imported} séance(s) importée(s)`);
      }
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Opération Final Surge impossible.');
    } finally { button.disabled = false; }
  });
  window.addEventListener('mm:final-surge-open', () => {
    showStatus(''); errors.hidden = true;
    void refresh();
    if (!dialog.open) dialog.showModal();
  });
}
