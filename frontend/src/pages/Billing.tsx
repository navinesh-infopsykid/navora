import { CheckCircle2, Clock3, Minus, PauseCircle, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import CustomerFields from "../components/CustomerFields";
import PaymentInput, { emptyPayment, paymentPayload, type PaymentState } from "../components/PaymentInput";
import WhatsAppShare from "../components/WhatsAppShare";
import { Modal, Notice } from "../components/ui";
import { api, errorMessage, pdfUrl, type DiscountType, type HeldCart, type Invoice, type PaymentStatus, type Product } from "../lib/api";
import { formatDateTime, formatPhone, METHOD_LABELS } from "../lib/format";
import { formatMoney, paiseToText, previewTotals } from "../lib/money";

interface CartLine {
  product: Product;
  quantity: number;
}

const MAX_HELD = 5;

/** "Cash ₹300 + UPI ₹200" for split payments, otherwise the method name. */
function paidByText(invoice: Invoice) {
  if (invoice.paymentMethod === "SPLIT" && invoice.payments?.length) {
    return invoice.payments.map((p) => `${METHOD_LABELS[p.method]} ${formatMoney(p.amountPaise)}`).join(" + ");
  }
  return METHOD_LABELS[invoice.paymentMethod];
}

export default function Billing() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("NONE");
  const [discountText, setDiscountText] = useState("");
  const [payment, setPayment] = useState<PaymentState>(emptyPayment());
  const [status, setStatus] = useState<PaymentStatus>("PAID");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Invoice | null>(null);
  const [held, setHeld] = useState<HeldCart[]>([]);
  const [heldOpen, setHeldOpen] = useState(false);
  const [holdBusy, setHoldBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  async function loadProducts() {
    try {
      const { data } = await api.get<Product[]>("/products");
      setProducts(data);
      setLoadError(null);
      return data;
    } catch (error) {
      setLoadError(errorMessage(error));
      return null;
    }
  }

  const loadHeld = useCallback(async () => {
    try {
      const { data } = await api.get<HeldCart[]>("/held-carts");
      setHeld(data);
    } catch {
      /* the held list is optional; billing still works */
    }
  }, []);

  useEffect(() => {
    void loadProducts();
    void loadHeld();
    // Press "/" anywhere to jump to product search.
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadHeld]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)).slice(0, 8);
  }, [products, query]);

  const totals = useMemo(
    () =>
      previewTotals(
        cart.map((l) => ({ unitPricePaise: l.product.pricePaise, quantity: l.quantity, discountAllowed: l.product.discountAllowed })),
        discountType,
        discountText,
      ),
    [cart, discountType, discountText],
  );
  const pay = paymentPayload(payment, totals.totalPaise);
  const splitError = status === "PAID" && payment.method === "SPLIT" ? (totals.totalPaise === 0 ? "This bill is ₹0, so there's nothing to split" : pay.error) : null;

  const stockProblems = cart.filter((l) => l.quantity > l.product.stock);
  const itemCount = cart.reduce((n, l) => n + l.quantity, 0);
  const hasDiscount = discountText.trim() !== "" && totals.discountValue > 0;
  const someExcluded = cart.some((l) => !l.product.discountAllowed);

  function addProduct(product: Product) {
    setCart((lines) => {
      const existing = lines.find((l) => l.product.id === product.id);
      if (existing) return lines.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...lines, { product, quantity: 1 }];
    });
    setQuery("");
    setHighlight(0);
    searchRef.current?.focus();
  }

  function setQuantity(productId: number, quantity: number) {
    setCart((lines) => lines.map((l) => (l.product.id === productId ? { ...l, quantity: Math.max(1, Math.floor(quantity) || 1) } : l)));
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[highlight];
      if (pick && pick.stock > 0) addProduct(pick);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  }

  function clearBill() {
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setDiscountType("NONE");
    setDiscountText("");
    setPayment(emptyPayment());
    setStatus("PAID");
    setSaveError(null);
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  /** The current screen as a held-cart request body. */
  function currentCartBody() {
    const useDiscount = discountText.trim() !== "" && !totals.error && totals.discountValue > 0;
    return {
      customerName: customerName.trim() || null,
      customerPhone: customerPhone.trim() || null,
      discountType: useDiscount ? discountType : "NONE",
      discountValue: useDiscount ? totals.discountValue : 0,
      items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
    };
  }

  async function holdBill() {
    if (cart.length === 0) return;
    setHoldBusy(true);
    setNotice(null);
    try {
      await api.post("/held-carts", currentCartBody());
      const who = customerName.trim() || "Walk-in customer";
      clearBill();
      setNotice({ kind: "success", text: `Bill for ${who} is on hold. Recall it from "Held bills".` });
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setHoldBusy(false);
      void loadHeld();
    }
  }

  /** Bring a held bill back. If something is already on screen, it is held in its place. */
  async function recall(cartToRecall: HeldCart) {
    setHoldBusy(true);
    setNotice(null);
    const swapping = cart.length > 0;
    const current = swapping ? currentCartBody() : null;
    try {
      const { data } = await api.post<HeldCart>(`/held-carts/${cartToRecall.id}/recall`);
      if (current) {
        try {
          await api.post("/held-carts", current);
        } catch (error) {
          // Couldn't park the current bill: put the recalled one back and leave the screen as it was.
          await api.post("/held-carts", { ...data, items: data.items.map((i) => ({ productId: i.productId, quantity: i.quantity })) }).catch(() => undefined);
          throw error;
        }
      }
      const fresh = (await loadProducts()) ?? products;
      const byId = new Map(fresh.map((p) => [p.id, p]));
      const lines: CartLine[] = [];
      let missing = 0;
      for (const item of data.items) {
        const product = byId.get(item.productId);
        if (product) lines.push({ product, quantity: item.quantity });
        else missing++;
      }
      setCart(lines);
      setCustomerName(data.customerName ?? "");
      setCustomerPhone(data.customerPhone ? formatPhone(data.customerPhone) : "");
      setDiscountType(data.discountType === "NONE" ? "NONE" : data.discountType);
      setDiscountText(data.discountType === "NONE" ? "" : paiseToText(data.discountValue));
      setPayment(emptyPayment());
      setStatus("PAID");
      setSaveError(null);
      setHeldOpen(false);
      const parts = [`Recalled bill for ${data.customerName || "walk-in customer"}.`];
      if (swapping) parts.push("The bill you were on is now held.");
      if (missing) parts.push(`${missing} item${missing === 1 ? " is" : "s are"} no longer available and ${missing === 1 ? "was" : "were"} left out.`);
      setNotice({ kind: missing ? "info" : "success", text: parts.join(" ") });
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setHoldBusy(false);
      void loadHeld();
    }
  }

  async function discardHeld(id: number) {
    try {
      await api.delete(`/held-carts/${id}`);
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      void loadHeld();
    }
  }

  async function saveBill(e: FormEvent) {
    e.preventDefault();
    if (cart.length === 0 || totals.error || stockProblems.length > 0 || splitError) return;
    setSaving(true);
    setSaveError(null);
    try {
      const isPaid = status === "PAID";
      const { data } = await api.post<Invoice>("/invoices", {
        customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        discountType: discountText.trim() === "" ? "NONE" : discountType,
        discountValue: discountText.trim() === "" ? 0 : totals.discountValue,
        paymentMethod: isPaid ? pay.paymentMethod : payment.method === "SPLIT" ? "CASH" : payment.method,
        paymentStatus: status,
        payments: isPaid ? pay.payments : null,
      });
      setSaved(data);
      setNotice(null);
      void loadProducts(); // refresh stock numbers
    } catch (error) {
      setSaveError(errorMessage(error));
      void loadProducts();
    } finally {
      setSaving(false);
    }
  }

  function startNewBill() {
    setSaved(null);
    clearBill();
  }

  const canSave = cart.length > 0 && !totals.error && stockProblems.length === 0 && !splitError && !saving;

  return (
    <form onSubmit={saveBill} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* Left: customer + items */}
      <section className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">New bill</h1>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={holdBill} disabled={cart.length === 0 || holdBusy || held.length >= MAX_HELD}>
              <PauseCircle className="size-4" aria-hidden /> Hold bill
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setHeldOpen(true)}>
              <Clock3 className="size-4" aria-hidden /> Held bills
              <span className={`num rounded-full px-1.5 text-xs ${held.length ? "bg-khata text-white" : "bg-rule-soft text-ink-soft"}`}>
                {held.length}/{MAX_HELD}
              </span>
            </button>
          </div>
        </div>

        {loadError && <Notice kind="error">{loadError}</Notice>}
        {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

        <CustomerFields
          name={customerName}
          phone={customerPhone}
          onNameChange={setCustomerName}
          onPhoneChange={setCustomerPhone}
          onPicked={() => searchRef.current?.focus()}
        />

        <div className="relative">
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="productSearch">
              Add item
            </label>
            <span className="hidden text-xs text-ink-faint sm:block">
              Press <kbd className="rounded border border-rule bg-sheet px-1">/</kbd> to search
            </span>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              id="productSearch"
              ref={searchRef}
              className="field pl-9"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={onSearchKey}
              placeholder="Type item name or SKU, then press Enter"
              autoComplete="off"
              autoFocus
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="productResults"
            />
          </div>
          {query.trim() !== "" && (
            <ul id="productResults" role="listbox" className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-rule bg-sheet shadow-lg">
              {results.length === 0 && <li className="px-3 py-3 text-sm text-ink-soft">No active item matches "{query}".</li>}
              {results.map((p, i) => {
                const out = p.stock <= 0;
                return (
                  <li key={p.id} role="option" aria-selected={i === highlight} aria-disabled={out}>
                    <button
                      type="button"
                      disabled={out}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => addProduct(p)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                        i === highlight ? "bg-rule-soft" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="text-xs text-ink-soft">
                          {p.sku ? `${p.sku}, ` : ""}
                          {out ? "out of stock" : `${p.stock} in stock`}
                          {!p.discountAllowed && ", no discount"}
                        </span>
                      </span>
                      <span className="num font-medium">{formatMoney(p.pricePaise)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="panel overflow-x-auto">
          {cart.length === 0 ? (
            <p className="px-4 py-12 text-center text-ink-soft">Items you add appear here.</p>
          ) : (
            <table className="w-full min-w-[540px] text-sm">
              <thead>
                <tr className="table-head">
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-2 py-2.5 text-right font-medium">Rate</th>
                  <th className="px-2 py-2.5 text-center font-medium">Qty</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {cart.map((line) => {
                  const over = line.quantity > line.product.stock;
                  return (
                    <tr key={line.product.id} className="border-b border-rule-soft last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">
                          {line.product.name}
                          {!line.product.discountAllowed && (
                            <span className="ml-2 rounded bg-rule-soft px-1.5 py-0.5 align-middle text-[11px] font-medium text-ink-soft">No discount</span>
                          )}
                        </div>
                        <div className={`text-xs ${over ? "font-medium text-khata" : "text-ink-soft"}`}>
                          {over ? `Only ${line.product.stock} in stock` : `${line.product.stock} in stock`}
                        </div>
                      </td>
                      <td className="num px-2 py-2.5 text-right">{formatMoney(line.product.pricePaise)}</td>
                      <td className="px-2 py-2.5">
                        <div className="mx-auto flex w-fit items-center rounded-md border border-rule">
                          <button type="button" className="px-2 py-1.5 text-ink-soft hover:text-ink" onClick={() => setQuantity(line.product.id, line.quantity - 1)} aria-label={`Decrease ${line.product.name}`}>
                            <Minus className="size-3.5" />
                          </button>
                          <input
                            className="num w-12 border-x border-rule py-1 text-center focus:outline-none"
                            value={line.quantity}
                            inputMode="numeric"
                            onChange={(e) => setQuantity(line.product.id, Number(e.target.value.replace(/\D/g, "")))}
                            aria-label={`Quantity of ${line.product.name}`}
                          />
                          <button type="button" className="px-2 py-1.5 text-ink-soft hover:text-ink" onClick={() => setQuantity(line.product.id, line.quantity + 1)} aria-label={`Increase ${line.product.name}`}>
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="num px-4 py-2.5 text-right font-medium">{formatMoney(line.product.pricePaise * line.quantity)}</td>
                      <td className="pr-2">
                        <button
                          type="button"
                          className="btn btn-ghost px-2"
                          onClick={() => setCart((lines) => lines.filter((l) => l.product.id !== line.product.id))}
                          aria-label={`Remove ${line.product.name}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Right: the bill slip */}
      <aside className="lg:pt-[3.1rem]">
        <div className="bill-slip mt-2 p-5 lg:sticky lg:top-8">
          <dl className="num space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">
                Subtotal ({itemCount} {itemCount === 1 ? "item" : "items"})
              </dt>
              <dd>{formatMoney(totals.subtotalPaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Discount</dt>
              <dd>{totals.discountPaise > 0 ? `− ${formatMoney(totals.discountPaise)}` : formatMoney(0)}</dd>
            </div>
          </dl>

          <div className="mt-3 flex gap-2">
            <div className="flex shrink-0 rounded-md border border-rule p-0.5 text-sm whitespace-nowrap" role="radiogroup" aria-label="Discount type">
              {(
                [
                  ["FIXED", "₹ off"],
                  ["PERCENT", "% off"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={discountType === value}
                  onClick={() => setDiscountType(value)}
                  className={`rounded px-2.5 py-1 font-medium ${discountType === value ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="field num py-1.5"
              value={discountText}
              onChange={(e) => {
                setDiscountText(e.target.value);
                if (discountType === "NONE") setDiscountType("FIXED");
              }}
              placeholder={discountType === "PERCENT" ? "e.g. 10" : "e.g. 50"}
              inputMode="decimal"
              aria-label={discountType === "PERCENT" ? "Discount percentage" : "Discount amount in rupees"}
            />
          </div>
          {totals.error ? (
            <p className="mt-1.5 text-sm text-khata">{totals.error}</p>
          ) : (
            hasDiscount &&
            someExcluded && (
              <p className="num mt-1.5 text-xs text-ink-soft">
                Applies to {formatMoney(totals.discountablePaise)} of items. Items marked "No discount" are excluded.
              </p>
            )
          )}

          <div className="mt-5 border-t border-dashed border-rule pt-4">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">Payable</span>
              <span className="num text-[2.1rem] leading-none font-bold tracking-tight">{formatMoney(totals.totalPaise)}</span>
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className="label">Payment status</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {(["PAID", "UNPAID"] as const).map((s) => (
                <label
                  key={s}
                  className={`cursor-pointer rounded-md border py-1.5 text-center text-sm font-medium ${
                    status === s ? (s === "PAID" ? "border-paid bg-paid-tint text-paid" : "border-due bg-due-tint text-due") : "border-rule text-ink-soft hover:border-ink"
                  }`}
                >
                  <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} className="sr-only" />
                  {s === "PAID" ? "Paid" : "Unpaid"}
                </label>
              ))}
            </div>
          </fieldset>

          {status === "PAID" && (
            <div className="mt-4">
              <PaymentInput value={payment} onChange={setPayment} totalPaise={totals.totalPaise} />
            </div>
          )}

          {saveError && (
            <div className="mt-4">
              <Notice kind="error">{saveError}</Notice>
            </div>
          )}

          <button type="submit" className="btn btn-primary mt-5 w-full py-3 text-base" disabled={!canSave}>
            {saving ? "Saving…" : "Save bill"}
          </button>
          {cart.length > 0 && stockProblems.length > 0 && <p className="mt-2 text-center text-sm text-khata">Reduce quantities that exceed stock.</p>}
        </div>
      </aside>

      <Modal open={heldOpen} title={`Held bills (${held.length}/${MAX_HELD})`} onClose={() => setHeldOpen(false)} wide>
        {held.length === 0 ? (
          <p className="py-6 text-center text-ink-soft">No bills on hold. Use "Hold bill" to park the current bill and serve the next customer.</p>
        ) : (
          <ul className="divide-y divide-rule-soft">
            {held.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {h.customerName || "Walk-in customer"}
                    {h.customerPhone && <span className="num ml-2 text-sm font-normal text-ink-soft">{formatPhone(h.customerPhone)}</span>}
                  </p>
                  <p className="num text-sm text-ink-soft">
                    {h.itemCount} {h.itemCount === 1 ? "item" : "items"}, about {formatMoney(h.estimatePaise)}
                    {h.discountType !== "NONE" && ` before ${h.discountType === "PERCENT" ? `${paiseToText(h.discountValue)}%` : formatMoney(h.discountValue)} off`}
                  </p>
                  <p className="truncate text-xs text-ink-faint">
                    {h.items.map((i) => `${i.product?.name ?? "Removed item"} × ${i.quantity}`).join(", ")}
                  </p>
                  <p className="num text-xs text-ink-faint">
                    Held {formatDateTime(h.createdAt)}
                    {h.createdByName ? ` by ${h.createdByName}` : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button type="button" className="btn btn-ghost px-2.5" onClick={() => void discardHeld(h.id)} disabled={holdBusy}>
                    Delete
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void recall(h)} disabled={holdBusy}>
                    Recall
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {cart.length > 0 && held.length > 0 && (
          <p className="mt-3 text-xs text-ink-soft">The bill on screen will be held automatically when you recall another one.</p>
        )}
      </Modal>

      <Modal open={saved !== null} title="Bill saved" onClose={startNewBill}>
        {saved && (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 text-paid" aria-hidden />
              <div>
                <p className="font-medium">
                  {saved.invoiceNumber} for <span className="num">{formatMoney(saved.totalPaise)}</span>
                </p>
                <p className="num text-sm text-ink-soft">
                  {saved.customerName}, {saved.paymentStatus === "PAID" ? `paid by ${paidByText(saved)}` : "marked unpaid"}. Stock has been updated.
                </p>
              </div>
            </div>

            {saved.paymentStatus === "PAID" ? (
              <WhatsAppShare invoice={saved} />
            ) : (
              <a className="btn btn-secondary" href={pdfUrl(saved.id)} download>
                Download PDF
              </a>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-rule pt-4">
              <Link className="btn btn-ghost" to={`/invoices/${saved.id}`}>
                View invoice
              </Link>
              <button type="button" className="btn btn-primary" onClick={startNewBill} autoFocus>
                Start new bill
              </button>
            </div>
          </div>
        )}
      </Modal>
    </form>
  );
}
