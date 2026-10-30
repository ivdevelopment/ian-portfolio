"use client";

import { createContext, useContext } from "react";
import type { Locale } from "./config";
import type { Dictionary } from "./dictionaries";

type LocaleContextValue = { locale: Locale; dict: Dictionary };

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** Makes the active locale and its UI dictionary available to client components. */
export function LocaleProvider({
  locale,
  dict,
  children,
}: LocaleContextValue & { children: React.ReactNode }) {
  return <LocaleContext value={{ locale, dict }}>{children}</LocaleContext>;
}

function useLocaleContext(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("LocaleProvider is missing: wrap public pages in the [locale] layout.");
  return value;
}

export const useLocale = (): Locale => useLocaleContext().locale;
/** For shared components that also render outside the public site (e.g. in the English-only admin). */
export const useOptionalLocale = (): Locale | null => useContext(LocaleContext)?.locale ?? null;
export const useDictionary = (): Dictionary => useLocaleContext().dict;
