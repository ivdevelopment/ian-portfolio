import Image from "next/image";
import { siteConfig } from "@/config/site";
import { aboutContent } from "@/data/content";

/**
 * Personal photo. Set `aboutContent.photo` to a real image to replace the
 * placeholder — no identity or avatar is generated here.
 */
export function Portrait() {
  const { photo } = aboutContent;

  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-panel border border-line bg-surface shadow-card">
      {photo ? (
        <Image
          src={photo.src}
          alt={photo.alt}
          fill
          priority
          sizes="(min-width: 1024px) 40vw, 100vw"
          className="object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(70%_60%_at_50%_35%,var(--glow-warm),transparent)] text-center">
          <span
            aria-hidden
            className="text-[clamp(5rem,16vw,9rem)] leading-none font-medium tracking-tighter text-ink/10"
          >
            {siteConfig.initials}
          </span>
          <p className="absolute bottom-6 text-sm text-subtle">Portrait coming soon</p>
        </div>
      )}
    </div>
  );
}
