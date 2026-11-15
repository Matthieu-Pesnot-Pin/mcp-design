const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Identifiant court, lisible dans un JSON lu par un agent. */
export function shortId(prefix: string, length = 8): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** "Ma Landing Page" -> "ma-landing-page" */
export function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "design";
}

/** Slug de 48 caractères au plus, suivi du suffixe numérique ou aléatoire d'une collision. */
const DESIGN_ID = /^[a-z0-9][a-z0-9-]{0,47}(?:-\d{1,2}|-x_[a-z0-9]{4})?$/;

/** Vrai pour un identifiant de la forme produite par `slugify` et `allocateDesignId`. */
export function isDesignId(value: unknown): value is string {
  return typeof value === "string" && DESIGN_ID.test(value);
}
