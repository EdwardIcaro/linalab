-- Criar tabela AdminConfig para vincular WhatsApp do admin owner
CREATE TABLE IF NOT EXISTS "admin_configs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "liniaOwnerId" TEXT NOT NULL UNIQUE,
  "whatsappNotificationPhone" TEXT,
  "phoneConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "phoneConfirmationToken" TEXT UNIQUE,
  "phoneConfirmationExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_configs_liniaOwnerId_fkey"
    FOREIGN KEY ("liniaOwnerId") REFERENCES "usuarios"("id") ON DELETE CASCADE
);

CREATE INDEX "admin_configs_liniaOwnerId_idx" ON "admin_configs"("liniaOwnerId");

-- Criar tabela TentativaResetSenha para rastrear tentativas
CREATE TABLE IF NOT EXISTS "tentativas_reset_senha" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "usuarioId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_approval',
  "ip" TEXT,
  "userAgent" TEXT,
  "approvedBy" TEXT,
  "rejectedBy" TEXT,
  "motivo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (now() + interval '1 hour'),
  CONSTRAINT "tentativas_reset_senha_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE
);

CREATE INDEX "tentativas_reset_senha_usuarioId_idx" ON "tentativas_reset_senha"("usuarioId");
CREATE INDEX "tentativas_reset_senha_status_idx" ON "tentativas_reset_senha"("status");

-- Criar tabela RecuperacaoSenha para tokens de reset
CREATE TABLE IF NOT EXISTS "recuperacoes_senha" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "usuarioId" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recuperacoes_senha_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE
);

CREATE INDEX "recuperacoes_senha_usuarioId_idx" ON "recuperacoes_senha"("usuarioId");
CREATE INDEX "recuperacoes_senha_token_idx" ON "recuperacoes_senha"("token");
