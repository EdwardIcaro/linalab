# 🔧 Aplicar Migration WhatsApp no Neon

## ✅ SQL Gerado

O arquivo SQL foi criado em:
```
backend/prisma/migrations/20260331_add_whatsapp/migration.sql
```

## 📋 Instruções para Neon

### Opção 1: Via SQL Editor do Neon (Recomendado)

1. **Abra o Neon Console:**
   - https://console.neon.tech
   - Selecione o projeto Lina X
   - Abra o banco de dados `linax`

2. **Acesse SQL Editor:**
   - Clique em "SQL Editor"
   - Ou use "SSH Terminal"

3. **Copie e execute o SQL:**
   ```sql
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

   -- CreateIndex for better query performance
   CREATE INDEX "whatsapp_messages_instanceId_idx" ON "whatsapp_messages"("instanceId");
   CREATE INDEX "whatsapp_messages_createdAt_idx" ON "whatsapp_messages"("createdAt");
   ```

4. **Clique em "Execute"** ou **Ctrl+Enter**

5. **Verifique sucesso:**
   ```sql
   SELECT * FROM information_schema.tables 
   WHERE table_name IN ('whatsapp_instances', 'whatsapp_messages');
   ```

### Opção 2: Via Terminal (Se preferir)

```bash
# 1. Configure .env com URL do Neon
DATABASE_URL="postgresql://user:password@seu-neon-host.neon.tech/linax"

# 2. Rode a migration via Prisma
cd backend
npx prisma migrate deploy

# 3. Verifique
npx prisma studio
```

---

## ✅ Verificação

Após executar o SQL, verifique no Neon:

```sql
-- Verificar tabelas
\dt whatsapp*

-- Verificar colunas
\d whatsapp_instances
\d whatsapp_messages

-- Verificar índices
\di whatsapp*

-- Contar registros (deve estar vazio inicialmente)
SELECT COUNT(*) FROM whatsapp_instances;
SELECT COUNT(*) FROM whatsapp_messages;
```

---

## 📝 Próximas Etapas

Após executar a migration:

1. **Reinicie o backend:**
   ```bash
   cd backend
   pnpm dev
   ```

2. **Gere Prisma Client:**
   ```bash
   npx prisma generate
   ```

3. **Configure .env com variáveis WhatsApp:**
   ```bash
   EVOLUTION_API_URL="http://localhost:8080"
   EVOLUTION_API_KEY="sua-chave-aqui"
   GROQ_API_KEY="gsk_xxxxx"
   BACKEND_URL="http://localhost:3001"
   ```

4. **Teste no dashboard:**
   - http://localhost:3000/index.html
   - Card "WhatsApp Bot Status" deve aparecer
   - Click "Configurar Bot"

---

## 🐛 Troubleshooting

**Erro: Foreign key constraint error**
- Certifique-se que a tabela `empresas` existe
- Verifique se `empresaId` em `empresas` é TEXT

**Erro: Table already exists**
- A migration foi executada 2x
- Verifique com: `SELECT * FROM "_prisma_migrations"`

**Erro: Cannot create index**
- O índice pode já existir
- Verifique com: `\di whatsapp_messages*`

---

**Arquivo SQL:** `backend/prisma/migrations/20260331_add_whatsapp/migration.sql`

**Data:** 2026-03-31
**Status:** ✅ Pronto para aplicar
