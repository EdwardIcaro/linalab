-- AddColumn auth_state to WhatsappInstance (armazena credenciais Baileys como JSON)
ALTER TABLE "whatsapp_instances" ADD COLUMN "auth_state" TEXT;

-- AddColumn telefone to Lavador (para identificação via WhatsApp)
ALTER TABLE "lavadores" ADD COLUMN "telefone" TEXT;

-- AddColumn whatsappBlockUnknown to Empresa (bloqueia mensagens de números não cadastrados)
ALTER TABLE "empresas" ADD COLUMN "whatsapp_block_unknown" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable WhatsappAdminPhone (números de admin com acesso ao bot)
CREATE TABLE "whatsapp_admin_phones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instance_id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "nome" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_admin_phones_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "whatsapp_instances" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex for WhatsappAdminPhone
CREATE UNIQUE INDEX "whatsapp_admin_phones_instance_id_telefone_key" ON "whatsapp_admin_phones"("instance_id", "telefone");
