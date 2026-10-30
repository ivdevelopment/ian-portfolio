import type { Metadata } from "next";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getI18n } from "@/i18n/server";
import { pageMetadata } from "@/lib/page-metadata";
import { MapPin } from "lucide-react";
import { Portrait } from "@/components/about/portrait";
import { CtaSection } from "@/components/cta/cta-section";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { resolveMediaUrl } from "@/lib/cms/mappers";
import { visibleStats } from "@/lib/schemas/site-content";
import { getAboutContent, getSkills } from "@/lib/site-content";

export async function generateMetadata({ params }: PageProps<"/[locale]/about">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = getDictionary(locale);
  return pageMetadata({ locale, title: dict.about.title, description: dict.about.description, path: "/about" });
}

export default async function AboutPage() {
  const { locale, dict } = await getI18n();
  const [about, skills] = await Promise.all([getAboutContent(locale), getSkills()]);
  const metrics = visibleStats(about.metrics);
  const paragraphs = [about.intro, ...about.body.split(/\n{2,}/)].map((p) => p.trim()).filter(Boolean);
  const showLocation = about.location.trim().length > 0;

  return (
    <>
      <section className="container-page page-top pb-(--section-y)">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
          <Reveal y={12}>
            {about.eyebrow && <Eyebrow>{about.eyebrow}</Eyebrow>}
            <h1 className="text-headline mt-4">
              {about.headline.line1}
              {about.headline.line2 && (
                <>
                  <br />
                  {about.headline.line2}{" "}
                </>
              )}{" "}
              <span className="text-accent-gradient">{about.headline.accent}</span>
            </h1>
            <div className="mt-6 max-w-xl space-y-4 text-lg text-muted">
              {paragraphs.map((p) => (
                <p key={p} className="whitespace-pre-line">
                  {p}
                </p>
              ))}
              {about.availability && <p className="text-base text-ink">{about.availability}</p>}
            </div>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/contact" size="lg">
                {dict.common.startProject}
              </ButtonLink>
              <ButtonLink href="/work" variant="secondary" size="lg" icon="none">
                {dict.common.viewMyWork}
              </ButtonLink>
            </div>
          </Reveal>

          <Reveal delay={0.1} className="mx-auto w-full max-w-md lg:max-w-none">
            <Portrait
              src={resolveMediaUrl(about.portrait?.src)}
              alt={about.portrait?.alt}
            />
          </Reveal>
        </div>

        {(metrics.length > 0 || showLocation) && (
          <Reveal className="mt-16">
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {metrics.map((metric, i) => (
                <div
                  key={`${i}-${metric.label}`}
                  className="glass flex flex-col-reverse justify-end rounded-card p-5 sm:p-6"
                >
                  <dt className="mt-1 text-sm text-muted">{metric.label}</dt>
                  <dd className="text-title">{metric.value}</dd>
                </div>
              ))}
              {showLocation && (
                <div className="glass flex flex-col-reverse justify-end rounded-card p-5 sm:p-6">
                  <dt className="mt-1 text-sm text-muted">{dict.about.basedIn}</dt>
                  <dd className="text-title flex items-center gap-2">
                    <MapPin aria-hidden className="size-5 text-accent" />
                    {about.location}
                  </dd>
                </div>
              )}
            </dl>
          </Reveal>
        )}
      </section>

      {skills.length > 0 && (
        <section aria-labelledby="skills-title" className="container-page pb-(--section-y)">
          <Reveal>
            <h2 id="skills-title" className="text-title">
              {dict.about.skills}
            </h2>
            <p className="mt-3 max-w-xl text-muted">
              {dict.about.skillsIntro}
            </p>
            <ul className="mt-8 flex flex-wrap gap-3">
              {skills.map((skill) => (
                <li
                  key={skill.id}
                  className="glass rounded-md px-4 py-2.5 text-[0.95rem] transition-colors duration-300 hover:bg-glass-strong"
                >
                  {skill.name}
                </li>
              ))}
            </ul>
          </Reveal>
        </section>
      )}

      <CtaSection />
    </>
  );
}
