import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './recap.css';
import type { StravaOutcome, StravaReadiness } from '../export/wiring';
import { formatDuration } from './duration';
import { POWER_ZONES, type RecapSummary } from './recap-model';
import { zoneOf } from '../workout/profile';

/**
 * Écran récapitulatif de fin de sortie (docs/design/recap.md) : une boîte de dialogue modale posée sur l'écran Sortie.
 * Grand écran : carte « Ligne d'arrivée » sur la scène floutée. Téléphone couché : « Bilan » plein écran.
 * Si Strava est connecté, l'envoi part seul au bout du compte à rebours ; « Continuer » ne l'annule pas.
 */

/** Durée du compte à rebours avant l'envoi automatique à Strava. */
export const COUNTDOWN_S = 8;

export interface RecapContent {
  summary: RecapSummary;
  /** « Séance terminée » ou « Sortie terminée ». */
  eyebrow: string;
  title: string;
  /** Lieu de la sortie (nom du parcours), avant la date. */
  place: string;
  startMs: number;
  defaultName: string;
  strava: StravaReadiness;
  /** La sortie roule encore : « Continuer à rouler » ; sinon « Reprendre la sortie ». */
  rideRunning: boolean;
}

export interface RecapActions {
  send(name: string): Promise<StravaOutcome>;
  downloadFit(): void;
  /** Le récapitulatif est fermé par « Continuer » ou Échap. */
  onContinue(): void;
  /** « Terminer » : arrêter la sortie et revenir à l'accueil. */
  onFinish(): void;
}

type State = 'countdown' | 'manual' | 'sending' | 'sent' | 'error' | 'none';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART_W = 1000;
const CHART_H = 200;

const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>',
  ride: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M13 5h3"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14L20 4M14 4h6v6M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5v.5M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>',
};

const stat = (key: string, label: string, unit = '') =>
  `<div class="rc-stat"><span class="rc-lab">${label}</span><span class="rc-num"><span data-r="${key}">–</span>${unit ? `<span class="rc-unit">${unit}</span>` : ''}</span></div>`;
const tile = (key: string, label: string, unit = '') =>
  `<div class="rc-tile"><span class="rc-lab">${label}</span><span class="rc-num"><span data-r="${key}">–</span>${unit ? `<span class="rc-unit">${unit}</span>` : ''}</span></div>`;

// Gabarit statique : aucune donnée de l'utilisateur ici (nom de séance compris), tout passe ensuite par textContent.
const TEMPLATE = `
<div class="rc-card">
  <header class="rc-head">
    <div class="rc-titles">
      <p class="rc-eyebrow">${ICON.check}<span data-r="eyebrow"></span></p>
      <h2 id="rc-title"><span class="rc-kicker">Bilan</span><span data-r="title"></span></h2>
      <p class="rc-when" data-r="when"></p>
    </div>
    <span class="rc-chip" data-r="chip" hidden></span>
    <p class="rc-meta" data-r="meta"></p>
  </header>

  <div class="rc-big">
    ${stat('duration', 'Durée')}
    ${stat('distance', 'Distance', 'km')}
    ${stat('avgPower', 'Puissance moy.', 'W')}
    ${stat('tss', 'Charge (TSS)')}
  </div>
  <p class="rc-more" data-r="more"></p>

  <figure class="rc-chart">
    <svg data-r="chart" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" role="img"></svg>
    <figcaption class="rc-axis"><span>0:00</span><span class="rc-legend" data-r="legend"></span><span data-r="end"></span></figcaption>
    <div class="rc-zbar" data-r="zbar" aria-hidden="true"></div>
    <p class="rc-zlegend" data-r="zlegend"></p>
  </figure>

  <div class="rc-grid">
    ${tile('tAvg', 'P moy.', 'W')}
    ${tile('tNp', 'NP', 'W')}
    ${tile('tTss', 'TSS')}
    ${tile('tIf', 'IF')}
    ${tile('tKj', 'Travail', 'kJ')}
    ${tile('tCad', 'Cadence')}
    ${tile('tHr', 'FC moy.')}
    ${tile('tHrMax', 'FC max')}
    <div class="rc-tile rc-tile-last" data-r="lastTile"></div>
  </div>

  <footer class="rc-actions" data-r="actions">
    <div class="rc-status" data-r="status" role="status">
      <span class="rc-badge" data-r="badge"></span>
      <span class="rc-status-text"><b data-r="statusTitle"></b><span data-r="statusSub"></span></span>
    </div>
    <button type="button" class="rc-send" data-r="send">
      ${ICON.upload}<span data-r="sendLabel">Envoyer à Strava</span>
      <span class="rc-count" data-r="count"><span class="rc-count-long">envoi seul dans <span data-r="secs"></span> s</span><span class="rc-count-short"><span data-r="secs2"></span> s</span></span>
      <span class="rc-drain" data-r="drain" aria-hidden="true"></span>
    </button>
    <a class="rc-ghost rc-view" data-r="view" target="_blank" rel="noopener">${ICON.out}<span>Voir sur Strava</span></a>
    <button type="button" class="rc-ghost rc-continue" data-r="continue">${ICON.ride}<span data-r="continueLabel">Continuer à rouler</span></button>
    <div class="rc-bottom">
      <div class="rc-name" data-r="nameRow">
        <label for="rc-name">Nom sur Strava</label>
        <input id="rc-name" type="text" maxlength="200" autocomplete="off" spellcheck="false" data-r="name" />
      </div>
      <div class="rc-tools">
        <button type="button" class="rc-link" data-r="skip">Ne pas envoyer</button>
        <button type="button" class="rc-link" data-r="finish"><span>Terminer<span class="rc-long">, retour à l’accueil</span></span></button>
        <button type="button" class="rc-link rc-fit" data-r="fit">${ICON.download}<span>FIT</span></button>
      </div>
    </div>
  </footer>
</div>`;

const fmtNum = (x: number | undefined, digits = 0) =>
  x === undefined ? '–' : x.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function setupRecap(dialog: HTMLDialogElement, actions: RecapActions) {
  dialog.classList.add('recap');
  dialog.setAttribute('aria-labelledby', 'rc-title');
  dialog.innerHTML = TEMPLATE;
  const el = <T extends Element = HTMLElement>(k: string) => dialog.querySelector(`[data-r="${k}"]`) as T;
  const set = (k: string, text: string) => (el(k).textContent = text);

  const sendBtn = el<HTMLButtonElement>('send');
  const nameInput = el<HTMLInputElement>('name');
  const actionsEl = el('actions');
  const viewLink = el<HTMLAnchorElement>('view');
  const drain = el('drain');
  drain.style.animationDuration = `${COUNTDOWN_S}s`;

  let state: State = 'none';
  let content: RecapContent | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let left = 0;

  function setState(s: State, info?: { title?: string; sub?: string; url?: string }) {
    state = s;
    actionsEl.dataset.state = s;
    sendBtn.disabled = s === 'sending';
    set(
      'sendLabel',
      s === 'sending' ? 'Envoi…' : content?.strava === 'login' ? 'Connecter Strava et envoyer' : s === 'error' ? 'Réessayer' : 'Envoyer à Strava',
    );
    el('count').hidden = s !== 'countdown';
    drain.classList.toggle('run', s === 'countdown');
    el('badge').innerHTML = s === 'error' ? ICON.warn : ICON.check;
    set('statusTitle', info?.title ?? '');
    set('statusSub', info?.sub ?? '');
    if (info?.url) viewLink.href = info.url;
    else viewLink.removeAttribute('href');
    // Ce qui ne sert pas dans l'état courant est masqué ; la disposition suit `data-state` (recap.css).
    const show: Record<string, State[]> = {
      status: ['sent', 'error'],
      send: ['countdown', 'manual', 'sending', 'error'],
      view: info?.url ? ['sent'] : [],
      nameRow: ['countdown', 'manual', 'error'],
      skip: ['countdown'],
      // Sortie déjà arrêtée : « Terminer » reste proposé partout, sinon fermer obligerait à la relancer.
      finish: content?.rideRunning ? ['sent', 'none'] : ['countdown', 'manual', 'sending', 'sent', 'error', 'none'],
    };
    for (const [k, states] of Object.entries(show)) el(k).hidden = !states.includes(s);
    // Échec définitif (Strava a refusé le fichier) : plus d'envoi possible, mais le message reste affiché.
    if (s === 'none' && info?.title) el('status').hidden = false;
  }

  const stopCountdown = () => {
    clearInterval(timer);
    timer = undefined;
  };

  function tick() {
    set('secs', String(left));
    set('secs2', String(left));
    if (left <= 0) {
      stopCountdown();
      void doSend();
    }
    left--;
  }

  /** Arrête le compte à rebours sans envoyer : l'envoi attend un geste. */
  function holdCountdown() {
    if (state !== 'countdown') return;
    stopCountdown();
    setState('manual');
  }

  async function doSend() {
    if (!content || state === 'sending' || state === 'sent') return;
    stopCountdown();
    setState('sending');
    const out = await actions.send(nameInput.value.trim() || content.defaultName);
    if (out.ok) {
      setState('sent', {
        title: out.processing ? `Reçue par Strava à ${fmtClock(Date.now())}` : `Envoyée sur Strava à ${fmtClock(Date.now())}`,
        sub: out.processing ? `${out.name} · traitement en cours chez Strava` : out.name,
        ...(out.activityUrl ? { url: out.activityUrl } : {}),
      });
    } else {
      // Accès Strava perdu : le bouton dit qu'il rouvrira la connexion, pas seulement « Réessayer ».
      if (out.login) content.strava = 'login';
      setState(out.kept ? 'error' : 'none', { title: out.login ? 'Connexion Strava à refaire' : 'Envoi impossible', sub: out.message });
    }
  }

  sendBtn.addEventListener('click', () => void doSend());
  el('skip').addEventListener('click', holdCountdown);
  el('fit').addEventListener('click', () => {
    holdCountdown();
    actions.downloadFit();
  });
  // Modifier le nom suspend l'envoi automatique : il partira d'un geste, sous le nom choisi.
  nameInput.addEventListener('input', holdCountdown);
  nameInput.addEventListener('pointerdown', holdCountdown);

  /** Fermer par « Continuer » ou Échap n'annule pas un envoi programmé : il part tout de suite. */
  function leave(then: () => void) {
    if (state === 'countdown') void doSend();
    stopCountdown();
    if (dialog.open) dialog.close();
    then();
  }
  el('continue').addEventListener('click', () => leave(actions.onContinue));
  el('finish').addEventListener('click', () => leave(actions.onFinish));
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    leave(actions.onContinue);
  });

  function drawChart(s: RecapSummary) {
    const svg = el<SVGSVGElement>('chart');
    svg.replaceChildren();
    const n = s.chart.length;
    if (!n) return;
    const bw = CHART_W / n;
    const y = (w: number) => +(CHART_H - (w / s.chartPeakW) * CHART_H).toFixed(1);
    const withTarget = s.chart.some((b) => b.targetW !== undefined);
    // Séance : la consigne en blocs de couleur de zone, comme le profil de séance du HUD ; sortie libre : la puissance elle-même.
    // Les points voisins de même valeur (un palier constant) forment un seul bloc : pas de filet entre deux tranches.
    const runs: { from: number; to: number; v: number }[] = [];
    s.chart.forEach((b, i) => {
      const v = withTarget ? b.targetW : b.powerW;
      if (v === undefined) return;
      const last = runs.at(-1);
      if (last && last.to === i && Math.abs(last.v - v) <= 1) last.to = i + 1;
      else runs.push({ from: i, to: i + 1, v });
    });
    for (const run of runs) {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', (run.from * bw).toFixed(1));
      r.setAttribute('y', String(y(run.v)));
      r.setAttribute('width', ((run.to - run.from) * bw + 0.6).toFixed(1)); // léger recouvrement avec le bloc suivant
      r.setAttribute('height', (CHART_H - y(run.v)).toFixed(1));
      r.setAttribute('class', zoneOf(run.v / s.ftpW));
      r.setAttribute('shape-rendering', 'crispEdges');
      svg.append(r);
    }
    const ftp = document.createElementNS(SVG_NS, 'line');
    ftp.setAttribute('x1', '0');
    ftp.setAttribute('x2', String(CHART_W));
    ftp.setAttribute('y1', String(y(s.ftpW)));
    ftp.setAttribute('y2', String(y(s.ftpW)));
    ftp.setAttribute('class', 'rc-ftp');
    svg.append(ftp);
    if (withTarget) {
      const pts = s.chart
        .map((b, i) => (b.powerW === undefined ? undefined : `${((i + 0.5) * bw).toFixed(1)},${y(b.powerW)}`))
        .filter(Boolean)
        .join(' ');
      for (const cls of ['rc-halo', 'rc-power']) {
        const p = document.createElementNS(SVG_NS, 'polyline');
        p.setAttribute('points', pts);
        p.setAttribute('class', cls);
        svg.append(p);
      }
    }
    svg.setAttribute(
      'aria-label',
      withTarget ? 'Consignes de la séance par zone et puissance mesurée' : 'Puissance mesurée au fil de la sortie, par zone',
    );
    set(
      'legend',
      withTarget
        ? `Consigne en couleur de zone · puissance réelle · pointillé : FTP ${s.ftpW} W`
        : `Puissance en couleur de zone · pointillé : FTP ${s.ftpW} W`,
    );
  }

  function fill(c: RecapContent) {
    const s = c.summary;
    const dur = formatDuration(s.durationS);
    set('eyebrow', c.eyebrow);
    set('title', c.title);
    const day = new Date(c.startMs).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    // En sortie libre, le titre est déjà le parcours : on ne le répète pas.
    set('when', [c.place !== c.title ? c.place : '', day, fmtClock(c.startMs)].filter(Boolean).join(' · '));
    set('meta', [dur, s.distanceKm !== undefined ? `${fmtNum(s.distanceKm, 1)} km` : '', s.climbM !== undefined ? `D+ ${s.climbM} m` : '']
      .filter(Boolean)
      .join(' · '));
    const chip = el('chip');
    chip.hidden = !s.efforts;
    if (s.efforts) {
      const { held, total } = s.efforts;
      chip.textContent = `${held} ${held > 1 ? 'blocs tenus' : 'bloc tenu'} sur ${total}`;
      chip.dataset.all = String(held === total);
    }

    set('duration', dur);
    set('distance', fmtNum(s.distanceKm, 1));
    set('avgPower', fmtNum(s.avgPowerW));
    set('tss', fmtNum(s.tss));
    const more: [string, string | undefined][] = [
      ['NP', s.normalizedW !== undefined ? `${s.normalizedW} W` : undefined],
      ['IF', s.intensityFactor !== undefined ? fmtNum(s.intensityFactor, 2) : undefined],
      ['FC moy.', s.avgHeartRate !== undefined ? `${s.avgHeartRate} bpm` : undefined],
      ['Cadence', s.avgCadence !== undefined ? `${s.avgCadence} tr/min` : undefined],
      ['Travail', s.workKj !== undefined ? `${s.workKj} kJ` : undefined],
      ['D+', s.climbM !== undefined ? `${s.climbM} m` : undefined],
    ];
    const moreEl = el('more');
    moreEl.replaceChildren();
    for (const [k, v] of more) {
      if (v === undefined) continue;
      const span = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = v;
      span.append(`${k} `, b);
      moreEl.append(span);
    }

    set('tAvg', fmtNum(s.avgPowerW));
    set('tNp', fmtNum(s.normalizedW));
    set('tTss', fmtNum(s.tss));
    set('tIf', fmtNum(s.intensityFactor, 2));
    set('tKj', fmtNum(s.workKj));
    set('tCad', fmtNum(s.avgCadence));
    set('tHr', fmtNum(s.avgHeartRate));
    set('tHrMax', fmtNum(s.maxHeartRate));
    // Dernière tuile : les blocs tenus en séance, la vitesse moyenne en sortie libre.
    const last = el('lastTile');
    last.dataset.ok = String(!!s.efforts);
    if (s.efforts) {
      last.innerHTML = ICON.check;
      last.append(`${s.efforts.held}/${s.efforts.total} ${s.efforts.held > 1 ? 'blocs tenus' : 'bloc tenu'}`);
    } else {
      last.innerHTML = '<span class="rc-lab">Vitesse moy.</span><span class="rc-num"><span></span><span class="rc-unit">km/h</span></span>';
      last.querySelector('.rc-num > span')!.textContent = fmtNum(s.avgSpeedKmh, 1);
    }

    drawChart(s);
    set('end', dur);
    const zbar = el('zbar');
    zbar.replaceChildren();
    const zl = el('zlegend');
    zl.replaceChildren();
    const top = POWER_ZONES.reduce((a, z) => (s.zones[z] > s.zones[a] ? z : a), POWER_ZONES[0]!);
    for (const z of POWER_ZONES) {
      const secs = s.zones[z];
      if (!secs) continue;
      const seg = document.createElement('span');
      seg.className = z;
      seg.style.flexGrow = String(secs);
      zbar.append(seg);
      const item = document.createElement('span');
      item.textContent = `${z.toUpperCase()} ${formatDuration(secs)}`;
      if (z === top) item.className = 'top';
      zl.append(item);
    }
  }

  return {
    get open() {
      return dialog.open;
    },
    show(c: RecapContent) {
      content = c;
      stopCountdown();
      fill(c);
      nameInput.value = c.defaultName;
      set('continueLabel', c.rideRunning ? 'Continuer à rouler' : 'Reprendre la sortie');
      if (c.strava === 'ready') {
        left = COUNTDOWN_S;
        setState('countdown');
        tick();
        timer = setInterval(tick, 1000);
      } else {
        setState(c.strava === 'none' ? 'none' : 'manual');
      }
      if (!dialog.open) dialog.showModal();
      // Le focus va à l'action principale (Entrée envoie tout de suite), pas au champ du nom, qui suspendrait l'envoi.
      (c.strava === 'none' ? el<HTMLButtonElement>('continue') : sendBtn).focus();
    },
    /** En quittant l'écran Sortie : un envoi programmé part quand même. */
    close() {
      if (dialog.open) leave(() => {});
    },
    /** Le cycliste est reparti (arrêt puis quelques secondes de pédalage) : comme « Continuer », un envoi programmé part. */
    dismissByPedaling() {
      if (dialog.open) leave(actions.onContinue);
    },
  };
}
