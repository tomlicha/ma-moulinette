/**
 * Catalogue des nouveautés montrées à l'utilisateur (docs/design/nouveautes.md).
 *
 * **Seulement ce qui est utile à l'utilisateur** : une chose qu'il voit, qu'il peut faire de nouveau, ou qu'il ressent à
 * l'usage. Ni refonte interne, ni test, ni CI, ni doc. Une entrée par fonction (pas une par commit), dite par ce que le
 * cycliste y gagne. Liste écrite à la main, ancienne en premier.
 *
 * L'`id` commence par la date (`AAAA-MM-JJ-nom`) : les ids se comparent comme du texte, et le plus grand est le plus
 * récent. Il ne change jamais (corriger un texte ne ré-annonce rien) ; il suit la règle des identifiants de la
 * synchronisation (`[A-Za-z0-9_-]`, 64 caractères au plus).
 */

export type EntryKind = 'new' | 'improved';

/** Petite icône de l'entrée (la vue la dessine). */
export type EntryIcon = 'route' | 'track' | 'map' | 'sync' | 'sun' | 'home' | 'pause' | 'layers' | 'people';

/** Illustration du héros et de la vignette du journal (la vue la dessine). */
export type EntryArt = 'rainbow' | 'velodrome' | 'map' | 'home';

/** Les écrans où « Essayer » peut mener. */
export type EntryView = 'accueil' | 'sortie' | 'seances' | 'appareils';

export interface WhatsNewEntry {
  id: string;
  kind: EntryKind;
  title: string;
  /** Une phrase pour la carte, jusqu'à deux pour le journal. */
  text: string;
  icon: EntryIcon;
  /** Au plus une par lot de dates voisines : elle devient le héros de la carte. À défaut, l'entrée la plus récente. */
  featured?: boolean;
  art?: EntryArt;
  /** Où mène « Essayer ». */
  target?: { view: EntryView; label: string };
}

/**
 * Repère des utilisateurs qui existaient avant cette fonction : ils voient le récap de tout ce qui est plus récent. Ce
 * n'est pas une entrée ; il se compare comme les ids (« 2026-11-16 » < « 2026-11-17-… »).
 */
export const LEGACY_BASELINE = '2026-11-16';

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    id: '2026-11-17-blocs-par-zone',
    kind: 'new',
    title: 'Blocs « Par zone »',
    text: "Dans l'éditeur, un bloc simple et un bloc d'intervalles pour chaque zone de puissance.",
    icon: 'layers',
    target: { view: 'seances', label: "Ouvrir l'éditeur" },
  },
  {
    id: '2026-11-17-carte-carrefour',
    kind: 'new',
    title: 'Carte du carrefour',
    text: "Elle s'affiche 250 m avant chaque intersection, avec les routes proposées et leur montée.",
    icon: 'map',
    art: 'map',
    target: { view: 'sortie', label: 'Voir la sortie' },
  },
  {
    id: '2026-11-17-reglages-synchronises',
    kind: 'new',
    title: 'Réglages synchronisés',
    text: "FTP, poids et séances se retrouvent sur chacun de tes appareils quand tu te connectes avec ton compte.",
    icon: 'sync',
  },
  {
    id: '2026-11-17-trainer-perdu-pause',
    kind: 'improved',
    title: 'Trainer perdu : la sortie attend',
    text: 'Si le trainer se déconnecte, la sortie se met en pause pendant la reconnexion, puis reprend toute seule.',
    icon: 'pause',
  },
  {
    id: '2026-11-18-route-arc-en-ciel',
    kind: 'new',
    title: 'La route arc-en-ciel',
    text: "Une route de lumière dans le ciel de nuit. Un ascenseur céleste t'y emmène en 40 secondes, sans compter la montée.",
    icon: 'route',
    featured: true,
    art: 'rainbow',
    target: { view: 'accueil', label: 'Essayer cette route' },
  },
  {
    id: '2026-11-18-theme-clair-sortie',
    kind: 'improved',
    title: 'Thème clair en sortie',
    text: 'La sortie suit le mode clair ou sombre de ton appareil.',
    icon: 'sun',
  },
  {
    id: '2026-11-18-velodrome-roubaix',
    kind: 'new',
    title: 'Vélodrome de Roubaix',
    text: "Une piste à l'est du Moulin : le parcours « Vélodrome » est dans le menu, son icône sur la carte du monde.",
    icon: 'track',
    art: 'velodrome',
    target: { view: 'accueil', label: 'Choisir la piste' },
  },
  {
    id: '2026-11-20-accueil-refait',
    kind: 'new',
    title: 'Un accueil refait',
    text: "Parcours en vignettes, séances détaillées : tout se choisit sans ouvrir de fenêtre.",
    icon: 'home',
    art: 'home',
    target: { view: 'accueil', label: "Voir l'accueil" },
  },
  {
    id: '2026-11-20-seance-de-groupe',
    kind: 'new',
    title: 'Séance de groupe',
    text: 'Lance une séance à plusieurs : tout le monde part ensemble et reste groupé sur la route, quelle que soit la puissance de chacun, à l’allure du créateur. Aux carrefours, c’est lui qui choisit.',
    icon: 'people',
    target: { view: 'accueil', label: 'Voir les groupes' },
  },
  {
    id: '2026-11-20-suivre-un-coureur',
    kind: 'new',
    title: 'Rouler avec quelqu’un',
    text: 'Dans « En ligne » sur l’accueil, ajoute des amis d’une étoile et rejoins un coureur en sortie : l’écart s’affiche et un coup de pouce t’aide à recoller.',
    icon: 'people',
    target: { view: 'accueil', label: 'Voir qui est en ligne' },
  },
  {
    id: '2026-11-20-velodrome-accueil',
    kind: 'improved',
    title: 'Le vélodrome a son image',
    text: 'Sur l’accueil, le fond et la vignette du vélodrome montrent maintenant la piste, la tribune et l’arche d’arrivée.',
    icon: 'track',
    target: { view: 'accueil', label: 'Choisir la piste' },
  },
  {
    id: '2026-11-20-vos-comptes-telephone',
    kind: 'improved',
    title: 'Strava et Final Surge, bien visibles',
    text: 'Sur téléphone, le bouton Strava et le menu de ton compte sont de nouveau en haut à droite. Strava et Final Surge y montrent leur logo quand ils sont connectés : un toucher ouvre leurs infos et leur déconnexion.',
    icon: 'sync',
    target: { view: 'accueil', label: 'Ouvrir l’accueil' },
  },
];
