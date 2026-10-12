import { badRequest } from "./errors";

/**
 * Normalise a phone number into digits with country code, as used by WhatsApp.
 *   "98765 43210"      -> "919876543210"
 *   "+91-98765-43210"  -> "919876543210"
 *   "098765 43210"     -> "919876543210"
 * Returns null for an empty value. Throws 400 for something that is not a phone number.
 */
export function normalizePhone(input: string | null | undefined, countryCode: string): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^[+\d\s\-().]+$/.test(trimmed)) throw badRequest("Phone number can contain only digits, spaces, +, - and brackets");

  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    // Already international.
  } else if (digits.length === 10) {
    digits = countryCode + digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = countryCode + digits.slice(1);
  }

  if (digits.length < 10 || digits.length > 15) throw badRequest("Enter a valid mobile number (10 digits, or with country code)");
  return digits;
}

/** "919876543210" -> "+91 98765 43210" (Indian numbers), otherwise "+<digits>". */
export function displayPhone(digits: string | null | undefined): string {
  if (!digits) return "";
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return `+${digits}`;
}
