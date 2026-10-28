# Ian Verlinden — portfolio & web studio site

Next.js (App Router) · TypeScript · Tailwind CSS v4 · Motion · React Hook Form + Zod.

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npx tsc --noEmit
npm run build && npm start
```

## Where things live

| Path | Purpose |
| --- | --- |
| `src/config/site.ts` | Site name, URL, nav, contact details (placeholders) |
| `src/data/content.ts` | Hero/about/contact copy and the stats strip |
| `src/data/projects.ts`, `reviews.ts`, `services.ts` | Local data that maps onto future DB tables |
| `src/lib/projects.ts`, `reviews.ts` | Data access — the only place to swap for Supabase in P1 |
| `src/types/` | `Project`, `ProjectMedia` (image / gif / video), `PreviewMode`, `Review`, `Service` |
| `src/app/globals.css` | Design tokens (`@theme`), glass utilities, `.theme-light` |
| `src/app/(site)/` | Public pages: `/`, `/work`, `/work/[slug]`, `/services`, `/about`, `/contact` |
| `src/app/admin/` | Admin shell placeholder (no auth yet, `noindex`) |
| `public/media/` | Placeholder screenshots and scenes (generated SVG) — replace with real captures |

## Placeholder content to replace before launch

- Stats, reviews (flagged `placeholder: true`), project entries and screenshots.
- `siteConfig.email`, the Red Harbor `liveUrl`, `NEXT_PUBLIC_SITE_URL`.
- About portrait: set `aboutContent.photo` in `src/data/content.ts`.
- A raster Open Graph image.

## Contact form

Validated with Zod on client and server (`src/app/(site)/contact/actions.ts`). In P0 the
action returns `not_configured` and the UI says nothing was sent. Persisting is a P1 task.
