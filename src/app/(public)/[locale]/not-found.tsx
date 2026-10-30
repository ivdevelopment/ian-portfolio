import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.errors.notFoundTitle, robots: { index: false } };
}

export default async function NotFound() {
  const { dict } = await getI18n();
  return (
    <div className="container-page page-top flex min-h-[70dvh] flex-col items-start justify-center pb-24">
      <p className="text-sm tracking-[0.18em] text-muted uppercase">{dict.errors.notFoundEyebrow}</p>
      <h1 className="text-display mt-4">{dict.errors.notFoundHeading}</h1>
      <p className="mt-5 max-w-md text-lg text-muted">{dict.errors.notFoundBody}</p>
      <div className="mt-8 flex gap-3">
        <ButtonLink href="/" size="lg">
          {dict.common.backToHome}
        </ButtonLink>
        <ButtonLink href="/work" variant="secondary" size="lg" icon="none">
          {dict.common.viewMyWork}
        </ButtonLink>
      </div>
    </div>
  );
}
