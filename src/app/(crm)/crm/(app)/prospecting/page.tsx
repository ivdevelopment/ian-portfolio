export { default } from "@/crm/views/prospecting";

// A search runs after the response (see crm/actions/prospecting.ts) and may take a while; this is the longest it may run.
export const maxDuration = 120;
