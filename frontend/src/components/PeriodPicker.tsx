/**
 * Period filter used by the Dashboard and Invoices pages.
 *
 * "day" (one chosen date) is shown as its own option but sent to the API as a
 * custom range with the same from and to date.
 */
export type Period = "all" | "today" | "yesterday" | "week" | "month" | "fy" | "lastfy" | "day" | "custom";

export interface PeriodValue {
  period: Period;
  from: string; // YYYY-MM-DD (day: the chosen date)
  to: string;
}

const LABELS: Record<Period, string> = {
  all: "All",
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  month: "This month",
  fy: "This financial year",
  lastfy: "Last financial year",
  day: "Pick a day",
  custom: "Custom range",
};

/** Today's date in the browser's timezone as YYYY-MM-DD. */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Query parameters for the API, or null when the chosen dates aren't complete yet. */
export function periodParams(v: PeriodValue): { range: string; from?: string; to?: string } | null {
  if (v.period === "day") return v.from ? { range: "custom", from: v.from, to: v.from } : null;
  if (v.period === "custom") return v.from && v.to ? { range: "custom", from: v.from, to: v.to } : null;
  return { range: v.period };
}

/** Short description of the chosen period, e.g. "14 Oct 2026" or "1 Oct – 13 Oct 2026". */
export function periodLabel(v: PeriodValue) {
  const fmt = (iso: string, withYear = true) =>
    new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(new Date(`${iso}T00:00:00`));
  if (v.period === "day" && v.from) return fmt(v.from);
  if (v.period === "custom" && v.from && v.to) return v.from === v.to ? fmt(v.from) : `${fmt(v.from, false)} – ${fmt(v.to)}`;
  return LABELS[v.period];
}

export default function PeriodPicker({ value, onChange, options }: { value: PeriodValue; onChange: (v: PeriodValue) => void; options: Period[] }) {
  function choose(period: Period) {
    if (period === "day") onChange({ period, from: value.from || todayISO(), to: "" });
    else if (period === "custom") onChange({ period, from: value.from, to: value.to });
    else onChange({ period, from: "", to: "" });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period">
        {options.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => choose(p)}
            aria-pressed={value.period === p}
            className={`rounded-full border px-3 py-1 text-sm font-medium ${value.period === p ? "border-ink bg-ink text-white" : "border-rule bg-sheet text-ink-soft hover:border-ink"}`}
          >
            {LABELS[p]}
          </button>
        ))}
      </div>

      {value.period === "day" && (
        <div className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="periodDay">
              Date
            </label>
            <input id="periodDay" type="date" className="field" value={value.from} max={todayISO()} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          </div>
        </div>
      )}

      {value.period === "custom" && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="periodFrom">
              From
            </label>
            <input id="periodFrom" type="date" className="field" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="periodTo">
              To
            </label>
            <input id="periodTo" type="date" className="field" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}
