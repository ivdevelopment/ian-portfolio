import { pageMetadata } from "@/lib/page-metadata";
import { Check } from "lucide-react";
import { CtaSection } from "@/components/cta/cta-section";
import { ServiceIconBadge } from "@/components/services/service-icon";
import { PageHeader } from "@/components/ui/page-header";
import { Reveal } from "@/components/ui/reveal";
import { getHomeContent, getServices } from "@/lib/site-content";

export const metadata = pageMetadata({
  title: "Services",
  description:
    "Web design, web development, redesigns and ongoing maintenance for businesses that want a modern, fast website.",
  path: "/services",
});

export default async function ServicesPage() {
  const [services, { services: copy }] = await Promise.all([getServices(), getHomeContent()]);

  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow || undefined}
        title={copy.statement || copy.heading}
        description={copy.body || undefined}
      />

      <section aria-label="Services" className="container-page pb-(--section-y)">
        {services.length === 0 ? (
          <p className="rounded-card border border-line p-8 text-muted">
            Services will be listed here soon.
          </p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {services.map((service, i) => (
              <Reveal as="li" key={service.id} delay={(i % 2) * 0.07}>
                <article
                  id={service.slug}
                  className="glass h-full scroll-mt-28 rounded-panel p-6 sm:p-9"
                >
                  <ServiceIconBadge icon={service.icon} />
                  <h2 className="text-title mt-6">{service.title}</h2>
                  <p className="mt-2 text-muted">{service.description}</p>
                  {service.includes.length > 0 && (
                    <ul className="mt-6 space-y-3 border-t border-line pt-6">
                      {service.includes.map((item) => (
                        <li key={item.label} className="flex items-center gap-3 text-[0.95rem]">
                          <span
                            aria-hidden
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
                          >
                            <Check className="size-3" strokeWidth={3} />
                          </span>
                          {item.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </Reveal>
            ))}
          </ul>
        )}
      </section>

      <CtaSection />
    </>
  );
}
