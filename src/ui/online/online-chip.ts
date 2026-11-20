import './online-chip.css';

/**
 * La pastille « En ligne » de l'accueil : le nombre d'autres coureurs, et un toucher ouvre le panneau « Rouler avec d'autres ».
 * Son contenu (icône, libellé) est dans index.html : le lancement n'en porte pas le poids. Cachée hors ligne.
 */
export function setupOnlineChip(button: HTMLButtonElement, onOpen: () => void) {
  const count = button.querySelector<HTMLElement>('.online-count')!;
  button.addEventListener('click', onOpen);
  return {
    /** `others` : coureurs en ligne autres que soi ; `undefined` : pas connecté à la salle, la pastille se cache. */
    setOthers(others: number | undefined): void {
      button.hidden = others === undefined;
      if (others === undefined) return;
      count.textContent = others > 0 ? String(others) : '';
      button.dataset.live = String(others > 0);
      button.setAttribute('aria-label', others > 0 ? `Rouler avec d’autres : ${others} en ligne` : 'Rouler avec d’autres : personne d’autre en ligne');
    },
  };
}
