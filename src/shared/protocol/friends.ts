/** Les amis d'un compte (docs/design/groupe.md) : ce que le serveur et la page se disent. */

export const FRIENDS_PATH = '/api/friends';
/** Amis par compte : de quoi couvrir une salle de club, sans que la liste envoyée à la salle ne devienne énorme. */
export const MAX_FRIENDS = 100;

/** Un ami : l'identifiant de son compte, et le nom qu'il montre aux autres. */
export interface Friend {
  id: string;
  name: string;
}

/** Un identifiant de compte tel que la salle l'accepte : lettres, chiffres, tiret et souligné, 40 caractères au plus. */
export const isAccountId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 40 && /^[\w-]+$/.test(v);
