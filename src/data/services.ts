import type { Service } from "@/types/service";

export const services: Service[] = [
  {
    id: "svc-design",
    slug: "web-design",
    title: "Web Design",
    description: "Modern, clean and conversion-focused designs.",
    icon: "design",
    includes: [
      "Design direction and layout",
      "Responsive, mobile-first interfaces",
      "Typography and design systems",
      "Prototype before build",
    ],
  },
  {
    id: "svc-development",
    slug: "web-development",
    title: "Web Development",
    description: "Fast, secure and maintainable websites and web apps.",
    icon: "development",
    includes: [
      "Next.js and TypeScript builds",
      "CMS and database integration",
      "Performance and SEO foundations",
      "Accessible, semantic markup",
    ],
  },
  {
    id: "svc-redesign",
    slug: "redesigns",
    title: "Redesigns",
    description: "Give an existing website a modern upgrade.",
    icon: "redesign",
    includes: [
      "Audit of the current site",
      "Fresh visual direction",
      "Content and structure clean-up",
      "Safe migration with redirects",
    ],
  },
  {
    id: "svc-maintenance",
    slug: "maintenance",
    title: "Maintenance",
    description: "Keep websites updated, fast and secure.",
    icon: "maintenance",
    includes: [
      "Dependency and security updates",
      "Performance monitoring",
      "Content changes on request",
      "Backups and uptime checks",
    ],
  },
];
