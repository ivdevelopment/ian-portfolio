"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import { ExternalLink, Loader2, Play } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
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
  const externalUrl = project.previewMode === "external" ? project.liveUrl : undefined;
  const [view, setView] = useState<View>(canEmbed ? "live" : "media");
  const [index, setIndex] = useState(0);
  const [frameState, setFrameState] = useState<"loading" | "loaded" | "slow">("loading");
  const current = items[index];
  const showingFrame = view === "live" && canEmbed;

  // Many sites refuse to be framed, and the browser gives us no reliable
  // signal. If nothing has loaded after a while, say so instead of spinning.
  useEffect(() => {
    if (!showingFrame) return;
    const timer = window.setTimeout(
      () => setFrameState((s) => (s === "loading" ? "slow" : s)),
      8000,
    );
    return () => window.clearTimeout(timer);
  }, [showingFrame, embedUrl]);

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
        {showingFrame ? (
          <>
            <iframe
              src={embedUrl}
              title={`${project.title} live preview`}
              loading="lazy"
              // No top navigation or downloads; scripts and forms only so the site is usable.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="no-referrer"
              onLoad={() => setFrameState("loaded")}
              className="absolute inset-0 size-full bg-white"
            />
            {frameState !== "loaded" && (
              <div
                role="status"
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface p-6 text-center"
              >
                {frameState === "loading" ? (
                  <>
                    <Loader2 aria-hidden className="size-6 animate-spin text-accent" />
                    <p className="text-sm text-muted">Loading live site…</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted">
                      This site is taking a while, or doesn&apos;t allow embedding.
                    </p>
                    <ButtonLink href={embedUrl!} external size="sm" variant="secondary">
                      Open in a new tab
                    </ButtonLink>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <motion.div
            key={`${index}-${current.src}`}
            className="absolute inset-0"
            initial={index === 0 ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <ProjectMediaView
              media={current}
              sizes="(min-width: 1024px) 50vw, 100vw"
              priority={index === 0}
            />
          </motion.div>
        )}
      </DeviceFrame>

      {externalUrl && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-glass p-4">
          <p className="text-sm text-muted">This project is best experienced on its own website.</p>
          <ButtonLink href={externalUrl} external size="sm">
            Visit live site
          </ButtonLink>
        </div>
      )}

      {showingFrame && (
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
