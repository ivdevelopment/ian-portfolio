import { FileSignature, FolderKanban, KanbanSquare, LayoutDashboard, Settings, UserCheck, Users, CalendarClock, type LucideIcon } from "lucide-react";

/**
 * The CRM's information architecture. Groups and order follow the daily workflow: what needs attention, who is in the pipeline,
 * what work is quoted or running. `planned` entries are the agreed future areas (billing); they are NOT rendered until the feature
 * exists, they only reserve the place in the structure.
 */
export type CrmNavItem = { id: string; label: string; href: string; icon: LucideIcon; planned?: boolean };
export type CrmNavGroup = { id: string; label: string | null; items: CrmNavItem[] };

export const CRM_NAV: CrmNavGroup[] = [
  { id: "overview", label: null, items: [{ id: "dashboard", label: "Dashboard", href: "/", icon: LayoutDashboard }] },
  {
    id: "sales",
    label: "Sales",
    items: [
      { id: "prospects", label: "Prospects", href: "/prospects", icon: Users },
      { id: "pipeline", label: "Pipeline", href: "/pipeline", icon: KanbanSquare },
      { id: "follow-ups", label: "Follow-ups", href: "/follow-ups", icon: CalendarClock },
      { id: "clients", label: "Clients", href: "/clients", icon: UserCheck },
    ],
  },
  {
    id: "work",
    label: "Work",
    items: [
      { id: "quotes", label: "Quotes", href: "/quotes", icon: FileSignature },
      { id: "projects", label: "Projects", href: "/projects", icon: FolderKanban },
      // Future billing (not built): invoices, payments, e-invoicing. They will join this group when an integration exists.
      // { id: "invoices", label: "Invoices", href: "/invoices", icon: Receipt, planned: true },
    ],
  },
  { id: "settings", label: null, items: [{ id: "settings", label: "Settings", href: "/settings", icon: Settings }] },
];

/** Is `href` the section the visitor is in? The dashboard only matches exactly. */
export function isActiveCrmPath(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
