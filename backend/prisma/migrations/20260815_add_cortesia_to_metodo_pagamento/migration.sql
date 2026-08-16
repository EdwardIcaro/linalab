-- Migration: Add CORTESIA to MetodoPagamento enum
-- Description: Adds CORTESIA as valid payment method. Cortesia orders are excluded
-- from faturamento (revenue) calculations, but commission is still paid normally.
-- Date: 2026-08-15

-- IMPORTANT: This migration runs outside of transaction block
-- because ALTER TYPE ADD VALUE cannot run inside transactions.

ALTER TYPE "public"."MetodoPagamento" ADD VALUE IF NOT EXISTS 'CORTESIA';
