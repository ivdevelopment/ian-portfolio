import {
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  MessageSquareQuote,
  Settings,
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
    id: "reviews",
    label: "Reviews",
    description: "Collect, approve and publish client reviews.",
    icon: MessageSquareQuote,
    note: "Coming in P2",
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
    description: "Screenshots, GIFs and videos are managed inside each project.",
    icon: ImageIcon,
    note: "In each project",
  },
  {
    id: "pages",
    label: "Pages",
    description: "Hero text, statistics, services and about content.",
    icon: FileText,
    note: "Coming in P2",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Site details and contact information.",
    icon: Settings,
    note: "Coming in P2",
  },
];
