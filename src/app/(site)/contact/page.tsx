import type { Metadata } from "next";
import { Mail, MapPin } from "lucide-react";
import { ContactForm } from "@/components/forms/contact-form";
import { PageHeader } from "@/components/ui/page-header";
import { Reveal } from "@/components/ui/reveal";
import { siteConfig } from "@/config/site";
import { contactContent } from "@/data/content";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Have an idea or need a new website? Tell me about your project and let's talk about it.",
  alternates: { canonical: "/contact" },
  openGraph: { url: "/contact", title: "Contact" },
};

export default function ContactPage() {
  return (
    <>
      <PageHeader
        eyebrow={contactContent.eyebrow}
        title={contactContent.title}
        description={contactContent.body}
      />

      <section aria-label="Project request" className="container-page pb-(--section-y)">
        <Reveal>
          <ContactForm />
        </Reveal>

        <Reveal delay={0.08}>
          <ul className="mt-8 flex flex-col gap-3 text-muted sm:flex-row sm:flex-wrap sm:gap-x-10">
            <li className="flex items-center gap-2.5">
              <Mail aria-hidden className="size-4 text-accent" />
              <a
                href={`mailto:${siteConfig.email}`}
                className="transition-colors hover:text-ink"
              >
                {siteConfig.email}
              </a>
            </li>
            <li className="flex items-center gap-2.5">
              <MapPin aria-hidden className="size-4 text-accent" />
              {siteConfig.location}
            </li>
            <li>{contactContent.responseTime}</li>
          </ul>
        </Reveal>
      </section>
    </>
  );
}
