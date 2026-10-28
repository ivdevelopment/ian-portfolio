/**
 * Editable page copy and numbers. Everything here is placeholder content
 * that the P1 admin ("Site content" module) will eventually own.
 */

export const homeContent = {
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
  services: {
    eyebrow: "Services",
    title: "What I do",
    statement: "Websites, web applications and everything in between.",
    body: "From clean landing pages to complex web applications, I focus on modern design, strong performance and a smooth user experience.",
  },
  reviews: {
    eyebrow: "Testimonials",
    title: "What clients say",
    note: "Sample reviews — placeholder content until real client feedback is added.",
  },
  cta: {
    badge: "Let's work together",
    title: "Have a project in mind?",
    body: "Let's build something great together. I'm always open to new projects and love working with ambitious people.",
    image: "/media/scenes/cta-workspace.svg",
  },
} as const;

/** Placeholder development values — change them here only. */
export const stats = [
  { id: "projects", value: "12+", label: "Projects completed" },
  { id: "clients", value: "8+", label: "Happy clients" },
  { id: "experience", value: "3+", label: "Years of experience" },
  { id: "satisfaction", value: "100%", label: "Client satisfaction" },
] as const;

export const aboutContent = {
  eyebrow: "About me",
  headline: { line1: "A passionate developer", line2: "with a creative", accent: "mindset." },
  paragraphs: [
    "I'm Ian, a web developer based in Belgium. I create modern websites and web applications that look great, perform well and help businesses grow.",
    "I enjoy working on challenging projects and bringing ideas to life — from the first sketch and design direction to a fast, maintainable build.",
  ],
  /**
   * Replace with a real portrait, e.g. "/media/about/ian.jpg".
   * While `undefined`, a neutral placeholder is rendered.
   */
  photo: undefined as { src: string; alt: string } | undefined,
  metrics: [
    { id: "experience", value: "3+", label: "Years of experience" },
    { id: "projects", value: "20+", label: "Projects completed" },
    { id: "satisfaction", value: "100%", label: "Client satisfaction" },
    { id: "location", value: "Belgium", label: "Based in" },
  ],
  skills: [
    "Next.js",
    "TypeScript",
    "React",
    "Tailwind CSS",
    "Node.js",
    "PostgreSQL",
    "Supabase",
  ],
} as const;

export const contactContent = {
  eyebrow: "Contact",
  title: "Start your project",
  body: "Have an idea or need a new website? Let's talk about it.",
  responseTime: "I usually reply within one or two working days.",
} as const;
