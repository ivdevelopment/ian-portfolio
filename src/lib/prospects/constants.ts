/** Pipeline vocabulary of the prospect CRM. Stable internal values; labels are for the admin UI. */

export const PROSPECT_STATUSES = [
  "new",
  "researching",
  "ready_to_contact",
  "contacted",
  "follow_up_due",
  "replied",
  "interested",
  "concept_sent",
  "meeting_planned",
  "quote_sent",
  "won",
  "lost",
  "not_interested",
  "no_response",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const STATUS_LABELS: Record<ProspectStatus, string> = {
  new: "New",
  researching: "Researching",
  ready_to_contact: "Ready to contact",
  contacted: "Contacted",
  follow_up_due: "Follow-up due",
  replied: "Replied",
  interested: "Interested",
  concept_sent: "Concept sent",
  meeting_planned: "Meeting planned",
  quote_sent: "Quote sent",
  won: "Won",
  lost: "Lost",
  not_interested: "Not interested",
  no_response: "No response",
};

/** No further sales action is expected from these. */
export const CLOSED_STATUSES: readonly ProspectStatus[] = ["won", "lost", "not_interested", "no_response"];
/** The prospect has responded at some point. */
export const REPLIED_STATUSES: readonly ProspectStatus[] = [
  "replied",
  "interested",
  "concept_sent",
  "meeting_planned",
  "quote_sent",
  "won",
];
/** Open prospects that responded: live sales opportunities. */
export const OPPORTUNITY_STATUSES: readonly ProspectStatus[] = [
  "replied",
  "interested",
  "concept_sent",
  "meeting_planned",
  "quote_sent",
];
/** Not contacted yet. */
export const PRE_CONTACT_STATUSES: readonly ProspectStatus[] = ["new", "researching", "ready_to_contact"];

export const isClosed = (status: ProspectStatus) => CLOSED_STATUSES.includes(status);

export const STATUS_TONES: Record<ProspectStatus, "neutral" | "accent" | "success" | "warn" | "danger"> = {
  new: "neutral",
  researching: "neutral",
  ready_to_contact: "neutral",
  contacted: "accent",
  follow_up_due: "warn",
  replied: "success",
  interested: "success",
  concept_sent: "accent",
  meeting_planned: "accent",
  quote_sent: "accent",
  won: "success",
  lost: "danger",
  not_interested: "danger",
  no_response: "neutral",
};

export const PROSPECT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type ProspectPriority = (typeof PROSPECT_PRIORITIES)[number];
export const PRIORITY_LABELS: Record<ProspectPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};
export const PRIORITY_TONES: Record<ProspectPriority, "neutral" | "accent" | "warn" | "danger"> = {
  low: "neutral",
  normal: "neutral",
  high: "warn",
  urgent: "danger",
};

export const DELIVERY_STATUSES = ["confirmed", "needs_verification", "unknown"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  confirmed: "Sending confirmed",
  needs_verification: "Verify sending",
  unknown: "Unknown",
};

export const ACTIVITY_TYPES = [
  "created",
  "imported",
  "note",
  "status_changed",
  "contacted",
  "follow_up_sent",
  "reply_received",
  "concept_sent",
  "meeting_planned",
  "quote_sent",
  "follow_up_set",
  "follow_up_done",
  "preview_linked",
  "preview_unlinked",
  "project_linked",
  "project_created",
  "won",
  "lost",
  "other",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Activity kinds a person can add by hand. */
export const MANUAL_ACTIVITY_TYPES: Array<{ value: ActivityType; label: string }> = [
  { value: "note", label: "Note" },
  { value: "contacted", label: "Contact sent" },
  { value: "follow_up_sent", label: "Follow-up sent" },
  { value: "reply_received", label: "Reply received" },
  { value: "concept_sent", label: "Concept sent" },
  { value: "meeting_planned", label: "Meeting planned" },
  { value: "quote_sent", label: "Quote sent" },
  { value: "other", label: "Other" },
];

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** Columns the list can be sorted by (mapped to real columns; status/priority sort in pipeline order). */
export const SORT_COLUMNS = {
  company: "company_name",
  created: "created_at",
  first_contact: "first_contact_on",
  last_contact: "last_contact_on",
  follow_up: "next_follow_up_on",
  status: "status_order",
  priority: "priority_order",
  estimated: "estimated_value_eur",
  quote: "quote_value_eur",
} as const;
export type SortKey = keyof typeof SORT_COLUMNS;
