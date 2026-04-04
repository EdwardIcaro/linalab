-- Adicionar colunas com IF NOT EXISTS para ser idempotente

-- auth_state em WhatsappInstance (credenciais Baileys)
ALTER TABLE "whatsapp_instances" ADD COLUMN IF NOT EXISTS "auth_state" TEXT;

-- telefone em Lavador (identificação WhatsApp)
ALTER TABLE "lavadores" ADD COLUMN IF NOT EXISTS "telefone" TEXT;

-- whatsapp_block_unknown em Empresa (bloquear números não cadastrados)
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "whatsapp_block_unknown" BOOLEAN NOT NULL DEFAULT true;

-- Criar tabela whatsapp_admin_phones (números de admin com acesso ao bot)
CREATE TABLE IF NOT EXISTS "whatsapp_admin_phones" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "nome" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_admin_phones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_admin_phones_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "whatsapp_instances" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Índice único (idempotente)
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_admin_phones_instance_id_telefone_key"
    ON "whatsapp_admin_phones"("instance_id", "telefone");
