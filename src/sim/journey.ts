import type { Course } from './course';
import type { CourseDef, Edge, RoadNetwork } from './network';
import { edgeS, endNodeId, findLeg, trackPoint, type JourneyPoint, type Leg, type NetPosition } from './track';

export { CORNER_M, type JourneyPoint, type NetPosition } from './track';

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

export interface PendingJunction {
  nodeId: string;
  /** Distance du trajet où se trouve le nœud, en m. */
  atM: number;
  /** Distance restante jusqu'au nœud, en m. */
  distanceM: number;
  /** Options de la gauche vers la droite. */
  options: JunctionOption[];
  /** Option retenue : le choix du cycliste, sinon le tout droit. */
  selected: number;
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
    this.committed.push({ edge: first, forward: start.forward, startM: 0, lengthM: first.lengthM });
    this.tentative = [];
    this.choice = undefined;
    this.exitTrack = false;
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
      const index = this.choice ?? this.defaultFor(last, options);
      const leg = this.legFor(options[index]!, last.startM + last.lengthM);
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
    return {
      nodeId: endNodeId(last),
      atM,
      distanceM: atM - distanceM,
      options,
      selected: this.choice ?? this.defaultFor(last, options),
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
    this.choice = index;
    this.tentative = [];
    return true;
  }

  altitudeAt(distanceM: number): number {
    const d = Math.max(0, distanceM);
    const leg = this.legAt(d);
    return leg.edge.altitudeAt(edgeS(leg, d));
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

  private legFor(option: JunctionOption, startM: number): Leg {
    const edge = this.network.edges.get(option.edgeId)!;
    return { edge, forward: option.forward, startM, lengthM: edge.lengthM };
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
        avgGradePct: ((forward ? edge.to.altitude - edge.from.altitude : edge.from.altitude - edge.to.altitude) / edge.lengthM) * 100,
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
      const index = this.tentative.length === 0 && this.choice !== undefined ? this.choice : this.defaultFor(last, options);
      this.tentative.push(this.legFor(options[index]!, last.startM + last.lengthM));
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

/** La route du parcours si elle est proposée ; sinon l'option la plus droite (à égalité, la première de gauche à droite). */
function defaultIndex(options: JunctionOption[]): number {
  const course = options.findIndex((o) => o.onCourse);
  if (course >= 0) return course;
  let best = 0;
  for (let i = 1; i < options.length; i++) if (Math.abs(options[i]!.turnDeg) < Math.abs(options[best]!.turnDeg)) best = i;
  return best;
}

/** Somme des montées sur la route, dans le sens de marche, échantillonnée tous les 20 m. */
function climbOf(edge: Edge, forward: boolean): number {
  const pts = edge.sample(20).map((p) => p.altitude);
  if (!forward) pts.reverse();
  let up = 0;
  for (let i = 1; i < pts.length; i++) up += Math.max(0, pts[i]! - pts[i - 1]!);
  return up;
}
