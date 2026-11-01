"use client";

import { Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A normal link click, so the browser saves the attachment without leaving the page. */
function download(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * Preview opens the PDF in a new tab (inline); Download asks for an attachment. Both are plain requests to a signed-in-only route:
 * there is no stored file and no shareable link.
 */
export function QuotePdfButtons({ id }: { id: string }) {
  const url = `/admin/quotes/${id}/pdf`;
  return (
    <>
      <Button size="sm" variant="secondary" icon="none" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
        <Eye aria-hidden className="size-4" />
        Preview PDF
      </Button>
      <Button size="sm" variant="secondary" icon="none" onClick={() => download(`${url}?download=1`)}>
        <Download aria-hidden className="size-4" />
        Download PDF
      </Button>
    </>
  );
}
