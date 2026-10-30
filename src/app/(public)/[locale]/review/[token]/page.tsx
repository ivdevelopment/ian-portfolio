import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewForm } from "@/components/forms/review-form";
import { Eyebrow } from "@/components/ui/eyebrow";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getI18n } from "@/i18n/server";
import { getInvitationPreview } from "@/lib/review-invitations";

// Private, single-use links: never index, never follow. The language never affects the token.
export async function generateMetadata({ params }: PageProps<"/[locale]/review/[token]">): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: getDictionary(isLocale(locale) ? locale : "nl").review.pageTitle,
    robots: { index: false, follow: false },
  };
}

export default async function ReviewPage({ params }: PageProps<"/[locale]/review/[token]">) {
  const { dict } = await getI18n();
  return (
    <div className="container-page page-top pb-(--section-y)">
      <div className="mx-auto max-w-2xl">
        <Eyebrow>{dict.review.eyebrow}</Eyebrow>
        <h1 className="text-headline mt-4">{dict.review.pageTitle}</h1>
        <p className="mt-5 text-lg text-muted">
          {dict.review.intro1}
          <br />
          {dict.review.intro2}
        </p>

        <div className="mt-10">
          <Suspense fallback={<div aria-hidden className="glass h-96 animate-pulse rounded-panel" />}>
            <ReviewGate params={params} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function ReviewGate({ params }: Pick<PageProps<"/[locale]/review/[token]">, "params">) {
  const { token } = await params;
  const { dict } = await getI18n();
  const invitation = await getInvitationPreview(token);

  if (!invitation) {
    return (
      <div role="alert" className="glass rounded-panel p-8 text-center sm:p-12">
        <p className="text-lg">{dict.review.invalidLink}</p>
      </div>
    );
  }

  return (
    <ReviewForm
      token={token}
      clientName={invitation.clientName}
      projectTitle={invitation.projectTitle}
      projectThumbnail={invitation.projectThumbnail}
    />
  );
}
