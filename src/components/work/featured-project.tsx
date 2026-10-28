"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Project } from "@/types/project";
import { ButtonLink } from "@/components/ui/button";
import { DeviceFrame } from "@/components/ui/device-frame";
import { ProjectMediaView } from "@/components/ui/project-media";

const pad = (n: number) => String(n).padStart(2, "0");

export function FeaturedProject({ projects }: { projects: Project[] }) {
  const [index, setIndex] = useState(0);
  const total = projects.length;
  if (total === 0) return null;

  const project = projects[index];
  const hero = project.heroMedia ?? {
    type: "image" as const,
    src: project.thumbnail,
    alt: `${project.title} website preview`,
  };
  const step = (dir: 1 | -1) => setIndex((i) => (i + dir + total) % total);

  return (
    <section aria-labelledby="featured-title" className="section-y pb-0">
      <div className="container-page">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 id="featured-title" className="text-title">
            Featured project
          </h2>

          {total > 1 && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted tabular-nums" aria-live="polite">
                <span className="sr-only">Project </span>
                {pad(index + 1)} / {pad(total)}
              </p>
              <div className="flex gap-2">
                {([-1, 1] as const).map((dir) => {
                  const Icon = dir === -1 ? ChevronLeft : ChevronRight;
                  return (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => step(dir)}
                      aria-label={dir === -1 ? "Previous project" : "Next project"}
                      className="glass inline-flex size-10 items-center justify-center rounded-md text-ink transition-[background-color,transform] duration-300 hover:bg-glass-strong active:scale-95"
                    >
                      <Icon aria-hidden className="size-5" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-panel border border-line bg-surface shadow-card">
          <AnimatePresence mode="wait" initial={false}>
            <motion.article
              key={project.id}
              className="grid lg:grid-cols-[1.3fr_1fr]"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="relative bg-[radial-gradient(60%_80%_at_35%_45%,var(--glow-warm),transparent)] p-6 sm:p-10 lg:p-12">
                <DeviceFrame>
                  <ProjectMediaView
                    media={hero}
                    sizes="(min-width: 1024px) 45vw, 100vw"
                  />
                </DeviceFrame>
              </div>

              <div className="flex flex-col justify-center border-t border-line p-6 sm:p-10 lg:border-t-0 lg:border-l lg:p-12">
                <h3 className="text-title">{project.title}</h3>
                <p className="mt-1 text-sm tracking-wide text-muted">
                  {project.subtitle ?? project.category}
                </p>
                <p className="mt-5 text-muted">{project.shortDescription}</p>

                <ul className="mt-6 flex flex-wrap gap-2" aria-label="Disciplines">
                  {project.tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full border border-line px-3 py-1 text-xs text-muted"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>

                <div className="mt-8 flex flex-wrap gap-3">
                  <ButtonLink href={`/work/${project.slug}`}>View project</ButtonLink>
                  <ButtonLink
                    href={`/work/${project.slug}#live-preview`}
                    variant="secondary"
                    icon="none"
                  >
                    Live preview
                  </ButtonLink>
                </div>
              </div>
            </motion.article>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
