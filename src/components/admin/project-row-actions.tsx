"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Eye, EyeOff, Globe, Pencil, Star, Trash2 } from "lucide-react";
import { deleteProjectAction, duplicateProjectAction, setFeaturedAction, setPublishedAction } from "@/app/(admin)/admin/(panel)/projects/actions";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { IconButton, iconButtonClass } from "./icon-button";
import { useActionRunner } from "./use-action-runner";

type RowProject = { id: string; title: string; published: boolean; featured: boolean };

export function ProjectRowActions({ project }: { project: RowProject }) {
  const router = useRouter();
  const { run, active, pending, error, setError } = useActionRunner();
  const [info, setInfo] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const warn = (r: object) => setInfo("warning" in r && typeof r.warning === "string" ? r.warning : null);
  const go = <R extends { ok: boolean; error?: string; warning?: string }>(key: string, job: () => Promise<R>, after?: (r: R) => void) => {
    setInfo(null);
    run(key, job, (r) => {
      warn(r);
      after?.(r);
    });
  };
  const message = error ? { tone: "error" as const, text: error } : info ? { tone: "info" as const, text: info } : null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <Link href={`/admin/projects/${project.id}/edit`} className={iconButtonClass} aria-label={`Edit ${project.title}`} title="Edit">
          <Pencil aria-hidden className="size-4" />
        </Link>
        <Link href={`/admin/projects/${project.id}/preview`} className={iconButtonClass} aria-label={`Preview ${project.title}`} title="Preview">
          <Eye aria-hidden className="size-4" />
        </Link>
        <IconButton
          busy={active === "publish"}
          disabled={pending}
          title={project.published ? "Unpublish" : "Publish"}
          aria-label={project.published ? `Unpublish ${project.title}` : `Publish ${project.title}`}
          onClick={() => go("publish", () => setPublishedAction(project.id, !project.published))}
        >
          {project.published ? <EyeOff aria-hidden className="size-4" /> : <Globe aria-hidden className="size-4" />}
        </IconButton>
        <IconButton
          busy={active === "feature"}
          className={cn(project.featured && "border-accent/50 text-accent")}
          disabled={pending}
          aria-pressed={project.featured}
          title={project.featured ? "Unfeature" : "Feature"}
          aria-label={project.featured ? `Unfeature ${project.title}` : `Feature ${project.title}`}
          onClick={() => go("feature", () => setFeaturedAction(project.id, !project.featured))}
        >
          <Star aria-hidden className={cn("size-4", project.featured && "fill-accent")} />
        </IconButton>
        <IconButton
          busy={active === "duplicate"}
          disabled={pending}
          title="Duplicate"
          aria-label={`Duplicate ${project.title}`}
          onClick={() =>
            go(
              "duplicate",
              () => duplicateProjectAction(project.id),
              (r) => {
                if (r.ok && "id" in r && typeof r.id === "string") router.push(`/admin/projects/${r.id}/edit?duplicated=1`);
              },
            )
          }
        >
          <Copy aria-hidden className="size-4" />
        </IconButton>
        <IconButton
          busy={active === "delete"}
          className="hover:border-danger/50 hover:text-danger"
          disabled={pending}
          title="Delete"
          aria-label={`Delete ${project.title}`}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
        >
          <Trash2 aria-hidden className="size-4" />
        </IconButton>
      </div>

      {/* One status line for the row: announced when an action starts, and replaced by the result. */}
      {pending && active && active !== "delete" && (
        <p role="status" className="max-w-56 text-right text-xs text-muted">
          {{ publish: project.published ? "Unpublishing…" : "Publishing…", feature: project.featured ? "Unfeaturing…" : "Featuring…", duplicate: "Duplicating…" }[active]}
        </p>
      )}
      {message && !pending && (
        <p role={message.tone === "error" ? "alert" : "status"} className={cn("max-w-56 text-right text-xs", message.tone === "error" ? "text-danger" : "text-muted")}>
          {message.text}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete “${project.title}”?`}
        confirmLabel="Delete project"
        pending={active === "delete"}
        error={error}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setInfo(null);
          run(
            "delete",
            () => deleteProjectAction(project.id),
            (r) => {
              setConfirmOpen(false);
              warn(r);
            },
          );
        }}
      >
        <p>
          This permanently deletes <strong className="text-ink">{project.title}</strong>, its
          features and its uploaded media. It will disappear from the public site. This can&apos;t
          be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}
