import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { Portrait } from "@/components/about/portrait";
import { CtaSection } from "@/components/cta/cta-section";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { aboutContent } from "@/data/content";

export const metadata: Metadata = {
  title: "About",
  description:
    "A web developer based in Belgium who designs and builds modern websites and web applications.",
  alternates: { canonical: "/about" },
  openGraph: { url: "/about", title: "About" },
};

export default function AboutPage() {
  const { headline, paragraphs, metrics, skills } = aboutContent;

  return (
    <>
      <section className="container-page page-top pb-(--section-y)">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
          <Reveal y={12}>
            <Eyebrow>{aboutContent.eyebrow}</Eyebrow>
            <h1 className="text-headline mt-4">
              {headline.line1}
              <br />
              {headline.line2}{" "}
              <span className="text-accent-gradient">{headline.accent}</span>
            </h1>
            <div className="mt-6 max-w-xl space-y-4 text-lg text-muted">
              {paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/contact" size="lg">
                Start a project
              </ButtonLink>
              <ButtonLink href="/work" variant="secondary" size="lg" icon="none">
                View my work
              </ButtonLink>
            </div>
          </Reveal>

          <Reveal delay={0.1} className="mx-auto w-full max-w-md lg:max-w-none">
            <Portrait />
          </Reveal>
        </div>

        <Reveal className="mt-16">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {metrics.map((metric) => (
              <div
                key={metric.id}
                className="glass flex flex-col-reverse justify-end rounded-card p-5 sm:p-6"
              >
                <dt className="mt-1 text-sm text-muted">{metric.label}</dt>
                <dd className="text-title flex items-center gap-2">
                  {metric.id === "location" && (
                    <MapPin aria-hidden className="size-5 text-accent" />
                  )}
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </section>

      <section aria-labelledby="skills-title" className="container-page pb-(--section-y)">
        <Reveal>
          <h2 id="skills-title" className="text-title">
            Skills &amp; technologies
          </h2>
          <p className="mt-3 max-w-xl text-muted">
            The tools I reach for to build fast, accessible and maintainable products.
          </p>
          <ul className="mt-8 flex flex-wrap gap-3">
            {skills.map((skill) => (
              <li
                key={skill}
                className="glass rounded-md px-4 py-2.5 text-[0.95rem] transition-colors duration-300 hover:bg-glass-strong"
              >
                {skill}
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      <CtaSection />
    </>
  );
}
