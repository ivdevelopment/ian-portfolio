"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { CrmNav } from "./crm-nav";

/**
 * Below 768px the sidebar becomes a drawer: a native modal <dialog> (focus trap, Esc and backdrop for free) opened from the top
 * bar. Choosing a destination closes it. `children` is the footer block (links + account), rendered by the server shell.
 */
export function CrmMobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex size-10 items-center justify-center rounded-md border border-line text-muted hover:border-line-strong hover:text-ink md:hidden"
      >
        <Menu aria-hidden className="size-5" />
        <span className="sr-only">Open navigation</span>
      </button>
      <dialog
        ref={ref}
        aria-label="Navigation"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // A click on the backdrop (the dialog element itself) closes it.
          if (e.target === ref.current) setOpen(false);
        }}
        className="m-0 h-dvh max-h-none w-[min(20rem,86vw)] max-w-none border-r border-line bg-surface p-0 text-ink backdrop:bg-black/60"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center justify-between border-b border-line px-4">
            <span className="text-sm font-medium tracking-tight">Ian Verlinden CRM</span>
            <button type="button" onClick={() => setOpen(false)} className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:text-ink">
              <X aria-hidden className="size-5" />
              <span className="sr-only">Close navigation</span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <CrmNav onNavigate={() => setOpen(false)} />
          </div>
          <div className="border-t border-line p-4">{children}</div>
        </div>
      </dialog>
    </>
  );
}
