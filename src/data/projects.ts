import type { Project } from "@/types/project";

/**
 * Placeholder portfolio entries. Screenshots in /public/media/projects are
 * generated stand-ins; swap `thumbnail` / `gallery` for real captures.
 * Image, GIF and video media are all supported by `ProjectMedia`.
 */
export const projects: Project[] = [
  {
    id: "prj-red-harbor",
    slug: "red-harbor-studios",
    title: "Red Harbor Studios",
    subtitle: "Creative Audio Software",
    shortDescription:
      "A modern website for my audio software brand, featuring product showcases, marketing pages and a CMS.",
    description:
      "Red Harbor Studios is my audio software brand. The goal was to create a modern, clean and professional website that showcases the products, builds trust and makes it easy to manage content.",
    category: "Creative Audio Software",
    kind: "website",
    tags: ["Web Design", "Development", "CMS"],
    technologies: ["Next.js", "Tailwind CSS", "Supabase"],
    keyFeatures: [
      "Modern and clean design",
      "Fully responsive",
      "Custom CMS",
      "Optimized performance",
      "Product showcase pages",
      "Blog / news system",
    ],
    year: 2026,
    client: "Red Harbor Studios",
    projectType: "personal",
    thumbnail: "/media/projects/red-harbor-home.svg",
    heroMedia: {
      type: "image",
      src: "/media/projects/red-harbor-home.svg",
      alt: "Red Harbor Studios homepage with a pair of red-accented headphones.",
    },
    gallery: [
      {
        type: "image",
        src: "/media/projects/red-harbor-home.svg",
        alt: "Red Harbor Studios homepage.",
      },
      {
        type: "image",
        src: "/media/projects/red-harbor-products.svg",
        alt: "Product library page with three audio plugins.",
      },
      {
        type: "image",
        src: "/media/projects/red-harbor-blog.svg",
        alt: "News and journal listing.",
      },
      {
        type: "image",
        src: "/media/projects/red-harbor-cms.svg",
        alt: "Custom CMS product management screen.",
      },
    ],
    // TODO: confirm the production URL before launch.
    liveUrl: "https://redharborstudios.com",
    previewMode: "media",
    featured: true,
    published: true,
    sortOrder: 1,
  },
  {
    id: "prj-afroton",
    slug: "afroton",
    title: "Afroton",
    subtitle: "Website Redesign",
    shortDescription:
      "A bold redesign for a music and events brand, built around rhythm, colour and upcoming shows.",
    description:
      "A placeholder case study. Afroton is a sample brand used to demonstrate how redesign projects appear in the portfolio.",
    category: "Music & Events",
    kind: "redesign",
    tags: ["Web Design", "Redesign"],
    technologies: ["Next.js", "Tailwind CSS"],
    keyFeatures: ["Event listings", "Responsive layouts", "Artist pages"],
    year: 2025,
    projectType: "concept",
    thumbnail: "/media/projects/afroton.svg",
    gallery: [
      {
        type: "image",
        src: "/media/projects/afroton.svg",
        alt: "Afroton homepage with an orange sun motif.",
      },
    ],
    previewMode: "media",
    featured: true,
    published: true,
    sortOrder: 2,
  },
  {
    id: "prj-lumen",
    slug: "lumen-studio",
    title: "Lumen Studio",
    subtitle: "Website",
    shortDescription:
      "A calm, editorial portfolio site for a creative design studio, led by photography and generous whitespace.",
    description:
      "A placeholder case study. Lumen Studio is a sample brand showing a lighter, editorial direction.",
    category: "Creative Design Studio",
    kind: "concept",
    tags: ["Web Design", "Development"],
    technologies: ["Next.js", "TypeScript", "Tailwind CSS"],
    keyFeatures: ["Editorial layouts", "Project case studies", "Contact flow"],
    year: 2025,
    projectType: "concept",
    thumbnail: "/media/projects/lumen-studio.svg",
    gallery: [
      {
        type: "image",
        src: "/media/projects/lumen-studio.svg",
        alt: "Lumen Studio homepage with warm editorial imagery.",
      },
    ],
    previewMode: "media",
    featured: true,
    published: true,
    sortOrder: 3,
  },
  {
    id: "prj-nova",
    slug: "nova-dashboard",
    title: "Nova Dashboard",
    subtitle: "Web Application",
    shortDescription:
      "An analytics dashboard concept with clear data visualisation and a focused, fast interface.",
    description:
      "A placeholder case study. Nova is a sample product used to demonstrate how web applications appear in the portfolio.",
    category: "Web Application",
    kind: "web-app",
    tags: ["Web App", "Development"],
    technologies: ["Next.js", "TypeScript", "PostgreSQL"],
    keyFeatures: ["KPI overview", "Interactive charts", "Role-based access"],
    year: 2026,
    projectType: "concept",
    thumbnail: "/media/projects/nova-dashboard.svg",
    gallery: [
      {
        type: "image",
        src: "/media/projects/nova-dashboard.svg",
        alt: "Nova analytics dashboard with KPI cards and a revenue chart.",
      },
    ],
    previewMode: "media",
    featured: true,
    published: true,
    sortOrder: 4,
  },
];
