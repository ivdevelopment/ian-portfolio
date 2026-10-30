import Link from "next/link";
import { cn } from "@/lib/utils";

export type EditLang = "en" | "nl";

export function parseEditLang(value: string | string[] | undefined): EditLang {
  return value === "nl" ? "nl" : "en";
}

/**
 * English / Dutch switch for content editors. English is the stored (base)
 * content; Dutch holds the translation. Dutch never blocks saving or publishing:
 * anything left untranslated falls back to the English text on the Dutch site.
 */
export function LangTabs({ active, basePath }: { active: EditLang; basePath: string }) {
  const tab = (lang: EditLang, label: string) => (
    <Link
      href={lang === "en" ? basePath : `${basePath}?lang=nl`}
      aria-current={active === lang ? "page" : undefined}
      className={cn(
        "rounded-full px-4 py-1.5 text-sm transition-colors",
        active === lang ? "bg-accent-soft text-ink" : "text-muted hover:text-ink",
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="mb-5 space-y-2">
      <div role="navigation" aria-label="Editing language" className="inline-flex rounded-full border border-line p-1">
        {tab("en", "English")}
        {tab("nl", "Nederlands")}
      </div>
      <p className="text-xs text-subtle">
        {active === "nl"
          ? "You're editing the Dutch version (the default language of the site). Fields left unchanged fall back to the English text. Links, images and numbers are shared — change those on the English tab."
          : "You're editing the English version, which is also the fallback for any Dutch field you haven't translated."}
      </p>
    </div>
  );
}
