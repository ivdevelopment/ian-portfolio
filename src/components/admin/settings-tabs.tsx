import Link from "next/link";
import { cn } from "@/lib/utils";

/** General | Quotes | Integrations, shared by the settings pages. */
export function SettingsTabs({ active }: { active: "general" | "quotes" | "integrations" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={cn("rounded-full px-4 py-1.5 text-sm transition-colors", on ? "bg-accent-strong text-white" : "text-muted hover:text-ink")}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="Settings sections" className="mb-5 inline-flex rounded-full border border-line bg-glass p-1">
      {tab("/admin/settings", "General", active === "general")}
      {tab("/admin/settings/quotes", "Quotes", active === "quotes")}
      {tab("/admin/settings/integrations", "Integrations", active === "integrations")}
    </nav>
  );
}
