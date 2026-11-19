import type { RecallStatus } from '../../app/device-manager';
import type { KnownDevice, DeviceRole } from '../../infra/sensors/device-registry';
import type { WebBluetoothTrainer } from '../../infra/sensors/ble/web-bluetooth';
import { PROTOCOL_LABEL, type ControlProtocol } from '../../infra/sensors/protocols/trainer-profiles';
import type { ConnectionState, TrainerCapabilities } from '../../infra/sensors/types';
import { controlModes } from '../ride/radar-model';
import type { Radar } from '../ride/radar';
import { setBlocked } from '../shared/blocked';
import { byId } from '../shared/dom';

/** Ce qu'il faut savoir d'un appareil (trainer ou ceinture cardio) pour dessiner sa carte. */
export interface DeviceModel {
  state: ConnectionState;
  /** Nom de l'appareil branché ; le simulé n'est pas mémorisé. */
  name: string | undefined;
  /** Dernier appareil connu de ce rôle (que la reconnexion cherche). */
  known: KnownDevice | undefined;
  /** Attendu mais éteint : il n'occupe pas le rôle, on peut en choisir un autre. */
  waiting: boolean;
}

export interface DevicesViewModel {
  trainer: DeviceModel & { capabilities: TrainerCapabilities | undefined };
  hr: DeviceModel;
  bluetooth: {
    available: boolean;
    /** Ce qu'il faut dire quand le navigateur n'a pas de Bluetooth. */
    hint: string;
  };
}

/** Ce que le coureur peut demander sur l'écran Appareils. */
export interface DevicesViewActions {
  /** `useKnown` : se limiter au dernier appareil connu (sinon, le sélecteur propose tous les appareils). */
  connectTrainer(useKnown: boolean): void;
  connectSimulator(): void;
  disconnectTrainer(): void;
  connectHeartRate(useKnown: boolean): void;
  disconnectHeartRate(): void;
  forget(role: DeviceRole): void;
  /** Quitter l'écran pour la sortie. */
  goRide(): void;
  /** Le coureur impose un protocole de pilotage (`undefined` : choix automatique selon le modèle du trainer). */
  protocolChanged(protocol: ControlProtocol | undefined): void;
}

/** État affiché sur les cartes de l'écran Appareils. */
const stateLabel = (s: ConnectionState) =>
  s === 'connected' ? 'Connecté' : s === 'connecting' ? 'Connexion…' : s === 'error' ? 'Erreur de connexion' : 'Non connecté';

const RECALL_NOTE: Record<Exclude<RecallStatus['kind'], 'reconnecting'>, string> = {
  'first-use': 'Première utilisation : connecte ton home trainer pour commencer. Il sera reconnu aux prochains lancements.',
  unavailable: 'Ce navigateur ne permet pas de retrouver les appareils sans clic : un clic sur « Reconnecter » par appareil suffit.',
  searching: 'Reconnexion automatique aux appareils connus…',
  failed: 'Reconnexion automatique impossible : un clic sur « Reconnecter » par appareil suffit.',
  'permissions-lost': 'Les autorisations Bluetooth de ce site ont été effacées : un clic sur « Reconnecter » par appareil suffit.',
};

/**
 * L'écran Appareils : une carte par appareil (trainer, ceinture cardio) avec son état et les boutons qui conviennent à
 * cet état, les radars (grand sur cet écran, réduit sur l'accueil), la note de reconnexion automatique, et le message
 * qui dit si Bluetooth est disponible. Il ne connecte rien : il demande (`DevicesViewActions`).
 */
export class DevicesView {
  private readonly trainerState = byId('state');
  private readonly hrState = byId('state-hr');
  private readonly connectBle = byId<HTMLButtonElement>('connect-ble');
  private readonly connectSim = byId<HTMLButtonElement>('connect-sim');
  private readonly disconnectBtn = byId<HTMLButtonElement>('disconnect');
  private readonly connectHr = byId<HTMLButtonElement>('connect-hr');
  private readonly disconnectHr = byId<HTMLButtonElement>('disconnect-hr');
  private readonly connectBleOther = byId<HTMLButtonElement>('connect-ble-other');
  private readonly connectHrOther = byId<HTMLButtonElement>('connect-hr-other');
  private readonly protocol = byId<HTMLSelectElement>('trainer-protocol');
  private model: DevicesViewModel | undefined;

  constructor(
    private readonly radars: readonly Pick<Radar, 'update'>[],
    private readonly actions: DevicesViewActions,
  ) {
    this.connectHr.addEventListener('click', () => actions.connectHeartRate(true));
    this.connectHrOther.addEventListener('click', () => actions.connectHeartRate(false));
    this.disconnectHr.addEventListener('click', () => actions.disconnectHeartRate());
    this.connectBle.addEventListener('click', () => actions.connectTrainer(true));
    this.connectBleOther.addEventListener('click', () => actions.connectTrainer(false));
    this.connectSim.addEventListener('click', () => actions.connectSimulator());
    this.disconnectBtn.addEventListener('click', () => actions.disconnectTrainer());
    for (const role of ['trainer', 'hr'] as const) {
      byId(`forget-${role}`).addEventListener('click', () => {
        const known = this.model?.[role].known;
        if (!known || !confirm(`Oublier « ${known.name} » ? Il ne sera plus reconnecté au lancement.`)) return;
        actions.forget(role);
      });
    }
    byId('go-ride').addEventListener('click', () => actions.goRide());
    this.protocol.addEventListener('change', () => actions.protocolChanged(this.forcedProtocol));
  }

  /** Protocole de pilotage imposé depuis l'aide de l'écran ; `undefined` : choix automatique selon le modèle. */
  get forcedProtocol(): ControlProtocol | undefined {
    return (this.protocol.value || undefined) as ControlProtocol | undefined;
  }

  setForcedProtocol(protocol: ControlProtocol | undefined): void {
    this.protocol.value = protocol ?? '';
  }

  /** Redessine les cartes d'après l'état des appareils. */
  render(m: DevicesViewModel): void {
    this.model = m;
    const t = m.trainer.known;
    const h = m.hr.known;
    const busyT = m.trainer.state === 'connected' || (m.trainer.state === 'connecting' && !m.trainer.waiting);
    const busyH = m.hr.state === 'connected' || (m.hr.state === 'connecting' && !m.hr.waiting);
    // Le nom de l'appareil branché prime (le trainer simulé n'est pas mémorisé) ; sinon le dernier appareil connu.
    byId('trainer-known').textContent =
      m.trainer.state === 'connected' && m.trainer.name ? m.trainer.name : t ? `Connu : ${t.name}` : 'Aucun trainer connu.';
    byId('hr-known').textContent =
      m.hr.state === 'connected' && m.hr.name ? m.hr.name : h ? `Connu : ${h.name}` : 'Aucun capteur connu. Facultatif.';
    // Le nom de l'appareil est déjà affiché au-dessus des boutons : le libellé reste court pour que la rangée tienne sur une ligne.
    this.connectBle.textContent = t ? 'Reconnecter' : 'Rechercher un trainer';
    this.connectHr.textContent = h ? 'Reconnecter' : 'Rechercher un capteur';
    const bt = m.bluetooth.available;
    const noBt = m.bluetooth.hint;
    const trainerBusy =
      m.trainer.state === 'connected' ? 'Un trainer est déjà connecté : déconnecte-le d’abord pour en changer.' : 'Connexion du trainer en cours…';
    const hrBusy = m.hr.state === 'connected' ? 'Un capteur est déjà connecté : déconnecte-le d’abord pour en changer.' : 'Connexion du capteur en cours…';
    setBlocked(this.connectBle, !bt ? noBt : busyT ? trainerBusy : undefined);
    setBlocked(this.connectHr, !bt ? noBt : busyH ? hrBusy : undefined);
    setBlocked(this.connectSim, busyT ? trainerBusy : undefined);
    // Une rangée par appareil, limitée à ce qui est utile dans l'état courant : connecté, il ne reste que « Déconnecter ».
    const liveT = m.trainer.state === 'connected';
    const liveH = m.hr.state === 'connected';
    this.connectBle.hidden = liveT;
    this.connectSim.hidden = liveT;
    this.disconnectBtn.hidden = !liveT;
    this.connectHr.hidden = liveH;
    this.disconnectHr.hidden = !liveH;
    this.connectBleOther.hidden = !t || liveT;
    setBlocked(this.connectBleOther, !bt ? noBt : busyT ? trainerBusy : undefined);
    this.connectHrOther.hidden = !h || liveH;
    setBlocked(this.connectHrOther, !bt ? noBt : busyH ? hrBusy : undefined);
    byId<HTMLButtonElement>('forget-trainer').hidden = !t || liveT;
    byId<HTMLButtonElement>('forget-hr').hidden = !h || liveH;
    setBlocked(this.disconnectHr, liveH ? undefined : 'Aucun capteur connecté.');
    setBlocked(byId<HTMLButtonElement>('go-ride'), liveT ? undefined : 'Connecte d’abord ton home trainer, ou choisis « Continuer sans trainer » juste à côté.');
    byId('sortie-hint').hidden = liveT;
    byId('card-trainer').dataset.s = m.trainer.state;
    byId('card-hr').dataset.s = m.hr.state;
    // Nom réel : celui de l'appareil connecté ; sinon le dernier appareil mémorisé, que la reconnexion cherche.
    const radarDevices = {
      trainer: {
        state: m.trainer.state,
        name: (liveT ? m.trainer.name : undefined) ?? t?.name,
        detail: liveT ? controlModes(m.trainer.capabilities) : undefined,
      },
      hr: { state: m.hr.state, name: (liveH ? m.hr.name : undefined) ?? h?.name },
    };
    for (const r of this.radars) r.update(radarDevices);
  }

  /** État du trainer, tel qu'il s'affiche sur sa carte (avec le détail en info-bulle). */
  showTrainerState(s: ConnectionState, detail: string | undefined): void {
    this.trainerState.dataset.s = s;
    this.trainerState.textContent = stateLabel(s);
    this.trainerState.title = detail ?? '';
    setBlocked(this.disconnectBtn, s === 'connected' ? undefined : 'Aucun trainer connecté.');
  }

  showHeartRateState(s: ConnectionState, detail: string | undefined): void {
    this.hrState.dataset.s = s;
    this.hrState.textContent = stateLabel(s);
    this.hrState.title = detail ?? '';
  }

  /** Ce que le trainer connecté sait faire, avec son modèle et le pilotage retenu quand ils sont connus. */
  showCapabilities(c: TrainerCapabilities, id: NonNullable<WebBluetoothTrainer['identity']> | undefined): void {
    const range = c.powerRange ? `, plage ${c.powerRange.min}–${c.powerRange.max} W` : '';
    const model = id ? `${id.profile.label}${id.info.firmware ? ` (firmware ${id.info.firmware})` : ''} · pilotage ${id.protocol ? PROTOCOL_LABEL[id.protocol] : 'aucun'} · ` : '';
    byId('caps').textContent = `${model}ERG : ${c.targetPower ? 'oui' : 'non'} · SIM : ${c.simulation ? 'oui' : 'non'}${range}${id?.advice ? `. ${id.advice}` : ''}`;
  }

  /** La note sous les cartes : où en est la reconnexion automatique du lancement. */
  showRecall(status: RecallStatus): void {
    byId('recall-note').textContent =
      status.kind === 'reconnecting' ? `Reconnexion automatique : ${status.names.join(', ')}. Allume-les si ce n'est pas déjà fait.` : RECALL_NOTE[status.kind];
  }

  /** Bluetooth est-il disponible ici ? Une ligne, en bas de l'écran. */
  showSupport(text: string): void {
    byId('support').textContent = text;
  }
}
