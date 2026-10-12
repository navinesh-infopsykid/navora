import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";

/** Business settings live in a single row with id = 1. It is created on first use. */
export const SETTINGS_ID = 1;

type Client = Prisma.TransactionClient | typeof prisma;

export async function getSettings(client: Client = prisma) {
  return client.businessSettings.upsert({ where: { id: SETTINGS_ID }, update: {}, create: { id: SETTINGS_ID } });
}

export interface SettingsInput {
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  currency: string;
  invoiceFooter: string;
}

export async function updateSettings(input: SettingsInput) {
  const data = {
    businessName: input.businessName.trim(),
    businessAddress: input.businessAddress.trim(),
    businessPhone: input.businessPhone.trim(),
    currency: input.currency.trim().toUpperCase(),
    invoiceFooter: input.invoiceFooter.trim(),
  };
  return prisma.businessSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });
}

/** Public view of settings (hides the internal invoice counter). */
export function publicSettings(settings: Awaited<ReturnType<typeof getSettings>>) {
  const { nextInvoiceNumber: _counter, ...rest } = settings;
  return rest;
}
