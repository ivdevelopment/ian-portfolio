"use client";

import { ArrowUpRight } from "lucide-react";
import type { Project } from "@/types/project";
import { ProjectMediaView } from "@/components/ui/project-media";
import { useDictionary } from "@/i18n/context";
import { LocaleLink } from "@/i18n/locale-link";
import { projectBadges } from "@/lib/project-labels";
import { cn } from "@/lib/utils";

type ProjectCardProps = {
  project: Project;
  sizes: string;
  /** Show a "Featured" badge on the thumbnail. */
  highlightFeatured?: boolean;
  priority?: boolean;
  className?: string;
};

/** A dark backing keeps the label readable on any screenshot, including light ones. */
const BADGE_CLASS = "rounded-full border border-line-strong bg-bg/85 px-2.5 py-1 text-xs text-ink backdrop-blur-md";

/** Screenshot-first card. The whole card links to the case study. */
export function ProjectCard({
  project,
  sizes,
  highlightFeatured,
  priority,
  className,
}: ProjectCardProps) {
  const dict = useDictionary();
  const badges = projectBadges(project, dict);
  return (
    <article className={cn("group relative", className)}>
      <div className="relative aspect-[16/10] overflow-hidden rounded-card border border-line bg-surface shadow-card transition-[border-color,box-shadow,transform] duration-500 ease-out-soft group-hover:-translate-y-1 group-hover:border-line-strong group-hover:shadow-lift">
        <ProjectMediaView
          media={{ type: "image", src: project.thumbnail, alt: "" }}
          sizes={sizes}
          priority={priority}
          className="transition-transform duration-700 ease-out-soft group-hover:scale-[1.04]"
        />
        {(badges.length > 0 || (highlightFeatured && project.featured)) && (
          <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
            {highlightFeatured && project.featured && (
              <span className={BADGE_CLASS}>{dict.project.badges.featured}</span>
            )}
            {badges.map((badge) => (
              <span key={badge} className={BADGE_CLASS}>
                {badge}
              </span>
            ))}
          </div>
        )}
        <span
          aria-hidden
          className="absolute right-3 bottom-3 inline-flex size-9 translate-y-1 items-center rounded-full border border-line-strong bg-bg/85 backdrop-blur-md justify-center text-ink opacity-0 transition-[opacity,transform] duration-500 ease-out-soft group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
        >
          <ArrowUpRight className="size-4" />
        </span>
      </div>

      <div className="mt-4">
        <h3 className="text-lg font-medium tracking-tight">
          <LocaleLink
            href={`/work/${project.slug}`}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {project.title}
          </LocaleLink>
        </h3>
        <p className="mt-0.5 text-sm text-muted">{project.tags.join(" · ")}</p>
        <p className="mt-2 line-clamp-2 text-[0.95rem] text-subtle">
          {project.shortDescription}
        </p>
      </div>
    </article>
  );
}
