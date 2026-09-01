/**
 * Recherche d'icones par nom et par synonyme.
 *
 * Separe de `index.ts` a dessein : le rendu n'a besoin que de la geometrie, et
 * l'index de mots-cles (deux fois le poids du reste) ne doit peser ni sur le
 * demarrage du serveur, ni sur le premier affichage du canvas. Il n'est charge
 * que par l'outil `search_icons` et par le selecteur de la GUI.
 */

import { hasIcon, iconNames } from "./index.js";
import { ICON_KEYWORDS_JSON } from "./icon-keywords.js";

let cache: Record<string, string[]> | null = null;

function keywords(): Record<string, string[]> {
  if (cache === null) cache = JSON.parse(ICON_KEYWORDS_JSON) as Record<string, string[]>;
  return cache;
}

export function iconKeywords(name: string): string[] {
  return keywords()[name] ?? [];
}

export interface IconMatch {
  name: string;
  /** Synonymes qui ont fait ressortir l'icone — ce qui explique un resultat inattendu. */
  keywords: string[];
  score: number;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Score d'une icone pour un terme : le nom prime sur les synonymes, et un debut
 * de mot prime sur une occurrence au milieu. Sans cette hierarchie, "user"
 * remonte d'abord les vingt variantes composees plutot que l'icone "user".
 *
 * Le RANG du synonyme compte autant que sa presence : les mots-cles sont
 * ordonnes du plus au moins caracteristique. "home" est le premier synonyme de
 * "house" et le quatrieme de "lamp" — sans cette decote, une recherche sur
 * "home" sortait une lampe avant une maison.
 */
function scoreToken(name: string, tags: string[], token: string): number {
  if (name === token) return 1000;

  const segments = name.split("-");
  const byName = segments.includes(token) ? (segments[0] === token ? 400 : 250) : name.includes(token) ? 120 : 0;

  const exact = tags.indexOf(token);
  const prefix = exact >= 0 ? -1 : tags.findIndex((tag) => tag.startsWith(token));
  const byTag =
    exact >= 0
      ? Math.max(80, 300 - exact * 25)
      : prefix >= 0
        ? Math.max(40, 110 - prefix * 10)
        : tags.some((tag) => tag.includes(token))
          ? 30
          : 0;

  // Le meilleur des deux, jamais leur somme : "close" doit sortir "x", dont
  // c'est le premier synonyme, avant "panel-top-close" qui le porte dans son nom.
  return Math.max(byName, byTag);
}

/**
 * Icones correspondant a une requete en langage naturel.
 *
 * Un terme non reconnu ne vide pas le resultat : les scores s'additionnent, si
 * bien qu'une requete de trois mots dont un seul existe dans la bibliotheque
 * retourne quand meme quelque chose d'utile.
 */
export function searchIcons(query: string, limit = 24): IconMatch[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const index = keywords();
  const matches: IconMatch[] = [];

  for (const name of iconNames()) {
    const tags = index[name] ?? [];
    let score = 0;
    let matched = 0;
    for (const token of tokens) {
      const value = scoreToken(name, tags, token);
      if (value > 0) matched += 1;
      score += value;
    }
    if (score === 0) continue;
    // Une icone qui repond a TOUS les termes passe devant : "credit card" doit
    // sortir "credit-card", pas les trente icones contenant "card". Le bonus est
    // proportionnel et non forfaitaire, sinon deux correspondances tiedes
    // passeraient devant une icone dont le NOM est exactement le terme cherche.
    if (matched === tokens.length && tokens.length > 1) score *= 1.5;
    matches.push({ name, keywords: tags, score });
  }

  return matches
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, limit));
}

/**
 * Noms proches d'un nom d'icone refuse — ce qui transforme une erreur en indice.
 *
 * Les synonymes comptent autant que les noms : c'est ce qui rattrape les
 * renommages de la bibliotheque, ou "home" ne designe plus rien mais reste le
 * synonyme de "house".
 */
export function suggestIcons(name: string, limit = 6): string[] {
  if (hasIcon(name)) return [];
  return searchIcons(name, limit).map((match) => match.name);
}
