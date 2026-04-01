-- CreateTable WhatsappInstance
CREATE TABLE "whatsapp_instances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empresaId" TEXT NOT NULL UNIQUE,
    "instanceName" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "qrCode" TEXT,
    "ownerPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_instances_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable WhatsappMessage
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "senderName" TEXT,
    "message" TEXT NOT NULL,
    "response" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_messages_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "whatsapp_instances" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AddColumn whatsappInstance to Empresa
ALTER TABLE "empresas" ADD COLUMN "whatsappInstanceId" TEXT;

-- CreateIndex for better query performance
CREATE INDEX "whatsapp_messages_instanceId_idx" ON "whatsapp_messages"("instanceId");
CREATE INDEX "whatsapp_messages_createdAt_idx" ON "whatsapp_messages"("createdAt");
