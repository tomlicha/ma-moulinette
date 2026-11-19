import type { EditorOptions } from './workout-editor';

/** L'éditeur de séance chargé à la demande : son code (~40 Kio) ne pèse pas sur le lancement (budget : tools/ci/bundle-budget.mjs). */
export interface LazyWorkoutEditor {
  /** À appeler à chaque arrivée sur l'écran Séances : charge l'éditeur la première fois, puis ouvre la séance choisie. */
  sync(): void;
  /** La connexion du trainer ou la séance en cours a changé : « Rouler » en dépend. Sans effet tant que l'éditeur n'est pas chargé. */
  refreshRide(): void;
  /** La FTP a changé. Sans effet tant que l'éditeur n'est pas chargé : il relit tout à l'arrivée. */
  refresh(): void;
  /** Séances ou blocs changés depuis un autre appareil. Sans effet tant que l'éditeur n'est pas chargé : il relit tout à l'arrivée. */
  libraryChanged(): void;
}

type Editor = ReturnType<typeof import('./workout-editor').setupWorkoutEditor>;

export function lazyWorkoutEditor(options: EditorOptions): LazyWorkoutEditor {
  let loading: Promise<Editor> | undefined;
  let editor: Editor | undefined;
  const load = () =>
    (loading ??= import('./workout-editor').then((m) => {
      editor = m.setupWorkoutEditor(options);
      editor.refreshRide();
      return editor;
    }));
  // Chargé dès que le navigateur est au repos : l'arrivée sur l'écran Séances ne l'attend (presque) jamais, et sa feuille
  // de style est là avant que l'écran ne s'affiche.
  const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (run: () => void) => setTimeout(run, 1500);
  idle(() => void load());
  return {
    sync: () => void load().then((e) => e.sync()),
    refreshRide: () => editor?.refreshRide(),
    refresh: () => editor?.refresh(),
    libraryChanged: () => editor?.libraryChanged(),
  };
}
