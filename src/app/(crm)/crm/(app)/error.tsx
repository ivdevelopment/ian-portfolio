"use client";

import { Button } from "@/components/ui/button";

export default function CrmError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="rounded-card border border-danger/40 p-6">
      <h1 className="text-lg font-medium">Something went wrong</h1>
      <p className="mt-1 text-sm text-muted">The CRM couldn&apos;t load this screen. Check your connection and try again.</p>
      <Button className="mt-4" size="sm" variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
