import Image from "next/image";
import { resolveMediaUrl } from "@/lib/cms/mappers";
import { getHomeContent } from "@/lib/site-content";
import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";

/** Closing call to action, shared by several pages. Content: /admin/pages/home. */
export async function CtaSection() {
  const { cta } = await getHomeContent();
  const image = resolveMediaUrl(cta.image.src);

  return (
    <section aria-labelledby="cta-title" className="relative isolate overflow-hidden">
      {image && (
        <Image
          src={image}
          alt={cta.image.alt}
          fill
          sizes="100vw"
          className="-z-20 object-cover object-center"
        />
      )}
      <div aria-hidden className="cta-scrim absolute inset-0 -z-10" />

      <div className="container-page section-y flex flex-col items-center text-center">
        {cta.badge && (
          <Reveal y={10}>
            <p className="glass rounded-full px-3.5 py-1.5 text-sm text-muted">{cta.badge}</p>
          </Reveal>
        )}
        <Reveal delay={0.08}>
          <h2 id="cta-title" className="text-display mt-6 max-w-3xl text-balance">
            {cta.heading}
          </h2>
        </Reveal>
        {cta.body && (
          <Reveal delay={0.16}>
            <p className="mt-6 max-w-xl text-lg text-balance text-ink/80">{cta.body}</p>
          </Reveal>
        )}
        <Reveal delay={0.24} className="mt-9 flex flex-wrap justify-center gap-3">
          <ButtonLink href={cta.primaryCta.href} size="lg">
            {cta.primaryCta.label}
          </ButtonLink>
          <ButtonLink href={cta.secondaryCta.href} variant="secondary" size="lg" icon="none">
            {cta.secondaryCta.label}
          </ButtonLink>
        </Reveal>
      </div>
    </section>
  );
}
