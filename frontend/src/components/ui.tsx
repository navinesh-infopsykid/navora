import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { PaymentStatus } from "../lib/api";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: PaymentStatus }) {
  return status === "PAID" ? (
    <span className="inline-flex rounded-full bg-paid-tint px-2 py-0.5 text-xs font-semibold text-paid">Paid</span>
  ) : (
    <span className="inline-flex rounded-full bg-due-tint px-2 py-0.5 text-xs font-semibold text-due">Unpaid</span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-ink-soft" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function Notice({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-khata/30 bg-khata-tint text-khata-dark",
    success: "border-paid/30 bg-paid-tint text-paid",
    info: "border-rule bg-rule-soft text-ink-soft",
  }[kind];
  const Icon = kind === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${styles}`} role={kind === "error" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

/** Accessible modal dialog using the native <dialog> element (Esc closes, focus is trapped). */
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] rounded-lg border border-rule bg-sheet p-0 text-ink shadow-xl backdrop:bg-ink/40 ${wide ? "max-w-2xl" : "max-w-lg"}`}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" className="btn-ghost btn -mr-2 -mt-1 px-2" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
