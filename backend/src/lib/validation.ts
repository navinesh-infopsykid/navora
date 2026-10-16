import { z } from "zod";
import { badRequest } from "./errors";

/** Parse and validate data with a zod schema. Invalid data -> 400 with a readable message. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    const first = issues[0];
    throw badRequest(first ? `${first.field ? `${first.field}: ` : ""}${first.message}` : "Invalid request", issues);
  }
  return result.data;
}

/** Validates a numeric route parameter such as /products/:id. */
export function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("Invalid id");
  return id;
}

// Reusable field rules
export const paise = z.number().int("Must be a whole number of paise").min(0, "Cannot be negative").max(1_00_00_000_00, "Amount is too large");
export const wholeNumber = z.number().int("Must be a whole number").min(0, "Cannot be negative").max(10_000_000, "Number is too large");
export const optionalText = (max: number) => z.string().trim().max(max).nullish();
export const paymentMethod = z.enum(["CASH", "UPI", "CARD", "OTHER", "SPLIT"]);
/** One part of a split payment, e.g. { method: "UPI", amountPaise: 20000 }. */
export const paymentParts = z
  .array(z.object({ method: z.enum(["CASH", "UPI", "CARD", "OTHER"]), amountPaise: paise }))
  .max(4)
  .nullish();
export const paymentStatus = z.enum(["PAID", "UNPAID"]);
export const orderType = z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]);
