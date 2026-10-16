import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";

/** Business settings live in a single row with id = 1. It is created on first use. */
export const SETTINGS_ID = 1;

type Client = Prisma.TransactionClient | typeof prisma;

export async function getSettings(client: Client = prisma) {
  // A plain read is one database round trip; the row is only created on a brand-new database.
  const existing = await client.businessSettings.findUnique({ where: { id: SETTINGS_ID } });
  return existing ?? client.businessSettings.upsert({ where: { id: SETTINGS_ID }, update: {}, create: { id: SETTINGS_ID } });
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

export interface PackagingSettingsInput {
  packagingMinPricePaise: number;
  packagingBoxPaise: number;
  packagingBagPaise: number;
  packagingOnTakeaway: boolean;
  packagingOnDelivery: boolean;
}

/** Changes the packaging rule. Only affects bills saved from now on (old bills keep their packaging). */
export async function updatePackagingSettings(input: PackagingSettingsInput) {
  return prisma.businessSettings.upsert({ where: { id: SETTINGS_ID }, update: input, create: { id: SETTINGS_ID, ...input } });
}

/** Public view of settings (hides the internal invoice counter). */
export function publicSettings(settings: Awaited<ReturnType<typeof getSettings>>) {
  const { nextInvoiceNumber: _counter, ...rest } = settings;
  return rest;
}
