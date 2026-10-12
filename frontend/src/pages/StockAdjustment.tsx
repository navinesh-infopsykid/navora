import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, Modal, Notice, PageHeader, Spinner } from "../components/ui";
import { api, errorMessage, type Product, type StockMovement } from "../lib/api";
import { formatDateTime } from "../lib/format";

const QUICK_REASONS = {
  add: ["New delivery", "Returned by customer", "Count correction"],
  remove: ["Damaged", "Expired", "Count correction", "Own use"],
};

export default function StockAdjustment() {
  const [params] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState<number | "">(params.get("product") ? Number(params.get("product")) : "");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<StockMovement[] | null>(null);
  const [historyFilter, setHistoryFilter] = useState<"" | "ADJUSTMENT" | "SALE">("ADJUSTMENT");

  const product = products.find((p) => p.id === productId);
  const quantity = Number(amount);
  const validQuantity = Number.isInteger(quantity) && quantity > 0;
  const change = direction === "add" ? quantity : -quantity;
  const newStock = product && validQuantity ? product.stock + change : null;
  const goesNegative = newStock !== null && newStock < 0;

  async function loadProducts() {
    const { data } = await api.get<Product[]>("/products", { params: { includeInactive: true } });
    setProducts(data);
  }

  async function loadHistory() {
    try {
      const { data } = await api.get<StockMovement[]>("/stock-adjustments", { params: { productId: productId || undefined, type: historyFilter || undefined } });
      setHistory(data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    loadProducts().catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, historyFilter]);

  const sortedProducts = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);

  function review(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!product) return setError("Choose an item.");
    if (!validQuantity) return setError("Enter a whole number greater than zero.");
    if (!reason.trim()) return setError("Enter a reason for this adjustment.");
    if (goesNegative) return setError(`Only ${product.stock} in stock. You cannot remove ${quantity}.`);
    setConfirming(true);
  }

  async function confirm() {
    if (!product) return;
    setSaving(true);
    try {
      await api.post("/stock-adjustments", { productId: product.id, change, reason: reason.trim() });
      setSuccess(`${product.name}: stock changed from ${product.stock} to ${product.stock + change}.`);
      setAmount("");
      setReason("");
      setConfirming(false);
      await Promise.all([loadProducts(), loadHistory()]);
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
      await loadProducts();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Stock adjustment" description="Add new deliveries or remove damaged and expired stock. Every change is recorded with its reason." />

      <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <form onSubmit={review} className="panel h-fit space-y-4 p-5">
          <div>
            <label className="label" htmlFor="product">
              Item
            </label>
            <select id="product" className="field" value={productId} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Choose an item…</option>
              {sortedProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}, {p.stock} in stock{p.isActive ? "" : " (deactivated)"}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Direction">
            {(["add", "remove"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                onClick={() => setDirection(d)}
                className={`btn border ${direction === d ? "border-ink bg-ink text-white" : "border-rule text-ink-soft hover:border-ink"}`}
              >
                {d === "add" ? <Plus className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
                {d === "add" ? "Add stock" : "Remove stock"}
              </button>
            ))}
          </div>

          <div>
            <label className="label" htmlFor="amount">
              Quantity
            </label>
            <input id="amount" className="field num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" />
          </div>

          {product && (
            <p className={`num text-sm ${goesNegative ? "text-khata" : "text-ink-soft"}`}>
              Stock {product.stock} → {newStock ?? product.stock}
              {goesNegative && " — stock cannot go below zero"}
            </p>
          )}

          <div>
            <label className="label" htmlFor="reason">
              Reason
            </label>
            <input id="reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is stock changing?" maxLength={200} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_REASONS[direction].map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full border border-rule px-2.5 py-0.5 text-xs text-ink-soft hover:border-ink hover:text-ink">
                  {r}
                </button>
              ))}
            </div>
          </div>

          {error && <Notice kind="error">{error}</Notice>}
          {success && <Notice kind="success">{success}</Notice>}

          <button type="submit" className="btn btn-primary w-full">
            Review adjustment
          </button>
        </form>

        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">{product ? `History for ${product.name}` : "Recent history"}</h2>
            <select className="field w-auto py-1.5 text-sm" value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value as typeof historyFilter)} aria-label="History type">
              <option value="ADJUSTMENT">Manual adjustments</option>
              <option value="SALE">Sales</option>
              <option value="">All changes</option>
            </select>
          </div>
          <div className="panel overflow-x-auto">
            {!history ? (
              <Spinner />
            ) : history.length === 0 ? (
              <EmptyState title="No stock changes yet" />
            ) : (
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="table-head">
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-3 py-2.5 font-medium">Item</th>
                    <th className="px-3 py-2.5 text-right font-medium">Before</th>
                    <th className="px-3 py-2.5 text-right font-medium">Change</th>
                    <th className="px-3 py-2.5 text-right font-medium">After</th>
                    <th className="px-4 py-2.5 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {history.map((m) => (
                    <tr key={m.id} className="border-b border-rule-soft last:border-0">
                      <td className="px-4 py-2.5 whitespace-nowrap text-ink-soft">{formatDateTime(m.createdAt)}</td>
                      <td className="px-3 py-2.5">{m.product.name}</td>
                      <td className="px-3 py-2.5 text-right">{m.previousStock}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${m.change > 0 ? "text-paid" : "text-khata"}`}>{m.change > 0 ? `+${m.change}` : `−${-m.change}`}</td>
                      <td className="px-3 py-2.5 text-right">{m.newStock}</td>
                      <td className="px-4 py-2.5">
                        {m.invoice ? (
                          <Link className="underline" to={`/invoices/${m.invoice.id}`}>
                            {m.reason}
                          </Link>
                        ) : (
                          m.reason
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <Modal open={confirming} title="Confirm stock adjustment" onClose={() => setConfirming(false)}>
        {product && (
          <div className="space-y-4">
            <dl className="num grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-ink-soft">Item</dt>
              <dd className="font-medium">{product.name}</dd>
              <dt className="text-ink-soft">Change</dt>
              <dd className={change > 0 ? "text-paid" : "text-khata"}>{change > 0 ? `+${change}` : `−${-change}`}</dd>
              <dt className="text-ink-soft">Stock</dt>
              <dd>
                {product.stock} → {newStock}
              </dd>
              <dt className="text-ink-soft">Reason</dt>
              <dd>{reason}</dd>
            </dl>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Go back
              </button>
              <button type="button" className="btn btn-primary" onClick={confirm} disabled={saving} autoFocus>
                {saving ? "Saving…" : "Confirm adjustment"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
