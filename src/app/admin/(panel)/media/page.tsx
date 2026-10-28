import { Film } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { resolveMediaUrl } from "@/lib/cms/mappers";
import { formatBytes } from "@/lib/media-rules";
import { AdminPageHeader, Badge, EmptyState } from "@/components/admin/ui";

type Supabase = Awaited<ReturnType<typeof requireAdmin>>["supabase"];
type Asset = {
  bucket: "project-media" | "site-media";
  path: string;
  name: string;
  mime: string;
  size?: number;
};

const MAX_ASSETS = 300;

/** Lists `<prefix>/<folder>/<file>` objects (two levels, which is how every upload is keyed). */
async function listBucket(supabase: Supabase, bucket: Asset["bucket"], prefixes: string[]): Promise<Asset[]> {
  const assets: Asset[] = [];
  for (const prefix of prefixes) {
    const { data: folders } = await supabase.storage.from(bucket).list(prefix, { limit: 200 });
    for (const folder of folders ?? []) {
      if (folder.id) continue; // a file directly under the prefix: not part of our key scheme
      const dir = `${prefix}/${folder.name}`;
      const { data: files } = await supabase.storage.from(bucket).list(dir, { limit: 200 });
      for (const file of files ?? []) {
        if (!file.id) continue;
        const meta = (file.metadata ?? {}) as { size?: number; mimetype?: string };
        assets.push({ bucket, path: `${dir}/${file.name}`, name: file.name, mime: meta.mimetype ?? "", size: meta.size });
      }
    }
  }
  return assets;
}

function pathsIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (value.startsWith("site/")) found.add(value);
  } else if (Array.isArray(value)) value.forEach((v) => pathsIn(v, found));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => pathsIn(v, found));
  return found;
}

export default async function AdminMediaPage() {
  const { supabase } = await requireAdmin();

  const [projectAssets, siteAssets, mediaRows, projectRows, reviewRows, contentRows] = await Promise.all([
    listBucket(supabase, "project-media", ["projects"]),
    listBucket(supabase, "site-media", ["reviews", "site"]),
    supabase.from("project_media").select("storage_path, poster_path, projects(title)"),
    supabase.from("projects").select("thumbnail_path, title"),
    supabase.from("reviews").select("avatar_path, name"),
    supabase.from("site_content").select("key, content"),
  ]);

  // path -> where it is used
  const usage = new Map<string, string[]>();
  const addUsage = (path: string | null | undefined, label: string) => {
    if (!path) return;
    usage.set(path, [...new Set([...(usage.get(path) ?? []), label])]);
  };
  for (const m of (mediaRows.data ?? []) as unknown as Array<{ storage_path: string | null; poster_path: string | null; projects: { title: string } | null }>) {
    addUsage(m.storage_path, `Project: ${m.projects?.title ?? "unknown"}`);
    addUsage(m.poster_path, `Project poster: ${m.projects?.title ?? "unknown"}`);
  }
  for (const p of projectRows.data ?? []) addUsage(p.thumbnail_path, `Project thumbnail: ${p.title}`);
  for (const r of reviewRows.data ?? []) addUsage(r.avatar_path, `Review: ${r.name}`);
  for (const c of contentRows.data ?? []) for (const path of pathsIn(c.content)) addUsage(path, `Site content: ${c.key}`);

  const all = [...projectAssets, ...siteAssets];
  const shown = all.slice(0, MAX_ASSETS);

  return (
    <>
      <AdminPageHeader
        title="Media"
        description={`Every uploaded file and where it's used. Read-only: manage files inside the project, review or page that uses them.`}
      />

      {shown.length === 0 ? (
        <EmptyState>No media uploaded yet.</EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            {all.length} {all.length === 1 ? "file" : "files"}
            {all.length > MAX_ASSETS ? ` (showing the first ${MAX_ASSETS})` : ""}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((a) => {
              const used = usage.get(a.path) ?? [];
              const isVideo = a.mime.startsWith("video/");
              const src = resolveMediaUrl(a.path);
              return (
                <li key={`${a.bucket}/${a.path}`} className="flex gap-3 rounded-card border border-line bg-glass p-3">
                  <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md border border-line bg-elevated">
                    {isVideo || !src ? (
                      <span className="flex size-full items-center justify-center text-subtle">
                        <Film aria-hidden className="size-5" />
                        <span className="sr-only">Video</span>
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- admin preview
                      <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium" title={a.path}>{a.name}</p>
                    <p className="mt-0.5 text-xs text-subtle">
                      {a.mime || "file"}
                      {a.size ? ` · ${formatBytes(a.size)}` : ""} · {a.bucket}
                    </p>
                    {used.length > 0 ? (
                      <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                        {used.map((u) => (
                          <li key={u} className="truncate">{u}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1.5">
                        <Badge tone="warn">Not referenced</Badge>
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
