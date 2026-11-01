import { Spinner } from "@/components/ui/loading";
import { cn } from "@/lib/utils";

export const iconButtonClass =
  "inline-flex size-8 items-center justify-center rounded-md border border-line text-muted transition-colors " +
  "hover:border-line-strong hover:bg-glass-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Small square action button for table rows. While its own action runs it shows a spinner in place of the icon (same size, so
 * nothing moves) and is marked busy; `disabled` is for "some other action in this row is running".
 */
export function IconButton({
  busy,
  className,
  children,
  ...props
}: { busy?: boolean } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { children: React.ReactNode }) {
  return (
    <button type="button" {...props} disabled={props.disabled || busy} aria-busy={busy || undefined} className={cn(iconButtonClass, busy && "disabled:opacity-100", className)}>
      {busy ? <Spinner className="size-4" /> : children}
    </button>
  );
}

export const rowTextButtonClass =
  "inline-flex h-8 items-center rounded-md border border-line px-2.5 text-xs text-muted transition-colors " +
  "hover:border-line-strong hover:bg-glass-strong hover:text-ink disabled:pointer-events-none disabled:opacity-50";

/**
 * Small text button for a table row. While its own action runs it swaps its label for a spinner and the verb ("Approving…");
 * both labels share one grid cell so the button keeps the width of the longer one and the row does not shift.
 */
export function RowTextButton({
  busy,
  busyLabel,
  className,
  children,
  ...props
}: { busy?: boolean; busyLabel: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { children: React.ReactNode }) {
  return (
    <button type="button" {...props} disabled={props.disabled || busy} aria-busy={busy || undefined} className={cn(rowTextButtonClass, busy && "disabled:opacity-100", className)}>
      <span className="inline-grid">
        <span className={cn("col-start-1 row-start-1", busy && "invisible")} aria-hidden={busy || undefined}>
          {children}
        </span>
        <span className={cn("col-start-1 row-start-1 inline-flex items-center gap-1.5", !busy && "invisible")} aria-hidden={!busy || undefined}>
          <Spinner className="size-3" />
          {busyLabel}
        </span>
      </span>
    </button>
  );
}
