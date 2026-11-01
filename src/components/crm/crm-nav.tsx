"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CRM_NAV, isActiveCrmPath } from "@/crm/nav";
import { cn } from "@/lib/utils";

/** The CRM's grouped navigation. Used by the desktop sidebar and by the mobile drawer (`onNavigate` closes it). */
export function CrmNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="CRM" className="space-y-5">
      {CRM_NAV.map((group) => (
        <div key={group.id}>
          {group.label && <p className="mb-1.5 px-3 text-[0.68rem] font-medium tracking-wider text-subtle uppercase">{group.label}</p>}
          <ul className="space-y-0.5">
            {group.items
              .filter((item) => !item.planned)
              .map((item) => {
                const active = isActiveCrmPath(item.href, pathname);
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        active ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-glass hover:text-ink",
                      )}
                    >
                      <item.icon aria-hidden className={cn("size-4 shrink-0", active && "text-accent")} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
