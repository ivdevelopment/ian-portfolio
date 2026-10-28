import Image from "next/image";
import type { ProjectMedia } from "@/types/project";
import { cn } from "@/lib/utils";

type ProjectMediaViewProps = {
  media: ProjectMedia;
  sizes: string;
  priority?: boolean;
  className?: string;
  /** Applied to the image / video element itself. */
  mediaClassName?: string;
};

/**
 * Renders a project's screenshot, GIF or video. Fills its parent, so the
 * parent decides the aspect ratio. Video never autoplays; it loads on demand.
 */
export function ProjectMediaView({
  media,
  sizes,
  priority,
  className,
  mediaClassName,
}: ProjectMediaViewProps) {
  if (media.type === "video") {
    return (
      <video
        className={cn("absolute inset-0 size-full object-cover", className, mediaClassName)}
        controls
        playsInline
        preload="none"
        poster={media.poster}
        aria-label={media.alt}
      >
        <source src={media.src} />
      </video>
    );
  }

  return (
    <Image
      src={media.src}
      alt={media.alt ?? ""}
      fill
      sizes={sizes}
      priority={priority}
      loading={priority ? "eager" : undefined}
      // Animated GIFs must not go through the optimiser.
      unoptimized={media.type === "gif"}
      className={cn("object-cover", className, mediaClassName)}
    />
  );
}
