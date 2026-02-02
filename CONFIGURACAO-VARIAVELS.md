# Configuração de Variáveis de Ambiente - Railway

Referência completa para todas as variáveis de ambiente necessárias para deploy no LinaX.

---

## Configuração Rápida (Copy-Paste)

Copie todas as variáveis abaixo e cole no Railway Dashboard → Service → Variables:

```env
NODE_ENV=production
PORT=3001
JWT_SECRET=SUBSTITUA_POR_CHAVE_GERADA
BCRYPT_SALT_ROUNDS=12
SENDGRID_API_KEY=SG.SUBSTITUA_POR_SUA_CHAVE
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

## Referência Detalhada das Variáveis

### Configuração do Servidor

#### `NODE_ENV`
- **Valor:** `production`
- **Descrição:** Indica que está em produção (desabilita hotreload, ativa caching)
- **Obrigatória:** Sim

#### `PORT`
- **Valor:** `3001`
- **Descrição:** Porta de listen (Railway pode ignorar, mas é necessária)
- **Obrigatória:** Sim

---

### Configuração de Segurança

#### `JWT_SECRET`
- **Valor:** 64+ caracteres aleatórios
- **Como Gerar:**
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- **Descrição:** Chave para assinar e verificar JWT tokens
- **Obrigatória:** **SIM - App não funciona sem isso!**
- **Segurança:** Guardar com segurança, nunca compartilhar

**IMPORTANTE:** Gere uma chave NOVA para produção!

#### `BCRYPT_SALT_ROUNDS`
- **Valor:** `12`
- **Descrição:** Número de rounds para hash de senha
- **Obrigatória:** Sim
- **Range:** 10-15 (12 é recomendado)

---

### Configuração de Email (SendGrid)

#### `SENDGRID_API_KEY`
- **Valor:** `SG.xxxxxxxxxxxx`
- **Como Obter:**
  1. Criar conta em: https://sendgrid.com
  2. Dashboard → Settings → API Keys
  3. Create API Key (Full Access)
  4. Copy and paste aqui
- **Descrição:** Chave para enviar emails via SendGrid
- **Obrigatória:** Sim (para funcionalidade de email)
- **Free Tier:** 100 emails/dia

#### `EMAIL_FROM`
- **Valor:** `noreply@seudominio.com`
- **Descrição:** Email que aparece no "From:" dos emails
- **Obrigatória:** Sim
- **Importante:** Deve ser verificado no SendGrid (Sender Verification)

---

### Configuração de Frontend

#### `FRONTEND_URL`
- **Valor:** `${{RAILWAY_PUBLIC_DOMAIN}}` (será substituído automaticamente)
- **Exemplo Result:** `https://linax-production-xxxx.up.railway.app`
- **Descrição:** URL pública do aplicativo (usado em emails, CORS, etc)
- **Obrigatória:** Sim
- **Nota:** Use a variável Railway `${{RAILWAY_PUBLIC_DOMAIN}}` para auto-update

---

### Configuração de Mercado Pago

#### `MERCADO_PAGO_ACCESS_TOKEN`
- **Para Testes:** `TEST-5277956129999284-013022-a0433da8a4d2e282840ab5a3cd96efa0-182616510`
- **Para Produção:** Obter em https://www.mercadopago.com.br/developers
- **Descrição:** Token para autenticar nas APIs do Mercado Pago
- **Obrigatória:** Sim

#### `MERCADO_PAGO_PUBLIC_KEY`
- **Para Testes:** `TEST-2e6d0347-0e5c-40fe-8502-b371cd766ee2`
- **Para Produção:** Obter em https://www.mercadopago.com.br/developers
- **Descrição:** Chave pública para integração frontend
- **Obrigatória:** Sim

#### `MERCADO_PAGO_WEBHOOK_SECRET`
- **Valor:** `db9ff2381b84a19f9c3ddd8e9e7fdf864277b6f65f4a12008a9ed1b3203e1b16`
- **Como Obter:**
  1. Acessar: https://www.mercadopago.com.br/developers
  2. Suas integrações → Webhooks
  3. Adicionar webhook com URL: `https://SEU_DOMINIO/api/payments/webhook`
  4. Copiar Secret key gerado
- **Descrição:** Secret para validar webhook requests do Mercado Pago
- **Obrigatória:** Sim

---

### URLs de Retorno de Pagamento

#### `PAYMENT_SUCCESS_URL`
- **Valor:** `${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html`
- **Descrição:** URL para redirecionar após pagamento bem-sucedido
- **Obrigatória:** Sim (para fluxo de pagamento)

#### `PAYMENT_FAILURE_URL`
- **Valor:** `${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html`
- **Descrição:** URL para redirecionar após falha de pagamento
- **Obrigatória:** Sim (para fluxo de pagamento)

#### `PAYMENT_PENDING_URL`
- **Valor:** `${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html`
- **Descrição:** URL para redirecionar após pagamento pendente
- **Obrigatória:** Sim (para fluxo de pagamento)

---

## Setup Passo-a-Passo

### 1. Gerar JWT_SECRET

No seu terminal local (não no Railway):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Exemplo de output:
```
a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0
```

Copie este valor para `JWT_SECRET` no Railway.

### 2. Criar Conta SendGrid

1. Acesse: https://sendgrid.com
2. Clique em "Free" ou "Sign Up"
3. Preencha formulário com seu email
4. Verifique seu email (confirme a conta)
5. Na dashboard:
   - Settings → API Keys
   - Clique "Create API Key"
   - Name: `LinaX Production`
   - Permissions: Full Access
   - Click "Create & Copy"
6. Copie a chave gerada

### 3. Configurar SendGrid Sender

**IMPORTANTE:** Sem isso, emails não funcionarão!

1. No SendGrid Dashboard:
   - Settings → Sender Authentication
   - Clique em "Verify a Single Sender"
2. Preencha:
   - From Name: `LinaX`
   - Email Address: seu_email@dominio.com
3. Clique "Create"
4. **Verifique seu email** (confirme o link)

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

### 5. Adicionar Variáveis ao Railway

1. Railway Dashboard → Seu Projeto
2. Clique no Service Node.js
3. Clique em "Variables"
4. Cole todas as variáveis do "Configuração Rápida" acima
5. Substitua os placeholders com seus valores reais:
   - `JWT_SECRET`: Cole a chave gerada
   - `SENDGRID_API_KEY`: Cole a chave do SendGrid
   - `MERCADO_PAGO_WEBHOOK_SECRET`: Cole a secret do Mercado Pago
6. Clique "Save" ou enter para salvar cada uma

### 6. Verificar Configuração

Após adicionar as variáveis:

1. Railway → Service → "Deploy" (botão azul)
2. Esperar deploy terminar
3. Verificar Logs para erros
4. Testar health check: `https://seu-dominio/health`

---

## Variáveis Auto-Substituídas pelo Railway

Railway fornece algumas variáveis que são auto-substituídas:

### `${{RAILWAY_PUBLIC_DOMAIN}}`
- **Auto-filled by Railway**
- **Exemplo:** `https://linax-production-xxxx.up.railway.app`
- **Updated:** Automaticamente quando domínio muda
- **Use case:** FRONTEND_URL, PAYMENT_*_URL

### `${{RAILWAY_POSTGRESQL_URL}}`
- **Auto-filled by Railway**
- **Used for:** DATABASE_URL
- **Already connected:** Não precisa fazer nada

---

## Testando as Variáveis

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

### Verificar Logs para Erros
Railway Dashboard → Logs:
- Procurar por `JWT_SECRET` error (se houver, significa que a variável não está definida)
- Procurar por `SENDGRID_API_KEY` error
- Procurar por `DATABASE_URL` error

---

## Troubleshooting de Variáveis

### Error: "JWT_SECRET is required"
- **Solução:** Verificar se `JWT_SECRET` está definida no Railway
- **Verificar:** Railway → Service → Variables

### Error: "SENDGRID_API_KEY is not valid"
- **Solução:** Copiar novamente a chave do SendGrid
- **Verificar:** SendGrid não deve ter espaços no começo/fim

### Error: "DATABASE_URL connection failed"
- **Solução:** Verificar se PostgreSQL foi adicionado ao projeto
- **Verificar:** Railway → PostgreSQL Service → está rodando?

### Error: "CORS blocked origin"
- **Solução:** Verificar FRONTEND_URL está correto
- **Verificar:** Deve começar com `https://`

---

## Notas Importantes

1. **Nunca faça commit de .env** - Seu .gitignore deve incluir `.env`
2. **Use Railway secrets** - Não coloque secrets no código ou git
3. **Rote secrets periodicamente** - Especialmente JWT_SECRET e API keys
4. **Guarde backups** - Anote suas chaves em lugar seguro
5. **Teste em sandbox primeiro** - Use TEST- credentials do Mercado Pago

---

## Tabela de Referência Rápida

| Variável | Obrigatória | Tipo | Fonte |
|----------|------------|------|-------|
| NODE_ENV | Sim | Fixo | `production` |
| PORT | Sim | Fixo | `3001` |
| JWT_SECRET | Sim | Gerar | `node crypto.randomBytes(64)` |
| BCRYPT_SALT_ROUNDS | Sim | Fixo | `12` |
| SENDGRID_API_KEY | Sim | SendGrid | SendGrid Dashboard |
| EMAIL_FROM | Sim | Custom | Seu domínio |
| FRONTEND_URL | Sim | Auto | `${{RAILWAY_PUBLIC_DOMAIN}}` |
| MERCADO_PAGO_* | Sim | Mercado Pago | Developers.mercadopago |
| PAYMENT_*_URL | Sim | Auto | `${{RAILWAY_PUBLIC_DOMAIN}}/...` |

---

**Última Atualização:** 2026-02-02
**Status:** Pronto para Produção
