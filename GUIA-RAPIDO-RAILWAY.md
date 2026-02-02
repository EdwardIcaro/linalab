# 🚀 Deploy Rápido Railway - 15 Minutos

Guia ultra-condensado de deployment. Leia GUIA-COMPLETO-RAILWAY.md para detalhes completos.

---

## 1. Abra Railway (1 min)
- https://railway.app
- Faça login com GitHub
- Clique em "New Project" → "Deploy from GitHub repo"
- Selecione: `EdwardIcaro/linalab`

---

## 2. Adicione PostgreSQL (1 min)
- Clique em: "+ New" → "Database" → "PostgreSQL"
- Aguarde provisionamento (auto-adiciona DATABASE_URL)

---

## 3. Configure Variáveis (3 min)

Vá para: **Service (Node.js) → Variables**

**Gere JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Copie e cole estas variáveis:**
```
NODE_ENV=production
PORT=3001
JWT_SECRET=[COLE_CHAVE_GERADA_AQUI]
BCRYPT_SALT_ROUNDS=12
SENDGRID_API_KEY=SG.obtenha_do_sendgrid
EMAIL_FROM=noreply@seudominio.com
FRONTEND_URL=${{RAILWAY_PUBLIC_DOMAIN}}
MERCADO_PAGO_ACCESS_TOKEN=TEST-5277956129999284-013022-a0433da8a4d2e282840ab5a3cd96efa0-182616510
MERCADO_PAGO_PUBLIC_KEY=TEST-2e6d0347-0e5c-40fe-8502-b371cd766ee2
MERCADO_PAGO_WEBHOOK_SECRET=db9ff2381b84a19f9c3ddd8e9e7fdf864277b6f65f4a12008a9ed1b3203e1b16
PAYMENT_SUCCESS_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
PAYMENT_FAILURE_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
PAYMENT_PENDING_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
```

---

## 4. Faça Deploy (1 min)
- Clique: "Deploy" (botão azul)
- Aguarde a build completar (5-10 min)
- Verifique os logs para erros

---

## 5. Obtenha o Domínio (1 min)
- Service → Settings → Domains
- Copie: `linax-production-xxxx.up.railway.app`

---

## 6. Configure SendGrid (3 min)

1. https://sendgrid.com → Crie uma conta (grátis)
2. Settings → API Keys → Create API Key
3. Copie a chave em Railway: `SENDGRID_API_KEY`
4. **IMPORTANTE:** Settings → Sender Authentication → Verify Single Sender (use seu email)

---

## 7. Atualize URL do Frontend (1 min)

Arquivo: `DESKTOPV2/api.js` linha 1
```javascript
const API_BASE_URL = 'https://linax-production-xxxx.up.railway.app/api';
```

Commit:
```bash
git add DESKTOPV2/api.js
git commit -m "Atualizar URL da API para produção"
git push
```

Railway faz auto-deploy. Aguarde ~5 min.

---

## 8. Teste (2 min)

Abra no navegador:
```
https://linax-production-xxxx.up.railway.app/login.html
```

1. Crie uma conta de teste
2. Verifique o email (deve chegar em 30s)
3. Faça login
4. Crie uma empresa
5. Crie um cliente
6. Crie uma ordem

---

## 9. Configure Webhook Mercado Pago (2 min)

1. https://www.mercadopago.com.br/developers
2. Suas integrações → Webhooks
3. Adicione webhook:
   - URL: `https://linax-production-xxxx.up.railway.app/api/payments/webhook`
   - Eventos: payment.*, subscription.*
4. Copie a secret → Railway: `MERCADO_PAGO_WEBHOOK_SECRET`

---

## ✅ Pronto!

Seu sistema agora está vivo em:
```
https://linax-production-xxxx.up.railway.app
```

---

## Referência Rápida

| Tarefa | URL |
|--------|-----|
| App | `https://linax-production-xxxx.up.railway.app` |
| Health Check | `https://linax-production-xxxx.up.railway.app/health` |
| Admin | `https://linax-production-xxxx.up.railway.app/admin/dashboard.html` |
| SendGrid | https://sendgrid.com |
| Mercado Pago | https://www.mercadopago.com.br/developers |
| Railway | https://railway.app |

---

## Troubleshooting Rápido

| Problema | Solução |
|----------|---------|
| Build falha | Verifique logs. Verifique package.json. Tente: `npm install && npm run build` |
| DB não conecta | Verifique PostgreSQL existe. Verifique DATABASE_URL. Reinicie serviço. |
| Emails não enviam | Verifique SENDGRID_API_KEY. Verifique sender verificado. Verifique quota. |
| API retorna 401 | Verifique JWT_SECRET configurado. Verifique token em localStorage. |
| Webhook pagamento não funciona | Verifique webhook URL é HTTPS. Verifique domínio acessível. Verifique secret. |
| Não consegue fazer login | Verifique email/senha corretos. Verifique database tem usuário. Verifique logs. |

---

**Guia Completo:** GUIA-COMPLETO-RAILWAY.md
**Testes:** TESTES-VALIDACAO.md
**Referência Env:** CONFIGURACAO-VARIAVELS.md

Para problemas: Verifique os logs do Railway primeiro, depois a documentação.

---

**Status:** 🟢 Pronto para Deploy
**Tempo Economizado:** ~2 horas vs setup manual
**Custo:** $0 primeiro mês, $5-10/mês depois (se necessário)

Faça o deploy agora! 🚀
