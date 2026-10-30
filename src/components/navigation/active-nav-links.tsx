"use client";

import { usePathname } from "next/navigation";
import { useLocale } from "@/i18n/context";
import { NavLinkList } from "./nav-link-list";

export function ActiveNavLinks() {
  const pathname = usePathname();
  return <NavLinkList pathname={pathname} locale={useLocale()} />;
}
