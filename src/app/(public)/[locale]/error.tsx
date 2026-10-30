"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { useDictionary } from "@/i18n/context";

/** Public fallback: a temporary data or network problem never shows a stack trace. */
export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const dict = useDictionary();
  return (
    <div
      role="alert"
      className="container-page page-top flex min-h-[60dvh] flex-col items-start justify-center pb-24"
    >
      <p className="text-sm tracking-[0.18em] text-muted uppercase">{dict.errors.errorEyebrow}</p>
      <h1 className="text-display mt-4">{dict.errors.errorHeading}</h1>
      <p className="mt-5 max-w-md text-lg text-muted">{dict.errors.errorBody}</p>
      <div className="mt-8 flex gap-3">
        <Button size="lg" onClick={reset}>
          {dict.common.tryAgain}
        </Button>
        <ButtonLink href="/" variant="secondary" size="lg" icon="none">
          {dict.common.backToHome}
        </ButtonLink>
      </div>
    </div>
  );
}
