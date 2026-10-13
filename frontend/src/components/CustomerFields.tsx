import { UserRound } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { api } from "../lib/api";
import { formatDate, formatPhone } from "../lib/format";

export interface SavedCustomer {
  id: number;
  name: string;
  phone: string;
  lastBilledAt: string;
  invoiceCount: number;
}

type Field = "name" | "phone";

/**
 * Customer name + phone inputs with suggestions from saved customers.
 * Customers are saved automatically whenever a bill has a phone number.
 * Typing in either box (or just clicking into it) shows matching customers;
 * picking one fills both boxes.
 */
export default function CustomerFields({
  name,
  phone,
  onNameChange,
  onPhoneChange,
  onPicked,
}: {
  name: string;
  phone: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onPicked?: () => void;
}) {
  const [active, setActive] = useState<Field | null>(null);
  const [suggestions, setSuggestions] = useState<SavedCustomer[]>([]);
  const [highlight, setHighlight] = useState(-1);

  const query = active === "name" ? name : active === "phone" ? phone : "";

  // Fetch suggestions 200 ms after typing stops.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<SavedCustomer[]>("/customers", { params: { search: query.trim() || undefined, limit: 8 } });
        if (!cancelled) {
          setSuggestions(data);
          setHighlight(query.trim() ? 0 : -1);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, query]);

  function pick(customer: SavedCustomer) {
    onNameChange(customer.name);
    onPhoneChange(formatPhone(customer.phone));
    setActive(null);
    setSuggestions([]);
    onPicked?.();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!active || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && highlight >= 0) {
      e.preventDefault();
      pick(suggestions[highlight]);
    } else if (e.key === "Escape") {
      setActive(null);
    }
  }

  // Small delay so a click on a suggestion lands before the list closes.
  const onBlur = () => setTimeout(() => setActive((current) => (document.activeElement?.closest("[data-customer-field]") ? current : null)), 120);

  const open = active !== null && suggestions.length > 0;

  return (
    <div className="relative">
      <div className="grid gap-3 sm:grid-cols-2">
        <div data-customer-field>
          <label className="label" htmlFor="customerName">
            Customer name
          </label>
          <input
            id="customerName"
            className="field"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onFocus={() => setActive("name")}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            placeholder="Walk-in customer"
            autoComplete="off"
            role="combobox"
            aria-expanded={open && active === "name"}
            aria-controls="customerSuggestions"
          />
        </div>
        <div data-customer-field>
          <label className="label" htmlFor="customerPhone">
            WhatsApp / mobile number
          </label>
          <input
            id="customerPhone"
            className="field num"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            onFocus={() => setActive("phone")}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            placeholder="98765 43210"
            inputMode="tel"
            autoComplete="off"
            role="combobox"
            aria-expanded={open && active === "phone"}
            aria-controls="customerSuggestions"
          />
        </div>
      </div>

      {open && (
        <ul id="customerSuggestions" role="listbox" className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-rule bg-sheet shadow-lg">
          {!query.trim() && <li className="px-3 pt-2 pb-1 text-xs text-ink-faint">Recent customers</li>}
          {suggestions.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === highlight ? "bg-rule-soft" : ""}`}
              >
                <UserRound className="size-4 shrink-0 text-ink-faint" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="num text-xs text-ink-soft">{formatPhone(c.phone)}</span>
                </span>
                <span className="num shrink-0 text-right text-xs text-ink-soft">
                  {c.invoiceCount} {c.invoiceCount === 1 ? "bill" : "bills"}
                  <span className="block">last {formatDate(c.lastBilledAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
