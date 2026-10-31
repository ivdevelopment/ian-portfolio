export type ListboxKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/** Next highlighted index for a listbox of `length` options (no wrapping, like a native select). */
export function nextListboxIndex(key: ListboxKey, current: number, length: number): number {
  if (length <= 0) return -1;
  switch (key) {
    case "ArrowDown":
      return Math.min(length - 1, current < 0 ? 0 : current + 1);
    case "ArrowUp":
      return Math.max(0, current < 0 ? 0 : current - 1);
    case "Home":
      return 0;
    case "End":
      return length - 1;
  }
}

/** Index of the next option whose label starts with `typed` (type-ahead), searching after `from`, wrapping. */
export function typeaheadIndex(labels: string[], typed: string, from: number): number {
  const needle = typed.toLowerCase();
  if (!needle) return -1;
  for (let step = 1; step <= labels.length; step++) {
    const i = (from + step) % labels.length;
    if (labels[i].toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}
