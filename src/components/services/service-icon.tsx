import { Code, LayoutTemplate, RefreshCw, Wrench, type LucideIcon } from "lucide-react";
import type { ServiceIcon } from "@/types/service";

const icons: Record<ServiceIcon, LucideIcon> = {
  design: LayoutTemplate,
  development: Code,
  redesign: RefreshCw,
  maintenance: Wrench,
};

export function ServiceIconBadge({ icon }: { icon: ServiceIcon }) {
  const Icon = icons[icon];
  return (
    <span className="inline-flex size-11 items-center justify-center rounded-md border border-line bg-accent-soft text-accent">
      <Icon aria-hidden className="size-5" strokeWidth={1.6} />
    </span>
  );
}
