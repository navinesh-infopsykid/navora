import { Download, MessageCircle, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage, pdfUrl, type Invoice, type WhatsAppCloudStatus, type WhatsAppMessage } from "../lib/api";
import { formatPhone } from "../lib/format";
import { Notice } from "./ui";

type OpenWith = "web" | "app";
const OPEN_WITH_KEY = "whatsappOpenWith";

function readOpenWith(): OpenWith {
  try {
    return localStorage.getItem(OPEN_WITH_KEY) === "app" ? "app" : "web";
  } catch {
    return "web";
  }
}

const STATUS_TEXT: Record<WhatsAppMessage["status"], string> = {
  LINK_GENERATED: "WhatsApp opened — sending not confirmed",
  ACCEPTED: "Accepted by WhatsApp — delivery not yet confirmed",
  SENT: "Sent by WhatsApp",
  DELIVERED: "Delivered to customer",
  READ: "Read by customer",
  FAILED: "Failed",
};

/**
 * WhatsApp sharing for a PAID invoice.
 *  - Manual: download the PDF, open WhatsApp with a prefilled message, attach the PDF yourself.
 *  - Automatic: only shown when the WhatsApp Cloud API is configured on the server.
 * Problems here never affect the saved invoice.
 */
export default function WhatsAppShare({ invoice, onSent }: { invoice: Pick<Invoice, "id" | "customerPhone" | "paymentStatus">; onSent?: () => void }) {
  const [cloud, setCloud] = useState<WhatsAppCloudStatus | null>(null);
  const [busy, setBusy] = useState<"link" | "send" | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [openWith, setOpenWith] = useState<OpenWith>(readOpenWith);

  function chooseOpenWith(value: OpenWith) {
    setOpenWith(value);
    try {
      localStorage.setItem(OPEN_WITH_KEY, value);
    } catch {
      /* storage unavailable: choice lasts for this page only */
    }
  }

  useEffect(() => {
    api
      .get<WhatsAppCloudStatus>("/whatsapp/status")
      .then((r) => setCloud(r.data))
      .catch(() => setCloud(null));
  }, []);

  if (invoice.paymentStatus !== "PAID") return null;
  if (!invoice.customerPhone) {
    return <Notice kind="info">Add the customer's mobile number on the bill to share it on WhatsApp.</Notice>;
  }

  async function openWhatsApp() {
    // WhatsApp Web: a website cannot reuse an existing WhatsApp Web tab (WhatsApp's security headers cut
    // the link between tabs), so each share needs a tab. It is opened now, inside the click, so pop-up
    // blockers allow it. The "WhatsApp app" option avoids browser tabs completely.
    const tab = openWith === "web" ? window.open("", "_blank") : null;
    if (openWith === "web" && !tab) {
      setMessage({ kind: "error", text: "The browser blocked the WhatsApp tab. Allow pop-ups for this site, then try again." });
      return;
    }
    setBusy("link");
    setMessage(null);
    try {
      const { data } = await api.post<{ webUrl: string; appUrl: string }>(`/invoices/${invoice.id}/whatsapp/link`);
      if (openWith === "web" && tab) {
        tab.opener = null;
        tab.location.href = data.webUrl;
      } else {
        window.location.href = data.appUrl; // hands off to the WhatsApp desktop app
      }
      setMessage({
        kind: "info",
        text: `WhatsApp ${openWith === "web" ? "Web" : "app"} opened with the message ready. Attach the downloaded PDF, then press Send in WhatsApp.`,
      });
      onSent?.();
    } catch (error) {
      tab?.close();
      setMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function sendAutomatically() {
    setBusy("send");
    setMessage(null);
    try {
      const { data } = await api.post<WhatsAppMessage>(`/invoices/${invoice.id}/whatsapp/send`);
      setMessage({ kind: "success", text: `${STATUS_TEXT[data.status]}. The status updates when WhatsApp confirms delivery.` });
    } catch (error) {
      setMessage({ kind: "error", text: `${errorMessage(error)} The invoice is saved; you can still share it manually.` });
    } finally {
      setBusy(null);
      onSent?.();
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Share with <span className="num font-medium text-ink">{formatPhone(invoice.customerPhone)}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-soft">Open in</span>
        <div className="flex rounded-md border border-rule p-0.5" role="radiogroup" aria-label="Open WhatsApp in">
          {(
            [
              ["web", "WhatsApp Web"],
              ["app", "WhatsApp app"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={openWith === value}
              onClick={() => chooseOpenWith(value)}
              className={`rounded px-2.5 py-1 font-medium ${openWith === value ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {openWith === "web" ? (
        <p className="text-xs text-ink-soft">
          WhatsApp Web opens a new tab for every customer. To avoid extra tabs, install WhatsApp for Mac and choose <strong>WhatsApp app</strong>.
        </p>
      ) : (
        <p className="text-xs text-ink-soft">Opens the WhatsApp desktop app, with no browser tab. Needs WhatsApp for Mac installed and logged in.</p>
      )}
      <ol className="space-y-2 text-sm">
        <li className="flex flex-wrap items-center gap-2">
          <span className="w-5 text-ink-faint">1.</span>
          <a className="btn btn-secondary" href={pdfUrl(invoice.id)} download>
            <Download className="size-4" aria-hidden /> Download PDF
          </a>
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span className="w-5 text-ink-faint">2.</span>
          <button type="button" className="btn btn-secondary" onClick={openWhatsApp} disabled={busy !== null}>
            <MessageCircle className="size-4" aria-hidden /> {busy === "link" ? "Opening…" : "Open WhatsApp"}
          </button>
          <span className="text-ink-soft">then attach the PDF and press Send.</span>
        </li>
      </ol>

      {cloud?.enabled && (
        <div className="border-t border-rule pt-3">
          <button type="button" className="btn btn-secondary" onClick={sendAutomatically} disabled={busy !== null}>
            <Send className="size-4" aria-hidden /> {busy === "send" ? "Sending…" : "Send PDF automatically"}
          </button>
          <p className="mt-1 text-xs text-ink-soft">Uses the WhatsApp Business account {cloud.displayPhoneNumber ?? ""}.</p>
        </div>
      )}

      {message && <Notice kind={message.kind}>{message.text}</Notice>}
    </div>
  );
}

export { STATUS_TEXT as WHATSAPP_STATUS_TEXT };
