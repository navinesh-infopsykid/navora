/**
 * Axios client + TypeScript types for every API response.
 * All money values from the API are integers in PAISE.
 */
import axios from "axios";

export const API_BASE = import.meta.env.VITE_API_URL || "/api";

// withCredentials sends the login cookie (needed when VITE_API_URL points to another port).
export const api = axios.create({ baseURL: API_BASE, timeout: 30_000, withCredentials: true });

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

export type SingleMethod = "CASH" | "UPI" | "CARD" | "OTHER";
/** SPLIT = paid with more than one method (see the invoice's payments). */
export type PaymentMethod = SingleMethod | "SPLIT";
export type PaymentStatus = "PAID" | "UNPAID";
export type DiscountType = "NONE" | "FIXED" | "PERCENT";
export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY";

export interface Product {
  id: number;
  name: string;
  sku: string | null;
  pricePaise: number;
  stock: number;
  lowStockThreshold: number;
  description: string | null;
  /** false = the bill discount never applies to this item. */
  discountAllowed: boolean;
  /** true = never charge packaging for this item. */
  noPackaging: boolean;
  /** Custom box charge per piece (paise); null = the shop rule. */
  packagingPaise: number | null;
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
  discountAllowed: boolean;
  /** Box charge for this line, copied when the bill was saved. */
  packagingPaise: number;
}

export interface Payment {
  id: number;
  amountPaise: number;
  method: SingleMethod;
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
  orderType: OrderType;
  boxCount: number;
  packagingPaise: number;
  bagCount: number;
  bagPaise: number;
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
  packagingMinPricePaise: number;
  packagingBoxPaise: number;
  packagingBagPaise: number;
  packagingOnTakeaway: boolean;
  packagingOnDelivery: boolean;
}

export interface Dashboard {
  range: { start: string; end: string } | null;
  sales: {
    salesPaise: number;
    paidPaise: number;
    unpaidPaise: number;
    invoiceCount: number;
    discountPaise: number;
    averageBillPaise: number;
  };
  receivedByMethod: { method: SingleMethod; amountPaise: number; count: number }[];
  packaging: { boxPaise: number; bagPaise: number; totalPaise: number; boxCount: number; bagCount: number };
  salesByOrderType: { orderType: OrderType; salesPaise: number; count: number }[];
  outstandingUnpaid: { totalPaise: number; count: number };
  lowStockProducts: Product[];
  recentInvoices: Pick<Invoice, "id" | "invoiceNumber" | "customerName" | "invoiceDate" | "totalPaise" | "paymentStatus" | "paymentMethod" | "orderType">[];
}

export interface HeldCart {
  id: number;
  customerName: string | null;
  customerPhone: string | null;
  discountType: DiscountType;
  /** FIXED: paise. PERCENT: basis points. */
  discountValue: number;
  orderType: OrderType;
  bagCount: number;
  items: { productId: number; quantity: number; product: { id: number; name: string; pricePaise: number; isActive: boolean } | null }[];
  itemCount: number;
  estimatePaise: number;
  createdByName: string | null;
  createdAt: string;
}

export interface WhatsAppCloudStatus {
  enabled: boolean;
  reason: string;
  displayPhoneNumber?: string;
  usesTemplate: boolean;
}

export const pdfUrl = (invoiceId: number) => `${API_BASE}/invoices/${invoiceId}/pdf`;

export interface AuthUser {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  isOwner: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthStatus {
  setupRequired: boolean;
  user: AuthUser | null;
  businessName: string | null;
}
