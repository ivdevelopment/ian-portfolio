export type ServiceIcon = "design" | "development" | "redesign" | "maintenance";

export type Service = {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: ServiceIcon;
  /** Longer list shown on /services. */
  includes: string[];
};
