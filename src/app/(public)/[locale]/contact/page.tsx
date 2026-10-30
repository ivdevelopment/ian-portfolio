import type { Metadata } from "next";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getI18n } from "@/i18n/server";
import { pageMetadata } from "@/lib/page-metadata";
import { publicEmail } from "@/lib/placeholder-email";
import { Mail, MapPin } from "lucide-react";
import { ContactForm } from "@/components/forms/contact-form";
import { PageHeader } from "@/components/ui/page-header";
import { Reveal } from "@/components/ui/reveal";
import { getContactContent, getSiteSettings } from "@/lib/site-content";

export async function generateMetadata({ params }: PageProps<"/[locale]/contact">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = getDictionary(locale);
  return pageMetadata({ locale, title: dict.contact.title, description: dict.contact.description, path: "/contact" });
}

export default async function ContactPage() {
  const { locale, dict } = await getI18n();
  const [content, settings] = await Promise.all([getContactContent(locale), getSiteSettings(locale)]);
  const email = publicEmail(content.email) || settings.contactEmail;

  return (
    <>
      <PageHeader
        eyebrow={content.eyebrow || undefined}
        title={content.heading}
        description={content.description || undefined}
      />

      <section aria-label={dict.contact.sectionLabel} className="container-page pb-(--section-y)">
        <Reveal>
          <ContactForm />
        </Reveal>

        <Reveal delay={0.08}>
          <ul className="mt-8 flex flex-col gap-3 text-muted sm:flex-row sm:flex-wrap sm:gap-x-10">
            {email && (
              <li className="flex items-center gap-2.5">
                <Mail aria-hidden className="size-4 text-accent" />
                <a href={`mailto:${email}`} className="transition-colors hover:text-ink">
                  {email}
                </a>
              </li>
            )}
            {settings.location && (
              <li className="flex items-center gap-2.5">
                <MapPin aria-hidden className="size-4 text-accent" />
                {settings.location}
              </li>
            )}
            {content.responseTime && <li>{content.responseTime}</li>}
            {content.availability && <li>{content.availability}</li>}
          </ul>
        </Reveal>
      </section>
    </>
  );
}
