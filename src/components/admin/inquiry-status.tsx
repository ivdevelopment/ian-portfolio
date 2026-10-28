import type { InquiryStatus } from "@/lib/schemas/inquiry";
import { Badge } from "./ui";

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};

const tones: Record<InquiryStatus, Parameters<typeof Badge>[0]["tone"]> = {
  new: "accent",
  contacted: "warn",
  qualified: "warn",
  won: "success",
  lost: "danger",
  archived: "neutral",
};

export function InquiryStatusBadge({ status }: { status: InquiryStatus }) {
  return <Badge tone={tones[status]}>{INQUIRY_STATUS_LABELS[status]}</Badge>;
}
