import { FTP_LIMITS, MASS_LIMITS, clampValue, wattsPerKg } from '../../domain/sim/rider-limits';
import { zoneRangesW } from '../../domain/workout/zones';
import type { setupWheel } from '../shared/wheel-picker';

interface Field {
  /** Champ de la valeur : saisie au clavier sur ordinateur, lecture seule qui ouvre la roulette au tactile. */
  button: HTMLInputElement;
  source: HTMLInputElement;
  min: number;
  max: number;
  step: number;
  label: string;
  unit: string;
}

/**
 * Fiche du coureur (masse, FTP, zones de puissance), ouverte en touchant le médaillon du radar ou le résumé.
 * Les valeurs se saisissent au clavier sur ordinateur et sur une roulette de chiffres (voir wheel-picker.ts) au tactile.
 * Les champs de la sortie (`#mass`, `#wo-ftp`) restent la source de vérité : la fiche les lit, les met à jour
 * et déclenche leur événement `change`, si bien que l'enregistrement et les rafraîchissements existants s'appliquent.
 */
export function setupRiderProfile(o: {
  massSource: HTMLInputElement;
  ftpSource: HTMLInputElement;
  readFtp: () => number;
  readMass: () => number;
  /** Élément qui affiche le résumé « 78 kg · FTP 230 W · 2,95 W/kg ». */
  summary: HTMLElement;
  /** Autres endroits qui montrent le coureur en bref (« 230 W · 78 kg », pastille de l'accueil). */
  briefs?: HTMLElement[];
  dialog: HTMLDialogElement;
  wheel: ReturnType<typeof setupWheel>;
  /** Ouvreurs : le bouton « Mon coureur » (le médaillon est branché par l'appelant via `open`). */
  openers: HTMLElement[];
}) {
  const d = o.dialog;
  const q = <T extends HTMLElement>(sel: string) => d.querySelector<T>(sel)!;
  const fields: Record<'mass' | 'ftp', Field> = {
    mass: { button: q<HTMLInputElement>('#rider-mass'), source: o.massSource, ...MASS_LIMITS, step: 1, label: 'Masse', unit: 'kg' },
    ftp: { button: q<HTMLInputElement>('#rider-ftp'), source: o.ftpSource, ...FTP_LIMITS, step: 1, label: 'FTP', unit: 'W' },
  };
  /** Écran tactile (téléphone, iPad) : roulette ; sinon clavier. */
  const isTouch = () => matchMedia('(pointer: coarse)').matches;
  const current = (k: 'mass' | 'ftp') => (k === 'mass' ? o.readMass() : o.readFtp());
  const wkgOut = q('#rider-wkg');
  const zonesOut = q('#rider-zones');

  const refresh = () => {
    const mass = o.readMass();
    const ftp = o.readFtp();
    const w = wattsPerKg(ftp, mass);
    o.summary.textContent = `${mass} kg · FTP ${ftp} W · ${w} W/kg`;
    for (const b of o.briefs ?? []) b.textContent = `${ftp} W · ${mass} kg`;
    wkgOut.textContent = w;
    fields.mass.button.value = String(mass);
    fields.ftp.button.value = String(ftp);
    zonesOut.replaceChildren(
      ...zoneRangesW(ftp).map((z) => {
        const li = document.createElement('li');
        const range = z.fromW === undefined ? `≤ ${z.toW} W` : z.toW === undefined ? `≥ ${z.fromW} W` : `${z.fromW}–${z.toW} W`;
        li.innerHTML = `<i class="${z.id}"></i><span>${z.id.toUpperCase()} · ${z.name}</span><b>${range}</b>`;
        return li;
      }),
    );
  };

  /** Écrit la valeur dans le champ de la sortie et prévient ceux qui l'écoutent (enregistrement, profil de séance). */
  const commit = (f: Field, v: number) => {
    if (f.source.value !== String(v)) {
      f.source.value = String(v);
      f.source.dispatchEvent(new Event('change', { bubbles: true }));
    }
    refresh();
  };

  for (const [key, f] of Object.entries(fields) as ['mass' | 'ftp', Field][]) {
    f.button.addEventListener('click', () => {
      if (!isTouch()) return;
      o.wheel.open({ title: f.label, unit: f.unit, min: f.min, max: f.max, step: f.step, value: current(key), digits: key === 'ftp', onPick: (v) => commit(f, v) });
    });
    // Ordinateur : on tape la valeur ; Entrée ou la sortie du champ la valide, une saisie illisible rétablit l'ancienne.
    f.button.addEventListener('focus', () => !isTouch() && f.button.select());
    f.button.addEventListener('change', () => commit(f, clampValue(Number(f.button.value.replace(',', '.')), f.min, f.max, current(key))));
    f.button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') f.button.blur();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        commit(f, clampValue(current(key) + (e.key === 'ArrowUp' ? 1 : -1) * f.step, f.min, f.max, f.min));
      }
    });
    d.querySelectorAll<HTMLButtonElement>(`[data-step="${key}"]`).forEach((b) =>
      b.addEventListener('click', () => commit(f, clampValue(current(key) + Number(b.dataset.dir) * f.step, f.min, f.max, f.min))),
    );
  }

  const sync = () => {
    // La masse se fige pendant une sortie (voir startRide) : la fiche suit.
    const locked = o.massSource.readOnly;
    fields.mass.button.disabled = locked;
    for (const f of Object.values(fields)) {
      f.button.readOnly = isTouch();
      f.button.inputMode = isTouch() ? 'none' : 'numeric';
    }
    d.querySelectorAll<HTMLButtonElement>('[data-step="mass"]').forEach((b) => (b.disabled = locked));
    q('#rider-mass-note').hidden = !locked;
    refresh();
  };

  const open = () => {
    sync();
    if (!d.open) d.showModal();
  };
  for (const b of o.openers) b.addEventListener('click', open);
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  // Un clic sur le fond (hors de la carte) ferme la fiche.
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  // Les champs de la sortie peuvent changer ailleurs : le résumé suit.
  o.massSource.addEventListener('change', refresh);
  o.ftpSource.addEventListener('change', refresh);
  refresh();
  return { open, refresh };
}
