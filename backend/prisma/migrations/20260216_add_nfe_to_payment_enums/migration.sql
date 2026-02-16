-- Migration: Add NFE to payment enums
-- Description: Adds NFE (Nota Fiscal Eletrônica) as valid payment method
-- Date: 2026-02-16

-- IMPORTANT: This migration runs outside of transaction block
-- because ALTER TYPE ADD VALUE cannot run inside transactions.

-- Add NFE to MetodoPagamento enum (used in pagamentos.metodo)
ALTER TYPE "public"."MetodoPagamento" ADD VALUE IF NOT EXISTS 'NFE';

-- Add NFE to FormaPagamento enum (used in CaixaRegistro.formaPagamento)
ALTER TYPE "public"."FormaPagamento" ADD VALUE IF NOT EXISTS 'NFE';
