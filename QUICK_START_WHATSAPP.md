# ⚡ Quick Start - Bot WhatsApp (5 minutos)

## 1️⃣ Instalar Dependência

```bash
cd backend
pnpm install
```

## 2️⃣ Rodar Migration

```bash
npx prisma migrate dev --name add_whatsapp
```

## 3️⃣ Configurar .env

```bash
# Copiar template
cp .env.example .env

# Editar .env com:
EVOLUTION_API_URL="http://localhost:8080"  # ou URL do Railway
EVOLUTION_API_KEY="sua-chave-aqui"
GROQ_API_KEY="gsk_xxxxx"
BACKEND_URL="http://localhost:3001"  # ngrok em produção
```

## 4️⃣ Iniciar Backend

```bash
pnpm dev
```

## 5️⃣ Testar no Dashboard

```
http://localhost:3000/index.html
→ Card "WhatsApp Bot Status"
→ Click "Configurar Bot"
→ Escanear QR code
→ Conectar!
```

## 6️⃣ Enviar Mensagem WhatsApp

```
/resumo          → Resumo do dia
/lavadores       → Lista de lavadores
joão             → Dados do João
/caixa          → Caixa do dia
/pendentes      → Ordens pendentes
/ajuda          → Menu de ajuda
Olá!            → IA interpreta
```

---

## 🔗 URLs Importantes

| Serviço | URL |
|---------|-----|
| Dashboard | http://localhost:3000/index.html |
| Backend Health | http://localhost:3001/health |
| Evolution API | http://localhost:8080 (local) |
| Groq Console | https://console.groq.com |

---

## 📦 Setup Externo (30 minutos)

### Evolution API no Railway

```bash
1. railway.app → New Project
2. Deploy Existing Repository
3. GitHub: https://github.com/EvolutionAPI/evolution-api
4. Variável: AUTHENTICATION_API_KEY=sua-chave
5. Copiar URL → EVOLUTION_API_URL
```

### Groq API Key

```bash
1. console.groq.com → Sign up
2. Create API Key
3. Copiar → GROQ_API_KEY
```

---

## 🐛 Troubleshooting

| Problema | Solução |
|----------|---------|
| "QR code não aparece" | Verificar EVOLUTION_API_URL e EVOLUTION_API_KEY |
| "Mensagens não chegam" | BACKEND_URL deve ser acessível (use ngrok) |
| "Groq retorna erro" | Verificar GROQ_API_KEY e rate limit (30/min) |
| "Port já em uso" | `lsof -i :3001` e matar processo |

---

**Tempo total:** ~5 min (local) + ~30 min (setup externo)

Próximo: Ver `WHATSAPP_BOT_SETUP.md` para documentação completa
