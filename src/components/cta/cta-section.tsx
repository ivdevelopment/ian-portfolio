import Image from "next/image";
import { homeContent } from "@/data/content";
import { siteConfig } from "@/config/site";
import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";

export function CtaSection() {
  const { cta } = homeContent;

  return (
    <section
      aria-labelledby="cta-title"
      className="relative isolate overflow-hidden"
    >
      <Image
        src={cta.image}
        alt=""
        fill
        sizes="100vw"
        className="-z-20 object-cover object-center"
      />
      <div aria-hidden className="cta-scrim absolute inset-0 -z-10" />

      <div className="container-page section-y flex flex-col items-center text-center">
        <Reveal y={10}>
          <p className="glass rounded-full px-3.5 py-1.5 text-sm text-muted">
            {cta.badge}
          </p>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 id="cta-title" className="text-display mt-6 max-w-3xl text-balance">
            {cta.title}
          </h2>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mt-6 max-w-xl text-lg text-balance text-ink/80">{cta.body}</p>
        </Reveal>
        <Reveal delay={0.24} className="mt-9 flex flex-wrap justify-center gap-3">
          <ButtonLink href={siteConfig.cta.href} size="lg">
            {siteConfig.cta.label}
          </ButtonLink>
          <ButtonLink href="/work" variant="secondary" size="lg" icon="none">
            View my work
          </ButtonLink>
        </Reveal>
      </div>
    </section>
  );
}
