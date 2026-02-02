# Railway Environment Variables Setup

Complete reference for all environment variables needed for LinaX deployment on Railway.

---

## Quick Copy-Paste Configuration

Copy all variables below and paste in Railway Dashboard → Service → Variables:

```env
NODE_ENV=production
PORT=3001
JWT_SECRET=REPLACE_WITH_GENERATED_SECRET_HERE
BCRYPT_SALT_ROUNDS=12
SENDGRID_API_KEY=SG.REPLACE_WITH_YOUR_KEY
EMAIL_FROM=noreply@yourdomain.com
FRONTEND_URL=${{RAILWAY_PUBLIC_DOMAIN}}
MERCADO_PAGO_ACCESS_TOKEN=TEST-5277956129999284-013022-a0433da8a4d2e282840ab5a3cd96efa0-182616510
MERCADO_PAGO_PUBLIC_KEY=TEST-2e6d0347-0e5c-40fe-8502-b371cd766ee2
MERCADO_PAGO_WEBHOOK_SECRET=db9ff2381b84a19f9c3ddd8e9e7fdf864277b6f65f4a12008a9ed1b3203e1b16
PAYMENT_SUCCESS_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
PAYMENT_FAILURE_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
PAYMENT_PENDING_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
```

---

## Detailed Variable Reference

### Server Configuration

#### `NODE_ENV`
- **Value:** `production`
- **Description:** Indica que está em produção (desabilita hotreload, ativa caching)
- **Required:** Yes

#### `PORT`
- **Value:** `3001`
- **Description:** Porta de listen (Railway pode ignorar, mas é necessária)
- **Required:** Yes

---

### Security Configuration

#### `JWT_SECRET`
- **Value:** 64+ caracteres aleatórios
- **How to Generate:**
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- **Description:** Chave para assinar e verificar JWT tokens
- **Required:** YES - App não funciona sem isso!
- **Security:** Guardar com segurança, nunca compartilhar

**IMPORTANTE:** Generate uma chave NEW para produção!

#### `BCRYPT_SALT_ROUNDS`
- **Value:** `12`
- **Description:** Número de rounds para hash de senha
- **Required:** Yes
- **Range:** 10-15 (12 é recomendado)

---

### Email Configuration (SendGrid)

#### `SENDGRID_API_KEY`
- **Value:** `SG.xxxxxxxxxxxx`
- **How to Get:**
  1. Criar conta em: https://sendgrid.com
  2. Dashboard → Settings → API Keys
  3. Create API Key (Full Access)
  4. Copy and paste aqui
- **Description:** Chave para enviar emails via SendGrid
- **Required:** Yes (for email functionality)
- **Free Tier:** 100 emails/dia

#### `EMAIL_FROM`
- **Value:** `noreply@yourdomain.com`
- **Description:** Email que aparece no "From:" dos emails
- **Required:** Yes
- **Important:** Deve ser verificado no SendGrid (Sender Verification)

---

### Frontend Configuration

#### `FRONTEND_URL`
- **Value:** `${{RAILWAY_PUBLIC_DOMAIN}}` (será substituído automaticamente)
- **Example Result:** `https://linax-production-xxxx.up.railway.app`
- **Description:** URL pública do aplicativo (usado em emails, CORS, etc)
- **Required:** Yes
- **Note:** Use a Railway variable `${{RAILWAY_PUBLIC_DOMAIN}}` para auto-update

---

### Mercado Pago Configuration

#### `MERCADO_PAGO_ACCESS_TOKEN`
- **For Testing:** `TEST-5277956129999284-013022-a0433da8a4d2e282840ab5a3cd96efa0-182616510`
- **For Production:** Obter em https://www.mercadopago.com.br/developers
- **Description:** Token para autenticar nas APIs do Mercado Pago
- **Required:** Yes

#### `MERCADO_PAGO_PUBLIC_KEY`
- **For Testing:** `TEST-2e6d0347-0e5c-40fe-8502-b371cd766ee2`
- **For Production:** Obter em https://www.mercadopago.com.br/developers
- **Description:** Chave pública para integração frontend
- **Required:** Yes

#### `MERCADO_PAGO_WEBHOOK_SECRET`
- **Value:** `db9ff2381b84a19f9c3ddd8e9e7fdf864277b6f65f4a12008a9ed1b3203e1b16`
- **How to Get:**
  1. Acessar: https://www.mercadopago.com.br/developers
  2. Suas integrações → Webhooks
  3. Adicionar webhook com URL: `https://SEU_DOMINIO/api/payments/webhook`
  4. Copiar Secret key gerado
- **Description:** Secret para validar webhook requests do Mercado Pago
- **Required:** Yes

---

### Payment Callback URLs

#### `PAYMENT_SUCCESS_URL`
- **Value:** `${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html`
- **Description:** URL para redirecionar após pagamento bem-sucedido
- **Required:** Yes (for payment flow)

#### `PAYMENT_FAILURE_URL`
- **Value:** `${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html`
- **Description:** URL para redirecionar após falha de pagamento
- **Required:** Yes (for payment flow)

#### `PAYMENT_PENDING_URL`
- **Value:** `${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html`
- **Description:** URL para redirecionar após pagamento pendente
- **Required:** Yes (for payment flow)

---

## Setup Step-by-Step

### 1. Generate JWT_SECRET

No seu terminal local (não no Railway):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Exemplo de output:
```
a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0
```

Copie este valor para `JWT_SECRET` no Railway.

### 2. Create SendGrid Account

1. Acesse: https://sendgrid.com
2. Clique em "Free" ou "Sign Up"
3. Preencha formulário com seu email
4. Verifique seu email (confirme conta)
5. Na dashboard:
   - Settings → API Keys
   - Clique "Create API Key"
   - Name: `LinaX Production`
   - Permissions: Full Access
   - Click "Create & Copy"
6. Copie a chave gerada

### 3. Configure SendGrid Sender

**IMPORTANTE:** Sem isso, emails não funcionarão!

1. No SendGrid Dashboard:
   - Settings → Sender Authentication
   - Clique em "Verify a Single Sender"
2. Preencha:
   - From Name: `LinaX`
   - Email Address: seu_email@dominio.com
3. Clique "Create"
4. Verifique seu email (confirme o link)

### 4. Setup Mercado Pago Webhook

1. Acesse: https://www.mercadopago.com.br/developers
2. Login com sua conta Mercado Pago
3. Menu: "Suas integrações" → "Webhooks"
4. Clique em "Adicionar novo webhook"
5. Preencha:
   - URL: `https://SEU_DOMINIO_RAILWAY/api/payments/webhook`
   - Events: Selecione todos (ou pelo menos payment.updated)
6. Clique "Criar"
7. Copie o "Secret key" gerado
8. Cole em `MERCADO_PAGO_WEBHOOK_SECRET` no Railway

### 5. Add Variables to Railway

1. Railway Dashboard → Seu Projeto
2. Clique no Service Node.js
3. Clique em "Variables"
4. Cole todas as variáveis do "Quick Copy-Paste" acima
5. Substitua os placeholders com seus valores reais:
   - `JWT_SECRET`: Cole a chave gerada
   - `SENDGRID_API_KEY`: Cole a chave do SendGrid
   - `MERCADO_PAGO_WEBHOOK_SECRET`: Cole a secret do Mercado Pago
6. Clique "Save" ou enter para salvar cada uma

### 6. Verify Configuration

Após adicionar as variáveis:

1. Railway → Service → "Deploy" (botão azul)
2. Esperar deploy terminar
3. Verificar Logs para erros
4. Testar health check: `https://seu-dominio/health`

---

## Railway Auto-Substitution Variables

Railway fornece algumas variáveis que são auto-substituídas:

### `${{RAILWAY_PUBLIC_DOMAIN}}`
- **Auto-filled by Railway**
- **Example:** `https://linax-production-xxxx.up.railway.app`
- **Updated:** Automaticamente quando domínio muda
- **Use case:** FRONTEND_URL, PAYMENT_*_URL

### `${{RAILWAY_POSTGRESQL_URL}}`
- **Auto-filled by Railway**
- **Used for:** DATABASE_URL
- **Already connected:** Não precisa fazer nada

---

## Testing Variables

Para testar se as variáveis estão corretas:

### Health Check
```bash
curl https://SEU_DOMINIO_RAILWAY.up.railway.app/health
```

Response esperada:
```json
{
  "status": "OK",
  "timestamp": "2026-02-02T10:30:45.123Z",
  "version": "1.0.0"
}
```

### Check Logs for Errors
Railway Dashboard → Logs:
- Procurar por `JWT_SECRET` error (se houver, significa que a variável não está definida)
- Procurar por `SENDGRID_API_KEY` error
- Procurar por `DATABASE_URL` error

---

## Troubleshooting

### Error: "JWT_SECRET is required"
- Solução: Verificar se `JWT_SECRET` está definida no Railway
- Verificar: Railway → Service → Variables

### Error: "SENDGRID_API_KEY is not valid"
- Solução: Copiar novamente a chave do SendGrid
- Verificar: SendGrid não deve ter espaços no começo/fim

### Error: "DATABASE_URL connection failed"
- Solução: Verificar se PostgreSQL foi adicionado ao projeto
- Verificar: Railway → PostgreSQL Service → está rodando?

### Error: "CORS blocked origin"
- Solução: Verificar FRONTEND_URL está correto
- Verificar: Deve começar com `https://`

---

## Important Notes

1. **Never commit .env files** - Seu .gitignore deve incluir `.env`
2. **Use Railway secrets** - Não coloque secrets no código ou git
3. **Rotate secrets periodically** - Especialmente JWT_SECRET e API keys
4. **Keep backups** - Anotar suas chaves em lugar seguro
5. **Test in sandbox first** - Use TEST- credentials do Mercado Pago

---

## Quick Reference Table

| Variable | Required | Type | Source |
|----------|----------|------|--------|
| NODE_ENV | Yes | Fixed | `production` |
| PORT | Yes | Fixed | `3001` |
| JWT_SECRET | Yes | Generate | `node crypto.randomBytes(64)` |
| BCRYPT_SALT_ROUNDS | Yes | Fixed | `12` |
| SENDGRID_API_KEY | Yes | SendGrid | SendGrid Dashboard |
| EMAIL_FROM | Yes | Custom | Your domain |
| FRONTEND_URL | Yes | Auto | `${{RAILWAY_PUBLIC_DOMAIN}}` |
| MERCADO_PAGO_* | Yes | Mercado Pago | Developers.mercadopago |
| PAYMENT_*_URL | Yes | Auto | `${{RAILWAY_PUBLIC_DOMAIN}}/...` |

---

**Last Updated:** 2026-02-02
**Status:** Ready for Production
