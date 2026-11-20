import './whats-new-chip.css';

/**
 * La pastille « Nouveautés » de l'en-tête de l'accueil : ouvre le journal ; un point orange tant qu'il reste du non-lu.
 * Son contenu (icône, libellé, point) est dans index.html : le lancement n'en porte pas le poids (tools/ci/bundle-budget.mjs).
 * Sur iPhone, seule l'icône reste (le libellé passe dans `aria-label`).
 */
export function setupNewsChip(button: HTMLButtonElement, onOpen: () => void) {
  button.addEventListener('click', onOpen);
  return {
    setUnread(unread: boolean): void {
      button.dataset.unread = String(unread);
      button.setAttribute('aria-label', unread ? 'Nouveautés, du nouveau à lire' : 'Nouveautés');
    },
  };
}
