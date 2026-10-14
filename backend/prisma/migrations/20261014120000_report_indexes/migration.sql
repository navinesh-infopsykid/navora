-- Indexes for payment and customer lookups, so reports stay fast as bills accumulate.
-- Adds no data and changes no existing rows.
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");
