import Link from "next/link";

export default function CrmNotFound() {
  return (
    <div className="rounded-card border border-line p-6">
      <h1 className="text-lg font-medium">Not found</h1>
      <p className="mt-1 text-sm text-muted">That page doesn&apos;t exist, or the record has been removed.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-accent underline-offset-4 hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
