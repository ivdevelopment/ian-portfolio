import { cn } from "@/lib/utils";

/**
 * The one loading vocabulary of the site: a small spinner, a skeleton block, and a few skeleton layouts that mirror the real pages.
 * Colours come from the existing tokens, the spinner inherits the text colour, and every animation stops under
 * `prefers-reduced-motion` (the words next to a spinner carry the meaning, not the motion).
 */

/** Small ring, `currentColor`, decorative unless `label` is given (then it is a polite status for assistive tech). */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80 motion-reduce:animate-none", className)}
    >
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Spinner for inside a button: always decorative (the button's own text says what is happening). */
export function ButtonSpinner({ className }: { className?: string }) {
  return <Spinner className={className} />;
}

/** Placeholder block. Decorative: the surrounding region announces loading once. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-glass-strong motion-reduce:animate-none", className)} />;
}

/** A page's loading region: announced once as busy, with the skeleton inside. */
export function PageLoading({ label = "page", children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn("space-y-4", className)}>
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  );
}

export function PageHeaderSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div aria-hidden className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }, (_, i) => (
          <Skeleton key={i} className="h-10 w-28 rounded-full" />
        ))}
      </div>
    </div>
  );
}

/** Row of KPI cards (dashboard, list summaries). */
export function StatCardsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-card border border-line bg-glass p-3.5">
          <Skeleton className="h-6 w-14" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Panel with a heading and a few text lines. */
export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("rounded-card border border-line bg-glass p-4 sm:p-5", className)}>
      <Skeleton className="mb-4 h-4 w-32" />
      <div className="space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    </div>
  );
}

/** Filter row + table rows (cards on narrow screens use the same rows). */
export function TableSkeleton({ rows = 8, filters = true }: { rows?: number; filters?: boolean }) {
  return (
    <div aria-hidden>
      {filters && (
        <div className="mb-4 flex flex-wrap gap-3">
          <Skeleton className="h-10 min-w-0 flex-1 basis-60" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-32" />
        </div>
      )}
      <div className="overflow-hidden rounded-card border border-line">
        <div className="border-b border-line bg-glass px-3 py-3">
          <Skeleton className="h-3 w-1/3" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line/60 px-3 py-3.5 last:border-0">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
            <Skeleton className="hidden h-3.5 w-24 md:block" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A stack of form panels (create / edit pages, settings). */
export function FormSkeleton({ panels = 3 }: { panels?: number }) {
  return (
    <div aria-hidden className="space-y-4">
      {Array.from({ length: panels }, (_, p) => (
        <div key={p} className="rounded-card border border-line bg-glass p-4 sm:p-5">
          <Skeleton className="mb-4 h-4 w-28" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className={i === 0 ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Detail pages: header, action row, then a main column and a side column. */
export function DetailSkeleton({ side = true }: { side?: boolean }) {
  return (
    <div aria-hidden>
      <div className="mb-5 flex flex-wrap gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-28 rounded-full" />
        ))}
      </div>
      <div className={cn("grid gap-4", side && "xl:grid-cols-[minmax(0,1fr)_22rem]")}>
        <div className="space-y-4">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={6} />
        </div>
        {side && (
          <div className="space-y-4">
            <CardSkeleton lines={4} />
            <CardSkeleton lines={3} />
          </div>
        )}
      </div>
    </div>
  );
}

/** A section that loads on its own (a panel inside an otherwise ready page). */
export function SectionSkeleton({ title, lines = 3, label }: { title?: string; lines?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading {label ?? title ?? "section"}…</span>
      <CardSkeleton lines={lines} />
    </div>
  );
}
