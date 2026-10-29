"use client";

import { Button, ButtonLink } from "@/components/ui/button";

/** Public fallback: a temporary data or network problem never shows a stack trace. */
export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div
      role="alert"
      className="container-page page-top flex min-h-[60dvh] flex-col items-start justify-center pb-24"
    >
      <p className="text-sm tracking-[0.18em] text-muted uppercase">Something went wrong</p>
      <h1 className="text-display mt-4">This page couldn&apos;t load.</h1>
      <p className="mt-5 max-w-md text-lg text-muted">
        It&apos;s usually temporary. Try again in a moment, or head back to the homepage.
      </p>
      <div className="mt-8 flex gap-3">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <ButtonLink href="/" variant="secondary" size="lg" icon="none">
          Back to home
        </ButtonLink>
      </div>
    </div>
  );
}
