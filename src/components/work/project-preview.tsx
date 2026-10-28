"use client";

import { useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, Play } from "lucide-react";
import type { Project, ProjectMedia } from "@/types/project";
import { cn } from "@/lib/utils";
import { DeviceFrame } from "@/components/ui/device-frame";
import { ProjectMediaView } from "@/components/ui/project-media";

type View = "live" | "media";

/**
 * Preview area for a case study. Honours `project.previewMode`:
 * - media:    gallery stage with thumbnails (images, GIFs, videos)
 * - embed:    iframe of the live site, with a switch back to the gallery
 * - external: gallery plus a prominent link that opens the live site in a new tab
 */
export function ProjectPreview({ project }: { project: Project }) {
  const items: ProjectMedia[] =
    project.gallery.length > 0
      ? project.gallery
      : [
          project.heroMedia ?? {
            type: "image",
            src: project.thumbnail,
            alt: `${project.title} preview`,
          },
        ];

  const embedUrl = project.previewUrl ?? project.liveUrl;
  const canEmbed = project.previewMode === "embed" && Boolean(embedUrl);
  const [view, setView] = useState<View>(canEmbed ? "live" : "media");
  const [index, setIndex] = useState(0);
  const current = items[index];

  return (
    <div id="live-preview" className="scroll-mt-28">
      {canEmbed && (
        <div
          role="group"
          aria-label="Preview type"
          className="mb-4 inline-flex rounded-full border border-line p-1 text-sm"
        >
          {(["live", "media"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-full px-4 py-1.5 transition-colors duration-300",
                view === v ? "bg-accent-soft text-ink" : "text-muted hover:text-ink",
              )}
            >
              {v === "live" ? "Live site" : "Screenshots"}
            </button>
          ))}
        </div>
      )}

      <DeviceFrame>
        {view === "live" && canEmbed ? (
          <iframe
            src={embedUrl}
            title={`${project.title} live preview`}
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
            className="absolute inset-0 size-full bg-white"
          />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${index}-${current.src}`}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <ProjectMediaView
                media={current}
                sizes="(min-width: 1024px) 50vw, 100vw"
                priority={index === 0}
              />
            </motion.div>
          </AnimatePresence>
        )}
      </DeviceFrame>

      {view === "live" && canEmbed && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 text-sm text-subtle">
          Some websites block embedding.
          <a
            href={embedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Open in a new tab <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </p>
      )}

      {items.length > 1 && (
        <ul className="mt-5 grid grid-cols-4 gap-2 sm:gap-3" aria-label="Gallery">
          {items.map((media, i) => (
            <li key={`${media.src}-${i}`}>
              <button
                type="button"
                onClick={() => {
                  setIndex(i);
                  setView("media");
                }}
                aria-label={`Show ${media.type} ${i + 1} of ${items.length}${media.alt ? `: ${media.alt}` : ""}`}
                aria-current={view === "media" && i === index}
                className={cn(
                  "group relative block aspect-[16/10] w-full overflow-hidden rounded-md border bg-surface transition-[border-color,opacity] duration-300",
                  view === "media" && i === index
                    ? "border-accent"
                    : "border-line opacity-70 hover:opacity-100",
                )}
              >
                {media.type === "video" ? (
                  media.poster && (
                    <Image src={media.poster} alt="" fill sizes="15vw" className="object-cover" />
                  )
                ) : (
                  <Image
                    src={media.src}
                    alt=""
                    fill
                    sizes="15vw"
                    unoptimized={media.type === "gif"}
                    className="object-cover transition-transform duration-500 ease-out-soft group-hover:scale-105"
                  />
                )}
                {media.type === "video" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-bg/40">
                    <Play aria-hidden className="size-5 fill-ink text-ink" />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
