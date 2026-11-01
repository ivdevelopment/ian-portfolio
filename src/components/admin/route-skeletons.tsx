import { CardSkeleton, DetailSkeleton, FormSkeleton, PageHeaderSkeleton, PageLoading, Skeleton, StatCardsSkeleton, TableSkeleton } from "@/components/ui/loading";

/**
 * Whole-route skeletons for the admin `loading.tsx` files. They mirror the real pages (header, summary cards, filter row, table or
 * form panels) so nothing jumps when the content arrives. Each one is announced once as a busy region.
 */

export function ListRouteSkeleton({ label, stats = 0, rows = 8, actions = 1 }: { label: string; stats?: number; rows?: number; actions?: number }) {
  return (
    <PageLoading label={label} className="space-y-0">
      <PageHeaderSkeleton actions={actions} />
      {stats > 0 && <StatCardsSkeleton count={stats} className="mb-5 md:grid-cols-3 xl:grid-cols-6" />}
      <TableSkeleton rows={rows} />
    </PageLoading>
  );
}

export function DetailRouteSkeleton({ label, side = true }: { label: string; side?: boolean }) {
  return (
    <PageLoading label={label} className="space-y-0">
      <PageHeaderSkeleton actions={0} />
      <DetailSkeleton side={side} />
    </PageLoading>
  );
}

export function FormRouteSkeleton({ label, panels = 3 }: { label: string; panels?: number }) {
  return (
    <PageLoading label={label} className="space-y-0">
      <PageHeaderSkeleton actions={0} />
      <FormSkeleton panels={panels} />
    </PageLoading>
  );
}

/** Cards in a grid (pages overview, media library). */
export function GridRouteSkeleton({ label, items = 6, tall = false }: { label: string; items?: number; tall?: boolean }) {
  return (
    <PageLoading label={label} className="space-y-0">
      <PageHeaderSkeleton actions={1} />
      <div aria-hidden className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: items }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-card border border-line bg-glass">
            <Skeleton className={tall ? "aspect-square w-full rounded-none" : "h-28 w-full rounded-none"} />
            <div className="space-y-2 p-3">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </PageLoading>
  );
}

/** The pipeline board: one narrow column per status, a few cards each. */
export function KanbanRouteSkeleton() {
  return (
    <PageLoading label="pipeline" className="space-y-0">
      <PageHeaderSkeleton actions={2} />
      <div aria-hidden className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }, (_, c) => (
          <div key={c} className="w-64 shrink-0 space-y-2.5 rounded-card border border-line bg-glass p-2.5">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 4 - (c % 3) }, (_, i) => (
              <div key={i} className="space-y-2 rounded-md border border-line bg-glass p-3">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </PageLoading>
  );
}

export function DashboardRouteSkeleton() {
  return (
    <PageLoading label="dashboard" className="space-y-0">
      <PageHeaderSkeleton actions={1} />
      <StatCardsSkeleton count={6} className="md:grid-cols-3 xl:grid-cols-6" />
      <CardSkeleton lines={4} className="mt-6" />
      <CardSkeleton lines={3} className="mt-4" />
      <div aria-hidden className="mt-6 grid gap-4 lg:grid-cols-2">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
      </div>
    </PageLoading>
  );
}
