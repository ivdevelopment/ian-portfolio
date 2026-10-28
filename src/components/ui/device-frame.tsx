import { cn } from "@/lib/utils";

/** CSS laptop that frames a screenshot (or any media) at a 16:10 ratio. */
export function DeviceFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full", className)}>
      <div className="rounded-t-[0.9rem] border border-line-strong bg-bezel p-[1.6%] shadow-lift">
        <div className="relative aspect-[16/10] overflow-hidden rounded-[0.3rem] bg-surface">
          {children}
        </div>
      </div>
      <div
        aria-hidden
        className="-mx-[3%] h-2 rounded-b-xl bg-gradient-to-b from-aluminium to-subtle shadow-[0_14px_24px_-10px_rgb(0_0_0/0.7)] sm:h-3"
      />
    </div>
  );
}
