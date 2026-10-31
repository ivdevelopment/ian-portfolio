/**
 * Access codes. They are only ever shown once (at creation or reset) and are stored solely as a
 * bcrypt hash computed inside the database. Generation works in the browser and on the server.
 */

/** No look-alikes (0/O, 1/I/L): codes get read aloud and typed from phones. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUPS = 3;
const GROUP_LENGTH = 4;

/** Entropy of a generated code in bits (the prefix is not secret and is not counted). */
export const GENERATED_CODE_BITS = Math.floor(GROUPS * GROUP_LENGTH * Math.log2(CODE_ALPHABET.length));

export const MIN_CODE_LENGTH = 10;
export const MAX_CODE_LENGTH = 128;

function randomInt(max: number, random: (n: Uint8Array) => Uint8Array): number {
  // Rejection sampling so every character is equally likely (no modulo bias).
  const limit = 256 - (256 % max);
  const byte = new Uint8Array(1);
  for (;;) {
    random(byte);
    if (byte[0] < limit) return byte[0] % max;
  }
}

/** Two-to-three letter prefix from a client name ("Geert Kips" → "GK"); purely a memory aid. */
export function codePrefix(clientName: string): string {
  const letters = clientName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("");
  return letters.slice(0, 3) || "PV";
}

/** e.g. "GK-7F3K-9MQX-P4TD": ~59 bits of randomness, not sequential or guessable. */
export function generateAccessCode(
  clientName: string,
  random: (n: Uint8Array) => Uint8Array = (n) => globalThis.crypto.getRandomValues(n),
): string {
  const groups = Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length, random)]).join(""),
  );
  return [codePrefix(clientName), ...groups].join("-");
}

export type CodeCheck = { ok: true; value: string } | { ok: false; error: string };

/** Rules for a manually entered code. Online guessing is also rate limited and bcrypt-slowed. */
export function validateAccessCode(raw: string): CodeCheck {
  const value = raw.trim();
  if (value.length < MIN_CODE_LENGTH) {
    return { ok: false, error: `Use at least ${MIN_CODE_LENGTH} characters (the generator makes a strong one).` };
  }
  if (value.length > MAX_CODE_LENGTH) return { ok: false, error: `Use at most ${MAX_CODE_LENGTH} characters.` };
  if (new Set(value.toLowerCase()).size < 5) return { ok: false, error: "That code is too repetitive." };
  if (/^\d+$/.test(value)) return { ok: false, error: "Don't use digits only — add letters." };
  return { ok: true, value };
}
