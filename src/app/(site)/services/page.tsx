import type { Metadata } from "next";
import { Check } from "lucide-react";
import { CtaSection } from "@/components/cta/cta-section";
import { ServiceIconBadge } from "@/components/services/service-icon";
import { PageHeader } from "@/components/ui/page-header";
import { Reveal } from "@/components/ui/reveal";
import { services } from "@/data/services";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Web design, web development, redesigns and ongoing maintenance for businesses that want a modern, fast website.",
  alternates: { canonical: "/services" },
  openGraph: { url: "/services", title: "Services" },
};

export default function ServicesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Services"
        title="Websites, web applications and everything in between."
        description="From clean landing pages to complex web applications, I focus on modern design, strong performance and a smooth user experience."
      />

      <section aria-label="Services" className="container-page pb-(--section-y)">
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
                <ul className="mt-6 space-y-3 border-t border-line pt-6">
                  {service.includes.map((item) => (
                    <li key={item} className="flex items-center gap-3 text-[0.95rem]">
                      <span
                        aria-hidden
                        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
                      >
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </ul>
      </section>

      <CtaSection />
    </>
  );
}
