/**
 * Editorial decisions for the concept-site import. Everything else (copy, Dutch
 * descriptions, features, files, live URLs) comes from portfolio-projects.json.
 *
 * - Array order is the My Work order (`sortOrder` values leave room to slot other work in).
 * - `sector` becomes the category and the third tag; Dutch comes from i18n/known-dutch.
 * - `gallery` is the keys of the manifest screenshots to show, after the cover and
 *   before the framed phone shot. `captionsNl` covers those three kinds of image.
 */
export const CONCEPTS = [
  {
    slug: "struct",
    sortOrder: 10,
    featured: true,
    sector: { en: "Construction", nl: "Bouw" },
    gallery: ["home-desktop", "quote-wizard", "realisations", "planning"],
    captionsNl: {
      cover: "Voor-en-naschuifregelaar van dezelfde woning naast de projectgegevens",
      "home-desktop": "Homepage met de kop Renovatie zonder verrassingen en kerncijfers",
      "quote-wizard": "Offertewizard in zeven stappen met live overzicht",
      realisations: "Realisaties met filters op type werk en gemeente",
      planning: "Werfplanning van achttien weken als Gantt-grafiek",
      "home-mobile": "Homepage op een smartphone met vaste call-to-action",
    },
  },
  {
    slug: "form-studio",
    sortOrder: 20,
    featured: true,
    sector: { en: "Architecture", nl: "Architectuur" },
    gallery: ["drawing", "project-list", "case-study", "title-block"],
    captionsNl: {
      cover: "Poché-opening: Architecture shaped by place, zwarte massa tegen baksteen",
      drawing: "Plan van het gelijkvloers, gegenereerd uit data in meter",
      "project-list": "Dezelfde projecten in de typografische indexweergave, met voorbeeld bij hover",
      "case-study": "Case study House V: passende titel en foto over de volle breedte",
      "title-block": "Footer getekend als titelblok van een tekenblad",
      "home-mobile": "Opening van de homepage op een smartphone",
    },
  },
  {
    slug: "noir-house",
    sortOrder: 30,
    featured: true,
    sector: { en: "Hospitality", nl: "Horeca" },
    gallery: ["booking", "rooms", "availability", "guide"],
    captionsNl: {
      cover: "Hero: een gebogen raam op een capitonné hoofdbord, met de boekingsbalk",
      booking: "Boekingsflow in meerdere stappen: verblijfsdata gekozen op de kalender",
      rooms: "Kamerbrowser met filters over verspringende foto's",
      availability: "Beschikbaarheidspaneel op de kamerpagina met een gespecificeerd voorbeeldverblijf",
      guide: "Gids van de receptie: filterbare plekken op een handgetekende kaart",
      "home-mobile": "Hero van de homepage op een smartphone",
    },
  },
  {
    slug: "vanta-motors",
    sortOrder: 40,
    featured: true,
    sector: { en: "Automotive", nl: "Automotive" },
    gallery: ["inventory", "vehicle-detail", "compare", "finance"],
    captionsEn: { cover: "The 911 GT3 spread: an oversized title under a sunset silhouette" },
    captionsNl: {
      cover: "De 911 GT3-spread: een overmaatse titel onder een silhouet bij zonsondergang",
      inventory: "Voorraad met de specificatiestrook, gefilterd op één merk",
      "vehicle-detail": "Voertuigpagina: prijs, acties om te informeren en kerncijfers",
      compare: "Vergelijking naast elkaar met markeringen voor de beste waarde",
      finance: "Illustratieve financieringscalculator met live maandbedrag",
      "home-mobile": "Hero van de homepage op een smartphone",
    },
  },
  {
    slug: "haven",
    sortOrder: 50,
    featured: true,
    sector: { en: "Real Estate", nl: "Vastgoed" },
    gallery: ["properties", "map", "property-detail", "floor-plan"],
    captionsNl: {
      cover: "Hero: Villa Duin met prijs, kenmerken en de geïntegreerde woningzoeker",
      properties: "Woningbrowser met toegepaste filters, chips en status in de URL",
      map: "Illustratieve kaartweergave van de woningen naast de lijst",
      "property-detail": "Woningdetail: prijs, kerngegevens en fotomozaïek",
      "floor-plan": "Grondplannen gegenereerd uit de woninggegevens",
      "home-mobile": "Hero van de homepage op een smartphone",
    },
  },
  {
    slug: "veltrix",
    sortOrder: 60,
    featured: false,
    sector: { en: "Automotive", nl: "Automotive" },
    gallery: ["home-desktop", "treatments", "services", "packages"],
    captionsNl: {
      cover: "Voor-en-naschuifregelaar voor lakcorrectie op een Porsche 911 GT3 RS",
      "home-desktop": "Hero van de homepage: Precision in every reflection, met de behandelingsindex eronder",
      treatments: "Interactieve behandelingskeuze: zes behandelingen, één voorbeeld",
      services: "Dienstenpagina: behandelingen met werkwijze, duur en prijs",
      packages: "Servicepakketten met een gemarkeerd signature-niveau",
      "home-mobile": "Hero van de homepage op een smartphone",
    },
  },
  {
    slug: "saison",
    sortOrder: 70,
    featured: false,
    sector: { en: "Hospitality", nl: "Horeca" },
    gallery: ["reservation", "menu", "season-calendar", "producers-map"],
    captionsNl: {
      cover: "De gedrukte menukaart op een olijfgroene achtergrond: On the table this season",
      reservation: "Reservatiekaart: datumchips, gasten, uur en dieetwensen; een demo die niets verstuurt",
      menu: "Volledig menu als gedrukte kaart met sectienavigatie",
      "season-calendar": "Interactieve seizoenskalender: wat er per maand in het seizoen is",
      "producers-map": "Handgetekende producentenkaart met een geselecteerde teler",
      "home-mobile": "Hero van de homepage op een smartphone",
    },
  },
  {
    slug: "blade-and-co",
    sortOrder: 80,
    featured: false,
    sector: { en: "Grooming", nl: "Grooming" },
    gallery: ["lookbook", "booking", "crew", "hours-board"],
    captionsNl: {
      cover: "Hero: GOOD HAIR ONLY in ivoor en zuurgroen boven een fade in de maak",
      lookbook: "Lookbook met een actieve filter over het onregelmatige fotoraster",
      booking: "Boekingsflow in vijf stappen met een meelopend ticket, bij het kiezen van een uur",
      crew: "Teampagina: grote namen, quotes, uurroosters en kenmerkende snitten",
      "hours-board": "Openingsuren als vertrekbord, met vandaag gemarkeerd",
      "home-mobile": "Hero van de homepage op een smartphone",
    },
  },
  {
    slug: "atelier-noir",
    sortOrder: 90,
    featured: false,
    title: "Atelier Noir",
    sector: { en: "Architecture", nl: "Architectuur" },
    gallery: ["project-index", "case-study", "material-study", "floor-plan"],
    captionsNl: {
      cover: "Hero: betonnen interieur met zicht op de bergen boven een grote serif-zin",
      "project-index": "Projectindex: bij hover op een rij wisselt het voorbeeldbeeld",
      "case-study": "Case study Residence K: plaat over de volle breedte en projectgegevens",
      "material-study": "Materiaalstudie: een materiaal kiezen opent het staal",
      "floor-plan": "Uitgelicht project met getekend grondplan en figuren met bijschrift",
      "home-mobile": "Hero van de homepage op een smartphone",
    },
  },
];
