import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { services } from "@/data/services";
import { homeContent } from "@/data/content";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { ServiceIconBadge } from "./service-icon";

export function ServicesSection() {
  const { services: copy } = homeContent;

  return (
    <section aria-labelledby="services-title" className="section-y">
      <div className="container-page">
        <Reveal className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <div>
            <Eyebrow>{copy.eyebrow}</Eyebrow>
            <h2 id="services-title" className="text-headline mt-4">
              {copy.title}
            </h2>
            <p className="text-title mt-3 max-w-xl text-balance text-muted">
              {copy.statement}
            </p>
          </div>
          <p className="max-w-md self-end text-muted lg:justify-self-end">
            {copy.body}
          </p>
        </Reveal>

        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service, i) => (
            <Reveal as="li" key={service.id} delay={i * 0.07}>
              <Link
                href={`/services#${service.slug}`}
                className="glass group flex h-full min-h-56 flex-col rounded-card p-6 transition-[transform,border-color,background-color] duration-500 ease-out-soft hover:-translate-y-1 hover:border-line-strong hover:bg-glass-strong"
              >
                <ServiceIconBadge icon={service.icon} />
                <h3 className="mt-8 text-lg font-medium tracking-tight">
                  {service.title}
                </h3>
                <p className="mt-2 text-[0.95rem] text-muted">{service.description}</p>
                <ArrowUpRight
                  aria-hidden
                  className="mt-auto ml-auto size-5 pt-0 text-subtle transition-[transform,color] duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent"
                />
              </Link>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
