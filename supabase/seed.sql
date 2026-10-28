-- Seed: the four P0 example projects, flagged `is_example = true` so the public
-- site labels them as sample content. Media points at the static placeholder
-- images shipped in /public/media (external_url with an app-relative path).
-- Idempotent: safe to run more than once.
--
-- Local:      `npx supabase db reset` runs this automatically.
-- Production: paste into the Supabase SQL editor (or `supabase db push --include-seed`).
-- Delete these rows (admin UI) once you have real projects.

insert into public.projects (
  id, slug, title, subtitle, short_description, description, category, kind,
  year, client, project_type, thumbnail_path, tags, technologies,
  live_url, preview_mode, featured, published, is_example, sort_order
) values
(
  '11111111-1111-4111-8111-111111111101', 'red-harbor-studios', 'Red Harbor Studios',
  'Creative Audio Software',
  'A modern website for my audio software brand, featuring product showcases, marketing pages and a CMS.',
  'Red Harbor Studios is my audio software brand. The goal was to create a modern, clean and professional website that showcases the products, builds trust and makes it easy to manage content.',
  'Creative Audio Software', 'website', 2026, 'Red Harbor Studios', 'personal',
  '/media/projects/red-harbor-home.svg',
  array['Web Design', 'Development', 'CMS'], array['Next.js', 'Tailwind CSS', 'Supabase'],
  'https://redharborstudios.com', 'media', true, true, true, 1
),
(
  '11111111-1111-4111-8111-111111111102', 'afroton', 'Afroton', 'Website Redesign',
  'A bold redesign for a music and events brand, built around rhythm, colour and upcoming shows.',
  'A placeholder case study. Afroton is a sample brand used to demonstrate how redesign projects appear in the portfolio.',
  'Music & Events', 'redesign', 2025, null, 'concept',
  '/media/projects/afroton.svg',
  array['Web Design', 'Redesign'], array['Next.js', 'Tailwind CSS'],
  null, 'media', true, true, true, 2
),
(
  '11111111-1111-4111-8111-111111111103', 'lumen-studio', 'Lumen Studio', 'Website',
  'A calm, editorial portfolio site for a creative design studio, led by photography and generous whitespace.',
  'A placeholder case study. Lumen Studio is a sample brand showing a lighter, editorial direction.',
  'Creative Design Studio', 'concept', 2025, null, 'concept',
  '/media/projects/lumen-studio.svg',
  array['Web Design', 'Development'], array['Next.js', 'TypeScript', 'Tailwind CSS'],
  null, 'media', true, true, true, 3
),
(
  '11111111-1111-4111-8111-111111111104', 'nova-dashboard', 'Nova Dashboard', 'Web Application',
  'An analytics dashboard concept with clear data visualisation and a focused, fast interface.',
  'A placeholder case study. Nova is a sample product used to demonstrate how web applications appear in the portfolio.',
  'Web Application', 'web-app', 2026, null, 'concept',
  '/media/projects/nova-dashboard.svg',
  array['Web App', 'Development'], array['Next.js', 'TypeScript', 'PostgreSQL'],
  null, 'media', true, true, true, 4
)
on conflict (id) do nothing;

insert into public.project_features (id, project_id, label, sort_order) values
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111101', 'Modern and clean design', 0),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111101', 'Fully responsive', 1),
  ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111101', 'Custom CMS', 2),
  ('22222222-2222-4222-8222-222222222204', '11111111-1111-4111-8111-111111111101', 'Optimized performance', 3),
  ('22222222-2222-4222-8222-222222222205', '11111111-1111-4111-8111-111111111101', 'Product showcase pages', 4),
  ('22222222-2222-4222-8222-222222222206', '11111111-1111-4111-8111-111111111101', 'Blog / news system', 5),
  ('22222222-2222-4222-8222-222222222207', '11111111-1111-4111-8111-111111111102', 'Event listings', 0),
  ('22222222-2222-4222-8222-222222222208', '11111111-1111-4111-8111-111111111102', 'Responsive layouts', 1),
  ('22222222-2222-4222-8222-222222222209', '11111111-1111-4111-8111-111111111102', 'Artist pages', 2),
  ('22222222-2222-4222-8222-222222222210', '11111111-1111-4111-8111-111111111103', 'Editorial layouts', 0),
  ('22222222-2222-4222-8222-222222222211', '11111111-1111-4111-8111-111111111103', 'Project case studies', 1),
  ('22222222-2222-4222-8222-222222222212', '11111111-1111-4111-8111-111111111103', 'Contact flow', 2),
  ('22222222-2222-4222-8222-222222222213', '11111111-1111-4111-8111-111111111104', 'KPI overview', 0),
  ('22222222-2222-4222-8222-222222222214', '11111111-1111-4111-8111-111111111104', 'Interactive charts', 1),
  ('22222222-2222-4222-8222-222222222215', '11111111-1111-4111-8111-111111111104', 'Role-based access', 2)
on conflict (id) do nothing;

insert into public.project_media (id, project_id, type, external_url, alt, sort_order) values
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111101', 'image', '/media/projects/red-harbor-home.svg', 'Red Harbor Studios homepage with a pair of red-accented headphones.', 0),
  ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111101', 'image', '/media/projects/red-harbor-products.svg', 'Product library page with three audio plugins.', 1),
  ('33333333-3333-4333-8333-333333333303', '11111111-1111-4111-8111-111111111101', 'image', '/media/projects/red-harbor-blog.svg', 'News and journal listing.', 2),
  ('33333333-3333-4333-8333-333333333304', '11111111-1111-4111-8111-111111111101', 'image', '/media/projects/red-harbor-cms.svg', 'Custom CMS product management screen.', 3),
  ('33333333-3333-4333-8333-333333333305', '11111111-1111-4111-8111-111111111102', 'image', '/media/projects/afroton.svg', 'Afroton homepage with an orange sun motif.', 0),
  ('33333333-3333-4333-8333-333333333306', '11111111-1111-4111-8111-111111111103', 'image', '/media/projects/lumen-studio.svg', 'Lumen Studio homepage with warm editorial imagery.', 0),
  ('33333333-3333-4333-8333-333333333307', '11111111-1111-4111-8111-111111111104', 'image', '/media/projects/nova-dashboard.svg', 'Nova analytics dashboard with KPI cards and a revenue chart.', 0)
on conflict (id) do nothing;
