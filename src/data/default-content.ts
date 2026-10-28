import type {
  AboutContent,
  ContactContent,
  HomeContent,
  ServiceItem,
  SiteSettings,
  SkillItem,
} from "@/lib/schemas/site-content";

/**
 * Structural fallbacks only. The database (seeded by the P2 migration with this
 * same wording) is the source of truth; these keep the public site rendering
 * if a content row is missing or fails validation. No reviews live here.
 */

export const defaultSiteSettings: SiteSettings = {
  siteName: "Ian Verlinden",
  displayName: "Ian Verlinden",
  location: "Belgium",
  contactEmail: "",
  githubUrl: "",
  linkedinUrl: "",
  instagramUrl: "",
  xUrl: "",
  seoDefaultTitle: "Ian Verlinden — Web design & development",
  seoTitleTemplate: "%s — Ian Verlinden",
  seoDefaultDescription:
    "I design and develop high-quality websites and web applications that look great, perform well and help businesses grow.",
  seoOgTitle: "",
};

export const defaultHomeContent: HomeContent = {
  hero: {
    badge: "Available for new projects",
    headline: { line1: "Modern websites", line2: "for", accent: "ambitious brands." },
    body: "I design and develop high-quality websites and web applications that look great, perform well and help businesses grow.",
    primaryCta: { label: "View my work", href: "/work" },
    secondaryCta: { label: "Start a project", href: "/contact" },
    image: {
      src: "/media/scenes/hero-workspace.svg",
      alt: "A laptop on a warm, lamp-lit desk showing the Red Harbor Studios website.",
    },
  },
  stats: [],
  featured: { eyebrow: "", heading: "Featured project", body: "" },
  services: {
    eyebrow: "Services",
    heading: "What I do",
    statement: "Websites, web applications and everything in between.",
    body: "From clean landing pages to complex web applications, I focus on modern design, strong performance and a smooth user experience.",
  },
  reviews: { eyebrow: "Testimonials", heading: "What clients say", body: "" },
  cta: {
    badge: "Let's work together",
    heading: "Have a project in mind?",
    body: "Let's build something great together. I'm always open to new projects and love working with ambitious people.",
    primaryCta: { label: "Start a project", href: "/contact" },
    secondaryCta: { label: "View my work", href: "/work" },
    image: { src: "/media/scenes/cta-workspace.svg", alt: "" },
  },
};

export const defaultAboutContent: AboutContent = {
  eyebrow: "About me",
  headline: { line1: "A passionate developer", line2: "with a creative", accent: "mindset." },
  intro:
    "I'm Ian, a web developer based in Belgium. I create modern websites and web applications that look great, perform well and help businesses grow.",
  body: "",
  portrait: null,
  location: "",
  availability: "",
  metrics: [],
};

export const defaultContactContent: ContactContent = {
  eyebrow: "Contact",
  heading: "Start your project",
  description: "Have an idea or need a new website? Let's talk about it.",
  email: "",
  responseTime: "",
  availability: "",
};

export const defaultServices: ServiceItem[] = [];
export const defaultSkills: SkillItem[] = [];
