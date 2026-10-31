import {
  FileText,
  FolderKanban,
  Globe,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  MessageSquareQuote,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type AdminModule = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Present for functional modules; placeholders have no href. */
  href?: string;
  /** Short note shown on placeholder modules. */
  note?: string;
};

export const adminModules: AdminModule[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Overview of projects and new inquiries.",
    icon: LayoutDashboard,
    href: "/admin",
  },
  {
    id: "projects",
    label: "Projects",
    description: "Create, edit, publish, feature and delete projects, and manage their media.",
    icon: FolderKanban,
    href: "/admin/projects",
  },
  {
    id: "prospects",
    label: "Prospects",
    description: "Website-sales CRM: prospects, follow-ups and activity.",
    icon: Users,
    href: "/admin/prospects",
  },
  {
    id: "previews",
    label: "Client Previews",
    description: "Private, access-code protected previews of client websites.",
    icon: Globe,
    href: "/admin/previews",
  },
  {
    id: "reviews",
    label: "Reviews",
    description: "Collect, approve and publish client reviews.",
    icon: MessageSquareQuote,
    href: "/admin/reviews",
  },
  {
    id: "inquiries",
    label: "Inquiries",
    description: "Project requests from the contact form.",
    icon: Inbox,
    href: "/admin/inquiries",
  },
  {
    id: "media",
    label: "Media",
    description: "Browse uploaded files and see where each one is used.",
    icon: ImageIcon,
    href: "/admin/media",
  },
  {
    id: "pages",
    label: "Pages",
    description: "Hero text, statistics, services and about content.",
    icon: FileText,
    href: "/admin/pages",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Site details, social links and SEO defaults.",
    icon: Settings,
    href: "/admin/settings",
  },
];
