export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <div className="h-7 w-48 animate-pulse rounded-md bg-glass-strong" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-card bg-glass" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-card bg-glass" />
    </div>
  );
}
