/**
 * Deep equality for plain JSON-like form values (strings, numbers, booleans,
 * arrays, objects). Array order matters (reordering is a change); object key
 * order does not; `undefined` properties are treated as missing.
 */
export function snapshotEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => snapshotEqual(item, b[i]));
  }

  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const key of keys) {
    if (!snapshotEqual(x[key], y[key])) return false;
  }
  return true;
}
