# 🤖 Bot WhatsApp - Guia de Configuração e Deployment

## Visão Geral

Integração de bot WhatsApp inteligente ao Lina X usando:
- **Evolution API** — gateway WhatsApp self-hosted
- **Groq LLM** — IA gratuita (Llama 3.3 70B)

---

## 🚀 Implementação Completa

### ✅ Arquivos Criados

1. **Backend Services:**
   - `backend/src/services/evolutionService.ts` — Cliente HTTP da Evolution API
   - `backend/src/services/groqService.ts` — Integração com Groq LLM
   - `backend/src/services/whatsappCommandHandler.ts` — Parser de comandos

2. **Backend Controllers & Routes:**
   - `backend/src/controllers/whatsappController.ts` — Endpoints REST
   - `backend/src/routes/whatsapp.ts` — Rotas `/api/whatsapp`

3. **Database Schema:**
   - `backend/prisma/schema.prisma` — 2 modelos novos (WhatsappInstance, WhatsappMessage)
   - Migration pendente: `npx prisma migrate dev --name add_whatsapp`

4. **Frontend:**
   - `DESKTOPV2/index.html` — Card de status e controle do bot
   - Alpine.js methods para `setupWhatsapp()`, `loadWhatsappStatus()`, `disconnectWhatsapp()`

5. **Environment:**
   - `.env.example` — 3 novas variáveis (EVOLUTION_API_URL, EVOLUTION_API_KEY, GROQ_API_KEY, BACKEND_URL)
   - `package.json` — Dependência `groq-sdk` adicionada

---

## 📋 Próximos Passos

### 1. Setup Evolution API

**Opção A — Railway (Recomendado):**

```bash
1. Acessar https://railway.app
2. Criar novo projeto
3. Deploy do repositório: https://github.com/EvolutionAPI/evolution-api
4. Variável de ambiente:
   AUTHENTICATION_API_KEY=sua-chave-secreta
5. Copiar URL gerada → EVOLUTION_API_URL no .env
6. Usar AUTHENTICATION_API_KEY → EVOLUTION_API_KEY no .env
```

**Opção B — Docker Local (Dev):**

```bash
docker run -d \
  -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=dev-key \
  atendai/evolution-api:latest
```

### 2. Obter Groq API Key

```bash
1. Acessar https://console.groq.com
2. Sign up (gratuito)
3. Criar API Key
4. Copiar para GROQ_API_KEY no .env
```

### 3. Rodar Migration Prisma

```bash
# No diretório backend/
npx prisma migrate dev --name add_whatsapp

# Verificar schema atualizado
npx prisma studio
```

### 4. Variáveis de Ambiente

Adicionar ao `.env` (copiar de `.env.example`):

```bash
# Evolution API
EVOLUTION_API_URL="https://seu-railway-domain.up.railway.app"
EVOLUTION_API_KEY="sua-chave-autenticacao"

# Groq
GROQ_API_KEY="gsk_seu_token_aqui"

# Backend URL (para webhooks)
BACKEND_URL="https://seu-backend-railway.up.railway.app"
```

---

## 🧪 Testando Localmente

### 1. Iniciar Backend

```bash
cd backend
pnpm dev
# Servidor rodando em http://localhost:3001
```

### 2. Abrir Dashboard

```
http://localhost:3000/index.html
```

### 3. Configurar Bot

1. Click no botão "Configurar Bot"
2. Você receberá um QR code
3. Escaneie com seu WhatsApp
4. Bot conecta automaticamente

### 4. Testar Comandos

No WhatsApp, envie:

```
/resumo          → Resumo do dia
/lavadores       → Lista de lavadores e comissões
joão             → Dados específicos de um lavador
/caixa          → Entradas, saídas, saldo
/pendentes      → Ordens em andamento
/ajuda          → Menu de comandos
Olá!            → Interpretação livre com Groq IA
```

---

## 🔍 Monitoramento

### Logs de Webhook

Evolution API envia eventos para `POST /api/whatsapp/webhook/evolution`

Ver no backend:
```bash
tail -f logs/whatsapp.log
```

### Mensagens Armazenadas

Verificar mensagens recebidas/enviadas no Prisma:

```bash
npx prisma studio
# Navegar até WhatsappMessage
```

### Status da Instância

Endpoint: `GET /api/whatsapp/status`

Retorna:
```json
{
  "status": "connected",
  "ownerPhone": "5511999999999",
  "message": "WhatsApp conectado com sucesso"
}
```

---

## 🚨 Troubleshooting

### QR Code não aparece

```bash
# Verificar status na Evolution API
curl -H "apikey: SUA_CHAVE" \
  http://localhost:8080/instance/fetchInstances

# Se status='close', tente reconectar
```

### Mensagens não chegam

```bash
# Verificar webhook URL no backend
BACKEND_URL deve ser acessível externamente
# Em dev: localhost não funciona (use ngrok)

ngrok http 3001
# Use URL do ngrok como BACKEND_URL
```

### Groq retorna erro

```bash
# Verificar API Key
echo $GROQ_API_KEY

# Testar conexão
curl https://api.groq.com/openai/v1/models \
  -H "Authorization: Bearer $GROQ_API_KEY"
```

---

## 📊 Endpoints REST

### Rotas Protegidas (com JWT)

```
POST   /api/whatsapp/setup      → Criar nova instância + gerar QR code
GET    /api/whatsapp/status     → Obter status atual
DELETE /api/whatsapp/disconnect → Desconectar e remover
```

### Rotas Públicas

```
POST   /api/whatsapp/webhook/evolution → Webhook da Evolution API
       (validação interna por instanceName)
```

---

## 📱 Comandos Disponíveis

| Comando | Resposta |
|---------|----------|
| `/resumo` | Resumo do dia: ordens, faturamento, status |
| `/lavadores` | Lista com ordens e comissões de cada lavador |
| `[nome lavador]` | Dados específicos do lavador |
| `/caixa` | Entradas, saídas, saldo do dia |
| `/pendentes` | Ordens em andamento |
| `/ajuda` | Lista de comandos |
| Qualquer outro | Groq IA interpreta com contexto |

---

## 🏗️ Arquitetura

```
WhatsApp
   ↓
Evolution API (webhook → POST /api/whatsapp/webhook/evolution)
   ↓
WhatsappController.handleEvolutionWebhook()
   ↓
WhatsappCommandHandler.handleIncomingMessage()
   ├─ Verifica comandos conhecidos (/resumo, /lavadores, etc)
   └─ Se não encontrar → Groq IA interpreta
   ↓
Groq LLM
   ├─ Recebe contexto do dia (ordens, caixa, lavadores)
   └─ Retorna resposta natural
   ↓
EvolutionService.sendTextMessage()
   ↓
WhatsApp
```

---

## 💾 Modelos de Dados

### WhatsappInstance

```prisma
model WhatsappInstance {
  id           String              // Identificador único
  empresaId    String              // Qual empresa este WhatsApp pertence
  instanceName String              // Nome único na Evolution API
  status       String              // connected | disconnected | qr_code
  qrCode       String?             // Base64 do QR code
  ownerPhone   String?             // Número do WhatsApp conectado
  createdAt    DateTime            // Quando foi criado
  updatedAt    DateTime            // Última atualização

  empresa      Empresa             // Relação com a empresa
  messages     WhatsappMessage[]   // Histórico de mensagens
}
```

### WhatsappMessage

```prisma
model WhatsappMessage {
  id          String              // ID único da mensagem
  instanceId  String              // Qual instância recebeu
  direction   String              // INCOMING | OUTGOING
  phoneNumber String              // Quem enviou
  senderName  String?             // Nome do remetente
  message     String              // Texto da mensagem
  response    String?             // Resposta enviada
  status      String              // processed | error | ignored
  createdAt   DateTime            // Quando chegou

  instance    WhatsappInstance    // Relação com instância
}
```

---

## 🔐 Segurança

- ✅ Webhooks validados internamente por `instanceName`
- ✅ Apenas LINA_OWNER acessa `/api/whatsapp/setup`
- ✅ Multi-tenant: cada empresa tem seu próprio bot
- ✅ JWT obrigatório para endpoints protegidos
- ✅ Mensagens armazenadas com encryption recomendada

---

## 📈 Próximas Melhorias

- [ ] Suporte a mídia (imagens, PDFs)
- [ ] Webhook para eventos de lembrete (comissões, adiantamentos)
- [ ] Integração com WhatsApp Business API (verificação azul)
- [ ] Dashboard de análise de conversas (Groq insights)
- [ ] Agendamento de mensagens automáticas
- [ ] Suporte a grupos do WhatsApp
- [ ] Template de mensagens customizáveis

---

**Criado em:** 2026-03-30
**Versão:** 1.0
**Status:** ✅ Implementação Completa
