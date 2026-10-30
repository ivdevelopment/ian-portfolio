import type { Locale } from "../config";
import { en, type Dictionary } from "./en";
import { nl } from "./nl";

export type { Dictionary };

const dictionaries: Record<Locale, Dictionary> = { nl, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/** Fills `{placeholders}`: fmt("Hi {name}", { name: "Ian" }). */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
}
