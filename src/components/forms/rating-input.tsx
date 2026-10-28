"use client";

import { useId, useRef } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

type RatingInputProps = {
  value: number | undefined;
  onChange: (value: number) => void;
  label?: string;
  error?: string;
  errorId?: string;
};

/**
 * Keyboard-accessible star rating built as a radio group: Tab focuses the
 * group, arrow keys change the value, and the current choice is also stated
 * in text ("4 of 5 stars"), so it never relies on colour alone.
 */
export function RatingInput({ value, onChange, label = "Rating", error, errorId }: RatingInputProps) {
  const labelId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (next: number) => {
    const clamped = Math.min(5, Math.max(1, next));
    onChange(clamped);
    refs.current[clamped - 1]?.focus();
  };

  return (
    <div>
      <p id={labelId} className="mb-2.5 text-sm font-medium">
        {label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className="flex items-center gap-1"
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const checked = value === n;
          const tabbable = checked || (value === undefined && n === 1);
          return (
            <button
              key={n}
              ref={(el) => {
                refs.current[n - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
              tabIndex={tabbable ? 0 : -1}
              onClick={() => select(n)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                  e.preventDefault();
                  select((value ?? 0) + 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                  e.preventDefault();
                  select((value ?? 2) - 1);
                } else if (e.key === "Home") {
                  e.preventDefault();
                  select(1);
                } else if (e.key === "End") {
                  e.preventDefault();
                  select(5);
                }
              }}
              className="rounded-md p-1 transition-transform duration-200 hover:scale-110 active:scale-95"
            >
              <Star
                aria-hidden
                className={cn(
                  "size-7 transition-colors",
                  value !== undefined && n <= value ? "fill-accent text-accent" : "text-line-strong",
                )}
              />
            </button>
          );
        })}
        <span aria-live="polite" className="ml-3 text-sm text-muted tabular-nums">
          {value ? `${value} of 5 stars` : "Not rated yet"}
        </span>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
