-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionStatus" ADD VALUE 'PENDING';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PAYMENT_FAILED';

-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "trialDays" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "subscription_payments_mercadoPagoPaymentId_idx" ON "subscription_payments"("mercadoPagoPaymentId");
