# 🏗️ Arquitetura Completa - Lina X + WhatsApp Bot

## 📊 Visão Geral da Stack

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│                         CLIENTE FINAL                                │
│                     (Desktop/Mobile/Web)                             │
│                                                                       │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
         ┌─────────────┴──────────────┐
         │                            │
         ▼                            ▼
    ┌─────────┐                  ┌──────────┐
    │ Frontend│                  │ WhatsApp │
    │ Vercel  │                  │ (Usuario)│
    └────┬────┘                  └────┬─────┘
         │                            │
         │                     Escaneia QR
         │                            │
         └──────────┬─────────────────┘
                    │
                    │ API Calls
                    │ JWT Token
                    │
                    ▼
         ┌──────────────────┐
         │  Backend (Lina X)│
         │   Express.js 5   │
         │  Railway (Prod)  │
         │  localhost:3001  │
         │  TypeScript      │
         └────────┬─────────┘
                  │
        ┌─────────┼─────────┐
        │         │         │
        ▼         ▼         ▼
    ┌────────────────────────────────────┐
    │   WhatsApp Bot Service             │
    │                                    │
    │  - evolutionService.ts             │
    │  - groqService.ts                  │
    │  - whatsappCommandHandler.ts       │
    │  - whatsappController.ts           │
    └────────────┬─────────┬─────────────┘
                 │         │
         ┌───────▼──┐   ┌──▼───────┐
         │           │   │          │
         ▼           ▼   ▼          ▼
    ┌─────────┐ ┌──────────┐  ┌──────────┐
    │Evolution│ │Groq LLM  │  │  Neon    │
    │  API    │ │(IA)      │  │PostgreSQL│
    │Railway  │ │Gratuito  │  │Production│
    │(Prod)   │ │<100ms    │  │          │
    │         │ │          │  │          │
    └────┬────┘ └──────────┘  └────┬─────┘
         │                          │
         │ Webhook                  │ Prisma ORM
         │ (WhatsApp messages)      │ (Dados)
         │                          │
         └──────────┬───────────────┘
                    │
                    ▼
            Lina X Database
            (WhatsappInstance)
            (WhatsappMessage)
            
```

---

## 🚀 Stack Tecnológico

### Frontend
- **Framework:** HTML5 + CSS3 + JavaScript (Vanilla)
- **Deploy:** Vercel
- **Estado:** Alpine.js

### Backend
- **Framework:** Express.js 5
- **Linguagem:** TypeScript
- **Deploy:** Railway
- **ORM:** Prisma

### WhatsApp Integration
- **Gateway:** Evolution API (GitHub: EvolutionAPI/evolution-api)
- **Deploy:** Railway (mesmo como backend)
- **Protocolo:** HTTP + Webhooks

### IA
- **LLM:** Groq (Llama 3.3 70B)
- **SDK:** groq-sdk
- **Gratuito:** 30 req/min free tier

### Database
- **Provider:** Neon
- **SQL:** PostgreSQL 15+
- **Migrations:** Prisma Migrate

---

## 🌍 Ambientes

### Desenvolvimento (Local)

```
Frontend: http://localhost:3000
Backend: http://localhost:3001
Evolution API: http://localhost:8080 (Docker)
Banco: localhost:5432 ou Neon
```

**Setup:**

```bash
# Terminal 1: Evolution API Docker
docker run -d -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=dev-key \
  atendai/evolution-api:latest

# Terminal 2: Backend
cd backend && pnpm dev

# Terminal 3: Frontend
# Já rodando em Vercel (auto-deploy)
# Ou: http://localhost:3000 se servido local
```

### Produção (Railway + Vercel + Neon)

```
Frontend: https://seu-frontend.vercel.app
Backend: https://seu-backend-railway.up.railway.app
Evolution API: https://seu-evolution-api-railway.up.railway.app
Banco: PostgreSQL no Neon
```

**Deploy automático:**
- Frontend: git push → Vercel auto-deploy
- Backend: git push → Railway auto-deploy
- Evolution API: Atualizações do GitHub → Railway redeploy

---

## 📋 Checklist de Deployment

### 1️⃣ Database (Neon) - ✅ FEITO

```bash
☑️ Tabelas criadas (WhatsappInstance, WhatsappMessage)
☑️ Migrations aplicadas
☑️ Índices criados
☑️ Foreign keys validadas
```

**Próximo:** Executar SQL no Neon Console

### 2️⃣ Evolution API (Railway)

```bash
☐ Railway account criado
☐ Projeto criado
☐ GitHub conectado
☐ EvolutionAPI/evolution-api deployado
☐ AUTHENTICATION_API_KEY definido
☐ URL pública obtida
☐ Testado com curl
```

**Guia:** `EVOLUTION_API_DEPLOYMENT.md`

### 3️⃣ Backend (Railway)

```bash
☐ .env atualizado com URLs reais
☐ EVOLUTION_API_URL preenchido
☐ EVOLUTION_API_KEY preenchido
☐ GROQ_API_KEY obtido
☐ DATABASE_URL apontando para Neon
☐ Backend deployado no Railway
☐ Logs monitorados
```

### 4️⃣ Frontend (Vercel)

```bash
☐ Git push do código
☐ Vercel faz auto-deploy
☐ Dashboard acessível
☐ Card WhatsApp visível
```

### 5️⃣ Teste Ponta-a-Ponta

```bash
☐ Dashboard carrega sem erros
☐ Click "Configurar Bot" funciona
☐ QR code aparece
☐ Escaneia e conecta
☐ Enviar /resumo no WhatsApp
☐ Recebe resposta automática
☐ Logs mostram tráfego correto
```

---

## 🔐 Variáveis de Ambiente

### Backend (.env)

```bash
# Database
DATABASE_URL="postgresql://user:pass@seu-neon-host/linax"

# WhatsApp (Evolution API)
EVOLUTION_API_URL="https://seu-evolution-railway.up.railway.app"
EVOLUTION_API_KEY="sua-chave-autenticacao"

# IA
GROQ_API_KEY="gsk_seu-token"

# Backend
BACKEND_URL="https://seu-backend-railway.up.railway.app"
PORT=3001
NODE_ENV=production

# JWT
JWT_SECRET="chave-super-secreta-256-chars"

# Etc (SendGrid, Mercado Pago, etc)
...
```

### Railway Auto-injeta

- DATABASE_URL (se PostgreSQL add-on)
- PORT (padrão 3001)
- NODE_ENV (production)

### Frontend (.env não precisa)

- VITE_API_URL (se necessário, mas Vercel não precisa)
- Valores sensíveis: NUNCA no frontend

---

## 📊 Fluxo de Dados Completo

### 1. Usuário Escaneia QR Code

```
Dashboard HTML
  ↓ click "Configurar Bot"
Alpine.js dashboard()
  ↓ call setupWhatsapp()
window.api.request('POST /api/whatsapp/setup')
  ↓ JWT token
Backend whatsappController.setupWhatsapp()
  ↓ call evolutionService.createInstance()
Evolution API (Railway)
  ↓ gera QR code
retorna Base64 QR
  ↓ atualiza DOM
QR code exibido no dashboard
  ↓ usuário escaneia
Evolution API conecta WhatsApp
Webhook: /api/whatsapp/webhook/evolution
```

### 2. Usuário Envia Mensagem

```
WhatsApp User
  ↓ mensagem: "/resumo"
Evolution API (recebe)
  ↓ POST webhook
Backend: /api/whatsapp/webhook/evolution
  ↓ handleEvolutionWebhook()
whatsappCommandHandler.handleIncomingMessage()
  ├─ verifica: "resumo"?
  └─ if yes → handleResumoCommand()
  └─ if no → passar para Groq IA
  
Groq LLM
  ← contexto do dia (ordens, caixa, etc)
  → resposta natural
  
evolutionService.sendTextMessage()
  ↓ POST /message/sendText
Evolution API
  ↓ envia via WhatsApp
WhatsApp User
  ← resposta automática
```

### 3. Armazenar no Banco

```
Toda mensagem:
  ↓
prisma.whatsappMessage.create()
  ↓
Neon PostgreSQL
  ↓
whatsapp_messages (histórico)
```

---

## 🔗 Relações Entre Serviços

```
Frontend (Vercel)
  └─ HTTP calls
    └─ Backend (Railway)
      ├─ Neon (PostgreSQL)
      ├─ Evolution API (Railway)
      │  └─ WhatsApp
      ├─ Groq (Cloud)
      └─ SendGrid (Email)
```

---

## 📈 Custos Estimados

| Serviço | Tier | Custo/mês | Notas |
|---------|------|-----------|-------|
| Railway (Backend) | Free | $0 | $5/mês crédito free |
| Railway (Evolution) | Free | $0 | Compartilha crédito |
| Neon (DB) | Free | $0 | 3GB storage free |
| Vercel (Frontend) | Free | $0 | Auto-deploy GitHub |
| Groq (IA) | Free | $0 | 30 req/min free |
| **TOTAL** | | **$0-5/mês** | Se sob free tier |

**Após crescimento:**
- Railway: ~$10-50/mês (conforme uso)
- Neon: ~$0-20/mês (por storage extra)
- Groq: ~$0-10/mês (se exceder free tier)

---

## ✅ Próximos Passos Imediatos

### Hoje (30 minutos)

1. ✅ Aplicar SQL no Neon
2. ⏳ Deploy Evolution API no Railway
3. ⏳ Atualizar .env
4. ⏳ Testar dashboard

### Amanhã

5. ⏳ Monitoramento e logs
6. ⏳ Testes de carga
7. ⏳ Documentação de suporte

---

**Criado:** 2026-03-31
**Status:** ✅ Arquitetura Pronta
