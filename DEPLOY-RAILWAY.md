# 🚀 Guia de Deploy - LinaX Sistema de Lava Jato no Railway

**Status:** ✅ Pronto para Deploy
**Plataforma:** Railway.app
**Tempo Estimado:** 45-60 minutos
**Custo:** $0 (primeiros 30 dias com $5 créditos/mês)

---

## 📋 Checklist de Pré-Deploy

Antes de começar, certifique-se que:

- [x] Código commitado no GitHub
- [x] `.env` **NÃO** está versionado (verificar `.gitignore`)
- [x] `railway.json` configurado
- [x] `Procfile` adicionado
- [x] `package.json` com scripts corretos
- [x] Frontend API_BASE_URL pronto para atualizar

---

## 🎯 Passo 1: Criar Conta Railway (5 min)

### 1.1 Acesso ao Railway
1. Abra: **https://railway.app**
2. Clique em **"Start a New Project"** ou **"Get Started"**
3. Clique em **"Deploy from GitHub repo"**
4. Authorize Railway para acessar seus repositórios GitHub

### 1.2 Conectar Repositório
1. Railway solicitará permissão para acessar GitHub
2. Selecione sua conta GitHub
3. Escolha se quer autorizar todos os repositórios ou apenas alguns

---

## 🔧 Passo 2: Criar Projeto Railway (5 min)

### 2.1 Nova Projeto
1. Na dashboard do Railway, clique: **"New Project"**
2. Selecione: **"Deploy from GitHub repo"**
3. Procure por: `linalab` (ou seu repositório)
4. Clique para selecionar

### 2.2 Railway Detectará Automaticamente
- Railway vê `railway.json` e `package.json`
- Detecta automaticamente: **Node.js 18+**
- Configuração de build: `cd backend && npm install && npm run build`
- Configuração de start: `cd backend && npm run start`

---

## 🗄️ Passo 3: Adicionar PostgreSQL Database (5 min)

### 3.1 Provisionar Database
1. No projeto Railway Dashboard
2. Clique em: **"+ New"** (botão verde)
3. Selecione: **"Database"** → **"PostgreSQL"**
4. Railway criará automaticamente uma instância PostgreSQL

### 3.2 Verificar Conexão
Railway vai criar automaticamente a variável:
- `DATABASE_URL` (preenchida automaticamente)
- Esta URL conecta o Node.js ao PostgreSQL

**Verificar em:** Railway Dashboard → PostgreSQL Service → Variables

---

## 🔐 Passo 4: Configurar Environment Variables (10 min)

### 4.1 Acessar Variáveis
1. Railway Dashboard → Seu Projeto
2. Selecione o **Service Node.js** (não o PostgreSQL)
3. Clique em **"Variables"**

### 4.2 Adicionar Variáveis Necessárias

Copie e cole no Railway:

```env
# Server
NODE_ENV=production
PORT=3001

# JWT Security (IMPORTANTE - Generate novo!)
JWT_SECRET=GERAR_NOVO_AQUI_256_CARACTERES

# Security
BCRYPT_SALT_ROUNDS=12

# Email SendGrid
SENDGRID_API_KEY=SG.seu_api_key_sendgrid
EMAIL_FROM=noreply@seudominio.com

# Frontend URL (será preenchido após obter domínio Railway)
FRONTEND_URL=${{RAILWAY_PUBLIC_DOMAIN}}

# Mercado Pago (Sandbox para testes)
MERCADO_PAGO_ACCESS_TOKEN=TEST-5277956129999284-013022-a0433da8a4d2e282840ab5a3cd96efa0-182616510
MERCADO_PAGO_PUBLIC_KEY=TEST-2e6d0347-0e5c-40fe-8502-b371cd766ee2
MERCADO_PAGO_WEBHOOK_SECRET=db9ff2381b84a19f9c3ddd8e9e7fdf864277b6f65f4a12008a9ed1b3203e1b16

# Payment URLs (ajustar após obter domínio)
PAYMENT_SUCCESS_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
PAYMENT_FAILURE_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
PAYMENT_PENDING_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
```

### 4.3 Gerar JWT_SECRET Seguro

No seu terminal local (não no Railway):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copie o resultado e cole em `JWT_SECRET` no Railway.

### 4.4 Obter Domínio Railway

Após deploy inicial, Railway gera:
- **Domínio:** `linax-production-xxxx.up.railway.app`
- Este domínio será visível em: Settings → Domains

Atualize `FRONTEND_URL` com este domínio (com `https://`).

---

## 🏗️ Passo 5: Configurar Build & Deploy (5 min)

### 5.1 Build Command
No Railway → Service → Settings → Build:

```
cd backend && npm install && npm run build
```

### 5.2 Start Command
No Railway → Service → Settings → Deploy:

```
cd backend && npm run start
```

### 5.3 Prisma Migrations
Adicionar em Deploy → Pre-Deploy Commands:

```
cd backend && npx prisma db push --accept-data-loss
```

**OU** (já configurado em `postinstall`):
- O `package.json` roda `prisma db push` automaticamente após `npm install`

---

## 🚀 Passo 6: Triggar Deploy (15 min)

### 6.1 Deploy Manual
1. Railway Dashboard → Seu Projeto → Service Node.js
2. Clique em **"Deploy"** (botão azul)
3. OU: Fazer `git push` no GitHub (auto-deploy)

### 6.2 Monitorar Build
1. Railway Dashboard → Logs
2. Procurar por:
   ```
   npm WARN deprecated...
   > cd backend && npm install && npm run build
   > tsc
   [DONE] Build completed
   ```

### 6.3 Monitorar Migrations
Logs devem mostrar:
```
Prisma Migrate: Running generated migrations...
✓ Generated migration from dev
✓ Applied migrations
```

### 6.4 Monitorar Start
Logs devem mostrar:
```
🚀 Servidor Lina X rodando na porta 3001
📊 Health check: http://localhost:3001/health
```

Se houver erro:
- Verificar logs completos
- Verificar todas as `DATABASE_URL` está definida
- Verificar `JWT_SECRET` está definida

---

## ✅ Passo 7: Validar Deploy (10 min)

### 7.1 Health Check
Abra no navegador:
```
https://SEU_DOMINIO_RAILWAY.up.railway.app/health
```

Resposta esperada:
```json
{
  "status": "OK",
  "timestamp": "2026-02-02T10:30:45.123Z",
  "version": "1.0.0"
}
```

### 7.2 Verificar Domínio Público
Railway → Settings → Domains:
- Domínio deve ser algo como: `linax-production-xxxx.up.railway.app`
- Anotar este domínio (será usado em vários lugares)

### 7.3 Acessar Frontend
```
https://SEU_DOMINIO_RAILWAY.up.railway.app/login.html
```

Página deve carregar (pode estar feia por falta de CSS - isso é normal em Railroad).

---

## 📱 Passo 8: Atualizar Frontend API URL (5 min)

### 8.1 Identificar a URL

A URL deve ser:
- **Sem** `http://localhost:3001`
- **Com** o domínio Railroad obtido
- **Formato:** `https://linax-production-xxxx.up.railway.app/api`

### 8.2 Editar api.js

Arquivo: `DESKTOPV2/api.js` (linha 1)

**Antes:**
```javascript
const API_BASE_URL = 'http://localhost:3001/api';
```

**Depois:**
```javascript
const API_BASE_URL = 'https://linax-production-xxxx.up.railway.app/api';
```

### 8.3 Commit e Push

```bash
cd C:\LinaX
git add DESKTOPV2/api.js
git commit -m "Atualizar API URL para produção Railway"
git push origin master
```

Railway fará **auto-deploy** automaticamente após o push.

---

## 🔐 Passo 9: Configurar Serviços Externos (15 min)

### 9.1 SendGrid Setup

#### Criar Conta
1. Acesse: https://sendgrid.com
2. Clique: **"Free"** → **"Sign Up"**
3. Preencha formulário (use seu email)

#### Criar API Key
1. Login no SendGrid
2. Settings → API Keys
3. Clique: **"Create API Key"**
   - Name: `LinaX Production`
   - Permissions: Full Access
4. **Copiar API Key** (salvar em lugar seguro)
5. Clique: **"Copy"**

#### Atualizar Railway
1. Railway Dashboard → Service → Variables
2. Cole em `SENDGRID_API_KEY`: Sua API key

#### Verificar Sender (Importante!)
1. SendGrid Dashboard → Settings → Sender Authentication
2. Clique: **"Verify a Single Sender"**
3. Preencha com seu email pessoal
4. Verifique seu email (confirmar link)

**Sem verificar, emails não funcionarão!**

#### Limitações Free Tier SendGrid
- 100 emails/dia
- Suficiente para: ~500 usuários/mês (2 emails cada)

---

### 9.2 Mercado Pago Webhooks

#### Configurar Webhook
1. Acesse: https://www.mercadopago.com.br/developers
2. Login com sua conta
3. Suas integrações → **Webhooks**
4. Clique: **"Adicionar novo webhook"**

#### Webhook Details
- **URL:** `https://SEU_DOMINIO_RAILWAY.up.railway.app/api/payments/webhook`
- **Eventos:** Selecionar:
  - `payment.created`
  - `payment.updated`
  - `subscription.created`
  - `subscription.updated`

#### Copiar Secret
- Após criar webhook, copiar: **Webhook ID** e **Secret key**
- Atualizar Railway: `MERCADO_PAGO_WEBHOOK_SECRET`

#### Testar Webhook
Use: https://requestbin.com para testar webhook primeiro.

---

## 🧪 Passo 10: Testes Completos (20 min)

### 10.1 Teste de Registro

1. Acesse: `https://SEU_DOMINIO_RAILWAY.up.railway.app/signup.html`
2. Preencha:
   - Email: seu_email@test.com
   - Senha: teste123
   - Nome: Teste User
3. Clique: "Criar Conta"
4. **Esperado:** Redirecionado para login
5. **Email:** Verificar se chegou email de boas-vindas

**Se não chegou email:**
- Verificar spam
- Verificar `SENDGRID_API_KEY` está correto no Railway
- Verificar sender foi verificado no SendGrid

### 10.2 Teste de Login

1. Acesse: `https://SEU_DOMINIO_RAILWAY.up.railway.app/login.html`
2. Preencha:
   - Email: seu_email@test.com
   - Senha: teste123
3. Clique: "Entrar"
4. **Esperado:** Tela de seleção de empresa

### 10.3 Teste de Empresa

1. Clique: "Criar Nova Empresa"
2. Preencha:
   - Nome: Lava Jato Teste
   - CNPJ: 00.000.000/0000-00
3. Clique: "Criar"
4. **Esperado:** Redirecionado para dashboard

### 10.4 Teste de Plano Gratuito

1. No dashboard, clique em: "Assinatura"
2. **Esperado:** Mostra plano "Gratuito" ativo
3. **Trial:** Deve mostrar dias restantes (default 7 dias)

### 10.5 Teste de CRUD Básico

#### Criar Cliente
1. Menu → "Clientes"
2. Clique: "+ Novo Cliente"
3. Preencha e salve
4. **Esperado:** Cliente aparece na lista

#### Criar Ordem
1. Menu → "Ordens"
2. Clique: "+ Nova Ordem"
3. Selecione cliente e serviço
4. Clique: "Criar"
5. **Esperado:** Ordem criada com status "Pendente"

### 10.6 Verificar Cron Jobs

1. Railway Dashboard → Logs
2. Procurar por:
   ```
   [CRON] Verificando ordens para finalização automática...
   [CRON] Verificando assinaturas expiradas...
   [CRON] Verificando avisos de trial...
   ```

**Logs devem aparecer automaticamente:**
- A cada 15 min (finalizações)
- A cada 6 horas (assinaturas)
- Diariamente às 09:00 (trial)

---

## 📊 Passo 11: Monitorar Performance (Contínuo)

### 11.1 Railway Metrics
Railway Dashboard → Metrics:
- **CPU:** Deve estar < 20% em repouso
- **Memory:** Deve estar 100-200 MB
- **Network:** Monitorar traffic
- **Requests:** Ver quantidade de requisições

### 11.2 Logs em Tempo Real
Railway Dashboard → Logs:
- Monitorar erros
- Monitorar rate limiting (se implementado)
- Monitorar performance

### 11.3 Uptime Monitoring (Recomendado)
Adicionar monitoring gratuito:

1. Acesse: https://uptimerobot.com
2. Sign up gratuito
3. Adicione monitor:
   - **Type:** HTTP(s)
   - **URL:** `https://SEU_DOMINIO_RAILWAY.app/health`
   - **Interval:** 5 minutos
4. Receberá alertas se site ficar down

---

## 🔧 Troubleshooting Comum

### Erro: Build Timeout
**Causa:** Build está levando muito tempo
**Solução:**
```bash
# Limpar cache local e rebuildar
cd C:\LinaX\backend
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Erro: DATABASE_URL not found
**Causa:** Variável não foi definida
**Solução:** Railway → PostgreSQL service → Variables → copiar DATABASE_URL para Node service

### Erro: JWT_SECRET not defined
**Causa:** Variável não foi definida
**Solução:** Railway → Service → Variables → adicionar JWT_SECRET

### Erro: CORS bloqueado
**Causa:** Frontend URL diferente do FRONTEND_URL env var
**Solução:** Verificar FRONTEND_URL com domínio correto

### Emails não chegam
**Causa:** SendGrid não configurado corretamente
**Solução:**
1. Verificar `SENDGRID_API_KEY`
2. Verificar sender verificado no SendGrid
3. Verificar se não atingiu 100 emails/dia
4. Checar spam folder

### Pagamentos retornam erro
**Causa:** Webhook não configurado
**Solução:**
1. Verificar webhook URL é HTTPS
2. Verificar domínio está correto
3. Testar webhook com RequestBin primeiro

---

## 🎯 Próximos Passos Após Deploy

### Imediato (Próximas 24h)
- [ ] Monitorar logs para erros
- [ ] Testar fluxo completo com 2-3 usuários
- [ ] Verificar emails chegando
- [ ] Conferir database storage

### Curto Prazo (1-7 dias)
- [ ] Convidar primeiros usuários beta
- [ ] Coletar feedback
- [ ] Ajustar performance se necessário
- [ ] Monitorar custos Railway

### Médio Prazo (2-4 semanas)
- [ ] Mercado Pago: Trocar TEST- por credenciais reais
- [ ] SendGrid: Upgrade se precisar > 100 emails/dia
- [ ] Custom domain: Registrar domínio próprio
- [ ] SSL/TLS: Railway já fornece automaticamente

---

## 💰 Custos Railway

### Free Tier ($5 créditos/mês)
- **Válido por:** 30 dias
- **Renovação:** Mensal automático
- **Uso estimado:**
  - Web Service: ~$2.5/mês (750h uptime)
  - PostgreSQL: ~$1.5/mês (256MB storage)
  - **Total:** ~$4/mês (dentro do free)

### Após Free Tier
Se precisar continuar:
- **Starter Plan:** $5/mês
- **Database upgrade:** +$2/mês por GB
- **Scaling:** Conforme necessário

### Economizar Créditos
- Parar o serviço quando não usar
- Limpar database antiga periodicamente
- Usar cron jobs eficientemente

---

## 🔒 Security Checklist

Antes de liberar para usuários reais:

- [x] JWT_SECRET novo e seguro (64+ caracteres)
- [x] BCRYPT_SALT_ROUNDS = 12
- [x] HTTPS ativo (Railway fornece automático)
- [x] CORS configurado para domínio production
- [x] Webhook Mercado Pago com secret validation
- [x] .env não commitado (verificar .gitignore)
- [ ] Rate limiting implementado (TODO: adicionar express-rate-limit)
- [x] Input validation nas rotas
- [x] SQL injection prevention (Prisma ORM)
- [x] XSS protection (não há user input em HTML)

---

## 📞 Suporte & Recursos

### Documentação
- Railway: https://docs.railway.app
- Prisma: https://www.prisma.io/docs/guides/deployment
- Mercado Pago: https://www.mercadopago.com.br/developers
- SendGrid: https://docs.sendgrid.com

### Community
- Railway Discord: https://discord.gg/railway
- Stack Overflow: tag [railway]
- GitHub Issues: https://github.com/EdwardIcaro/linalab/issues

### Ferramentas de Teste
- RequestBin: https://requestbin.com (testar webhooks)
- Postman: https://www.postman.com (testar API)
- Railway CLI: `npm i -g @railway/cli`

---

## ✅ Checklist Final

- [ ] Código commitado e pushed
- [ ] Projeto Railway criado
- [ ] PostgreSQL provisionado
- [ ] Todas env vars configuradas
- [ ] Build completado com sucesso
- [ ] Migrations aplicadas
- [ ] Health check respondendo
- [ ] Frontend carregando
- [ ] Registro funcionando
- [ ] Email sendo recebido
- [ ] Login funcionando
- [ ] CRUD básico testado
- [ ] Plano gratuito ativo
- [ ] Cron jobs rodando
- [ ] SendGrid verificado
- [ ] Mercado Pago webhook registrado
- [ ] Monitor uptime ativado

---

**Pronto para produção!** 🚀

Para dúvidas ou erros, consulte os logs do Railway ou a documentação acima.
