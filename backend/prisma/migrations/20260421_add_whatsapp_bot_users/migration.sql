CREATE TABLE "whatsapp_bot_users" (
    "id"         TEXT NOT NULL,
    "empresaId"  TEXT NOT NULL,
    "nome"       TEXT NOT NULL,
    "role"       TEXT NOT NULL,
    "jid"        TEXT,
    "telefone"   TEXT,
    "lavadorId"  TEXT,
    "ativo"      BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_bot_users_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "whatsapp_bot_users"
    ADD CONSTRAINT "whatsapp_bot_users_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_bot_users"
    ADD CONSTRAINT "whatsapp_bot_users_lavadorId_fkey"
    FOREIGN KEY ("lavadorId") REFERENCES "lavadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
