import { ReceiptIndianRupee } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PeriodPicker, { periodLabel, periodParams, type Period, type PeriodValue } from "../components/PeriodPicker";
import { EmptyState, Notice, Spinner, StatusBadge } from "../components/ui";
import { api, errorMessage, type Dashboard as DashboardData } from "../lib/api";
import { formatDateTime, METHOD_LABELS } from "../lib/format";
import { formatMoney } from "../lib/money";

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="num mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {note && <p className="num mt-0.5 text-sm text-ink-soft">{note}</p>}
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const PERIODS: Period[] = ["today", "yesterday", "week", "month", "fy", "lastfy", "day", "custom"];

export default function Dashboard() {
  // The chosen period is kept in the address (?period=week), so refreshing keeps it.
  const [params, setParams] = useSearchParams();
  const value: PeriodValue = {
    period: (params.get("period") as Period) || "today",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function setValue(v: PeriodValue) {
    const next = new URLSearchParams();
    if (v.period !== "today") next.set("period", v.period);
    if (v.from) next.set("from", v.from);
    if (v.to) next.set("to", v.to);
    setParams(next, { replace: true });
  }

  const query = periodParams(value);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    if (!query) return;
    setLoading(true);
    api
      .get<DashboardData>("/dashboard", { params: query })
      .then((r) => {
        setData(r.data);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  const label = periodLabel(value);
  const received = data?.receivedByMethod.filter((r) => r.amountPaise > 0) ?? [];
  const receivedTotal = received.reduce((s, r) => s + r.amountPaise, 0);

  // Link to the same period on the Invoices page.
  const invoiceLink = (() => {
    const p = new URLSearchParams();
    if (value.period === "day" && value.from) {
      p.set("range", "day");
      p.set("from", value.from);
    } else if (value.period === "custom") {
      p.set("range", "custom");
      if (value.from) p.set("from", value.from);
      if (value.to) p.set("to", value.to);
    } else p.set("range", value.period);
    return `/invoices?${p.toString()}`;
  })();

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-ink-soft">{label}</p>
        </div>
        <Link to="/billing" className="btn btn-primary">
          <ReceiptIndianRupee className="size-4" aria-hidden /> New bill
        </Link>
      </div>

      <div className="mb-5">
        <PeriodPicker value={value} onChange={setValue} options={PERIODS} />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {!query && <Notice kind="info">Choose the dates to see figures for this period.</Notice>}
      {query && !data && !error && <Spinner />}

      {data && query && (
        <div className={`space-y-6 ${loading ? "opacity-60" : ""}`}>
          <section aria-label="Sales summary" className="panel grid divide-y divide-rule sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
            <Figure
              label="Sales"
              value={formatMoney(data.sales.salesPaise)}
              note={`${plural(data.sales.invoiceCount, "bill")}${data.sales.invoiceCount ? `, avg ${formatMoney(data.sales.averageBillPaise)}` : ""}`}
            />
            <Figure label="Paid" value={formatMoney(data.sales.paidPaise)} />
            <Figure
              label="Unpaid"
              value={formatMoney(data.sales.unpaidPaise)}
              note={data.outstandingUnpaid.count > 0 ? `${formatMoney(data.outstandingUnpaid.totalPaise)} due overall` : "Nothing due overall"}
            />
            <Figure label="Discounts given" value={formatMoney(data.sales.discountPaise)} />
          </section>

          <section className="panel px-5 py-4" aria-label="Money received by payment method">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">Money received</h2>
              <p className="num text-sm text-ink-soft">{formatMoney(receivedTotal)} in total</p>
            </div>
            <p className="mt-0.5 text-xs text-ink-soft">Payments collected in this period. Split payments count under each method used.</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data.receivedByMethod.map((r) => (
                <div key={r.method} className="rounded-md border border-rule-soft px-3 py-2">
                  <dt className="text-sm text-ink-soft">{METHOD_LABELS[r.method]}</dt>
                  <dd className="num text-lg font-semibold">{formatMoney(r.amountPaise)}</dd>
                  <dd className="num text-xs text-ink-faint">{plural(r.count, "payment")}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="panel">
              <div className="flex items-center justify-between border-b border-rule px-5 py-3">
                <h2 className="font-semibold">Bills in this period</h2>
                <Link to={invoiceLink} className="text-sm text-ink-soft hover:text-ink">
                  See all
                </Link>
              </div>
              {data.recentInvoices.length === 0 ? (
                <EmptyState title="No bills in this period">
                  <Link className="text-khata underline" to="/billing">
                    Create a bill
                  </Link>
                </EmptyState>
              ) : (
                <ul>
                  {data.recentInvoices.map((inv) => (
                    <li key={inv.id} className="border-b border-rule-soft last:border-0">
                      <Link to={`/invoices/${inv.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-paper">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{inv.customerName}</span>
                          <span className="num text-xs text-ink-soft">
                            {inv.invoiceNumber}, {formatDateTime(inv.invoiceDate)}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="num block font-medium">{formatMoney(inv.totalPaise)}</span>
                          <StatusBadge status={inv.paymentStatus} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <div className="flex items-center justify-between border-b border-rule px-5 py-3">
                <h2 className="font-semibold">Low stock</h2>
                <Link to="/stock" className="text-sm text-ink-soft hover:text-ink">
                  Adjust stock
                </Link>
              </div>
              {data.lowStockProducts.length === 0 ? (
                <EmptyState title="All items are above their alert level" />
              ) : (
                <ul>
                  {data.lowStockProducts.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 border-b border-rule-soft px-5 py-3 last:border-0">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="num text-xs text-ink-soft">Alert at {p.lowStockThreshold}</span>
                      </span>
                      <Link to={`/stock?product=${p.id}`} className={`num font-semibold ${p.stock === 0 ? "text-khata" : "text-due"}`}>
                        {p.stock === 0 ? "Out of stock" : `${p.stock} left`}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
