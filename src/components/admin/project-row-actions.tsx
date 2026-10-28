"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Eye, EyeOff, Globe, Pencil, Star, Trash2 } from "lucide-react";
import {
  deleteProjectAction,
  duplicateProjectAction,
  setFeaturedAction,
  setPublishedAction,
  type ActionResult,
} from "@/app/admin/(panel)/projects/actions";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";

type RowProject = { id: string; title: string; published: boolean; featured: boolean };

const iconButton =
  "inline-flex size-8 items-center justify-center rounded-md border border-line text-muted transition-colors " +
  "hover:border-line-strong hover:bg-glass-strong hover:text-ink disabled:opacity-50";

export function ProjectRowActions({ project }: { project: RowProject }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const run = (action: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      if (result.warning) setMessage({ tone: "info", text: result.warning });
      after?.(result);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <Link href={`/admin/projects/${project.id}/edit`} className={iconButton} aria-label={`Edit ${project.title}`} title="Edit">
          <Pencil aria-hidden className="size-4" />
        </Link>
        <Link href={`/admin/projects/${project.id}/preview`} className={iconButton} aria-label={`Preview ${project.title}`} title="Preview">
          <Eye aria-hidden className="size-4" />
        </Link>
        <button
          type="button"
          className={iconButton}
          disabled={pending}
          title={project.published ? "Unpublish" : "Publish"}
          aria-label={project.published ? `Unpublish ${project.title}` : `Publish ${project.title}`}
          onClick={() => run(() => setPublishedAction(project.id, !project.published))}
        >
          {project.published ? <EyeOff aria-hidden className="size-4" /> : <Globe aria-hidden className="size-4" />}
        </button>
        <button
          type="button"
          className={cn(iconButton, project.featured && "border-accent/50 text-accent")}
          disabled={pending}
          aria-pressed={project.featured}
          title={project.featured ? "Unfeature" : "Feature"}
          aria-label={project.featured ? `Unfeature ${project.title}` : `Feature ${project.title}`}
          onClick={() => run(() => setFeaturedAction(project.id, !project.featured))}
        >
          <Star aria-hidden className={cn("size-4", project.featured && "fill-accent")} />
        </button>
        <button
          type="button"
          className={iconButton}
          disabled={pending}
          title="Duplicate"
          aria-label={`Duplicate ${project.title}`}
          onClick={() =>
            run(
              () => duplicateProjectAction(project.id),
              (r) => {
                if (r.ok && "id" in r && typeof r.id === "string") {
                  router.push(`/admin/projects/${r.id}/edit?duplicated=1`);
                }
              },
            )
          }
        >
          <Copy aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          className={cn(iconButton, "hover:border-danger/50 hover:text-danger")}
          disabled={pending}
          title="Delete"
          aria-label={`Delete ${project.title}`}
          onClick={() => {
            setDeleteError(null);
            setConfirmOpen(true);
          }}
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      </div>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={cn("max-w-56 text-right text-xs", message.tone === "error" ? "text-danger" : "text-muted")}>
          {message.text}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete “${project.title}”?`}
        confirmLabel="Delete project"
        pending={pending}
        error={deleteError}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setDeleteError(null);
          startTransition(async () => {
            const result = await deleteProjectAction(project.id);
            if (!result.ok) {
              setDeleteError(result.error);
              return;
            }
            setConfirmOpen(false);
            if (result.warning) setMessage({ tone: "info", text: result.warning });
            router.refresh();
          });
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
