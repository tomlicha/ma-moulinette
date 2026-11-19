/** Un élément de la page par son identifiant (la page est celle d'index.html : il y est toujours). */
export const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
