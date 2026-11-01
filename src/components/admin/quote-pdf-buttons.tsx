"use client";

import { useAppPaths } from "@/lib/crm/paths-context";
import { useState } from "react";
import { Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePendingAction } from "@/lib/use-pending-action";

/** "attachment; filename="Q-2026-0004-geert-kips.pdf"" -> the file name, or a safe fallback. */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  const match = header ? /filename="([^"\\/]+)"/.exec(header) : null;
  return match?.[1] ?? fallback;
}

/**
 * Preview opens the PDF in a new tab (inline). Download fetches it here so the button can say "Generating PDF…" while the server
 * builds it, then saves it; a failure is shown next to the buttons and the button comes back. Both are plain requests to a
 * signed-in-only route: there is no stored file and no shareable link.
 */
export function QuotePdfButtons({ id }: { id: string }) {
  const P = useAppPaths();
  const url = P.quotePdf(id);
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);

  const download = () =>
    run(async () => {
      setError(null);
      try {
        const response = await fetch(`${url}?download=1`, { credentials: "same-origin" });
        if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) {
          setError(response.status === 404 ? "This quote could not be found. Reload the page." : "The PDF could not be generated. Try again.");
          return;
        }
        const blob = await response.blob();
        const link = document.createElement("a");
        const href = URL.createObjectURL(blob);
        link.href = href;
        link.download = fileNameFromDisposition(response.headers.get("content-disposition"), "quote.pdf");
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
      } catch {
        setError("The PDF could not be downloaded. Check your connection and try again.");
      }
    });

  return (
    <>
      <Button size="sm" variant="secondary" icon="none" disabled={pending} onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
        <Eye aria-hidden className="size-4" />
        Preview PDF
      </Button>
      <Button size="sm" variant="secondary" icon="none" pending={pending} pendingLabel="Generating PDF…" onClick={() => void download()}>
        <Download aria-hidden className="size-4" />
        Download PDF
      </Button>
      {pending && (
        <span role="status" className="sr-only">
          Generating PDF…
        </span>
      )}
      {error && (
        <span role="alert" className="w-full text-sm text-danger">
          {error}
        </span>
      )}
    </>
  );
}
