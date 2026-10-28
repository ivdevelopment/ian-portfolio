"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Project, ProjectKind } from "@/types/project";
import { cn } from "@/lib/utils";
import { ProjectCard } from "./project-card";

type Filter = { label: string; kind: ProjectKind | "all" };

type ProjectGridProps = {
  projects: Project[];
  filters: Filter[];
  /** Tailwind grid-cols classes for the card layout. */
  columnsClassName?: string;
  sizes: string;
  highlightFeatured?: boolean;
};

export function ProjectGrid({
  projects,
  filters,
  columnsClassName = "sm:grid-cols-2 lg:grid-cols-4",
  sizes,
  highlightFeatured,
}: ProjectGridProps) {
  const [active, setActive] = useState<Filter["kind"]>("all");

  // Only offer filters that match at least one project (plus "All").
  const available = filters.filter(
    (f) => f.kind === "all" || projects.some((p) => p.kind === f.kind),
  );
  const visible =
    active === "all" ? projects : projects.filter((p) => p.kind === active);

  return (
    <div>
      <div
        role="group"
        aria-label="Filter projects"
        className="no-scrollbar -mx-(--gutter) flex gap-2 overflow-x-auto px-(--gutter) pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {available.map((filter) => {
          const selected = filter.kind === active;
          return (
            <button
              key={filter.kind}
              type="button"
              aria-pressed={selected}
              onClick={() => setActive(filter.kind)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-sm transition-[background-color,border-color,color] duration-300",
                selected
                  ? "border-accent/50 bg-accent-soft text-ink"
                  : "border-line text-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      <p className="sr-only" role="status">
        Showing {visible.length} {visible.length === 1 ? "project" : "projects"}
      </p>

      <ul className={cn("mt-8 grid gap-x-6 gap-y-10", columnsClassName)}>
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((project) => (
            <motion.li
              key={project.id}
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <ProjectCard
                project={project}
                sizes={sizes}
                highlightFeatured={highlightFeatured}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {visible.length === 0 && (
        <p className="mt-10 text-muted">No projects in this category yet.</p>
      )}
    </div>
  );
}
