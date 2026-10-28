import {
  FileText,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  MessageSquareQuote,
  Settings,
  FolderKanban,
  type LucideIcon,
} from "lucide-react";

export type AdminModule = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Milestone in which the module ships. */
  milestone: "P1" | "P2";
};

export const adminModules: AdminModule[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Overview of projects, reviews and new inquiries.",
    icon: LayoutDashboard,
    milestone: "P1",
  },
  {
    id: "projects",
    label: "Projects",
    description: "Create, edit, reorder, publish and feature projects; upload media; choose the preview type.",
    icon: FolderKanban,
    milestone: "P1",
  },
  {
    id: "reviews",
    label: "Reviews",
    description: "Add reviews, receive submissions, approve or reject, publish.",
    icon: MessageSquareQuote,
    milestone: "P2",
  },
  {
    id: "inquiries",
    label: "Inquiries",
    description: "Receive project requests and manage their status.",
    icon: Inbox,
    milestone: "P2",
  },
  {
    id: "media",
    label: "Media",
    description: "Screenshots, GIFs and videos stored in Supabase Storage.",
    icon: ImageIcon,
    milestone: "P1",
  },
  {
    id: "pages",
    label: "Pages",
    description: "Hero text, statistics, services and about content.",
    icon: FileText,
    milestone: "P2",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Site details and contact information.",
    icon: Settings,
    milestone: "P2",
  },
];
