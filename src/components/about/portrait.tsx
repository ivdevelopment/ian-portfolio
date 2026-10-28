import Image from "next/image";
import { siteConfig } from "@/config/site";

type PortraitProps = {
  /** Resolved image URL; when absent a neutral placeholder is shown. */
  src?: string;
  alt?: string;
};

/**
 * Personal photo, managed in /admin/pages/about. No identity or avatar is
 * generated here — without an upload it's a tasteful placeholder.
 */
export function Portrait({ src, alt }: PortraitProps) {
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-panel border border-line bg-surface shadow-card">
      {src ? (
        <Image
          src={src}
          alt={alt ?? ""}
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
