import type { SimulationParams } from './types';

/**
 * Protocole trainer de Zwift, celui des trainers « Zwift Ready » et « Zwift Cog Compatible » (Zwift Hub, KICKR CORE,
 * Van Rysel, JetBlack, Elite, Tacx NEO récents) : le trainer reçoit le braquet virtuel et fait lui-même le calcul.
 *
 * Zwift ne l'a pas publié. Tout vient de rétro-ingénierie, recoupée le 14 novembre 2026 entre quatre implémentations
 * ouvertes qui s'accordent sur les numéros de champs et les échelles : swift-gears (WouterWisse, MIT), TrainerHUD
 * (callegarimattia, MIT), orbeat (pjoachims, trames reprises de qdomyos-zwift) et Kickr-Virtual-Shifting (Berg0162,
 * qui joue le rôle du trainer). Source d'origine : le blog Makinolo, « Zwift Trainer protocol » (20 octobre 2024).
 * Aucun code n'est repris, seulement les faits de protocole.
 *
 * Trame : un octet de code, puis un message protobuf. Pas de chiffrement côté trainer.
 * Non essayé sur matériel : seul l'encodage est couvert par les tests.
 */
export const ZWIFT_SERVICE = '00000001-19ca-4651-86e5-fa29dcdd09d1';
/** Même service sous son identifiant court, vu sur les firmwares récents. */
export const ZWIFT_SERVICE_SHORT = 0xfc82;
/** Mesures (code 0x03 : puissance, cadence, vitesse, cardio), en notification ; on lit les mesures par les services standard. */
export const ZWIFT_DATA_CHAR = '00000002-19ca-4651-86e5-fa29dcdd09d1';
/** Commandes, en écriture. */
export const ZWIFT_CONTROL_CHAR = '00000003-19ca-4651-86e5-fa29dcdd09d1';
/** Réponses, en indication. */
export const ZWIFT_RESPONSE_CHAR = '00000004-19ca-4651-86e5-fa29dcdd09d1';

export const ZWIFT_OP = {
  query: 0x00,
  ridingData: 0x03,
  command: 0x04,
  deviceInfo: 0x41,
} as const;

const RIDE_ON = [0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e]; // « RideOn »

/**
 * Poignée de main. Zwift et TrainerHUD envoient « RideOn » suivi de 02 01 ; swift-gears envoie les six lettres seules
 * et cela suffit sur un KICKR CORE. On essaie la forme longue, puis la courte.
 */
export const zwiftRideOn = (long = true) => Uint8Array.from(long ? [...RIDE_ON, 0x02, 0x01] : RIDE_ON);

/** Le trainer répond par « RideOn » (suivi ou non d'octets de version). */
export const isZwiftRideOn = (b: Uint8Array) => b.length >= RIDE_ON.length && RIDE_ON.every((c, i) => b[i] === c);

/**
 * Demandes envoyées après la poignée de main par qdomyos-zwift et TrainerHUD : informations de l'appareil, puis état,
 * puis braquet courant. Leur rôle exact n'est pas établi ; swift-gears s'en passe.
 */
export const zwiftInitFrames = () => [Uint8Array.of(0x41, 0x08, 0x05), Uint8Array.of(0x00, 0x08, 0x00), Uint8Array.of(0x00, 0x08, 0x88, 0x04)];

function varint(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const out: number[] = [];
  do {
    const b = v % 128;
    v = Math.floor(v / 128);
    out.push(v > 0 ? b | 0x80 : b);
  } while (v > 0);
  return out;
}

/** Entier signé protobuf (sint32) : 0, -1, 1, -2… deviennent 0, 1, 2, 3… */
const zigzag = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);

const VARINT = 0;
const BYTES = 2;
const field = (num: number, value: number) => [(num << 3) | VARINT, ...varint(value)];
const message = (num: number, body: number[]) => [(num << 3) | BYTES, ...varint(body.length), ...body];
const command = (body: number[]) => Uint8Array.from([ZWIFT_OP.command, ...body]);

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Puissance cible (ERG) : champ 3, en watts. */
export const zwiftTargetPower = (watts: number) => command(field(3, clamp(watts, 0, 4000)));

/**
 * Simulation : champ 4. Vent (signé), pente en centièmes de pourcent (signée), traînée × 10 000, roulement × 100 000.
 * Le trainer attend la pente réelle du parcours : avec un braquet virtuel, c'est lui qui en déduit la résistance.
 */
export function zwiftSimulation(p: SimulationParams) {
  return command(
    message(4, [
      ...field(1, zigzag(Math.round((p.windSpeedMs ?? 0) * 100))),
      ...field(2, zigzag(Math.round(clamp(p.gradePct, -100, 100) * 100))),
      ...field(3, (p.cw ?? 0.51) * 10000),
      ...field(4, (p.crr ?? 0.004) * 100000),
    ]),
  );
}

/**
 * Paramètres physiques : champ 5. Braquet virtuel × 10 000 (0 : pas de vitesse virtuelle, simulation simple),
 * masse du vélo et du cycliste × 100.
 */
export const zwiftPhysical = (gearRatio: number, bikeKg: number, riderKg: number) =>
  command(message(5, [...field(2, clamp(gearRatio, 0, 10) * 10000), ...field(4, bikeKg * 100), ...field(5, riderKg * 100)]));
