import crypto from "crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Identifiant court, lisible dans un JSON lu par un agent. */
export function shortId(prefix: string, length = 8): string {
  const bytes = crypto.randomBytes(length);
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
