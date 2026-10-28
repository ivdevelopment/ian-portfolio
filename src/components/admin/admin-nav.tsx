"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { adminModules } from "./admin-modules";

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin modules" className="no-scrollbar overflow-x-auto px-3 pb-3 md:pb-6">
      <ul className="flex gap-1 md:flex-col">
        {adminModules.map((mod) => {
          const active = mod.href
            ? mod.href === "/admin"
              ? pathname === "/admin"
              : pathname === mod.href || pathname.startsWith(`${mod.href}/`)
            : false;
          const content = (
            <>
              <mod.icon aria-hidden className="size-4 shrink-0" />
              <span>{mod.label}</span>
              {mod.note && (
                <span className="ml-auto hidden rounded-full border border-line px-2 py-0.5 text-[0.65rem] tracking-wide whitespace-nowrap text-subtle uppercase md:inline">
                  {mod.note}
                </span>
              )}
            </>
          );
          const classes = cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
            active ? "bg-glass-strong text-ink" : "text-muted",
          );

          return (
            <li key={mod.id}>
              {mod.href ? (
                <Link
                  href={mod.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(classes, !active && "hover:bg-glass hover:text-ink")}
                >
                  {content}
                </Link>
              ) : (
                <span aria-disabled="true" className={cn(classes, "cursor-default opacity-60")}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
