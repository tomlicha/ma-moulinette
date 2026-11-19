import type { BlockReason } from '../shared/blocked';

/** Raison « pas de trainer », avec le raccourci qui mène à l'écran des appareils. */
export const needTrainer = (goDevices: () => void, text: string): BlockReason => ({
  text,
  action: { label: 'Connecter le trainer', run: goDevices },
});

/** Raison « ce trainer ne pilote pas cela » (il mesure seulement), avec le raccourci pour en changer. */
export const noControl = (goDevices: () => void, trainerName: string | undefined, what: string): BlockReason => ({
  text: `${trainerName ?? 'Cet appareil'} mesure ta puissance mais ne pilote pas la résistance (pas de ${what}). Il faut un home trainer connecté pour ça.`,
  action: { label: 'Changer d’appareil', run: goDevices },
});
