import PDFDocument from "pdfkit";
import { config } from "../config";
import { formatDateTime } from "../lib/dates";
import { formatMoney } from "../lib/money";
import { displayPhone } from "../lib/phone";
import { getInvoice } from "./invoiceService";
import { getSettings } from "./settingsService";

const METHOD_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", OTHER: "Other" };

function discountLabel(type: string, value: number) {
  if (type === "PERCENT") return `Discount (${(value / 100).toString()}%)`;
  return "Discount";
}

/** Builds an A4 invoice PDF and returns it as a Buffer. */
export async function buildInvoicePdf(invoiceId: number): Promise<{ buffer: Buffer; filename: string }> {
  const [invoice, settings] = await Promise.all([getInvoice(invoiceId), getSettings()]);
  const money = (paise: number) => formatMoney(paise, settings.currency);

  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Invoice ${invoice.invoiceNumber}`, Author: settings.businessName } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = 50;
  const right = doc.page.width - 50;
  const width = right - left;

  // Header: business details
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#111827").text(settings.businessName, left, 50);
  doc.font("Helvetica").fontSize(10).fillColor("#4b5563");
  if (settings.businessAddress) doc.text(settings.businessAddress, { width: width / 2 });
  if (settings.businessPhone) doc.text(`Phone: ${settings.businessPhone}`);

  doc.font("Helvetica-Bold").fontSize(16).fillColor("#111827").text("INVOICE", left, 50, { width, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor("#4b5563");
  doc.text(invoice.invoiceNumber, { width, align: "right" });
  doc.text(formatDateTime(invoice.invoiceDate, config.timezone), { width, align: "right" });
  doc
    .font("Helvetica-Bold")
    .fillColor(invoice.paymentStatus === "PAID" ? "#047857" : "#b45309")
    .text(invoice.paymentStatus === "PAID" ? "PAID" : "UNPAID", { width, align: "right" });

  // Bill to
  let y = Math.max(doc.y, 130) + 20;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#6b7280").text("BILL TO", left, y);
  doc.font("Helvetica").fontSize(11).fillColor("#111827").text(invoice.customerName, left, y + 14);
  if (invoice.customerPhone) doc.fontSize(10).fillColor("#4b5563").text(displayPhone(invoice.customerPhone));

  // Items table
  y = doc.y + 20;
  const cols = { no: left, item: left + 30, qty: left + 280, rate: left + 330, amount: left + 410 };
  const drawRow = (cells: { no: string; item: string; qty: string; rate: string; amount: string }, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor("#111827");
    const itemHeight = doc.heightOfString(cells.item, { width: 240 });
    doc.text(cells.no, cols.no, y, { width: 25 });
    doc.text(cells.item, cols.item, y, { width: 240 });
    doc.text(cells.qty, cols.qty, y, { width: 45, align: "right" });
    doc.text(cells.rate, cols.rate, y, { width: 75, align: "right" });
    doc.text(cells.amount, cols.amount, y, { width: right - cols.amount, align: "right" });
    y += Math.max(itemHeight, 12) + 8;
  };

  doc.rect(left, y - 6, width, 22).fill("#f3f4f6");
  drawRow({ no: "#", item: "Item", qty: "Qty", rate: "Rate", amount: "Amount" }, true);

  invoice.items.forEach((item, index) => {
    if (y > doc.page.height - 200) {
      doc.addPage();
      y = 50;
    }
    drawRow({
      no: String(index + 1),
      item: item.sku ? `${item.productName} (${item.sku})` : item.productName,
      qty: String(item.quantity),
      rate: money(item.unitPricePaise),
      amount: money(item.lineTotalPaise),
    });
  });

  doc.moveTo(left, y).lineTo(right, y).strokeColor("#e5e7eb").stroke();
  y += 10;

  // Totals
  const totalRow = (label: string, value: string, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 10).fillColor("#111827");
    doc.text(label, cols.rate - 120, y, { width: 190, align: "right" });
    doc.text(value, cols.amount, y, { width: right - cols.amount, align: "right" });
    y += bold ? 20 : 16;
  };
  totalRow("Subtotal", money(invoice.subtotalPaise));
  if (invoice.discountPaise > 0) totalRow(discountLabel(invoice.discountType, invoice.discountValue), `- ${money(invoice.discountPaise)}`);
  totalRow("Total", money(invoice.totalPaise), true);

  y += 10;
  doc.font("Helvetica").fontSize(10).fillColor("#4b5563");
  doc.text(`Payment: ${METHOD_LABEL[invoice.paymentMethod]} · ${invoice.paymentStatus === "PAID" ? "Paid" : "Unpaid"}`, left, y);
  if (invoice.paidAt && invoice.paymentStatus === "PAID") doc.text(`Paid on: ${formatDateTime(invoice.paidAt, config.timezone)}`);
  if (invoice.notes) doc.moveDown(0.5).text(`Notes: ${invoice.notes}`, { width });

  if (settings.invoiceFooter) {
    doc.moveDown(2).font("Helvetica-Oblique").fontSize(10).fillColor("#6b7280").text(settings.invoiceFooter, left, doc.y, { width, align: "center" });
  }

  doc.end();
  const buffer = await done;
  return { buffer, filename: `${invoice.invoiceNumber}.pdf` };
}
