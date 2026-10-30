/**
 * Dutch renderings of the English copy that ships in the database seed and in
 * the current production site. The match is EXACT: text an admin has edited,
 * or any text not listed here, is left untouched (it then falls back to the
 * English wording until a Dutch version is saved in the admin). Project
 * descriptions are never machine-translated.
 */
const KNOWN: Record<string, string> = {
  // Hero / home
  "Available for new projects": "Beschikbaar voor nieuwe projecten",
  "Modern websites": "Moderne websites",
  for: "voor",
  "ambitious brands.": "ambitieuze merken.",
  "I design and develop high-quality websites and web applications that look great, perform well and help businesses grow.":
    "Ik ontwerp en ontwikkel hoogwaardige websites en webapplicaties die er sterk uitzien, snel werken en bedrijven helpen groeien.",
  "I design and develop high-quality websites and software applications that look great, perform well and help businesses grow.":
    "Ik ontwerp en ontwikkel hoogwaardige websites en softwaretoepassingen die er sterk uitzien, snel werken en bedrijven helpen groeien.",
  "View my work": "Bekijk mijn werk",
  "Start a project": "Start een project",
  "A laptop on a warm, lamp-lit desk showing the Red Harbor Studios website.":
    "Een laptop op een warm, door een lamp verlicht bureau met de website van Red Harbor Studios.",
  "Projects completed": "Afgeronde projecten",
  "Happy clients": "Tevreden klanten",
  "Years of experience": "Jaar ervaring",
  "Client satisfaction": "Klanttevredenheid",
  "Featured project": "Uitgelicht project",
  Services: "Diensten",
  "What I do": "Wat ik doe",
  "Websites, web applications and everything in between.": "Websites, webapplicaties en alles daartussen.",
  "From clean landing pages to complex web applications, I focus on modern design, strong performance and a smooth user experience.":
    "Van strakke landingspagina's tot complexe webapplicaties: ik focus op modern design, sterke prestaties en een vlotte gebruikservaring.",
  Testimonials: "Ervaringen",
  "What clients say": "Wat klanten zeggen",
  "Let's work together": "Laten we samenwerken",
  "Have a project in mind?": "Heb je een project in gedachten?",
  "Let's build something great together. I'm always open to new projects and love working with ambitious people.":
    "Laten we samen iets moois bouwen. Ik sta altijd open voor nieuwe projecten en werk graag met ambitieuze mensen.",

  // About
  "About me": "Over mij",
  "A passionate developer": "Een gedreven developer",
  "with a creative": "met een creatieve",
  "mindset.": "blik.",
  "I'm Ian, a web developer based in Belgium. I create modern websites and web applications that look great, perform well and help businesses grow.":
    "Ik ben Ian, een webdeveloper uit België. Ik maak moderne websites en webapplicaties die er sterk uitzien, goed presteren en bedrijven helpen groeien.",
  "I enjoy working on challenging projects and bringing ideas to life — from the first sketch and design direction to a fast, maintainable build.":
    "Ik werk graag aan uitdagende projecten en breng ideeën tot leven — van de eerste schets en designrichting tot een snelle, onderhoudbare build.",
  Belgium: "België",

  // Contact
  Contact: "Contact",
  "Start your project": "Start je project",
  "Have an idea or need a new website? Let's talk about it.":
    "Heb je een idee of heb je een nieuwe website nodig? Laten we erover praten.",
  "I usually reply within one or two working days.": "Ik antwoord meestal binnen een à twee werkdagen.",

  // Settings / SEO
  "Ian Verlinden — Web design & development": "Ian Verlinden — Webdesign & webontwikkeling",
  "Ian Verlinden— Web & Software development": "Ian Verlinden — Web & softwareontwikkeling",

  // Services
  "Web Design": "Webdesign",
  "Modern, clean and conversion-focused designs.": "Moderne, strakke en conversiegerichte ontwerpen.",
  "Design direction and layout": "Designrichting en layout",
  "Responsive, mobile-first interfaces": "Responsieve, mobile-first interfaces",
  "Typography and design systems": "Typografie en designsystemen",
  "Prototype before build": "Prototype vóór de bouw",
  "Web Development": "Webdevelopment",
  "Fast, secure and maintainable websites and web apps.": "Snelle, veilige en onderhoudbare websites en webapps.",
  "Next.js and TypeScript builds": "Builds met Next.js en TypeScript",
  "CMS and database integration": "CMS- en databaseintegratie",
  "Performance and SEO foundations": "Performance en SEO-basis",
  "Accessible, semantic markup": "Toegankelijke, semantische markup",
  Redesigns: "Redesigns",
  "Give an existing website a modern upgrade.": "Geef een bestaande website een moderne upgrade.",
  "Audit of the current site": "Audit van de huidige site",
  "Fresh visual direction": "Frisse visuele richting",
  "Content and structure clean-up": "Opschoning van inhoud en structuur",
  "Safe migration with redirects": "Veilige migratie met redirects",
  Maintenance: "Onderhoud",
  "Keep websites updated, fast and secure.": "Hou websites up-to-date, snel en veilig.",
  "Dependency and security updates": "Updates van dependencies en beveiliging",
  "Performance monitoring": "Performance-monitoring",
  "Content changes on request": "Inhoudswijzigingen op aanvraag",
  "Backups and uptime checks": "Back-ups en uptimecontrole",

  // Common project descriptors (tags and categories only)
  Development: "Ontwikkeling",
  "Website Redesign": "Website-redesign",
  "Front-End Development": "Front-endontwikkeling",
  "Responsive Design": "Responsief design",
  "Web Design & Development": "Webdesign & webontwikkeling",
  "Creative Audio Software": "Creatieve audiosoftware",
  "Music & Events": "Muziek & events",
  "Web Application": "Webapplicatie",
  "Creative Design Studio": "Creatieve designstudio",
};

/** The Dutch text for a known English string, or undefined. */
export function knownDutch(text: string): string | undefined {
  return Object.hasOwn(KNOWN, text) ? KNOWN[text] : undefined;
}

/** Descriptors only (tags, categories, subtitles): translates known ones, keeps the rest. */
export function dutchDescriptor(text: string): string {
  return knownDutch(text) ?? text;
}
