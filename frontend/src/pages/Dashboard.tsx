import { ReceiptIndianRupee } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, Notice, Spinner, StatusBadge } from "../components/ui";
import { api, errorMessage, type Dashboard as DashboardData } from "../lib/api";
import { formatDateTime } from "../lib/format";
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

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DashboardData>("/dashboard")
      .then((r) => setData(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-ink-soft">{today}</p>
        </div>
        <Link to="/billing" className="btn btn-primary">
          <ReceiptIndianRupee className="size-4" aria-hidden /> New bill
        </Link>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {!data && !error && <Spinner />}

      {data && (
        <div className="space-y-6">
          <section aria-label="Sales summary" className="panel grid divide-y divide-rule sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
            <Figure label="Today's sales" value={formatMoney(data.today.salesPaise)} note={plural(data.today.invoiceCount, "invoice")} />
            <Figure label="This month's sales" value={formatMoney(data.month.salesPaise)} note={plural(data.month.invoiceCount, "invoice")} />
            <Figure label="Paid this month" value={formatMoney(data.month.paidPaise)} />
            <Figure
              label="Unpaid this month"
              value={formatMoney(data.month.unpaidPaise)}
              note={data.outstandingUnpaid.count > 0 ? `${formatMoney(data.outstandingUnpaid.totalPaise)} due overall` : "Nothing due"}
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="panel">
              <div className="flex items-center justify-between border-b border-rule px-5 py-3">
                <h2 className="font-semibold">Recent invoices</h2>
                <Link to="/invoices" className="text-sm text-ink-soft hover:text-ink">
                  See all
                </Link>
              </div>
              {data.recentInvoices.length === 0 ? (
                <EmptyState title="No bills yet">
                  <Link className="text-khata underline" to="/billing">
                    Create your first bill
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
