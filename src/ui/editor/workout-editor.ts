import {
  BLOCK_LABEL,
  blocksToWorkout,
  defaultBlock,
  toZwo,
  validateBlocks,
  workoutStats,
  workoutToBlocks,
  type EditorBlock,
  type WorkoutStats,
} from '../../domain/workout/blocks';
import { blockIndexAt, blockRanges, blockShort, describeBlock, nudgeDuration, nudgePower, splitIntervals } from '../../domain/workout/block-ops';
import { EditorSession, type EditorDraft } from '../../app/editor-session';
import type { BlockLibrary } from '../../domain/workout/block-library';
import type { SavedWorkout, WorkoutLibrary } from '../../domain/workout/library';
import { targetWatts, type Workout } from '../../domain/workout/model';
import { profilePeakW, profileShapes, zoneOf, type Zone } from '../../domain/workout/profile';
import { SAMPLE_WORKOUTS } from '../../domain/workout/samples';
import { effortSeconds, intensityWord, timeInZones, ZONES, zoneName, zoneReading, type ZoneTimes } from '../../domain/workout/zones';
import { setBlocked, type BlockReason } from '../shared/blocked';
import './seances.css';
import { formatDuration, parseDuration } from '../shared/duration';
import { BlockMover } from './block-mover';
import { BlockShelf } from './block-shelf';
import { DURATION_STEP_S, POWER_STEP } from './constants';
import { PhoneBlockControls } from './phone-controls';
import { download, el, fmtLong, fold, isElsewhere, isTyping, miniProfile as miniProfileSvg, pct, slug, svg } from './dom';

const W = 1000;
const H = 120;

type Draft = EditorDraft;

export interface EditorOptions {
  library: WorkoutLibrary;
  /** « Mes blocs » : blocs mis de côté par l'utilisateur, proposés dans l'étagère. */
  blocks: BlockLibrary;
  readFtp: () => number;
  log: (msg: string) => void;
  /** La bibliothèque a changé : la liste des séances de l'écran de sortie doit être reconstruite. */
  onLibraryChange: () => void;
  /** Séance choisie dans l'application (`lib:<id>` ou `sample:<id>`, vide si aucune) : celle que l'écran ouvre en premier. */
  currentChoice: () => string;
  /** L'utilisateur a ouvert cette séance dans l'éditeur : elle devient la séance choisie de l'application. */
  onFocus: (key: string) => void;
  /** Rouler cette séance : va sur la sortie et la démarre. */
  onRide: (key: string) => void;
  /** Pourquoi on ne peut pas rouler maintenant (pas de trainer, séance déjà en cours), sinon `undefined`. */
  rideBlock: () => string | BlockReason | undefined;
}

/**
 * Écran « Séances » : bibliothèque (mes séances, modèles, import) et éditeur à profil direct, sur le même écran
 * (docs/design/seances.md). Une séance est toujours ouverte : en choisir une dans la bibliothèque l'ouvre
 * aussitôt. Le profil, la bande de structure et la ligne de réglages montrent le même bloc sélectionné ;
 * chaque modification passe par `commit`, qui l'inscrit dans l'historique avant de redessiner.
 * Un modèle s'ouvre en lecture seule : on peut le parcourir et le rouler, ou le dupliquer pour le modifier.
 */
export function setupWorkoutEditor(o: EditorOptions) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const editor = $('editor');
  const nameIn = $<HTMLInputElement>('ed-name');
  const descIn = $<HTMLTextAreaElement>('ed-desc');
  const plot = $('ed-plot');
  const tip = $('ed-tip');
  const inspector = $<HTMLFormElement>('ed-inspector');
  const cadenceDialog = $<HTMLDialogElement>('ed-cadence');
  const sea = document.querySelector<HTMLElement>('.sea')!;
  const overlay = $('ed-over');
  /** Téléphone en paysage : écran sans défilement, commandes posées sur le bloc (docs/design/seances.md, piste J). */
  const PHONE = matchMedia('(pointer: coarse) and (orientation: landscape) and (max-height: 460px)');
  /** Panneau ouvert sur téléphone : `lib` (bibliothèque), `more` (menu ⋯), `add`, `block` (réglages du bloc) ; vide : aucun. */
  const setPanel = (p = '') => {
    sea.dataset.panel = p;
  };
  setPanel();

  const ftp = () => o.readFtp();
  const session = new EditorSession({
    library: o.library,
    ftp,
    log: o.log,
    confirmDiscard: () => confirm('Abandonner les modifications en cours ?'),
  });
  const workout = (): Workout => session.workout();
  const isDirty = () => session.isDirty();

  // --- Bibliothèque ---

  /** Clé d'une séance ouverte : `lib:<id>` (enregistrée) ou `sample:<id>` (modèle) ; rien pour un brouillon. */
  const keyOf = (d: Draft | undefined = session.draft) => session.keyOf(d);

  /** Message dans la bibliothèque (le journal est masqué sur cet écran) : import refusé, enregistrement impossible. */
  function say(msg?: string) {
    const p = $('lib-msg');
    p.textContent = msg ?? '';
    p.hidden = !msg;
    if (msg) o.log(msg);
  }

  function summary(blocks: EditorBlock[]) {
    const s = workoutStats(blocksToWorkout('x', undefined, blocks), ftp());
    return `${fmtLong(s.durationS)} · ${s.avgW} W · charge ${s.load}`;
  }

  function button(label: string, onClick: () => void, cls = '') {
    const b = el('button', { textContent: label, type: 'button', className: cls });
    b.addEventListener('click', onClick);
    return b;
  }

  const sampleWorkout = (id: string) => session.sampleWorkout(id);

  /** Aperçu du profil d'une séance (mêmes couleurs de zones que l'éditeur), pour sa ligne dans la bibliothèque. */
  const miniProfile = (w: Workout, cls = 'lib-mini') => miniProfileSvg(w, ftp(), cls);

  function libRow(key: string, w: Workout, meta: string, pressed: boolean, onPick?: () => void, onRemove?: () => void) {
    const main = el(
      'button',
      { type: 'button', className: 'lib-item' },
      miniProfile(w),
      el('span', { className: 'lib-text' }, el('strong', { textContent: w.name || 'Séance sans nom' }), el('small', { textContent: meta })),
    );
    main.dataset.key = key;
    main.setAttribute('aria-pressed', String(pressed));
    if (onPick) main.addEventListener('click', onPick);
    const row = el('li', { className: 'lib-row' }, main);
    if (onRemove) {
      const del = el('button', { type: 'button', className: 'lib-del', textContent: '✕', title: 'Supprimer' });
      del.setAttribute('aria-label', `Supprimer la séance « ${w.name} »`);
      del.addEventListener('click', onRemove);
      row.append(del);
    }
    return row;
  }

  function renderLibrary() {
    // Les lignes sont reconstruites à chaque ouverture : le focus clavier revient sur la même ligne.
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && active.closest('.sea-lib') ? active.dataset.key : undefined;
    const q = fold($<HTMLInputElement>('lib-search').value.trim());
    const match = (name: string) => !q || fold(name).includes(q);
    const current = keyOf(session.draft);

    const saved = o.library.list();
    const mine: HTMLElement[] = [];
    // Une séance nouvelle, importée ou copiée n'est pas encore dans la bibliothèque : on la montre en tête, ouverte.
    if (session.draft && !session.draft.id && !session.draft.readOnly) mine.push(libRow('draft', workout(), 'Non enregistrée', true));
    for (const w of saved.filter((x) => match(x.name))) {
      const key = `lib:${w.id}`;
      mine.push(libRow(key, blocksToWorkout(w.name, w.description, w.blocks), summary(w.blocks), current === key, () => pick(key), () => remove(w)));
    }
    if (!mine.length) mine.push(el('li', { className: 'note', textContent: saved.length ? 'Aucune séance ne correspond.' : 'Aucune séance enregistrée : crée-en une ou duplique un modèle.' }));
    $('lib-list').replaceChildren(...mine);
    $('lib-count').textContent = String(saved.length);

    const samples = SAMPLE_WORKOUTS.flatMap((s) => {
      const w = sampleWorkout(s.id);
      return w && match(w.name) ? [libRow(`sample:${s.id}`, w, summary(workoutToBlocks(w, ftp()).blocks), current === `sample:${s.id}`, () => pick(`sample:${s.id}`))] : [];
    });
    $('lib-samples').replaceChildren(...(samples.length ? samples : [el('li', { className: 'note', textContent: 'Aucun modèle ne correspond.' })]));
    $('lib-sample-count').textContent = String(SAMPLE_WORKOUTS.length);

    if (focusKey) document.querySelector<HTMLElement>(`.sea-lib [data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  // --- Ouverture, enregistrement, modifications : l'état est dans la session (app/editor-session.ts) ---

  // La session publie ; la vue pose les questions, redessine et prévient l'application.
  session.on('opened', () => {
    nameIn.value = session.draft!.name;
    descIn.value = session.draft!.description;
    setPanel();
    say();
    renderLibrary();
    render();
    renderShelf();
  });
  session.on('changed', () => render());
  session.on('focused', (key) => o.onFocus(key));

  const open = (d: Draft, unsaved = false) => session.open(d, unsaved);
  const commit = (change: (blocks: EditorBlock[]) => EditorBlock[], nextSelected?: number) => session.commit(change, nextSelected);
  const updateSelected = (f: (b: EditorBlock) => EditorBlock) => session.updateSelected(f);
  const select = (i: number) => session.select(i);
  const undo = () => session.undo();
  const redo = () => session.redo();

  /** Clic dans la bibliothèque : la séance s'ouvre, et devient la séance choisie de l'application. */
  function pick(key: string) {
    setPanel();
    if (key === keyOf()) return;
    if (session.openKey(key)) o.onFocus(key);
  }

  function remove(w: SavedWorkout) {
    if (!confirm(`Supprimer la séance « ${w.name} » ?`)) return;
    const wasOpen = session.removeSaved(w);
    o.log(`séance supprimée : ${w.name}`);
    renderLibrary();
    o.onLibraryChange();
    if (wasOpen) session.openFallback(true);
  }

  function openFromWorkoutFile(fileName: string, text: string) {
    const r = session.importFile(fileName, text);
    if (r.kind === 'error') say(`import impossible (${fileName}) : ${r.message}`);
    else if (r.kind === 'opened') for (const m of r.warnings) o.log(`import : ${m}`);
  }

  /** À l'arrivée sur l'écran : on ouvre la séance choisie dans l'application, sauf si un brouillon modifié est en cours. */
  function sync() {
    setPanel();
    if (!session.syncTo(o.currentChoice())) return;
    renderLibrary();
    render();
  }

  function save(): string | undefined {
    const r = session.save();
    if (!r) return undefined;
    if (r.kind === 'failed') {
      say(`enregistrement impossible (stockage du navigateur plein ou bloqué) : ${r.message}`);
      return undefined;
    }
    const saved = r.workout;
    nameIn.value = saved.name;
    say();
    o.log(`séance enregistrée : ${saved.name}`);
    renderLibrary();
    o.onLibraryChange();
    render();
    o.onFocus(`lib:${saved.id}`);
    return saved.id;
  }

  // --- Rendu ---

  function render(keepInspector = false) {
    if (!session.draft) return;
    const w = workout();
    const f = ftp();
    const stats = workoutStats(w, f);
    const zones = timeInZones(w, f);
    const ro = !!session.draft.readOnly;
    $('ed-sub').textContent = `${fmtLong(stats.durationS)} · charge ${stats.load}${ro ? ' · lecture seule' : isDirty() ? ' · modifiée' : ''}`;
    $('ed-dirty').hidden = !isDirty();
    $('ed-readonly').hidden = !ro;
    $('ed-kicker').textContent = ro ? 'Modèle' : session.draft.id ? 'Mes séances' : 'Nouvelle séance';
    $('ed-bbar').classList.toggle('locked', ro);
    nameIn.readOnly = ro;
    descIn.readOnly = ro;
    $('ed-save').hidden = ro;
    $('ed-export').hidden = ro;
    $('ed-copy').hidden = !ro;
    inspector.inert = ro;
    inspector.classList.toggle('ro', ro);
    const roReason = 'Un modèle est en lecture seule : duplique-le pour le modifier.';
    for (const id of ['ed-undo', 'ed-undo2']) setBlocked($<HTMLButtonElement>(id), session.history.canUndo ? undefined : ro ? roReason : 'Rien à annuler pour l’instant.');
    for (const id of ['ed-redo', 'ed-redo2']) setBlocked($<HTMLButtonElement>(id), session.history.canRedo ? undefined : ro ? roReason : 'Rien à rétablir : tu n’as rien annulé.');
    setBlocked($<HTMLButtonElement>('ed-del'), ro ? roReason : session.draft.blocks.length ? undefined : 'Aucun bloc à supprimer.');
    renderSummary(stats, zones);
    renderChart(w, f);
    renderBlockBar();
    if (keepInspector) refreshInspectorText();
    else renderInspector();
    renderZones(zones);
    const errors = validateBlocks(session.draft.blocks);
    $('ed-errors').replaceChildren(...errors.map((e) => el('li', { textContent: e })));
    for (const id of ['ed-save', 'ed-export']) setBlocked($<HTMLButtonElement>(id), errors.length ? `À corriger d’abord : ${errors[0]}` : undefined);
    renderRide(errors);
    renderOverlay();
  }

  /** « Rouler » attend une séance valide, puis un trainer connecté ; l'application rappelle quand la connexion change. */
  function renderRide(errors = session.draft ? validateBlocks(session.draft.blocks) : []) {
    setBlocked($<HTMLButtonElement>('ed-ride'), errors.length ? `À corriger d’abord : ${errors[0]}` : o.rideBlock());
  }

  function delta(now: number, before: number | undefined, digits = 0, unit = '') {
    if (before === undefined) return '';
    const d = +(now - before).toFixed(digits);
    if (d === 0) return '';
    return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(digits).replace('.', ',')}${unit}`;
  }

  function renderSummary(s: WorkoutStats, z: ZoneTimes) {
    const f = ftp();
    const cell = (k: string, v: string, h: string, d = '', small = '') =>
      el(
        'div',
        { title: h },
        el('div', { className: 'k', textContent: k }),
        el('div', { className: 'v' }, v, small ? el('small', { textContent: ` ${small}` }) : '', d ? el('span', { className: 'delta', textContent: d }) : ''),
      );
    $('ed-summary').replaceChildren(
      cell('Durée', fmtLong(s.durationS), `dont ${fmtLong(effortSeconds(z))} d'effort`, delta(s.durationS / 60, session.baseStats && session.baseStats.durationS / 60, 0, ' min')),
      cell('Moyenne', `${s.avgW} W`, `${Math.round((s.avgW / f) * 100)} % de ta FTP (${f} W)`, delta(s.avgW, session.baseStats?.avgW)),
      cell('Intensité', s.intensity.toFixed(2).replace('.', ','), '1,00 = tenir sa FTP', delta(s.intensity, session.baseStats?.intensity, 2), intensityWord(s.intensity)),
      cell('Charge', String(s.load), '1 h à la FTP = 100', delta(s.load, session.baseStats?.load)),
    );
  }

  function renderChart(w: Workout, f: number) {
    const peak = profilePeakW(w, f);
    const y = (watts: number) => H - (watts / peak) * H;
    const top = (watts: number) => `${(1 - watts / peak) * 100}%`;
    const total = w.steps.reduce((t, s) => t + s.durationS, 0) || 1;

    // Axe vertical : % de FTP et watts, FTP en gras.
    const yaxis = $('ed-yaxis');
    yaxis.replaceChildren(
      ...[
        [peak, `${Math.round((peak / f) * 100)} % · ${Math.round(peak)} W`, ''],
        [f, `FTP · ${f} W`, 'ftp'],
        [0.75 * f, `75 % · ${Math.round(0.75 * f)} W`, ''],
        [0.5 * f, `50 % · ${Math.round(0.5 * f)} W`, ''],
        [0, '0', ''],
      ].map(([watts, label, cls]) => {
        const s = el('span', { textContent: label as string, className: cls as string });
        s.style.top = top(watts as number);
        return s;
      }),
    );

    // Bandes de zones, puis paliers, ligne de FTP et cadre du bloc sélectionné.
    const root = $('ed-svg');
    const bands = svg('g', {});
    const labels: HTMLElement[] = [];
    const selZone = selectedZone();
    ZONES.forEach((z, i) => {
      const lo = z.from * f;
      const hi = Math.min(peak, (ZONES[i + 1]?.from ?? Infinity) * f);
      if (lo >= peak) return;
      bands.append(svg('rect', { x: 0, y: y(hi), width: W, height: y(lo) - y(hi), fill: `var(--${z.id})`, 'fill-opacity': 0.1 }));
      const label = el('span', { textContent: z.name, className: z.id === selZone ? 'on' : '' });
      label.style.top = top((lo + hi) / 2);
      labels.push(label);
    });
    $('ed-zone-labels').replaceChildren(...labels);

    const bars = svg('g', { class: 'ed-svg-bars' });
    for (const s of profileShapes(w, f, W, H)) bars.append(svg('path', { d: s.d, class: s.zone }));
    const ftpLine = svg('line', { x1: 0, x2: W, y1: y(f), y2: y(f), stroke: 'currentColor', 'stroke-opacity': 0.55, 'stroke-dasharray': '8 6', 'vector-effect': 'non-scaling-stroke' });
    root.replaceChildren(bands, bars, ftpLine);
    const r = blockRanges(session.draft!.blocks)[session.selected];
    if (r) {
      root.append(
        svg('rect', {
          x: (r.start / total) * W,
          y: 0.5,
          width: ((r.end - r.start) / total) * W,
          height: H - 1,
          fill: 'none',
          stroke: 'var(--accent)',
          'stroke-width': 2,
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }
    root.setAttribute('aria-label', `Profil de la séance, ${session.draft!.blocks.length} blocs, ${fmtLong(total)}`);

    $('ed-xaxis').replaceChildren(...[0, 0.25, 0.5, 0.75, 1].map((k) => el('span', { textContent: fmtLong(Math.round(k * total)) })));
  }

  function selectedZone(): Zone | undefined {
    const b = session.draft?.blocks[session.selected];
    if (!b || b.type === 'free') return undefined;
    const main = b.type === 'steady' ? b.power : b.type === 'intervals' ? b.onPower : (b.from + b.to) / 2;
    return zoneOf(main);
  }

  /**
   * Barre du bloc sélectionné, sous le profil : le profil montre déjà tous les blocs, en couleur, et se touche pour en
   * choisir un ; cette barre en donne le nom et le détail, la place (3/9), permet de passer au précédent ou au suivant,
   * et porte la poignée qui le déplace (voir plus bas).
   */
  function renderBlockBar() {
    const blocks = session.draft!.blocks;
    const b = blocks[session.selected];
    $('ed-bbar').hidden = !b;
    if (!b) return;
    $('bb-name').textContent = BLOCK_LABEL[b.type];
    $('bb-short').textContent = blockShort(b);
    $('bb-pos').textContent = `${session.selected + 1}/${blocks.length}`;
    const main = b.type === 'free' ? undefined : b.type === 'steady' ? b.power : b.type === 'intervals' ? b.onPower : (b.from + b.to) / 2;
    $('bb-main').style.borderLeftColor = main === undefined ? 'var(--muted)' : `var(--${zoneOf(main)})`;
    $<HTMLButtonElement>('bb-prev').disabled = session.selected === 0;
    $<HTMLButtonElement>('bb-next').disabled = session.selected >= blocks.length - 1;
    $('bb-handle').hidden = blocks.length < 2;
  }

  // --- Étagère de blocs préfaits : onglets, cartes, « Mes blocs », glisser sur le profil (block-shelf.ts) ---

  const shelf = new BlockShelf({ session, blocks: o.blocks, ftp, log: o.log, say, plot, overlay });
  const renderShelf = () => shelf.render();
  const saveAsBlock = (b: EditorBlock) => shelf.saveAsBlock(b);

  /**
   * Téléphone : la barre du bloc sélectionné monte dans l'en-tête, à côté du titre, et l'étagère occupe le bas.
   * Ailleurs, elle reste sous le profil.
   */
  const barEl = $('ed-bbar');
  function placeBar() {
    const target = PHONE.matches ? document.querySelector<HTMLElement>('.sea-hero-row')! : document.querySelector<HTMLElement>('.ed-srow')!;
    if (barEl.parentElement !== target) target.prepend(barEl);
  }
  PHONE.addEventListener('change', placeBar);

  // --- Déplacer un bloc : on tient la poignée de la barre et on la fait glisser sur le profil (block-mover.ts) ---

  new BlockMover({ session, handle: $('bb-handle'), plot, overlay });
  $('bb-prev').addEventListener('click', () => select(session.selected - 1));
  $('bb-next').addEventListener('click', () => select(session.selected + 1));

  // --- Ligne de réglages du bloc sélectionné ---

  /** Champ de puissance en % avec boutons ±5 % ; `key` sert à rendre le focus après redessin. */
  function powerStepper(label: string, value: number, set: (v: number) => void, key: string) {
    const input = el('input', { type: 'number', value: String(pct(value)), min: '1', max: '300', step: '1' });
    input.setAttribute('aria-label', `${label}, en % de la FTP`);
    input.dataset.key = `${key}-in`;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      const ok = input.value.trim() !== '' && v > 0 && v <= 300;
      input.classList.toggle('invalid', !ok);
      if (!ok) return;
      liveEdit(() => set(v / 100));
    });
    const step = (d: number) => {
      const b = el('button', { type: 'button', textContent: d > 0 ? '+' : '−' });
      b.setAttribute('aria-label', `${label} ${d > 0 ? 'plus' : 'moins'} 5 %`);
      b.dataset.key = `${key}-${d > 0 ? 'up' : 'down'}`;
      b.addEventListener('click', () => {
        // Part de ce qui est affiché : une valeur tapée juste avant n'a pas encore redessiné le champ.
        const typed = Number(input.value) / 100;
        const base = input.value.trim() !== '' && typed > 0 ? typed : value;
        commitSet(set, Math.min(3, Math.max(0.05, Math.round((base + d) * 100) / 100)));
      });
      return b;
    };
    // La vraie valeur, à côté du pourcentage : elle suit la frappe (voir refreshInspectorText).
    const watts = el('span', { className: 'watts', textContent: `${Math.round(value * ftp())} W` });
    watts.dataset.power = key;
    return el('div', { className: 'stepper' }, step(-POWER_STEP), input, el('span', { textContent: '%' }), step(POWER_STEP), watts);
  }

  /** Les setters écrivent dans le bloc sélectionné du brouillon : on le copie d'abord, l'historique garde l'original. */
  const commitSet = (set: (v: number) => void, v: number) => session.commitSet(set, v);

  function durationField(label: string, value: number, set: (v: number) => void, key: string) {
    const input = el('input', { type: 'text', value: formatDuration(value), inputMode: 'numeric', placeholder: 'mm:ss' });
    input.setAttribute('aria-label', label);
    input.dataset.key = key;
    input.addEventListener('input', () => {
      const v = parseDuration(input.value);
      input.classList.toggle('invalid', v === undefined || v < 1);
      if (v === undefined || v < 1) return;
      liveEdit(() => set(v));
    });
    return el('label', { className: 'dur' }, label.split(' ')[0]!.toLowerCase(), input);
  }

  function countStepper(value: number, set: (v: number) => void) {
    const input = el('input', { type: 'number', value: String(value), min: '1', step: '1' });
    input.setAttribute('aria-label', 'Répétitions');
    input.dataset.key = 'rep-in';
    input.addEventListener('input', () => {
      const v = Number(input.value);
      const ok = Number.isInteger(v) && v >= 1 && v <= 50;
      input.classList.toggle('invalid', !ok);
      if (ok) liveEdit(() => set(v));
    });
    const step = (d: number) => {
      const b = el('button', { type: 'button', textContent: d > 0 ? '+' : '−' });
      b.setAttribute('aria-label', d > 0 ? 'Une répétition de plus' : 'Une répétition de moins');
      b.dataset.key = `rep-${d > 0 ? 'up' : 'down'}`;
      b.addEventListener('click', () => updateSelected((x) => (x.type === 'intervals' ? { ...x, repeat: Math.max(1, Math.min(50, x.repeat + d)) } : x)));
      return b;
    };
    return el('div', { className: 'stepper' }, step(-1), input, step(1));
  }

  /** Frappe dans un champ : on modifie le brouillon en place et on redessine tout sauf la ligne de réglages. */
  function liveEdit(apply: () => void) {
    if (!session.draft || session.draft.readOnly) return;
    if (!session.typing) {
      session.history.record(session.draft.blocks);
      session.typing = true;
    }
    apply();
    render(true);
  }

  /** Légende « Effort · Seuil » ; la zone est omise quand elle répète le nom (« Récupération · Récupération »). */
  const legendText = (name: string, zone?: string) => (zone && zone !== name ? `${name} · ${zone}` : name);

  function fieldset(name: string, zone: string | undefined, main: boolean, ...children: Node[]) {
    const f = el('fieldset', { className: main ? 'main' : '' }, el('legend', { textContent: legendText(name, zone) }), ...children);
    f.dataset.legend = name;
    return f;
  }

  /** Actions du bloc sélectionné : cadence, déplacer, dupliquer, séparer, enregistrer comme bloc, supprimer. */
  function blockActions(b: EditorBlock, keyed: boolean): HTMLElement {
    const actions = el('div', { className: 'actions' });
    if (b.type !== 'free') {
      const c = b.cadenceRpm;
      actions.append(button(c ? `${c} rpm…` : 'Cadence…', openCadence, 'secondary'));
      actions.lastElementChild!.setAttribute('title', 'Cadence cible du bloc (facultative)');
      actions.lastElementChild!.classList.add('act-cadence');
    }
    actions.append(
      button('← Avant', () => moveSelected(-1), 'secondary'),
      button('Après →', () => moveSelected(1), 'secondary'),
      button('Dupliquer', () => commit((bs) => [...bs.slice(0, session.selected + 1), structuredClone(b), ...bs.slice(session.selected + 1)], session.selected + 1), 'secondary'),
    );
    if (b.type === 'intervals') {
      const split = button('Séparer', () => commit((bs) => [...bs.slice(0, session.selected), ...splitIntervals(b), ...bs.slice(session.selected + 1)]), 'secondary');
      split.title = 'Séparer les répétitions en blocs individuels';
      actions.append(split);
    }
    const keep = button('Enregistrer comme bloc', () => saveAsBlock(b), 'secondary');
    keep.title = 'Le ranger dans « Mes blocs », sur l’étagère';
    actions.append(keep, button('Supprimer', deleteSelected, 'secondary danger'));
    if (keyed) actions.querySelectorAll('button').forEach((x, i) => (x.dataset.key = `act-${i}`));
    const [before, after] = [...actions.querySelectorAll('button')].filter((x) => /Avant|Après/.test(x.textContent ?? ''));
    if (before) setBlocked(before, session.selected === 0 ? 'C’est déjà le premier bloc.' : undefined);
    if (after) setBlocked(after, session.selected === session.draft!.blocks.length - 1 ? 'C’est déjà le dernier bloc.' : undefined);
    // Sur téléphone, ces actions vivent dans le menu « ⋯ » : une action faite, il se referme.
    actions.addEventListener('click', () => setPanel());
    return actions;
  }

  function renderInspector() {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
    const b = session.draft!.blocks[session.selected];
    if (!b) {
      inspector.replaceChildren(el('p', { className: 'note', textContent: 'Aucun bloc : ajoute-en depuis l’étagère.' }));
      $('ed-bactions').replaceChildren();
      return;
    }
    const f = ftp();
    const cur = () => session.draft!.blocks[session.selected]!;
    const set = <K extends string>(k: K) => (v: number) => ((cur() as unknown as Record<K, number>)[k] = v);
    const z = (p: number) => zoneName(zoneOf(p));

    const actions = blockActions(b, true);

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
          fieldset('Répétitions', undefined, false, countStepper(b.repeat, set('repeat'))),
          fieldset('Effort', z(b.onPower), true, powerStepper('Effort', b.onPower, set('onPower'), 'on'), durationField('Durée de l’effort', b.onS, set('onS'), 'on-dur')),
          fieldset('Récupération', z(b.offPower), false, powerStepper('Récupération', b.offPower, set('offPower'), 'off'), durationField('Durée de la récupération', b.offS, set('offS'), 'off-dur')),
        );
        break;
      }
      case 'steady':
        line.append(fieldset('Puissance', z(b.power), true, powerStepper('Puissance', b.power, set('power'), 'p'), durationField('Durée du palier', b.durationS, set('durationS'), 'dur')));
        break;
      case 'warmup':
      case 'cooldown':
      case 'ramp':
        line.append(
          fieldset('Début', z(b.from), true, powerStepper('Début', b.from, set('from'), 'from'), durationField('Durée du bloc', b.durationS, set('durationS'), 'dur')),
          fieldset('Fin', z(b.to), false, powerStepper('Fin', b.to, set('to'), 'to')),
        );
        break;
      case 'free':
        line.append(fieldset('Libre', 'sans consigne', true, durationField('Durée du bloc', b.durationS, set('durationS'), 'dur')));
        break;
    }

    const sentence = el('p', { className: 'sentence', textContent: describeBlock(b, f) });
    if (b.type === 'intervals') sentence.title = `Les ${b.repeat} répétitions sont modifiées ensemble`;
    // Sur téléphone, l'inspecteur est une feuille (bouton ⋯ sous le profil) : titre et bouton Fermer en tête.
    const close = el('button', { type: 'button', className: 'sheet-x', textContent: 'Fermer' });
    close.dataset.openPanel = '';
    const head = el('div', { className: 'sheet-head' }, el('strong', { textContent: `${BLOCK_LABEL[b.type]} · bloc ${session.selected + 1} sur ${session.draft!.blocks.length}` }), close);
    // Sur téléphone, l'inspecteur n'est plus qu'un menu d'actions : une action faite, il se referme.
    inspector.replaceChildren(head, sentence, el('div', { className: 'ed-body' }, line, actions));
    $('ed-bactions').replaceChildren(blockActions(b, false)); // le même menu, dans le « ⋯ » de l'en-tête (téléphone)
    if (active) inspector.querySelector<HTMLElement>(`[data-key="${active}"]`)?.focus();
  }

  /** Pendant la frappe : la phrase et les zones des légendes suivent, sans reconstruire les champs. */
  function refreshInspectorText() {
    const b = session.draft!.blocks[session.selected];
    if (!b) return;
    const sentence = inspector.querySelector('.sentence');
    if (sentence) sentence.textContent = describeBlock(b, ftp());
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
    inspector.querySelectorAll<HTMLElement>('.watts[data-power]').forEach((w) => {
      const v = power[w.dataset.power!];
      if (v !== undefined) w.textContent = `${Math.round(v * ftp())} W`;
    });
    inspector.querySelectorAll<HTMLFieldSetElement>('fieldset[data-legend]').forEach((fs) => {
      const zone = legends[fs.dataset.legend!];
      if (zone) fs.querySelector('legend')!.textContent = legendText(fs.dataset.legend!, zone);
    });
  }

  function moveSelected(d: number) {
    const j = session.selected + d;
    if (!session.draft || j < 0 || j >= session.draft.blocks.length) return;
    commit((bs) => {
      const c = [...bs];
      [c[session.selected], c[j]] = [c[j]!, c[session.selected]!];
      return c;
    }, j);
  }

  function deleteSelected() {
    if (!session.draft?.blocks.length) return;
    commit((bs) => bs.filter((_, i) => i !== session.selected), session.selected);
  }

  // --- Temps par zone ---

  /** Une ligne : barre de répartition, puis le temps passé dans chaque zone. Le détail (écarts, lecture) est en info-bulle. */
  function renderZones(z: ZoneTimes) {
    const total = Object.values(z).reduce((a, b) => a + b, 0) || 1;
    const ids = [...ZONES.map((x) => x.id), 'free'] as Zone[];
    const color = (id: Zone) => (id === 'free' ? 'var(--muted)' : `var(--${id})`);
    const bar = el('div', { className: 'zone-bar' });
    bar.setAttribute('aria-hidden', 'true');
    for (const id of ids) {
      if (!z[id]) continue;
      const s = el('span');
      s.style.width = `${(z[id] / total) * 100}%`;
      s.style.background = color(id);
      bar.append(s);
    }
    const items = ids
      .filter((id) => z[id] || session.baseZones?.[id])
      .sort((a, b) => z[b] - z[a])
      .map((id) => {
        const swatch = el('i');
        swatch.style.background = color(id);
        const was = session.baseZones && session.baseZones[id] !== z[id] ? ` (avant : ${formatDuration(session.baseZones[id])})` : '';
        return el('li', { title: `${zoneName(id)}${was}` }, swatch, `${zoneName(id)} `, el('strong', { textContent: formatDuration(z[id]) }));
      });
    const parts = [el('span', { className: 'k', textContent: 'Zones' }), bar, el('ul', {}, ...items)];
    for (const id of ['ed-zones', 'ed-zones-m']) {
      $(id).title = zoneReading(z, formatDuration);
      $(id).replaceChildren(...parts.map((n) => n.cloneNode(true)));
    }
  }

  // --- Info-bulle et sélection sur le profil ---

  function timeAt(e: MouseEvent): number {
    const r = plot.getBoundingClientRect();
    const total = workout().steps.reduce((t, s) => t + s.durationS, 0);
    return Math.max(0, Math.min(total - 0.001, ((e.clientX - r.left) / r.width) * total));
  }

  plot.addEventListener('mousemove', (e) => {
    if (!session.draft?.blocks.length) return;
    const t = timeAt(e);
    const bi = blockIndexAt(session.draft.blocks, t);
    const b = session.draft.blocks[bi]!;
    const range = blockRanges(session.draft.blocks)[bi]!;
    const w = workout();
    let acc = 0;
    let stepLeft = 0;
    let watts: number | undefined;
    for (const s of w.steps) {
      if (t < acc + s.durationS) {
        watts = targetWatts(s, t - acc, ftp());
        stepLeft = acc + s.durationS - t;
        break;
      }
      acc += s.durationS;
    }
    let what: string = BLOCK_LABEL[b.type];
    if (b.type === 'intervals') {
      const inRep = t - range.start;
      const rep = Math.floor(inRep / (b.onS + b.offS)) + 1;
      what = `${inRep % (b.onS + b.offS) < b.onS ? 'effort' : 'récupération'} ${rep} sur ${b.repeat}`;
    }
    const f = ftp();
    tip.replaceChildren(
      el('strong', { textContent: formatDuration(Math.floor(t)) }),
      ` · ${what}`,
      el('br'),
      watts === undefined ? 'sans consigne' : `${watts} W · ${Math.round((watts / f) * 100)} % · ${zoneName(zoneOf(watts / f))}`,
      el('br'),
      el('span', { className: 'muted', textContent: `encore ${formatDuration(Math.ceil(stepLeft))} dans ce palier` }),
    );
    tip.hidden = false;
    const r = plot.getBoundingClientRect();
    const x = e.clientX - r.left;
    tip.style.left = x > r.width * 0.6 ? '' : `${x + 12}px`;
    tip.style.right = x > r.width * 0.6 ? `${r.width - x + 12}px` : '';
  });
  plot.addEventListener('mouseleave', () => (tip.hidden = true));
  plot.addEventListener('click', (e) => {
    if (session.draft?.blocks.length) select(blockIndexAt(session.draft.blocks, timeAt(e)));
  });

  // --- Saisie d'une valeur exacte et commandes posées sur le bloc, au toucher (téléphone en paysage) : phone-controls.ts ---

  const phoneControls = new PhoneBlockControls({ session, ftp, plot, overlay, phone: PHONE, setPanel });
  const renderOverlay = () => phoneControls.render();

  // --- Clavier ---

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sea.dataset.panel && editor.offsetParent !== null) setPanel();
    if (!session.draft || editor.offsetParent === null || isTyping(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    // Annuler et rétablir valent partout ; flèches et Suppr n'agissent sur les blocs que hors bibliothèque, étagère et navigation.
    if (ctrl || e.altKey || isElsewhere(e.target)) return;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        updateSelected((b) => nudgePower(b, e.key === 'ArrowUp' ? POWER_STEP : -POWER_STEP));
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const d = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey) updateSelected((b) => nudgeDuration(b, d * DURATION_STEP_S));
        else select(session.selected + d);
        break;
      }
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        deleteSelected();
        break;
    }
  });

  // --- Cadence cible (option, hors de la ligne de réglages) ---

  function openCadence() {
    const b = session.draft?.blocks[session.selected];
    if (!b || b.type === 'free') return;
    $('ed-cad-on-label').textContent = b.type === 'intervals' ? 'Effort' : 'Cadence';
    $<HTMLInputElement>('ed-cad-on').value = b.cadenceRpm ? String(b.cadenceRpm) : '';
    $('ed-cad-off-row').hidden = b.type !== 'intervals';
    $<HTMLInputElement>('ed-cad-off').value = b.type === 'intervals' && b.restCadenceRpm ? String(b.restCadenceRpm) : '';
    cadenceDialog.showModal();
  }

  const readRpm = (id: string) => {
    const v = Math.round(Number($<HTMLInputElement>(id).value));
    return v >= 30 && v <= 200 ? v : undefined;
  };
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
  $('ed-cad-apply').addEventListener('click', () => {
    updateSelected((b) => withCadence(b, readRpm('ed-cad-on'), readRpm('ed-cad-off')));
    cadenceDialog.close();
  });
  $('ed-cad-clear').addEventListener('click', () => {
    updateSelected((b) => withCadence(b));
    cadenceDialog.close();
  });

  for (const d of [cadenceDialog]) {
    d.querySelector('[data-close]')?.addEventListener('click', () => d.close());
  }

  // --- Branchements ---

  nameIn.addEventListener('input', () => {
    if (!session.draft || session.draft.readOnly) return;
    session.draft.name = nameIn.value;
    $('ed-dirty').hidden = !isDirty();
    // Un brouillon est montré dans la bibliothèque sous son nom : on le tient à jour sans reconstruire la liste.
    const row = document.querySelector('.sea-lib [data-key="draft"] strong');
    if (row) row.textContent = session.draft.name || 'Séance sans nom';
  });
  descIn.addEventListener('input', () => {
    if (!session.draft || session.draft.readOnly) return;
    session.draft.description = descIn.value;
    $('ed-dirty').hidden = !isDirty();
  });
  // Fin d'une frappe : la prochaine saisie ouvrira une nouvelle entrée d'historique, et les champs reprennent leur forme normale.
  inspector.addEventListener('focusout', () => {
    if (!session.typing) return;
    session.typing = false;
    setTimeout(() => {
      if (!inspector.contains(document.activeElement)) render();
    });
  });
  inspector.addEventListener('submit', (e) => e.preventDefault());

  $('ed-undo').addEventListener('click', undo);
  $('ed-redo').addEventListener('click', redo);
  $('ed-del').addEventListener('click', deleteSelected); // téléphone : sans passer par le menu « ⋯ » (annulable)
  $('ed-undo2').addEventListener('click', undo);
  $('ed-redo2').addEventListener('click', redo);
  // Boutons de panneau (téléphone) : un second tap referme ; le voile referme aussi.
  sea.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-open-panel]');
    if (!t) return;
    const next = t.dataset.openPanel ?? '';
    setPanel(next && sea.dataset.panel === next ? '' : next);
  });
  $('lib-new').addEventListener('click', () =>
    open({ name: 'Nouvelle séance', description: '', blocks: [defaultBlock('warmup'), defaultBlock('intervals'), defaultBlock('cooldown')] }, true),
  );
  $('lib-search').addEventListener('input', renderLibrary);
  const importIn = $<HTMLInputElement>('lib-import');
  $('lib-import-btn').addEventListener('click', () => importIn.click());
  importIn.addEventListener('change', async () => {
    const f = importIn.files?.[0];
    if (f) openFromWorkoutFile(f.name, await f.text());
    importIn.value = '';
  });
  $('ed-save').addEventListener('click', () => {
    setPanel();
    void save();
  });
  $('ed-copy').addEventListener('click', () => {
    setPanel();
    session.duplicateModel();
  });
  $('ed-ride').addEventListener('click', () => {
    if (!session.draft) return;
    if (session.draft.readOnly) return o.onRide(`sample:${session.draft.sampleId}`);
    const id = save();
    if (id) o.onRide(`lib:${id}`);
  });
  $('ed-export').addEventListener('click', () => {
    setPanel();
    if (session.draft) download(`${slug(session.draft.name)}.zwo`, toZwo(session.draft.name, session.draft.description, session.draft.blocks));
  });
  addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault();
  });

  renderLibrary();
  renderShelf();
  placeBar();

  return {
    /** À appeler à chaque arrivée sur l'écran : ouvre la séance choisie dans l'application. */
    sync,
    /** À appeler quand la connexion du trainer ou la séance en cours change : « Rouler » en dépend. */
    refreshRide: () => renderRide(),
    /** À appeler quand la FTP change : les watts affichés en dépendent. */
    refresh() {
      // Un modèle en watts se relit avec la nouvelle FTP : la session le rouvre. Sinon on redessine seulement.
      if (!session.reopenModel()) {
        renderLibrary();
        if (session.draft) render();
      }
      renderShelf();
    },
    /**
     * Séances ou blocs changés depuis un autre appareil (synchronisation du compte). Une séance ouverte sans
     * modification suit la nouvelle version, ou laisse la place si elle a été supprimée ; un brouillon modifié reste
     * tel quel : l'enregistrer en fera la version la plus récente.
     */
    libraryChanged() {
      session.adoptLibraryChange();
      renderLibrary();
      renderShelf();
    },
  };
}
