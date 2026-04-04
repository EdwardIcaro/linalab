-- Adicionar colunas de pareamento de admin no WhatsApp
ALTER TABLE "whatsapp_instances" ADD COLUMN IF NOT EXISTS "pairing_mode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_instances" ADD COLUMN IF NOT EXISTS "pairing_nome" TEXT;
