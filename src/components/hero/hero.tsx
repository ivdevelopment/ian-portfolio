import Image from "next/image";
import { resolveMediaUrl } from "@/lib/cms/mappers";
import { getHomeContent } from "@/lib/site-content";
import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";

export async function Hero() {
  const { hero } = await getHomeContent();
  const imageSrc = resolveMediaUrl(hero.image.src);

  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden xl:min-h-[43rem]"
    >
      <div className="container-page page-top pb-10 xl:flex xl:min-h-[43rem] xl:items-center xl:pb-20">
        <div className="max-w-xl xl:max-w-[50rem]">
          {hero.badge && (
            <Reveal y={10}>
              <p className="glass inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 text-sm text-muted">
                <span aria-hidden className="relative flex size-2">
                  <span className="absolute inline-flex size-full rounded-full bg-accent opacity-40" />
                  <span className="relative inline-flex size-2 rounded-full bg-accent" />
                </span>
                {hero.badge}
              </p>
            </Reveal>
          )}

          <Reveal delay={0.08}>
            <h1 id="hero-title" className="text-display mt-6">
              {hero.headline.line1}
              {hero.headline.line2 ? (
                <>
                  <br />
                  {hero.headline.line2}{" "}
                </>
              ) : (
                " "
              )}
              <span className="text-accent-gradient">{hero.headline.accent}</span>
            </h1>
          </Reveal>

          <Reveal delay={0.16}>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted">{hero.body}</p>
          </Reveal>

          <Reveal delay={0.24} className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href={hero.primaryCta.href} size="lg">
              {hero.primaryCta.label}
            </ButtonLink>
            <ButtonLink href={hero.secondaryCta.href} variant="secondary" size="lg" icon="none">
              {hero.secondaryCta.label}
            </ButtonLink>
          </Reveal>
        </div>
      </div>

      {/* The hero image is editable in /admin/pages/home. */}
      {imageSrc && (
        <Reveal
          delay={0.1}
          y={0}
          className="hero-fade pointer-events-none relative aspect-[5/4] w-full sm:aspect-[16/10] xl:absolute xl:inset-y-0 xl:right-0 xl:-z-10 xl:aspect-auto xl:w-[68%]"
        >
          <Image
            src={imageSrc}
            alt={hero.image.alt}
            fill
            priority
            sizes="(min-width: 1280px) 68vw, 100vw"
            className="object-cover object-[60%_center] xl:object-center"
          />
        </Reveal>
      )}
    </section>
  );
}
