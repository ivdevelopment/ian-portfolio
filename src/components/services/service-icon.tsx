import {
  Code,
  Compass,
  Database,
  Gauge,
  LayoutTemplate,
  LifeBuoy,
  RefreshCw,
  Search,
  ShoppingCart,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ServiceIconId } from "@/lib/schemas/site-content";

/** Controlled identifiers only — never arbitrary SVG or HTML from the CMS. */
const icons: Record<ServiceIconId, LucideIcon> = {
  design: LayoutTemplate,
  development: Code,
  redesign: RefreshCw,
  maintenance: Wrench,
  performance: Gauge,
  seo: Search,
  cms: Database,
  support: LifeBuoy,
  strategy: Compass,
  ecommerce: ShoppingCart,
};

export function ServiceIconBadge({ icon }: { icon: ServiceIconId }) {
  const Icon = icons[icon] ?? LayoutTemplate;
  return (
    <span className="inline-flex size-11 items-center justify-center rounded-md border border-line bg-accent-soft text-accent">
      <Icon aria-hidden className="size-5" strokeWidth={1.6} />
    </span>
  );
}
