/** Ce que l'application demande à un stockage de clés : le `Storage` du navigateur le remplit, une mémoire aussi (tests). */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
