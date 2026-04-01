# 🚀 Evolution API - Deploy no Railway

## O que é Evolution API?

**Evolution API** é um gateway WhatsApp open-source, self-hosted, sem risco de ban.

- GitHub: https://github.com/EvolutionAPI/evolution-api
- Sem cobranças por mensagem
- Controle total sobre dados
- Integração direta com WhatsApp Web
- Suporte a múltiplas instâncias

---

## 📋 3 Opções de Deployment

| Opção | Tempo | Custo | Melhor Para |
|-------|-------|-------|-----------|
| **Railway** (Recomendado) | 10 min | Gratuito/Pago | Produção |
| **Docker Local** | 5 min | Gratuito | Desenvolvimento |
| **VPS/Servidor** | 30 min | ~$5-10/mês | Muito alto volume |

---

## ✅ Opção 1: Railway (RECOMENDADO PARA PRODUÇÃO)

### Passo 1: Preparar Railway

1. Acesse: https://railway.app
2. **Login/Sign up** com GitHub
3. Clique em **"New Project"**
4. Selecione **"Deploy from GitHub"**

### Passo 2: Conectar Repositório

1. Autorize Railway com GitHub
2. Na busca, digite: `EvolutionAPI/evolution-api`
3. Selecione o repositório oficial
4. Clique em **"Deploy"**

### Passo 3: Configurar Variáveis de Ambiente

Railway automaticamente detectará e deployará. Vá para:

**"Variables"** ou **"Variables"** tab:

Adicione:

```bash
AUTHENTICATION_API_KEY=chave-super-secreta-bem-forte-123456
NODE_ENV=production
PORT=8080
```

**Gerar chave segura:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Passo 4: Obter URL Pública

Após deploy completar (~2-3 minutos):

1. Clique em **"Deployments"**
2. Status deve estar **green** (✅ Success)
3. Copie a URL gerada:
   ```
   https://evolution-api-prod-xxxxx.railway.app
   ```

### Passo 5: Testar Conexão

```bash
# Teste a API (substitua URL e chave)
curl -H "apikey: sua-chave" \
  https://evolution-api-prod-xxxxx.railway.app/instance/fetchInstances

# Resposta esperada:
# {"status": "success", "data": []}
```

---

## 💻 Opção 2: Docker Local (Para Desenvolvimento)

### Passo 1: Instalar Docker

```bash
# Verificar se Docker já está instalado
docker --version

# Se não tiver, baixar em: https://www.docker.com/products/docker-desktop
```

### Passo 2: Rodar Container

```bash
docker run -d \
  --name evolution-api \
  -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=dev-key-local \
  -e NODE_ENV=development \
  atendai/evolution-api:latest
```

### Passo 3: Verificar Status

```bash
# Ver se container está rodando
docker ps | grep evolution-api

# Ver logs
docker logs evolution-api

# Testar
curl -H "apikey: dev-key-local" \
  http://localhost:8080/instance/fetchInstances
```

### Parar Container

```bash
docker stop evolution-api
docker rm evolution-api
```

---

## 🔧 Configuração do Lina X

### Em Desenvolvimento (Docker Local)

```bash
# backend/.env
EVOLUTION_API_URL="http://localhost:8080"
EVOLUTION_API_KEY="dev-key-local"
BACKEND_URL="http://localhost:3001"
```

### Em Produção (Railway)

```bash
# backend/.env (será injetado pelo Railway)
EVOLUTION_API_URL="https://evolution-api-prod-xxxxx.railway.app"
EVOLUTION_API_KEY="chave-autenticacao-super-secreta"
BACKEND_URL="https://seu-backend-railway.up.railway.app"
```

---

## 🌐 Expor localhost em Desenvolvimento (ngrok)

Se precisar testar webhooks localmente:

### Instalar ngrok

```bash
# Baixar: https://ngrok.com/download
# Ou via Homebrew (Mac/Linux):
brew install ngrok

# Via Chocolatey (Windows):
choco install ngrok
```

### Expor localhost

```bash
# Terminal 1: Rodar Evolution API local
docker run -d -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=dev-key \
  atendai/evolution-api:latest

# Terminal 2: Expor com ngrok
ngrok http 8080
# Copiar URL gerada: https://abc123.ngrok.io

# Terminal 3: Atualizar .env
EVOLUTION_API_URL="https://abc123.ngrok.io"
BACKEND_URL="https://xyz789.ngrok.io"  # ngrok do backend também

# Terminal 4: Rodar backend
cd backend && pnpm dev
```

---

## 📊 Endpoints Evolution API

### Principais

```bash
# Criar instância (com webhook)
POST /instance/create
{
  "instanceName": "lina-empresa-123",
  "webhook": "https://seu-backend.com/api/whatsapp/webhook/evolution",
  "qrcode": true
}

# Obter QR Code
GET /instance/fetchInstances?instanceName=lina-empresa-123

# Verificar status
GET /instance/connectionState/lina-empresa-123

# Enviar mensagem
POST /message/sendText/lina-empresa-123
{
  "number": "5511999999999",
  "text": "Olá!"
}

# Deletar instância
DELETE /instance/delete/lina-empresa-123
```

---

## 🧪 Teste Completo

### 1. Deploy Evolution API no Railway ✅

### 2. Atualizar .env do Lina X

```bash
EVOLUTION_API_URL="https://sua-url-railway.up.railway.app"
EVOLUTION_API_KEY="sua-chave-autenticacao"
GROQ_API_KEY="gsk_xxxxx"
BACKEND_URL="https://seu-backend-railway.up.railway.app"
```

### 3. Reiniciar Backend

```bash
cd backend
pnpm dev
```

### 4. Abrir Dashboard

```
http://localhost:3000/index.html
→ Card "WhatsApp Bot Status"
→ Click "Configurar Bot"
```

### 5. Escanear QR Code

Receberá um QR code → escaneie com WhatsApp

### 6. Testar Comando

```
WhatsApp: /resumo
Esperado: Resumo do dia
```

---

## 🚨 Troubleshooting

### "Cannot connect to Evolution API"

**Solução:**
```bash
# Verificar URL e chave
curl -H "apikey: sua-chave" https://sua-url/instance/fetchInstances

# Se falhar, verificar:
1. URL correta? (copiar novamente do Railway)
2. Chave correta? (verificar em Variables)
3. Deploy completo? (status verde no Railway)
```

### "QR Code não aparece"

**Solução:**
```bash
# Verificar se instância foi criada
curl -H "apikey: sua-chave" https://sua-url/instance/fetchInstances

# Se vazio [], rodar setup novamente no dashboard
# Se erro, verificar logs no Railway:
# Railway → Deployments → seu deploy → Logs
```

### "Webhooks não chegam"

**Solução:**
```bash
# BACKEND_URL deve ser acessível externamente
# Se local (localhost), usar ngrok:
ngrok http 3001

# Copiar URL do ngrok → BACKEND_URL no .env
BACKEND_URL="https://abc123.ngrok.io"

# Retestar
```

---

## 📈 Monitoramento no Railway

### Logs em Tempo Real

```
Railway → Seu projeto → Deployments
→ Seu deployment → Logs
```

### Métricas

```
Railway → Seu projeto → Metrics
→ Ver CPU, Memory, Network
```

### Reiniciar Deploy

```
Railway → Deployments → seu deploy
→ Click em "..." → Redeploy
```

---

## 🔒 Segurança

### Chaves de Ambiente

✅ **NUNCA** commitando `.env` com chaves reais
✅ **SEMPRE** usar variáveis no Railway
✅ **SEMPRE** usar HTTPS em produção
✅ **NUNCA** compartilhar AUTHENTICATION_API_KEY

### Regenerar Chave

Se achar que foi comprometida:

```bash
1. Railway → Variables
2. Copiar nova chave: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
3. Atualizar AUTHENTICATION_API_KEY
4. Railway faz redeploy automático
5. Atualizar .env do Lina X
6. Reiniciar backend
```

---

## 💰 Custos

### Railway

| Plano | Preço | Inclui |
|-------|-------|--------|
| Free | $0 | 5$/mês em crédito |
| Pay-as-you-go | Conforme uso | Depois de 5$/mês |

**Para Lina X:**
- Evolution API + backend = ~$3-5/mês no free tier
- Depois pagamos conforme uso

---

## 📚 Referências

- Evolution API Docs: https://docs.evolution-api.com
- Railway Docs: https://docs.railway.app
- ngrok: https://ngrok.com

---

**Data:** 2026-03-31
**Status:** ✅ Pronto para produção
