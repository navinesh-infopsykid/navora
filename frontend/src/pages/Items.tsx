import { Pencil, Plus, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { EmptyState, Modal, Notice, PageHeader, Spinner } from "../components/ui";
import { api, errorMessage, type Product } from "../lib/api";
import { formatMoney, paiseToInput, parseRupees } from "../lib/money";

interface FormState {
  name: string;
  sku: string;
  price: string;
  stock: string;
  lowStockThreshold: string;
  description: string;
  discountAllowed: boolean;
}

const emptyForm: FormState = { name: "", sku: "", price: "", stock: "0", lowStockThreshold: "5", description: "", discountAllowed: true };

export default function Items() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const { data } = await api.get<Product[]>("/products", { params: { search: search || undefined, includeInactive: showInactive } });
      setProducts(data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, showInactive]);

  function openNew() {
    setForm(emptyForm);
    setFormError(null);
    setEditing("new");
  }

  function openEdit(p: Product) {
    setForm({
      name: p.name,
      sku: p.sku ?? "",
      price: paiseToInput(p.pricePaise),
      stock: String(p.stock),
      lowStockThreshold: String(p.lowStockThreshold),
      description: p.description ?? "",
      discountAllowed: p.discountAllowed,
    });
    setFormError(null);
    setEditing(p);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const pricePaise = parseRupees(form.price);
    const stock = Number(form.stock);
    const low = Number(form.lowStockThreshold);
    if (!form.name.trim()) return setFormError("Enter the item name.");
    if (pricePaise === null) return setFormError("Enter a price like 49 or 49.50.");
    if (editing === "new" && (!Number.isInteger(stock) || stock < 0)) return setFormError("Opening stock must be a whole number, 0 or more.");
    if (!Number.isInteger(low) || low < 0) return setFormError("Low-stock alert must be a whole number, 0 or more.");

    const body = { name: form.name, sku: form.sku || null, pricePaise, lowStockThreshold: low, description: form.description || null, discountAllowed: form.discountAllowed };
    setSaving(true);
    try {
      if (editing === "new") await api.post("/products", { ...body, stock });
      else if (editing) await api.put(`/products/${editing.id}`, body);
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Product) {
    try {
      await api.patch(`/products/${p.id}/status`, { isActive: !p.isActive });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        title="Items"
        description="Products you sell. Deactivated items are hidden from billing but stay on old invoices."
        actions={
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <Plus className="size-4" aria-hidden /> Add item
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input className="field pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or SKU" aria-label="Search items" />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4 accent-khata" />
          Show deactivated items
        </label>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="panel mt-3 overflow-x-auto">
        {!products ? (
          !error && <Spinner />
        ) : products.length === 0 ? (
          <EmptyState title={search ? `No items match "${search}"` : "No items yet"}>{!search && "Add your first item to start billing."}</EmptyState>
        ) : (
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 text-right font-medium">Price</th>
                <th className="px-3 py-2.5 text-right font-medium">Stock</th>
                <th className="px-3 py-2.5 text-right font-medium">Alert at</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const low = p.stock <= p.lowStockThreshold;
                return (
                  <tr key={p.id} className={`border-b border-rule-soft last:border-0 ${p.isActive ? "" : "text-ink-faint"}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {p.name} {!p.isActive && <span className="ml-1 text-xs font-normal">(deactivated)</span>}
                        {!p.discountAllowed && (
                          <span className="ml-2 rounded bg-rule-soft px-1.5 py-0.5 align-middle text-[11px] font-medium text-ink-soft">No discount</span>
                        )}
                      </div>
                      <div className="text-xs text-ink-soft">{[p.sku, p.description].filter(Boolean).join(", ")}</div>
                    </td>
                    <td className="num px-3 py-3 text-right">{formatMoney(p.pricePaise)}</td>
                    <td className={`num px-3 py-3 text-right font-medium ${p.isActive && low ? "text-due" : ""}`}>
                      {p.stock}
                      {p.isActive && low && <span className="block text-xs font-normal">{p.stock === 0 ? "out of stock" : "low"}</span>}
                    </td>
                    <td className="num px-3 py-3 text-right text-ink-soft">{p.lowStockThreshold}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Link className="btn btn-ghost px-2.5" to={`/stock?product=${p.id}`}>
                          Adjust stock
                        </Link>
                        <button type="button" className="btn btn-ghost px-2.5" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
                          <Pencil className="size-4" aria-hidden /> Edit
                        </button>
                        <button type="button" className="btn btn-ghost px-2.5" onClick={() => toggleActive(p)}>
                          {p.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={editing !== null} title={editing === "new" ? "Add item" : "Edit item"} onClose={() => setEditing(null)}>
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">
              Name
            </label>
            <input id="name" className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="sku">
                SKU (optional)
              </label>
              <input id="sku" className="field" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="price">
                Selling price (₹)
              </label>
              <input id="price" className="field num" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {editing === "new" ? (
              <div>
                <label className="label" htmlFor="stock">
                  Opening stock
                </label>
                <input id="stock" className="field num" inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
              </div>
            ) : (
              <div>
                <span className="label">Current stock</span>
                <p className="num py-2">
                  {editing?.stock ?? 0}{" "}
                  <Link className="text-sm text-khata underline" to={editing ? `/stock?product=${editing.id}` : "/stock"}>
                    Adjust
                  </Link>
                </p>
              </div>
            )}
            <div>
              <label className="label" htmlFor="low">
                Low-stock alert at
              </label>
              <input id="low" className="field num" inputMode="numeric" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} />
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-md border border-rule p-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-khata"
              checked={form.discountAllowed}
              onChange={(e) => setForm({ ...form, discountAllowed: e.target.checked })}
            />
            <span>
              <span className="block text-sm font-medium">Discount allowed</span>
              <span className="block text-xs text-ink-soft">
                When off, bill discounts (₹ or %) never apply to this item, for example fixed-price items or offers.
              </span>
            </span>
          </label>
          <div>
            <label className="label" htmlFor="description">
              Description (optional)
            </label>
            <textarea id="description" rows={2} className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {editing !== "new" && <p className="text-xs text-ink-soft">Changing the price affects new bills only. Old invoices keep their original price.</p>}
          {formError && <Notice kind="error">{formError}</Notice>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : editing === "new" ? "Add item" : "Save changes"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
