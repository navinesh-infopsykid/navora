/**
 * Axios client + TypeScript types for every API response.
 * All money values from the API are integers in PAISE.
 */
import axios from "axios";

export const API_BASE = import.meta.env.VITE_API_URL || "/api";

export const api = axios.create({ baseURL: API_BASE, timeout: 30_000 });

/** Human-readable message from any API error. */
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    if (error.code === "ECONNABORTED") return "The server took too long to respond. Try again.";
    if (!error.response) return "Cannot reach the billing server. Check that the backend is running (npm run dev).";
    return `Request failed (${error.response.status})`;
  }
  return error instanceof Error ? error.message : "Something went wrong";
}

export type PaymentMethod = "CASH" | "UPI" | "CARD" | "OTHER";
export type PaymentStatus = "PAID" | "UNPAID";
export type DiscountType = "NONE" | "FIXED" | "PERCENT";

export interface Product {
  id: number;
  name: string;
  sku: string | null;
  pricePaise: number;
  stock: number;
  lowStockThreshold: number;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: number;
  productId: number;
  type: "ADJUSTMENT" | "SALE";
  previousStock: number;
  change: number;
  newStock: number;
  reason: string;
  createdAt: string;
  product: { id: number; name: string; sku: string | null };
  invoice?: { id: number; invoiceNumber: string } | null;
}

export interface InvoiceItem {
  id: number;
  productId: number;
  productName: string;
  sku: string | null;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface Payment {
  id: number;
  amountPaise: number;
  method: PaymentMethod;
  paidAt: string;
}

export type WhatsAppStatus = "LINK_GENERATED" | "ACCEPTED" | "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface WhatsAppMessage {
  id: number;
  phone: string;
  mode: "MANUAL_LINK" | "CLOUD_API";
  status: WhatsAppStatus;
  error: string | null;
  createdAt: string;
}

export interface Invoice {
  id: number;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string | null;
  invoiceDate: string;
  subtotalPaise: number;
  discountType: DiscountType;
  discountValue: number;
  discountPaise: number;
  totalPaise: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  paidAt: string | null;
  notes: string | null;
  items: InvoiceItem[];
  payments?: Payment[];
  whatsAppMessages?: WhatsAppMessage[];
}

export interface InvoiceList {
  invoices: (Omit<Invoice, "items"> & { items: Pick<InvoiceItem, "productName" | "quantity" | "unitPricePaise">[] })[];
  total: number;
  page: number;
  pageSize: number;
  summary: { paidPaise: number; unpaidPaise: number; totalPaise: number };
}

export interface Settings {
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  currency: string;
  invoiceFooter: string;
  invoicePrefix: string;
}

interface PeriodStats {
  salesPaise: number;
  paidPaise: number;
  unpaidPaise: number;
  invoiceCount: number;
}

export interface Dashboard {
  today: PeriodStats;
  month: PeriodStats;
  outstandingUnpaid: { totalPaise: number; count: number };
  lowStockProducts: Product[];
  recentInvoices: Pick<Invoice, "id" | "invoiceNumber" | "customerName" | "invoiceDate" | "totalPaise" | "paymentStatus">[];
}

export interface WhatsAppCloudStatus {
  enabled: boolean;
  reason: string;
  displayPhoneNumber?: string;
  usesTemplate: boolean;
}

export const pdfUrl = (invoiceId: number) => `${API_BASE}/invoices/${invoiceId}/pdf`;
