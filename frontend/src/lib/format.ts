export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/** "919876543210" -> "+91 98765 43210" */
export function formatPhone(digits: string | null | undefined) {
  if (!digits) return "";
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return `+${digits}`;
}

export const METHOD_LABELS = { CASH: "Cash", UPI: "UPI", CARD: "Card", OTHER: "Other", SPLIT: "Split" } as const;

export const ORDER_TYPE_LABELS: Record<"DINE_IN" | "TAKEAWAY" | "DELIVERY", string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};
