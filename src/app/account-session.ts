import { loginUrl, prefersStravaApp, type AccountState, type User } from '../infra/net/account';
import type { KeyValueStore } from '../shared/util/key-value-store';
import { TypedEmitter } from '../shared/util/typed-emitter';

/** Les gestes du compte vus du serveur (infra/net/account.ts) : injectés, pour qu'on puisse les remplacer par des faux. */
export interface AccountApi {
  fetchAccount(): Promise<AccountState>;
  saveDisplayName(name: string): Promise<User>;
  logout(): Promise<void>;
  devLogin(name: string): Promise<User>;
  /** Coquille native : connexion Strava dans une session d'authentification système. `false` si annulée ou refusée. */
  nativeStravaLogin(): Promise<boolean>;
}

export interface AccountSessionDeps {
  api: AccountApi;
  /** Garde l'instant du dernier essai de connexion par l'app Strava (Android). */
  store: KeyValueStore;
  clock?: () => number;
  /** Le système, que le choix « par l'app Strava ou par la page web » regarde. */
  env: () => { userAgent: string; platform?: string | undefined };
  /** Coquille native (iOS, Android) : la connexion Strava passe par la session système, pas par une adresse web. */
  native: boolean;
  log: (msg: string) => void;
}

/** Instant du dernier essai de connexion par l'app Strava, effacé dès qu'une session s'ouvre. */
const APP_TRY_KEY = 'mm.stravaAppTry';

/**
 * Le compte du joueur : qui est connecté, et les gestes qui changent cela (connexion Strava, connexion de développement,
 * nom affiché, déconnexion). Facultatif : sans serveur de comptes (`unavailable`), l'application marche entièrement seule.
 * L'écran (ui/account/account-chip.ts) affiche l'état et lui signale les gestes.
 *
 * Événements : `changed` à chaque nouvel état ; `firstSignIn` juste après, quand le joueur vient de se connecter et
 * n'a pas encore validé son nom (l'écran lui demande alors).
 */
export class AccountSession extends TypedEmitter<{ changed: [state: AccountState]; firstSignIn: [user: User] }> {
  private current: AccountState = { kind: 'unavailable' };
  private readonly clock: () => number;

  constructor(private readonly deps: AccountSessionDeps) {
    super();
    this.clock = deps.clock ?? (() => Date.now());
  }

  get state(): AccountState {
    return this.current;
  }

  /** La connexion Strava passe par la session système (coquille native), pas par une adresse web. */
  get nativeLogin(): boolean {
    return this.deps.native;
  }

  /** Relit l'état auprès du serveur. */
  async refresh(): Promise<void> {
    this.set(await this.deps.api.fetchAccount());
  }

  /** Adresse de la connexion Strava par le navigateur : par l'app Strava sur Android, sauf si l'essai précédent n'a rien donné. */
  webLoginHref(): string {
    const viaApp = prefersStravaApp(this.deps.env(), this.readAppTry(), this.clock());
    this.writeAppTry(viaApp ? this.clock() : undefined);
    this.deps.log(`compte : connexion Strava par ${viaApp ? 'l’app Strava' : 'la page web de Strava'}`);
    return loginUrl(viaApp);
  }

  /** Coquille native : connexion Strava par la session système. */
  async loginNative(): Promise<void> {
    this.deps.log('compte : connexion Strava par la session système');
    try {
      const ok = await this.deps.api.nativeStravaLogin();
      this.deps.log(ok ? 'compte : connecté avec Strava' : 'compte : connexion Strava annulée');
      if (ok) void this.refresh();
    } catch (err) {
      this.deps.log(`compte : connexion Strava impossible (${err instanceof Error ? err.message : err})`);
    }
  }

  /** Connexion de développement, par simple nom. Un refus est journalisé, pas relancé. */
  async devLogin(name: string): Promise<void> {
    try {
      const user = await this.deps.api.devLogin(name);
      this.deps.log(`compte : connecté en développement (${user.displayName})`);
      void this.refresh();
    } catch (e) {
      this.deps.log(`compte : connexion de développement refusée (${e instanceof Error ? e.message : e})`);
    }
  }

  /** Valide ou change le nom montré aux autres. Un refus du serveur (`invalid_name`, panne) est relancé : l'écran le dit. */
  async saveName(name: string): Promise<User> {
    const user = await this.deps.api.saveDisplayName(name);
    if (this.current.kind === 'signed-in') this.set({ ...this.current, user });
    this.deps.log(`compte : nom affiché « ${user.displayName} »`);
    return user;
  }

  async logout(): Promise<void> {
    try {
      await this.deps.api.logout();
      this.deps.log('compte : déconnecté');
    } catch (err) {
      this.deps.log(`compte : déconnexion impossible (${err instanceof Error ? err.message : err})`);
    }
    await this.refresh();
  }

  private set(next: AccountState): void {
    if (next.kind === 'signed-in') this.writeAppTry(undefined);
    const firstSignIn = next.kind === 'signed-in' && !next.user.nameConfirmed && this.current.kind !== 'signed-in';
    this.current = next;
    this.emit('changed', next);
    if (firstSignIn && next.kind === 'signed-in') this.emit('firstSignIn', next.user);
  }

  private readAppTry(): number | undefined {
    try {
      const v = Number(this.deps.store.getItem(APP_TRY_KEY));
      return v > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  }

  private writeAppTry(v: number | undefined): void {
    try {
      if (v === undefined) this.deps.store.removeItem(APP_TRY_KEY);
      else this.deps.store.setItem(APP_TRY_KEY, String(v));
    } catch {
      // stockage indisponible : chaque essai repasse par l'app, sans autre conséquence
    }
  }
}
