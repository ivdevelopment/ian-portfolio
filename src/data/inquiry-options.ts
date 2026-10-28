export const PROJECT_TYPES = [
  "New website",
  "Redesign",
  "Web application",
  "Landing page",
  "Other",
] as const;

export const BUDGETS = [
  "< €1,000",
  "€1,000 – €2,500",
  "€2,500 – €5,000",
  "€5,000+",
] as const;

export type ProjectTypeOption = (typeof PROJECT_TYPES)[number];
export type BudgetOption = (typeof BUDGETS)[number];
