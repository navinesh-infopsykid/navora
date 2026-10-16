import { Download, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import PeriodPicker, { periodParams, type Period, type PeriodValue } from "../components/PeriodPicker";
import { EmptyState, Notice, PageHeader, Spinner, StatusBadge } from "../components/ui";
import { api, errorMessage, pdfUrl, type InvoiceList } from "../lib/api";
import { formatDateTime, formatPhone, METHOD_LABELS, ORDER_TYPE_LABELS } from "../lib/format";
import { formatMoney } from "../lib/money";

export default function Invoices() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const range = (params.get("range") as Period) ?? "all";
  const status = params.get("status") ?? "";
  const orderType = params.get("orderType") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Number(params.get("page") ?? 1);
  const q = params.get("q") ?? "";

  const [search, setSearch] = useState(q);
  const [data, setData] = useState<InvoiceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  }

  // Search as you type (waits 300 ms after the last key).
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) update({ q: search.trim() });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const period: PeriodValue = { period: range || "all", from, to };
  const dates = periodParams(period);

  useEffect(() => {
    if (!dates) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .get<InvoiceList>("/invoices", { params: { ...dates, status: status || undefined, orderType: orderType || undefined, q: q || undefined, page, pageSize: 25 } })
      .then((r) => {
        setData(r.data);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, status, orderType, from, to, q, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Invoices" description="Find a bill by number, customer name or phone. Open one to download it, share it or mark it paid." />

      <div className="mb-4 space-y-3">
        <PeriodPicker
          value={period}
          onChange={(v) => update({ range: v.period === "all" ? "" : v.period, from: v.from, to: v.to })}
          options={["all", "today", "yesterday", "week", "month", "fy", "lastfy", "day", "custom"]}
        />

        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input className="field pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice number, customer or phone" aria-label="Search invoices" />
          </div>
          <select className="field w-auto" value={status} onChange={(e) => update({ status: e.target.value })} aria-label="Payment status">
            <option value="">Paid and unpaid</option>
            <option value="PAID">Paid only</option>
            <option value="UNPAID">Unpaid only</option>
          </select>
          <select className="field w-auto" value={orderType} onChange={(e) => update({ orderType: e.target.value })} aria-label="Order type">
            <option value="">All order types</option>
            <option value="DINE_IN">Dine-in</option>
            <option value="TAKEAWAY">Takeaway</option>
            <option value="DELIVERY">Delivery</option>
          </select>
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {!dates && <Notice kind="info">Choose the dates to see invoices for this period.</Notice>}

      {data && !error && (
        <p className="num mb-3 text-sm text-ink-soft">
          {data.total} {data.total === 1 ? "invoice" : "invoices"}, {formatMoney(data.summary.totalPaise)} in total ({formatMoney(data.summary.paidPaise)} paid,{" "}
          {formatMoney(data.summary.unpaidPaise)} unpaid)
        </p>
      )}

      <div className="panel overflow-x-auto">
        {loading && !data ? (
          <Spinner />
        ) : data && data.invoices.length === 0 ? (
          <EmptyState title="No invoices match these filters">
            Try a different date range or search, or <Link className="text-khata underline" to="/billing">create a new bill</Link>.
          </EmptyState>
        ) : (
          data && (
            <table className={`w-full min-w-[760px] text-sm ${loading ? "opacity-60" : ""}`}>
              <thead>
                <tr className="table-head">
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-3 py-2.5 font-medium">Customer</th>
                  <th className="px-3 py-2.5 font-medium">Items</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-3 py-2.5 font-medium">Payment</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((inv) => (
                  <tr key={inv.id} className="cursor-pointer border-b border-rule-soft last:border-0 hover:bg-paper" onClick={() => navigate(`/invoices/${inv.id}`)}>
                    <td className="px-4 py-3">
                      <Link to={`/invoices/${inv.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {inv.invoiceNumber}
                      </Link>
                      <div className="num text-xs text-ink-soft">
                        {formatDateTime(inv.invoiceDate)}
                        {inv.orderType !== "DINE_IN" && ` · ${ORDER_TYPE_LABELS[inv.orderType]}`}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div>{inv.customerName}</div>
                      <div className="num text-xs text-ink-soft">{formatPhone(inv.customerPhone)}</div>
                    </td>
                    <td className="max-w-64 px-3 py-3 text-ink-soft">
                      <span className="line-clamp-2">{inv.items.map((i) => `${i.productName} × ${i.quantity}`).join(", ")}</span>
                    </td>
                    <td className="num px-3 py-3 text-right font-medium">
                      {formatMoney(inv.totalPaise)}
                      {inv.discountPaise > 0 && <div className="text-xs font-normal text-ink-soft">after {formatMoney(inv.discountPaise)} off</div>}
                      {inv.packagingPaise + inv.bagPaise > 0 && (
                        <div className="text-xs font-normal text-ink-soft">incl. {formatMoney(inv.packagingPaise + inv.bagPaise)} packaging</div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={inv.paymentStatus} />
                      <div className="mt-0.5 text-xs text-ink-soft">{METHOD_LABELS[inv.paymentMethod]}</div>
                    </td>
                    <td className="pr-3">
                      <a className="btn btn-ghost px-2" href={pdfUrl(inv.id)} download onClick={(e) => e.stopPropagation()} aria-label={`Download ${inv.invoiceNumber} PDF`}>
                        <Download className="size-4" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {data && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <button className="btn btn-secondary" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
            Previous
          </button>
          <span className="num text-ink-soft">
            Page {page} of {totalPages}
          </span>
          <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>
            Next
          </button>
        </div>
      )}
    </>
  );
}
