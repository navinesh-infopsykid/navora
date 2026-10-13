import { ArrowLeft, Download, FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PaymentInput, { emptyPayment, paymentPayload, type PaymentState } from "../components/PaymentInput";
import WhatsAppShare, { WHATSAPP_STATUS_TEXT } from "../components/WhatsAppShare";
import { Notice, Spinner, StatusBadge } from "../components/ui";
import { api, errorMessage, pdfUrl, type Invoice } from "../lib/api";
import { formatDateTime, formatPhone, METHOD_LABELS } from "../lib/format";
import { formatMoney } from "../lib/money";

export default function InvoiceDetail() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentState>(emptyPayment());
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Invoice>(`/invoices/${id}`);
      setInvoice(data);
      setPayment(emptyPayment(data.paymentMethod === "SPLIT" ? "CASH" : data.paymentMethod));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markPaid() {
    if (!invoice) return;
    const pay = paymentPayload(payment, invoice.totalPaise);
    if (pay.error) {
      setPayError(pay.error);
      return;
    }
    setPaying(true);
    setPayError(null);
    try {
      const { data } = await api.post<Invoice>(`/invoices/${id}/mark-paid`, pay.payments ? { payments: pay.payments } : { paymentMethod: pay.paymentMethod });
      setInvoice(data);
    } catch (e) {
      setPayError(errorMessage(e));
      void load();
    } finally {
      setPaying(false);
    }
  }

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!invoice) return <Spinner />;

  const discountText =
    invoice.discountType === "PERCENT" ? `Discount (${invoice.discountValue / 100}%)` : invoice.discountType === "FIXED" ? "Discount" : "Discount";

  return (
    <>
      <Link to="/invoices" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> All invoices
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {invoice.invoiceNumber} <StatusBadge status={invoice.paymentStatus} />
          </h1>
          <p className="num mt-1 text-ink-soft">{formatDateTime(invoice.invoiceDate)}</p>
        </div>
        <div className="flex gap-2">
          <a className="btn btn-secondary" href={`${pdfUrl(invoice.id)}?inline=1`} target="_blank" rel="noreferrer">
            <FileText className="size-4" aria-hidden /> View PDF
          </a>
          <a className="btn btn-secondary" href={pdfUrl(invoice.id)} download>
            <Download className="size-4" aria-hidden /> Download PDF
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel overflow-x-auto">
          <div className="border-b border-rule px-5 py-4">
            <p className="text-sm text-ink-soft">Bill to</p>
            <p className="font-medium">{invoice.customerName}</p>
            {invoice.customerPhone && <p className="num text-sm text-ink-soft">{formatPhone(invoice.customerPhone)}</p>}
          </div>
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="table-head">
                <th className="px-5 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 text-right font-medium">Rate</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="px-5 py-2.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="num">
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-b border-rule-soft">
                  <td className="px-5 py-2.5">
                    {item.productName}
                    {item.sku && <span className="text-ink-soft"> ({item.sku})</span>}
                    {invoice.discountPaise > 0 && !item.discountAllowed && (
                      <span className="ml-2 rounded bg-rule-soft px-1.5 py-0.5 align-middle text-[11px] font-medium text-ink-soft">No discount</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">{formatMoney(item.unitPricePaise)}</td>
                  <td className="px-3 py-2.5 text-right">{item.quantity}</td>
                  <td className="px-5 py-2.5 text-right">{formatMoney(item.lineTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="num ml-auto max-w-xs space-y-1.5 px-5 py-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Subtotal</dt>
              <dd>{formatMoney(invoice.subtotalPaise)}</dd>
            </div>
            {invoice.discountPaise > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-soft">{discountText}</dt>
                <dd>− {formatMoney(invoice.discountPaise)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-rule pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>{formatMoney(invoice.totalPaise)}</dd>
            </div>
          </dl>
          <p className="px-5 pb-4 text-xs text-ink-faint">Item names and prices are saved as they were when this bill was made.</p>
        </section>

        <aside className="space-y-6">
          <section className="panel p-5">
            <h2 className="mb-3 font-semibold">Payment</h2>
            {invoice.paymentStatus === "PAID" ? (
              <div className="space-y-1 text-sm">
                {(invoice.payments ?? []).map((p) => (
                  <p key={p.id} className="num">
                    {formatMoney(p.amountPaise)} by {METHOD_LABELS[p.method]}, {formatDateTime(p.paidAt)}
                  </p>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink-soft">
                  <span className="num font-medium text-due">{formatMoney(invoice.totalPaise)}</span> is still due. Stock was already deducted when the bill was saved; marking it paid does not change stock.
                </p>
                <PaymentInput value={payment} onChange={setPayment} totalPaise={invoice.totalPaise} />
                {payError && <Notice kind="error">{payError}</Notice>}
                <button type="button" className="btn btn-primary w-full" onClick={markPaid} disabled={paying}>
                  {paying ? "Saving…" : "Mark as paid"}
                </button>
              </div>
            )}
          </section>

          <section className="panel p-5">
            <h2 className="mb-3 font-semibold">WhatsApp</h2>
            {invoice.paymentStatus === "PAID" ? (
              <WhatsAppShare invoice={invoice} onSent={load} />
            ) : (
              <p className="text-sm text-ink-soft">Sharing becomes available once the invoice is paid.</p>
            )}
            {(invoice.whatsAppMessages ?? []).length > 0 && (
              <div className="mt-4 border-t border-rule pt-3">
                <h3 className="mb-1.5 text-sm font-medium">History</h3>
                <ul className="space-y-1.5 text-xs text-ink-soft">
                  {invoice.whatsAppMessages!.map((m) => (
                    <li key={m.id}>
                      <span className={m.status === "FAILED" ? "text-khata" : m.status === "DELIVERED" || m.status === "READ" ? "text-paid" : "text-ink"}>
                        {m.mode === "MANUAL_LINK" ? "Manual: " : "Automatic: "}
                        {WHATSAPP_STATUS_TEXT[m.status]}
                      </span>
                      {m.error && <span> ({m.error})</span>}
                      <span className="num block">{formatDateTime(m.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {invoice.notes && (
            <section className="panel p-5 text-sm">
              <h2 className="mb-1 font-semibold">Notes</h2>
              <p className="text-ink-soft">{invoice.notes}</p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
