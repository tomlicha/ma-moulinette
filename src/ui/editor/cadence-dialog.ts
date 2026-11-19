import type { EditorSession } from '../../app/editor-session';
import type { EditorBlock } from '../../domain/workout/blocks';
import { byId } from './dom';

/** Cadence valide : 30 à 200 tr/min ; sinon « pas de consigne ». */
const readRpm = (id: string) => {
  const v = Math.round(Number(byId<HTMLInputElement>(id).value));
  return v >= 30 && v <= 200 ? v : undefined;
};

/** Le bloc avec sa cadence cible (et celle de la récupération, pour des intervalles), ou sans quand elle est absente. */
const withCadence = (b: EditorBlock, on?: number, off?: number): EditorBlock => {
  if (b.type === 'free') return b;
  const c = { ...b } as EditorBlock & { cadenceRpm?: number; restCadenceRpm?: number };
  if (on) c.cadenceRpm = on;
  else delete c.cadenceRpm;
  if (c.type === 'intervals') {
    if (off) c.restCadenceRpm = off;
    else delete c.restCadenceRpm;
  }
  return c;
};

/** Cadence cible du bloc sélectionné (option, hors de la ligne de réglages) : un petit dialogue, une seule entrée d'historique. */
export class CadenceDialog {
  private readonly dialog = byId<HTMLDialogElement>('ed-cadence');

  constructor(private readonly session: EditorSession) {
    byId('ed-cad-apply').addEventListener('click', () => {
      session.updateSelected((b) => withCadence(b, readRpm('ed-cad-on'), readRpm('ed-cad-off')));
      this.dialog.close();
    });
    byId('ed-cad-clear').addEventListener('click', () => {
      session.updateSelected((b) => withCadence(b));
      this.dialog.close();
    });
    this.dialog.querySelector('[data-close]')?.addEventListener('click', () => this.dialog.close());
  }

  open(): void {
    const b = this.session.draft?.blocks[this.session.selected];
    if (!b || b.type === 'free') return;
    byId('ed-cad-on-label').textContent = b.type === 'intervals' ? 'Effort' : 'Cadence';
    byId<HTMLInputElement>('ed-cad-on').value = b.cadenceRpm ? String(b.cadenceRpm) : '';
    byId('ed-cad-off-row').hidden = b.type !== 'intervals';
    byId<HTMLInputElement>('ed-cad-off').value = b.type === 'intervals' && b.restCadenceRpm ? String(b.restCadenceRpm) : '';
    this.dialog.showModal();
  }
}
