import type { ActivityType, DeliveryStatus, ProspectPriority, ProspectStatus } from "./constants";

/** A prospect as stored. Dates are calendar days ("YYYY-MM-DD") in Europe/Brussels. */
export type ProspectRecord = {
  id: string;
  company_name: string;
  sector: string | null;
  city: string | null;
  website_url: string | null;
  email: string | null;
  contact_name: string | null;
  phone: string | null;
  status: ProspectStatus;
  priority: ProspectPriority;
  first_contact_on: string | null;
  last_contact_on: string | null;
  next_follow_up_on: string | null;
  estimated_value_eur: number | null;
  quote_value_eur: number | null;
  contact_delivery_status: DeliveryStatus;
  source: string | null;
  notes: string | null;
  linked_project_id: string | null;
  linked_preview_id: string | null;
  legacy_ref: string | null;
  last_activity_on: string | null;
  last_activity_title: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivityRecord = {
  id: string;
  prospect_id: string;
  type: ActivityType;
  title: string;
  description: string | null;
  occurred_on: string;
  occurred_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ProspectSummary = {
  total: number;
  contacted: number;
  replies: number;
  active_opportunities: number;
  followups_overdue: number;
  followups_today: number;
  followups_week: number;
  pipeline_value: number;
  pipeline_count: number;
  quote_total: number;
  quote_count: number;
  won_value: number;
  won_count: number;
};
