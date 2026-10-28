import { cn } from "@/lib/utils";

/** Small uppercase label that introduces a section. */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-xs font-medium tracking-[0.18em] text-muted uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}
