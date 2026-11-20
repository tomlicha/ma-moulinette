import type { Course, LiftState } from '../course/course';
import type { CourseDef, Edge, RoadNetwork } from '../course/network';
import { edgeS, endNodeId, findLeg, trackPoint, type JourneyPoint, type Leg, type NetPosition } from '../course/track';

export { CORNER_M, type JourneyPoint, type NetPosition } from '../course/track';

/** Distance à laquelle un carrefour est annoncé, en m. */
export const ANNOUNCE_M = 250;
/**
 * Distance avant le nœud où le choix se verrouille, en m. Plus grande que la demi-fenêtre de lissage de la pente (25 m) :
 * la pente envoyée au trainer ne voit jamais une route encore indécise.
 */
export const LOCK_M = 40;
/** En dessous de cet écart de cap, une route compte comme « tout droit », en degrés. */
const STRAIGHT_DEG = 25;

export type Turn = 'left' | 'straight' | 'right';

export interface JunctionOption {
  edgeId: string;
  /** Vrai si la route se parcourt dans son sens de définition (départ → arrivée). */
  forward: boolean;
  name: string;
  lengthM: number;
  /** Vrai si c'est la route que le parcours propose ensuite. */
  onCourse: boolean;
  /** Pente moyenne dans le sens de marche, en %. */
  avgGradePct: number;
  /** Total des montées dans le sens de marche, en m. */
  climbM: number;
  /** Écart de cap : positif vers la droite, en degrés. */
  turnDeg: number;
  turn: Turn;
}

/**
 * Séance de groupe : tout le groupe fait le même trajet, donc la même simulation. Le **créateur** choisit à chaque carrefour ;
 * son choix est diffusé et chacun l'applique au moment où son propre trajet valide la route (la route est identifiée par son
 * rang dans le trajet : `legIndex`). Sans choix connu à ce moment-là, le parcours (sinon le tout droit) l'emporte, comme en solo.
 */
export interface GroupRouting {
  /** Le choix du groupe pour la route numéro `legIndex` (celle qui suit le prochain carrefour) ; `undefined` : pas décidé. */
  choiceFor(legIndex: number): number | undefined;
  /** Ce coureur choisit pour le groupe. */
  readonly decides: boolean;
  /** Ce coureur vient de toucher une option : à diffuser au groupe (elle ne s'applique qu'à son retour, comme pour les autres). */
  decide(legIndex: number, index: number): void;
}

/** Le créateur ne peut plus changer le choix à cette distance du carrefour, en m : de quoi laisser le message arriver chez tous avant le verrou (`LOCK_M`). */
export const DECIDE_CLOSE_M = LOCK_M + 60;

export interface PendingJunction {
  nodeId: string;
  /** Distance du trajet où se trouve le nœud, en m. */
  atM: number;
  /** Distance restante jusqu'au nœud, en m. */
  distanceM: number;
  /** Options de la gauche vers la droite. */
  options: JunctionOption[];
  /** Option retenue : le choix du cycliste (ou du groupe), sinon le tout droit. */
  selected: number;
  /** Rang de la route à choisir dans le trajet : de quoi désigner ce carrefour auprès du groupe. */
  legIndex: number;
  /** Séance de groupe seulement : qui choisit, et si le choix est encore ouvert. */
  group?: { decides: boolean; closed: boolean };
}

const wrapPi = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

/**
 * Trajet du cycliste sur le réseau : une suite de routes mises bout à bout, vue par la simulation comme un parcours
 * à distance monotone. Les routes déjà validées sont figées. Au-delà, le trajet se prolonge par le choix en cours,
 * sinon tout droit, sans rien valider à la place du cycliste.
 */
export class Journey implements Course {
  private readonly committed: Leg[] = [];
  private tentative: Leg[] = [];
  private choice: number | undefined;
  /** Sortie de piste programmée à la prochaine porte (`setTrackExit`). */
  private exitTrack = false;
  /** Séance de groupe : le créateur choisit (`setGroupRouting`). */
  private routing?: GroupRouting;
  /** Distance restante au dernier carrefour annoncé, en m : le choix du créateur se ferme près du nœud. */
  private lastRemainingM = Infinity;

  private courseDef: CourseDef | undefined;

  /** `courseId` : le parcours à suivre (le premier du réseau par défaut) ; un réseau sans parcours va tout droit. */
  constructor(readonly network: RoadNetwork, courseId?: string) {
    this.courseDef = network.course(courseId);
    this.reset();
  }

  /** Le parcours suivi, s'il y en a un. */
  get course(): CourseDef | undefined {
    return this.courseDef;
  }

  /** Nom du parcours suivi, sinon du réseau. */
  get name(): string {
    return this.courseDef?.name ?? this.network.name;
  }

  /** Change de parcours et repart du départ : à n'appeler qu'entre deux sorties. */
  setCourse(courseId: string | undefined): void {
    this.courseDef = this.network.course(courseId);
    this.reset();
  }

  /** Remet le trajet au départ du réseau, sans aucun choix de carrefour : une nouvelle sortie. */
  reset(): void {
    const start = this.courseDef ? { edge: this.courseDef.guide[0]!, forward: true } : this.network.start;
    const first = this.network.edges.get(start.edge)!;
    this.committed.length = 0;
    this.committed.push({ edge: first, forward: start.forward, startM: 0, lengthM: first.lengthM, liftedM: 0 });
    this.tentative = [];
    this.choice = undefined;
    this.exitTrack = false;
  }

  /**
   * Repart de la position `pos` d'un autre coureur, `behindM` derrière lui dans son sens de marche (au plus jusqu'au
   * début de sa route). La distance 0 du trajet est ce point : une sortie qui commence là compte ses kilomètres depuis
   * l'endroit où l'on a rejoint, pas depuis le départ du réseau. Les routes suivantes suivent le parcours choisi, sinon
   * le tout droit. Renvoie la position retenue, `undefined` si la route est inconnue (réseau différent).
   */
  placeAt(pos: NetPosition, behindM = 10): NetPosition | undefined {
    const edge = this.network.edges.get(pos.edgeId);
    if (!edge) return undefined;
    const along = pos.forward ? pos.s : edge.lengthM - pos.s; // distance parcourue sur la route, dans son sens de marche
    // Dans un ascenseur, on monte en cabine : on y entre par le pied, pas au milieu.
    const from = edge.isLift ? 0 : Math.min(edge.lengthM, Math.max(0, along - behindM));
    this.committed.length = 0;
    this.committed.push({ edge, forward: pos.forward, startM: -from, lengthM: edge.lengthM, liftedM: 0 });
    this.tentative = [];
    this.choice = undefined;
    this.exitTrack = false;
    return { edgeId: edge.id, forward: pos.forward, s: pos.forward ? from : edge.lengthM - from };
  }

  /**
   * Passe en séance de groupe (`GroupRouting`) : les choix du coureur ne comptent plus, ceux du créateur du groupe oui. Sans
   * argument, redevient un trajet libre. À appeler hors de toute sortie (avant le départ, ou une fois arrêté).
   */
  setGroupRouting(routing: GroupRouting | undefined): void {
    this.routing = routing;
    this.choice = undefined;
    this.exitTrack = false;
    this.tentative = [];
  }

  /** Un choix du groupe vient d'arriver : le prolongement déjà calculé par défaut n'est plus le bon. */
  refreshRouting(): void {
    this.tentative = [];
  }

  /** Le choix en cours pour la route numéro `legIndex` : celui du groupe en séance de groupe, sinon celui du coureur. */
  private chosen(legIndex: number): number | undefined {
    return this.routing ? this.routing.choiceFor(legIndex) : this.choice;
  }

  /** Fin de la partie validée, en m. */
  get committedEndM(): number {
    const last = this.committed[this.committed.length - 1]!;
    return last.startM + last.lengthM;
  }

  /** Valide les routes dont le verrou est passé. À appeler avec la distance du cycliste. */
  update(distanceM: number): void {
    while (distanceM >= this.committedEndM - LOCK_M) {
      const last = this.committed[this.committed.length - 1]!;
      const options = this.optionsAfter(last);
      const wanted = this.chosen(this.committed.length);
      const index = wanted !== undefined && wanted >= 0 && wanted < options.length ? wanted : this.defaultFor(last, options);
      const leg = this.legFor(options[index]!, last);
      this.committed.push(leg);
      this.choice = undefined;
      this.tentative = [];
      // La sortie programmée est faite : on a quitté la piste.
      if (this.exitTrack && !isTrack(leg)) this.exitTrack = false;
    }
  }

  /**
   * Le prochain carrefour, s'il est annoncé et pas encore verrouillé. Un nœud qui n'offre qu'une route (la ligne
   * d'arrivée d'une piste, l'entrée sur la piste, La Rive) n'en est pas un : rien à choisir, rien à annoncer. La porte
   * d'un vélodrome, vue de la piste, ne s'annonce pas non plus : on y tourne tour après tour, et la sortie se
   * programme à part (`setTrackExit`), sans panneau à chaque passage.
   */
  pendingJunction(distanceM: number): PendingJunction | undefined {
    const atM = this.committedEndM;
    if (atM - distanceM > ANNOUNCE_M || atM - distanceM <= LOCK_M) return undefined;
    const last = this.committed[this.committed.length - 1]!;
    if (isTrack(last)) return undefined;
    const options = this.optionsAfter(last);
    if (options.length < 2) return undefined;
    const legIndex = this.committed.length;
    const wanted = this.chosen(legIndex);
    this.lastRemainingM = atM - distanceM;
    return {
      nodeId: endNodeId(last),
      atM,
      distanceM: atM - distanceM,
      options,
      selected: wanted !== undefined && wanted >= 0 && wanted < options.length ? wanted : this.defaultFor(last, options),
      legIndex,
      ...(this.routing ? { group: { decides: this.routing.decides, closed: atM - distanceM <= DECIDE_CLOSE_M } } : {}),
    };
  }

  /**
   * Tours de piste bouclés à `distanceM` : le nombre de passages sur la ligne d'arrivée d'un vélodrome depuis le départ
   * (le départ du parcours « Vélodrome », posé sur la ligne, ne compte pas).
   */
  lapsAt(distanceM: number): number {
    const finish = new Set(this.network.velodromes.map((v) => v.finishNodeId));
    let laps = 0;
    for (const leg of this.committed) {
      if (leg.startM + leg.lengthM > distanceM) break;
      if (leg.forward && isTrack(leg) && finish.has(endNodeId(leg))) laps++;
    }
    return laps;
  }

  /** Vrai si le cycliste est, à `distanceM`, sur la piste d'un vélodrome. */
  onTrack(distanceM: number): boolean {
    return isTrack(this.legAt(Math.max(0, distanceM)));
  }

  /** Vrai si la sortie de la piste est programmée à la prochaine porte. */
  get trackExitArmed(): boolean {
    return this.exitTrack;
  }

  /**
   * Programme (`true`) ou annule la sortie de la piste à la prochaine porte : on y prend alors la route qui quitte la
   * piste au lieu d'un tour de plus. Sans effet hors de la piste ; s'efface une fois sorti.
   */
  setTrackExit(on: boolean): void {
    if (this.routing) return; // en groupe, tout le monde fait le même trajet
    this.exitTrack = on;
    this.tentative = [];
  }

  /**
   * Distance jusqu'à la prochaine porte où l'on peut quitter la piste, en m ; `undefined` hors de la piste. Si le choix
   * de la porte toute proche est déjà verrouillé (moins de `LOCK_M`), c'est la porte du tour suivant.
   */
  trackExitInM(distanceM: number): number | undefined {
    const d = Math.max(0, distanceM);
    if (!this.onTrack(d)) return undefined;
    let x = d;
    for (let i = 0; i < 8; i++) {
      const leg = this.legAt(x);
      const end = leg.startM + leg.lengthM;
      const committedNext = end <= this.committedEndM - 1e-6 ? findLeg(this.committed, end + 1e-3) : undefined;
      const canLeave = this.optionsAfter(leg).some((o) => this.network.edges.get(o.edgeId)!.def.surface !== 'track');
      // Une porte dont le choix est déjà figé sur la piste ne compte pas : on ne peut plus y sortir.
      if (canLeave && !(committedNext && isTrack(committedNext))) return end - d;
      x = end + 1e-3;
    }
    return undefined;
  }

  /** Retient l'option `index` du prochain carrefour. Renvoie faux si elle n'existe pas. */
  choose(index: number): boolean {
    const options = this.optionsAfter(this.committed[this.committed.length - 1]!);
    if (!Number.isInteger(index) || index < 0 || index >= options.length) return false;
    if (this.routing) {
      // Seul le créateur choisit, et jusqu'à `DECIDE_CLOSE_M` du carrefour ; son choix revient par `choiceFor`, comme chez les autres.
      if (!this.routing.decides || this.lastRemainingM <= DECIDE_CLOSE_M) return false;
      this.routing.decide(this.committed.length, index);
      return true;
    }
    this.choice = index;
    this.tentative = [];
    return true;
  }

  /**
   * Altitude pédalée : celle du monde, moins la hauteur que les ascenseurs ont donnée jusque-là. C'est celle de la
   * simulation (pente envoyée au trainer), du récapitulatif et du fichier FIT : une montée en ascenseur n'y compte pas.
   * L'image, elle, suit l'altitude du monde (`pointAt`).
   */
  altitudeAt(distanceM: number): number {
    const d = Math.max(0, distanceM);
    const leg = this.legAt(d);
    const world = leg.edge.altitudeAt(edgeS(leg, d));
    return world - (leg.liftedM ?? 0) - (leg.edge.isLift ? world - legStartAltitude(leg) : 0);
  }

  /**
   * L'ascenseur sous la distance `distanceM`, s'il y en a un : où il commence sur le trajet, sa longueur et sa durée.
   * La simulation y fait avancer le cycliste au rythme de la cabine, pas à celui de ses jambes.
   */
  liftAt(distanceM: number): LiftState | undefined {
    const d = Math.max(0, distanceM);
    const leg = this.legAt(d);
    const lift = leg.edge.isLift ? leg.edge.def.lift : undefined;
    if (!lift) return undefined;
    return {
      startM: leg.startM,
      lengthM: leg.lengthM,
      durationS: lift.durationS,
      progress: (d - leg.startM) / leg.lengthM,
      fromAltitudeM: legStartAltitude(leg),
      toAltitudeM: legEndAltitude(leg),
      altitudeM: leg.edge.altitudeAt(edgeS(leg, d)),
      toName: (leg.forward ? leg.edge.to : leg.edge.from).name,
      name: leg.edge.name,
    };
  }

  /** Pente lissée sur 2 × `halfWindowM`, sans reculer avant le départ. */
  gradeAt(distanceM: number, halfWindowM = 25): number {
    const lo = Math.max(0, distanceM - halfWindowM);
    const hi = Math.max(lo + 1, distanceM + halfWindowM);
    return ((this.altitudeAt(hi) - this.altitudeAt(lo)) / (hi - lo)) * 100;
  }

  /**
   * Position, altitude et cap à la distance `distanceM`, avec les coins des carrefours arrondis (voir `trackPoint`).
   */
  pointAt(distanceM: number): JourneyPoint {
    return trackPoint((d) => this.legAt(d), Math.max(0, distanceM));
  }

  /**
   * Position sur le réseau à la distance `distanceM`, à envoyer aux autres joueurs. La route suivante y figure dès que
   * le carrefour est verrouillé (`LOCK_M` avant le nœud) : les autres arrondissent ainsi le virage au bon moment.
   */
  locate(distanceM: number): NetPosition {
    const d = Math.max(0, distanceM);
    const leg = this.legAt(d);
    const pos: NetPosition = { edgeId: leg.edge.id, forward: leg.forward, s: edgeS(leg, d) };
    const i = this.committed.indexOf(leg);
    const next = i >= 0 ? this.committed[i + 1] : undefined;
    if (next) pos.next = { edgeId: next.edge.id, forward: next.forward };
    return pos;
  }

  /** La route sous `distanceM`, de carrefour à carrefour : début sur le trajet et longueur, en m. */
  roadAt(distanceM: number): { startM: number; lengthM: number } {
    const { startM, lengthM } = this.legAt(Math.max(0, distanceM));
    return { startM, lengthM };
  }

  /** Nom de la route sous le cycliste. */
  edgeNameAt(distanceM: number): string {
    return this.legAt(Math.max(0, distanceM)).edge.name;
  }

  /** La route `option` mise au bout de `prev`, avec la hauteur donnée par les ascenseurs jusque-là. */
  private legFor(option: JunctionOption, prev: Leg): Leg {
    const edge = this.network.edges.get(option.edgeId)!;
    const liftedM = (prev.liftedM ?? 0) + (prev.edge.isLift ? legEndAltitude(prev) - legStartAltitude(prev) : 0);
    return { edge, forward: option.forward, startM: prev.startM + prev.lengthM, lengthM: edge.lengthM, liftedM };
  }

  /** Les routes qui partent du nœud où finit `leg`, de la gauche vers la droite, demi-tour exclu. */
  private optionsAfter(leg: Leg): JunctionOption[] {
    const nodeId = endNodeId(leg);
    const inHeading = leg.forward ? leg.edge.headingAt(leg.edge.lengthM) : leg.edge.headingAt(0) + Math.PI;
    const options: JunctionOption[] = [];
    const onCourse = this.guideNextAfter(leg);
    for (const edge of this.network.incident(nodeId)) {
      if (edge === leg.edge) continue;
      const forward = edge.from.id === nodeId;
      if (!forward && edge.def.oneWay) continue; // pas de piste à contresens
      const outHeading = forward ? edge.headingAt(0) : edge.headingAt(edge.lengthM) + Math.PI;
      const turnDeg = (wrapPi(outHeading - inHeading) * 180) / Math.PI;
      options.push({
        edgeId: edge.id,
        forward,
        name: edge.name,
        lengthM: edge.lengthM,
        onCourse: forward && edge.id === onCourse,
        avgGradePct: edge.isLift ? 0 : ((forward ? edge.to.altitude - edge.from.altitude : edge.from.altitude - edge.to.altitude) / edge.lengthM) * 100,
        climbM: climbOf(edge, forward),
        turnDeg,
        turn: Math.abs(turnDeg) < STRAIGHT_DEG ? 'straight' : turnDeg > 0 ? 'right' : 'left',
      });
    }
    if (options.length === 0) {
      // Ne devrait pas arriver (le réseau n'a pas de cul-de-sac) : demi-tour plutôt que de bloquer la simulation.
      options.push({
        edgeId: leg.edge.id,
        forward: !leg.forward,
        name: leg.edge.name,
        lengthM: leg.edge.lengthM,
        onCourse: false,
        avgGradePct: 0,
        climbM: 0,
        turnDeg: 180,
        turn: 'right',
      });
    }
    return options.sort((a, b) => a.turnDeg - b.turnDeg || (a.edgeId < b.edgeId ? -1 : 1));
  }

  /** La route que le parcours propose après `leg`, si on la suit dans son sens ; sinon `undefined`. */
  private guideNextAfter(leg: Leg): string | undefined {
    const guide = this.courseDef?.guide;
    if (!guide || !leg.forward) return undefined;
    const i = guide.indexOf(leg.edge.id);
    return i < 0 ? undefined : guide[(i + 1) % guide.length];
  }

  /** La route sous la distance `d` : d'abord les routes validées, puis le prolongement par défaut. */
  private legAt(d: number): Leg {
    const end = this.committedEndM;
    if (d < end) return findLeg(this.committed, d);
    while (this.tentativeEndM() <= d) {
      const last = this.tentative[this.tentative.length - 1] ?? this.committed[this.committed.length - 1]!;
      const options = this.optionsAfter(last);
      // Seul le prochain carrefour tient compte du choix en cours ; les suivants prennent le tout droit.
      const wanted = this.tentative.length === 0 ? this.chosen(this.committed.length) : undefined;
      const index = wanted !== undefined && wanted >= 0 && wanted < options.length ? wanted : this.defaultFor(last, options);
      this.tentative.push(this.legFor(options[index]!, last));
    }
    return findLeg(this.tentative, d);
  }

  /** Route par défaut après `leg` : la sortie de piste si elle est programmée, sinon celle du parcours ou le tout droit. */
  private defaultFor(leg: Leg, options: JunctionOption[]): number {
    if (this.exitTrack && isTrack(leg)) {
      const out = options.findIndex((o) => this.network.edges.get(o.edgeId)!.def.surface !== 'track');
      if (out >= 0) return out;
    }
    return defaultIndex(options);
  }

  private tentativeEndM(): number {
    const last = this.tentative[this.tentative.length - 1];
    return last ? last.startM + last.lengthM : this.committedEndM;
  }
}

const isTrack = (leg: Leg) => leg.edge.def.surface === 'track';
const legStartAltitude = (leg: Leg) => (leg.forward ? leg.edge.from.altitude : leg.edge.to.altitude);
const legEndAltitude = (leg: Leg) => (leg.forward ? leg.edge.to.altitude : leg.edge.from.altitude);

/** La route du parcours si elle est proposée ; sinon l'option la plus droite (à égalité, la première de gauche à droite). */
function defaultIndex(options: JunctionOption[]): number {
  const course = options.findIndex((o) => o.onCourse);
  if (course >= 0) return course;
  let best = 0;
  for (let i = 1; i < options.length; i++) if (Math.abs(options[i]!.turnDeg) < Math.abs(options[best]!.turnDeg)) best = i;
  return best;
}

/** Somme des montées sur la route, dans le sens de marche, échantillonnée tous les 20 m ; nulle en ascenseur. */
function climbOf(edge: Edge, forward: boolean): number {
  if (edge.isLift) return 0;
  const pts = edge.sample(20).map((p) => p.altitude);
  if (!forward) pts.reverse();
  let up = 0;
  for (let i = 1; i < pts.length; i++) up += Math.max(0, pts[i]! - pts[i - 1]!);
  return up;
}
