import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewForm } from "@/components/forms/review-form";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getInvitationPreview } from "@/lib/review-invitations";
import { INVALID_REVIEW_LINK_MESSAGE } from "@/lib/review-tokens";

// Private, single-use links: never index, never follow.
export const metadata: Metadata = {
  title: "Share your experience",
  robots: { index: false, follow: false },
};

export default function ReviewPage({ params }: PageProps<"/review/[token]">) {
  return (
    <div className="container-page page-top pb-(--section-y)">
      <div className="mx-auto max-w-2xl">
        <Eyebrow>Review</Eyebrow>
        <h1 className="text-headline mt-4">Share your experience</h1>
        <p className="mt-5 text-lg text-muted">
          Thanks for working with me.
          <br />
          I&apos;d love to hear how the project went.
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

async function ReviewGate({ params }: Pick<PageProps<"/review/[token]">, "params">) {
  const { token } = await params;
  const invitation = await getInvitationPreview(token);

  if (!invitation) {
    return (
      <div role="alert" className="glass rounded-panel p-8 text-center sm:p-12">
        <p className="text-lg">{INVALID_REVIEW_LINK_MESSAGE}</p>
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
