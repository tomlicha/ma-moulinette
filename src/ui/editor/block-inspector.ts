import type { EditorSession } from '../../app/editor-session';
import { BLOCK_LABEL, type EditorBlock } from '../../domain/workout/blocks';
import { describeBlock } from '../../domain/workout/block-ops';
import { zoneOf } from '../../domain/workout/profile';
import { zoneName } from '../../domain/workout/zones';
import { setBlocked } from '../shared/blocked';
import { formatDuration, parseDuration } from '../shared/duration';
import { POWER_STEP } from './constants';
import { button, byId, el, pct } from './dom';

export interface BlockInspectorContext {
  session: EditorSession;
  ftp: () => number;
  /** Redessine tout l'écran de l'éditeur, sauf la ligne de réglages (la frappe est en cours dans un de ses champs). */
  redrawExceptInspector: () => void;
  /** Redessine tout l'écran, ligne de réglages comprise (la frappe est finie). */
  redraw: () => void;
  saveAsBlock: (b: EditorBlock) => void;
  openCadence: () => void;
  /** Ferme les panneaux du téléphone (une action faite, le menu « ⋯ » se referme). */
  closePanel: () => void;
}

/** Légende « Effort · Seuil » ; la zone est omise quand elle répète le nom (« Récupération · Récupération »). */
const legendText = (name: string, zone?: string) => (zone && zone !== name ? `${name} · ${zone}` : name);

/**
 * La ligne de réglages du bloc sélectionné (puissance, durée, répétitions, actions), sous le profil : la même chose que
 * les commandes posées sur le bloc du téléphone, avec des champs pour taper une valeur. La phrase qui décrit le bloc et
 * les légendes de zone suivent la frappe sans reconstruire les champs (`refreshText`).
 */
export class BlockInspector {
  private readonly form = byId<HTMLFormElement>('ed-inspector');

  constructor(private readonly c: BlockInspectorContext) {
    // Fin d'une frappe : la prochaine saisie ouvrira une nouvelle entrée d'historique, et les champs reprennent leur forme normale.
    this.form.addEventListener('focusout', () => {
      const { session } = this.c;
      if (!session.typing) return;
      session.typing = false;
      setTimeout(() => {
        if (!this.form.contains(document.activeElement)) this.c.redraw();
      });
    });
    this.form.addEventListener('submit', (e) => e.preventDefault());
  }

  /** Champ de puissance en % avec boutons ±5 % ; `key` sert à rendre le focus après redessin. */
  private powerStepper(label: string, value: number, set: (v: number) => void, key: string) {
    const input = el('input', { type: 'number', value: String(pct(value)), min: '1', max: '300', step: '1' });
    input.setAttribute('aria-label', `${label}, en % de la FTP`);
    input.dataset.key = `${key}-in`;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      const ok = input.value.trim() !== '' && v > 0 && v <= 300;
      input.classList.toggle('invalid', !ok);
      if (!ok) return;
      this.liveEdit(() => set(v / 100));
    });
    const step = (d: number) => {
      const b = el('button', { type: 'button', textContent: d > 0 ? '+' : '−' });
      b.setAttribute('aria-label', `${label} ${d > 0 ? 'plus' : 'moins'} 5 %`);
      b.dataset.key = `${key}-${d > 0 ? 'up' : 'down'}`;
      b.addEventListener('click', () => {
        // Part de ce qui est affiché : une valeur tapée juste avant n'a pas encore redessiné le champ.
        const typed = Number(input.value) / 100;
        const base = input.value.trim() !== '' && typed > 0 ? typed : value;
        // Les setters écrivent dans le bloc sélectionné du brouillon : la session le copie d'abord, l'historique garde l'original.
        this.c.session.commitSet(set, Math.min(3, Math.max(0.05, Math.round((base + d) * 100) / 100)));
      });
      return b;
    };
    // La vraie valeur, à côté du pourcentage : elle suit la frappe (voir refreshText).
    const watts = el('span', { className: 'watts', textContent: `${Math.round(value * this.c.ftp())} W` });
    watts.dataset.power = key;
    return el('div', { className: 'stepper' }, step(-POWER_STEP), input, el('span', { textContent: '%' }), step(POWER_STEP), watts);
  }

  private durationField(label: string, value: number, set: (v: number) => void, key: string) {
    const input = el('input', { type: 'text', value: formatDuration(value), inputMode: 'numeric', placeholder: 'mm:ss' });
    input.setAttribute('aria-label', label);
    input.dataset.key = key;
    input.addEventListener('input', () => {
      const v = parseDuration(input.value);
      input.classList.toggle('invalid', v === undefined || v < 1);
      if (v === undefined || v < 1) return;
      this.liveEdit(() => set(v));
    });
    return el('label', { className: 'dur' }, label.split(' ')[0]!.toLowerCase(), input);
  }

  private countStepper(value: number, set: (v: number) => void) {
    const input = el('input', { type: 'number', value: String(value), min: '1', step: '1' });
    input.setAttribute('aria-label', 'Répétitions');
    input.dataset.key = 'rep-in';
    input.addEventListener('input', () => {
      const v = Number(input.value);
      const ok = Number.isInteger(v) && v >= 1 && v <= 50;
      input.classList.toggle('invalid', !ok);
      if (ok) this.liveEdit(() => set(v));
    });
    const step = (d: number) => {
      const b = el('button', { type: 'button', textContent: d > 0 ? '+' : '−' });
      b.setAttribute('aria-label', d > 0 ? 'Une répétition de plus' : 'Une répétition de moins');
      b.dataset.key = `rep-${d > 0 ? 'up' : 'down'}`;
      b.addEventListener('click', () =>
        this.c.session.updateSelected((x) => (x.type === 'intervals' ? { ...x, repeat: Math.max(1, Math.min(50, x.repeat + d)) } : x)),
      );
      return b;
    };
    return el('div', { className: 'stepper' }, step(-1), input, step(1));
  }

  /** Frappe dans un champ : on modifie le brouillon en place et on redessine tout sauf la ligne de réglages. */
  private liveEdit(apply: () => void) {
    const { session } = this.c;
    if (!session.draft || session.draft.readOnly) return;
    if (!session.typing) {
      session.history.record(session.draft.blocks);
      session.typing = true;
    }
    apply();
    this.c.redrawExceptInspector();
  }

  private fieldset(name: string, zone: string | undefined, main: boolean, ...children: Node[]) {
    const f = el('fieldset', { className: main ? 'main' : '' }, el('legend', { textContent: legendText(name, zone) }), ...children);
    f.dataset.legend = name;
    return f;
  }

  /** Actions du bloc sélectionné : cadence, déplacer, dupliquer, séparer, enregistrer comme bloc, supprimer. */
  private blockActions(b: EditorBlock, keyed: boolean): HTMLElement {
    const { session } = this.c;
    const actions = el('div', { className: 'actions' });
    if (b.type !== 'free') {
      const c = b.cadenceRpm;
      actions.append(button(c ? `${c} rpm…` : 'Cadence…', () => this.c.openCadence(), 'secondary'));
      actions.lastElementChild!.setAttribute('title', 'Cadence cible du bloc (facultative)');
      actions.lastElementChild!.classList.add('act-cadence');
    }
    actions.append(
      button('← Avant', () => session.moveSelected(-1), 'secondary'),
      button('Après →', () => session.moveSelected(1), 'secondary'),
      button('Dupliquer', () => session.duplicateSelected(), 'secondary'),
    );
    if (b.type === 'intervals') {
      const split = button('Séparer', () => session.splitSelected(), 'secondary');
      split.title = 'Séparer les répétitions en blocs individuels';
      actions.append(split);
    }
    const keep = button('Enregistrer comme bloc', () => this.c.saveAsBlock(b), 'secondary');
    keep.title = 'Le ranger dans « Mes blocs », sur l’étagère';
    actions.append(keep, button('Supprimer', () => session.deleteSelected(), 'secondary danger'));
    if (keyed) actions.querySelectorAll('button').forEach((x, i) => (x.dataset.key = `act-${i}`));
    const [before, after] = [...actions.querySelectorAll('button')].filter((x) => /Avant|Après/.test(x.textContent ?? ''));
    if (before) setBlocked(before, session.selected === 0 ? 'C’est déjà le premier bloc.' : undefined);
    if (after) setBlocked(after, session.selected === session.draft!.blocks.length - 1 ? 'C’est déjà le dernier bloc.' : undefined);
    // Sur téléphone, ces actions vivent dans le menu « ⋯ » : une action faite, il se referme.
    actions.addEventListener('click', () => this.c.closePanel());
    return actions;
  }

  /** Reconstruit la ligne de réglages du bloc sélectionné (et son menu d'actions du téléphone). */
  render(): void {
    const { session } = this.c;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
    const b = session.draft!.blocks[session.selected];
    if (!b) {
      this.form.replaceChildren(el('p', { className: 'note', textContent: 'Aucun bloc : ajoute-en depuis l’étagère.' }));
      byId('ed-bactions').replaceChildren();
      return;
    }
    const f = this.c.ftp();
    const cur = () => session.draft!.blocks[session.selected]!;
    const set = <K extends string>(k: K) => (v: number) => ((cur() as unknown as Record<K, number>)[k] = v);
    const z = (p: number) => zoneName(zoneOf(p));

    const actions = this.blockActions(b, true);

    const line = el('div', { className: 'ed-line' });
    switch (b.type) {
      case 'intervals': {
        const schema = el(
          'div',
          { className: 'rep-schema' },
          el('span', { textContent: 'Une répétition' }),
          el('div', { className: 'bars' }),
          el('span', { textContent: `${formatDuration(b.onS)} + ${formatDuration(b.offS)}, × ${b.repeat}` }),
        );
        const bars = schema.querySelector('.bars')!;
        for (const [s, p] of [[b.onS, b.onPower], [b.offS, b.offPower]] as const) {
          const bar = el('span');
          bar.style.flex = String(s);
          bar.style.height = `${Math.min(100, (p / Math.max(b.onPower, b.offPower)) * 100)}%`;
          bar.style.background = `var(--${zoneOf(p)})`;
          bars.append(bar);
        }
        line.append(
          schema,
          this.fieldset('Répétitions', undefined, false, this.countStepper(b.repeat, set('repeat'))),
          this.fieldset('Effort', z(b.onPower), true, this.powerStepper('Effort', b.onPower, set('onPower'), 'on'), this.durationField('Durée de l’effort', b.onS, set('onS'), 'on-dur')),
          this.fieldset('Récupération', z(b.offPower), false, this.powerStepper('Récupération', b.offPower, set('offPower'), 'off'), this.durationField('Durée de la récupération', b.offS, set('offS'), 'off-dur')),
        );
        break;
      }
      case 'steady':
        line.append(this.fieldset('Puissance', z(b.power), true, this.powerStepper('Puissance', b.power, set('power'), 'p'), this.durationField('Durée du palier', b.durationS, set('durationS'), 'dur')));
        break;
      case 'warmup':
      case 'cooldown':
      case 'ramp':
        line.append(
          this.fieldset('Début', z(b.from), true, this.powerStepper('Début', b.from, set('from'), 'from'), this.durationField('Durée du bloc', b.durationS, set('durationS'), 'dur')),
          this.fieldset('Fin', z(b.to), false, this.powerStepper('Fin', b.to, set('to'), 'to')),
        );
        break;
      case 'free':
        line.append(this.fieldset('Libre', 'sans consigne', true, this.durationField('Durée du bloc', b.durationS, set('durationS'), 'dur')));
        break;
    }

    const sentence = el('p', { className: 'sentence', textContent: describeBlock(b, f) });
    if (b.type === 'intervals') sentence.title = `Les ${b.repeat} répétitions sont modifiées ensemble`;
    // Sur téléphone, l'inspecteur est une feuille (bouton ⋯ sous le profil) : titre et bouton Fermer en tête.
    const close = el('button', { type: 'button', className: 'sheet-x', textContent: 'Fermer' });
    close.dataset.openPanel = '';
    const head = el('div', { className: 'sheet-head' }, el('strong', { textContent: `${BLOCK_LABEL[b.type]} · bloc ${session.selected + 1} sur ${session.draft!.blocks.length}` }), close);
    // Sur téléphone, l'inspecteur n'est plus qu'un menu d'actions : une action faite, il se referme.
    this.form.replaceChildren(head, sentence, el('div', { className: 'ed-body' }, line, actions));
    byId('ed-bactions').replaceChildren(this.blockActions(b, false)); // le même menu, dans le « ⋯ » de l'en-tête (téléphone)
    if (active) this.form.querySelector<HTMLElement>(`[data-key="${active}"]`)?.focus();
  }

  /** Pendant la frappe : la phrase et les zones des légendes suivent, sans reconstruire les champs. */
  refreshText(): void {
    const b = this.c.session.draft!.blocks[this.c.session.selected];
    if (!b) return;
    const sentence = this.form.querySelector('.sentence');
    if (sentence) sentence.textContent = describeBlock(b, this.c.ftp());
    const z = (p: number) => zoneName(zoneOf(p));
    const legends: Record<string, string | undefined> = {
      Effort: b.type === 'intervals' ? z(b.onPower) : undefined,
      Récupération: b.type === 'intervals' ? z(b.offPower) : undefined,
      Puissance: b.type === 'steady' ? z(b.power) : undefined,
      Début: 'from' in b ? z(b.from) : undefined,
      Fin: 'to' in b ? z(b.to) : undefined,
    };
    const power: Record<string, number | undefined> = {
      on: b.type === 'intervals' ? b.onPower : undefined,
      off: b.type === 'intervals' ? b.offPower : undefined,
      p: b.type === 'steady' ? b.power : undefined,
      from: 'from' in b ? b.from : undefined,
      to: 'to' in b ? b.to : undefined,
    };
    this.form.querySelectorAll<HTMLElement>('.watts[data-power]').forEach((w) => {
      const v = power[w.dataset.power!];
      if (v !== undefined) w.textContent = `${Math.round(v * this.c.ftp())} W`;
    });
    this.form.querySelectorAll<HTMLFieldSetElement>('fieldset[data-legend]').forEach((fs) => {
      const zone = legends[fs.dataset.legend!];
      if (zone) fs.querySelector('legend')!.textContent = legendText(fs.dataset.legend!, zone);
    });
  }
}
