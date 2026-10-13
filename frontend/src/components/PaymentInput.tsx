import type { PaymentMethod, SingleMethod } from "../lib/api";
import { METHOD_LABELS } from "../lib/format";
import { formatMoney, paiseToText, parseRupees } from "../lib/money";

export const SINGLE_METHODS: SingleMethod[] = ["CASH", "UPI", "CARD", "OTHER"];

/** What the cashier picked: one method, or "SPLIT" with an amount per method (as typed). */
export interface PaymentState {
  method: PaymentMethod;
  amounts: Record<SingleMethod, string>;
}

export const emptyPayment = (method: PaymentMethod = "CASH"): PaymentState => ({
  method,
  amounts: { CASH: "", UPI: "", CARD: "", OTHER: "" },
});

/**
 * Turns the picker into what the API expects, and checks a split adds up.
 * Returns { paymentMethod, payments } or an error message to show.
 */
export function paymentPayload(state: PaymentState, totalPaise: number) {
  if (state.method !== "SPLIT") return { paymentMethod: state.method, payments: null, error: null, enteredPaise: totalPaise };
  const parts: { method: SingleMethod; amountPaise: number }[] = [];
  for (const m of SINGLE_METHODS) {
    const text = state.amounts[m].trim();
    if (!text) continue;
    const paise = parseRupees(text);
    if (paise === null) return { paymentMethod: "SPLIT" as const, payments: null, error: `${METHOD_LABELS[m]}: enter an amount like 250 or 250.50`, enteredPaise: 0 };
    if (paise > 0) parts.push({ method: m, amountPaise: paise });
  }
  const enteredPaise = parts.reduce((s, p) => s + p.amountPaise, 0);
  let error: string | null = null;
  if (parts.length === 0) error = "Enter how much was paid by each method";
  else if (enteredPaise < totalPaise) error = `${formatMoney(totalPaise - enteredPaise)} still to enter`;
  else if (enteredPaise > totalPaise) error = `${formatMoney(enteredPaise - totalPaise)} more than the bill`;
  return { paymentMethod: "SPLIT" as const, payments: parts, error, enteredPaise };
}

/** Payment method buttons, plus amount boxes when "Split" is chosen. */
export default function PaymentInput({ value, onChange, totalPaise }: { value: PaymentState; onChange: (v: PaymentState) => void; totalPaise: number }) {
  const split = value.method === "SPLIT";
  const check = paymentPayload(value, totalPaise);

  function setAmount(m: SingleMethod, text: string) {
    onChange({ ...value, amounts: { ...value.amounts, [m]: text } });
  }

  /** Put whatever is still unpaid into this method's box. */
  function fillRest(m: SingleMethod) {
    const others = SINGLE_METHODS.filter((x) => x !== m).reduce((s, x) => s + (parseRupees(value.amounts[x]) ?? 0), 0);
    const rest = Math.max(0, totalPaise - others);
    setAmount(m, rest > 0 ? paiseToText(rest) : "");
  }

  return (
    <fieldset>
      <legend className="label">Payment method</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {[...SINGLE_METHODS, "SPLIT" as const].map((m) => (
          <label
            key={m}
            className={`cursor-pointer rounded-md border py-1.5 text-center text-sm font-medium ${
              value.method === m ? "border-ink bg-ink text-white" : "border-rule text-ink-soft hover:border-ink"
            }`}
          >
            <input type="radio" name="method" value={m} checked={value.method === m} onChange={() => onChange({ ...value, method: m })} className="sr-only" />
            {METHOD_LABELS[m]}
          </label>
        ))}
      </div>

      {split && (
        <div className="mt-3 space-y-1.5 rounded-md border border-rule bg-paper p-3">
          {SINGLE_METHODS.map((m) => (
            <div key={m} className="flex items-center gap-2">
              <label htmlFor={`split-${m}`} className="w-12 text-sm text-ink-soft">
                {METHOD_LABELS[m]}
              </label>
              <div className="relative flex-1">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-ink-faint">₹</span>
                <input
                  id={`split-${m}`}
                  className="field num py-1 pl-6"
                  value={value.amounts[m]}
                  onChange={(e) => setAmount(m, e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                />
              </div>
              <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => fillRest(m)} title={`Put the remaining amount in ${METHOD_LABELS[m]}`}>
                Rest
              </button>
            </div>
          ))}
          <p className={`num pt-1 text-sm ${check.error ? "text-due" : "text-paid"}`} role="status">
            {check.error ?? `${formatMoney(check.enteredPaise)} entered, matches the bill`}
          </p>
        </div>
      )}
    </fieldset>
  );
}
