import type { EditorSession } from '../../app/editor-session';
import type { EditorBlock } from '../../domain/workout/blocks';
import { blockRanges, nudgeDuration } from '../../domain/workout/block-ops';
import { profilePeakW } from '../../domain/workout/profile';
import { formatDuration, parseDuration } from '../shared/duration';
import { DURATION_STEP_S, POWER_STEP } from './constants';
import { byId, el, pct } from './dom';

type PowerField = 'onPower' | 'offPower' | 'power' | 'powerTo' | 'from' | 'to';

/** Ce que la saisie règle : une puissance (% et W), une durée, une cadence, ou les répétitions. */
interface EditSpec {
  title: string;
  power?: PowerField;
  /** Seconde puissance réglée dans la même saisie (début et fin d'une montée, sur un bloc trop étroit pour deux capsules). */
  power2?: PowerField;
  dur?: 'on' | 'off' | 'block';
  cad?: 'on' | 'off';
  reps?: boolean;
}

const clampPower = (v: number) => Math.min(3, Math.max(0.05, Math.round(v * 100) / 100));

export interface PhoneControlsContext {
  session: EditorSession;
  ftp: () => number;
  /** Le profil, sur lequel les commandes sont posées. */
  plot: HTMLElement;
  /** Le calque des commandes posées sur le bloc sélectionné. */
  overlay: HTMLElement;
  /** Téléphone en paysage : les seules fois où ces commandes existent. */
  phone: MediaQueryList;
  /** Ouvre un panneau (`edit` : la saisie d'une valeur) ou les ferme tous. */
  setPanel: (panel?: string) => void;
}

/**
 * Téléphone en paysage : les commandes du bloc sélectionné sont dessinées sur le profil (un pas + / − par puissance,
 * une pastille de durée, un badge de répétitions), et toucher une valeur ouvre la saisie d'un chiffre exact.
 * Ailleurs, l'inspecteur sous le profil porte les mêmes réglages.
 */
export class PhoneBlockControls {
  private readonly pop = byId<HTMLFormElement>('ed-pop');
  private spec: EditSpec | undefined;

  constructor(private readonly c: PhoneControlsContext) {
    const popIn = (id: string) => this.input(id);
    // Pourcentage et watts se suivent : on tape l'un ou l'autre.
    popIn('pop-pct').addEventListener('input', () => this.followPct('pop-pct', 'pop-w'));
    popIn('pop-w').addEventListener('input', () => this.followWatts('pop-w', 'pop-pct'));
    popIn('pop-pct2').addEventListener('input', () => this.followPct('pop-pct2', 'pop-w2'));
    popIn('pop-w2').addEventListener('input', () => this.followWatts('pop-w2', 'pop-pct2'));
    this.pop.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    c.overlay.addEventListener('click', (e) => e.stopPropagation());
    new ResizeObserver(() => this.render()).observe(c.plot);
    c.phone.addEventListener('change', () => {
      c.setPanel();
      this.render();
    });
  }

  private input(id: string) {
    return byId<HTMLInputElement>(id);
  }

  private followPct(pctId: string, wattsId: string) {
    const v = Number(this.input(pctId).value);
    if (v > 0) this.input(wattsId).value = String(Math.round((v * this.c.ftp()) / 100));
  }

  private followWatts(wattsId: string, pctId: string) {
    const v = Number(this.input(wattsId).value);
    if (v > 0) this.input(pctId).value = String(Math.round((v * 100) / this.c.ftp()));
  }

  private openEdit(spec: EditSpec) {
    const { session } = this.c;
    const popIn = (id: string) => this.input(id);
    const ftp = this.c.ftp();
    const b = session.draft?.blocks[session.selected] as unknown as Record<string, number | undefined> | undefined;
    if (!session.draft || session.draft.readOnly || !b) return;
    this.spec = spec;
    byId('pop-title').textContent = spec.title;
    byId('pop-g-power').hidden = !spec.power;
    byId('pop-g-power2').hidden = !spec.power2;
    byId('pop-l-power').textContent = spec.power2 ? 'Début' : 'Puissance';
    byId('pop-g-dur').hidden = !spec.dur;
    byId('pop-g-cad').hidden = !spec.cad;
    byId('pop-g-rep').hidden = !spec.reps;
    if (spec.power) {
      const v = b[spec.power] ?? 0;
      popIn('pop-pct').value = String(pct(v));
      popIn('pop-w').value = String(Math.round(v * ftp));
    }
    if (spec.power2) {
      const v = b[spec.power2] ?? 0;
      popIn('pop-pct2').value = String(pct(v));
      popIn('pop-w2').value = String(Math.round(v * ftp));
    }
    if (spec.dur) popIn('pop-dur').value = formatDuration((spec.dur === 'on' ? b.onS : spec.dur === 'off' ? b.offS : b.durationS) ?? 0);
    if (spec.cad) popIn('pop-cad').value = String((spec.cad === 'on' ? b.cadenceRpm : b.restCadenceRpm) ?? '');
    if (spec.reps) popIn('pop-rep').value = String(b.repeat ?? 1);
    for (const i of this.pop.querySelectorAll('input')) i.classList.remove('invalid');
    this.c.setPanel('edit');
    const first = this.pop.querySelector<HTMLInputElement>('.pop-g:not([hidden]) input');
    first?.focus();
    first?.select();
  }

  private submit() {
    const { session } = this.c;
    const popIn = (id: string) => this.input(id);
    const spec = this.spec;
    if (!spec || !session.draft) return;
    let ok = true;
    const check = (input: HTMLInputElement, valid: boolean) => {
      input.classList.toggle('invalid', !valid);
      if (!valid) ok = false;
    };
    const out: { pct?: number; pct2?: number; dur?: number; cad?: number | null; reps?: number } = {};
    if (spec.power) {
      const t = popIn('pop-pct').value.trim();
      const v = Number(t);
      check(popIn('pop-pct'), t !== '' && v > 0 && v <= 300);
      out.pct = v;
    }
    if (spec.power2) {
      const t = popIn('pop-pct2').value.trim();
      const v = Number(t);
      check(popIn('pop-pct2'), t !== '' && v > 0 && v <= 300);
      out.pct2 = v;
    }
    if (spec.dur) {
      const v = parseDuration(popIn('pop-dur').value);
      check(popIn('pop-dur'), v !== undefined && v >= 1);
      out.dur = v;
    }
    if (spec.cad) {
      const t = popIn('pop-cad').value.trim();
      const v = Math.round(Number(t));
      check(popIn('pop-cad'), t === '' || (v >= 30 && v <= 200));
      out.cad = t === '' ? null : v;
    }
    if (spec.reps) {
      const v = Number(popIn('pop-rep').value);
      check(popIn('pop-rep'), Number.isInteger(v) && v >= 1 && v <= 50);
      out.reps = v;
    }
    if (!ok) return;
    // Une seule entrée d'historique pour toute la saisie.
    session.updateSelected((b) => {
      const c = { ...b } as unknown as Record<string, number | undefined>;
      if (spec.power && out.pct !== undefined) c[spec.power] = clampPower(out.pct / 100);
      if (spec.power2 && out.pct2 !== undefined) c[spec.power2] = clampPower(out.pct2 / 100);
      if (spec.dur && out.dur !== undefined) c[spec.dur === 'on' ? 'onS' : spec.dur === 'off' ? 'offS' : 'durationS'] = out.dur;
      if (spec.cad) {
        const key = spec.cad === 'on' ? 'cadenceRpm' : 'restCadenceRpm';
        if (out.cad) c[key] = out.cad;
        else delete c[key];
      }
      if (spec.reps && out.reps !== undefined) c.repeat = out.reps;
      return c as unknown as EditorBlock;
    });
    this.c.setPanel();
  }

  /** Ajuste d'un pas la puissance d'un champ du bloc sélectionné (même historique que l'inspecteur). */
  private bump(field: PowerField, d: number) {
    const { session } = this.c;
    const b = session.draft?.blocks[session.selected] as unknown as Record<string, number> | undefined;
    const current = b?.[field];
    if (!session.draft || session.draft.readOnly || typeof current !== 'number') return;
    session.commitSet((v) => {
      (session.draft!.blocks[session.selected] as unknown as Record<string, number>)[field] = v;
    }, clampPower(current + d));
  }

  /**
   * Redessine les commandes du bloc sélectionné : un pas + / − par puissance (en % et en watts), une pastille de durée,
   * un badge de répétitions. Les répétitions étant liées, on règle un seul motif.
   */
  render(): void {
    const { session, plot, overlay, phone } = this.c;
    overlay.replaceChildren();
    if (!session.draft || session.draft.readOnly || !phone.matches) return;
    const b = session.draft.blocks[session.selected];
    const W = plot.clientWidth;
    const H = plot.clientHeight;
    if (!b || !W || !H) return;
    const f = this.c.ftp();
    const w = session.workout();
    const peak = profilePeakW(w, f);
    const total = w.steps.reduce((t, s) => t + s.durationS, 0) || 1;
    const r = blockRanges(session.draft.blocks)[session.selected]!;
    const px = (s: number) => (s / total) * W;
    const topOf = (frac: number) => (1 - (frac * f) / peak) * H;
    const put = (node: HTMLElement, cx: number, top: number, half: number) => {
      node.style.left = `${Math.max(half, Math.min(W - half, cx))}px`;
      node.style.top = `${Math.max(2, top)}px`;
      overlay.append(node);
    };
    const step = (txt: string, label: string, run: () => void) => {
      const x = el('button', { type: 'button', textContent: txt });
      x.setAttribute('aria-label', label);
      x.addEventListener('click', run);
      return x;
    };
    /** Pastille de durée : au-dessus de la barre s'il y a la place, sinon en haut du profil ; les capsules passent alors dessous. */
    const CHIP_ROOM = 34;
    const capMin = (barTop: number) => (barTop >= CHIP_ROOM ? 0 : 32);
    /** Valeur touchable : ouvre la saisie d'un chiffre exact. */
    const val = (what: string, spec: EditSpec, ...children: HTMLElement[]) => {
      const v = el('button', { type: 'button', className: 'ov-val' }, ...children);
      v.setAttribute('aria-label', `${what} : saisir une valeur`);
      v.addEventListener('click', () => this.openEdit(spec));
      return v;
    };
    const cap = (field: PowerField, frac: number, cx: number, label: string, small: boolean, minTop: number, spec: EditSpec) => {
      const node = el(
        'div',
        { className: `ov-cap${small ? ' sm' : ''}` },
        step('+', `${label} plus 5 %`, () => this.bump(field, POWER_STEP)),
        val(label, spec, el('strong', { textContent: `${pct(frac)} %` }), el('small', { textContent: `${Math.round(frac * f)} W` })),
        step('−', `${label} moins 5 %`, () => this.bump(field, -POWER_STEP)),
      );
      put(node, cx, Math.min(Math.max(topOf(frac) + 3, minTop), H - (small ? 74 : 84)), 16);
    };
    /** Durée du bloc (l'effort pour des intervalles). */
    const chip = (cx: number, seconds: number, barTop: number, spec: EditSpec) => {
      const node = el(
        'div',
        { className: 'ov-chip' },
        step('−', 'Durée moins 15 s', () => session.updateSelected((x) => nudgeDuration(x, -DURATION_STEP_S))),
        val('Durée', spec, el('strong', { textContent: formatDuration(seconds) })),
        step('+', 'Durée plus 15 s', () => session.updateSelected((x) => nudgeDuration(x, DURATION_STEP_S))),
      );
      put(node, cx, barTop >= CHIP_ROOM ? barTop - 30 : 2, 52);
    };
    const x0 = px(r.start);
    switch (b.type) {
      case 'intervals': {
        const onW = px(b.onS);
        const barTop = topOf(b.onPower);
        cap('onPower', b.onPower, x0 + onW / 2, 'Effort', false, capMin(barTop), { title: 'Effort', power: 'onPower', dur: 'on', cad: 'on' });
        cap('offPower', b.offPower, x0 + onW + px(b.offS) / 2, 'Récupération', true, 0, { title: 'Récupération', power: 'offPower', dur: 'off', cad: 'off' });
        chip(x0 + onW / 2, b.onS, barTop, { title: 'Durée de l’effort', dur: 'on' });
        const reps = el(
          'div',
          { className: 'ov-chip ov-reps' },
          step('−', 'Une répétition de moins', () => session.updateSelected((x) => (x.type === 'intervals' ? { ...x, repeat: Math.max(1, x.repeat - 1) } : x))),
          val('Répétitions', { title: 'Répétitions', reps: true }, el('strong', { textContent: `× ${b.repeat}` })),
          step('+', 'Une répétition de plus', () => session.updateSelected((x) => (x.type === 'intervals' ? { ...x, repeat: Math.min(50, x.repeat + 1) } : x))),
        );
        put(reps, px(r.end) - 48, 4, 44);
        break;
      }
      case 'steady': {
        const center = x0 + px(b.durationS) / 2;
        if (b.powerTo === undefined) {
          cap('power', b.power, center, 'Puissance', false, capMin(topOf(b.power)), { title: 'Puissance', power: 'power', dur: 'block', cad: 'on' });
        } else {
          cap('power', b.power, center - 22, 'Minimum', true, capMin(Math.min(topOf(b.power), topOf(b.powerTo))), { title: 'Minimum', power: 'power', dur: 'block', cad: 'on' });
          cap('powerTo', b.powerTo, center + 22, 'Maximum', true, 0, { title: 'Maximum', power: 'powerTo', dur: 'block', cad: 'on' });
        }
        chip(center, b.durationS, Math.min(topOf(b.power), topOf(b.powerTo ?? b.power)), { title: 'Durée', dur: 'block' });
        break;
      }
      case 'warmup':
      case 'cooldown':
      case 'ramp': {
        const bw = px(b.durationS);
        const barTop = Math.min(topOf(b.from), topOf(b.to));
        if (bw >= 52) {
          cap('from', b.from, x0 + bw * 0.22, 'Début', true, capMin(barTop), { title: 'Début', power: 'from', dur: 'block', cad: 'on' });
          cap('to', b.to, x0 + bw * 0.78, 'Fin', true, capMin(barTop), { title: 'Fin', power: 'to', dur: 'block', cad: 'on' });
        } else {
          // Trop étroit pour deux capsules : une seule (la fin), dont la saisie règle aussi le début.
          cap('to', b.to, x0 + bw / 2, 'Fin', true, capMin(barTop), { title: 'Début et fin', power: 'from', power2: 'to', dur: 'block', cad: 'on' });
        }
        chip(x0 + bw / 2, b.durationS, barTop, { title: 'Durée', dur: 'block' });
        break;
      }
      case 'free':
        chip(x0 + px(b.durationS) / 2, b.durationS, 0, { title: 'Durée', dur: 'block' });
        break;
    }
  }
}
