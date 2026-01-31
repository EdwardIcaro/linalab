# Como Começar com Mercado Pago - Quick Start

## 1️⃣ Obter Credenciais Sandbox (Teste)

1. Acesse https://www.mercadopago.com.br/developers/pt-BR/guides/resources/api/basics
2. Crie uma conta de teste (se ainda não tem)
3. Na área de "Aplicações", crie uma nova aplicação
4. Copie:
   - `Access Token` (comece com `APP_USR-`)
   - `Public Key` (comece com `APP_USR-`)
5. Configure o Webhook Secret no painel do Mercado Pago

## 2️⃣ Configurar Variáveis de Ambiente

Abra `C:\LinaX\backend\.env` e atualize:

```env
MERCADO_PAGO_ACCESS_TOKEN="APP_USR-sua_access_token_aqui"
MERCADO_PAGO_PUBLIC_KEY="APP_USR-sua_public_key_aqui"
MERCADO_PAGO_WEBHOOK_SECRET="seu_webhook_secret_aqui"
```

## 3️⃣ Iniciar o Servidor

```bash
cd C:\LinaX\backend
pnpm dev
```

Você verá algo como:
```
> backend@1.0.0 dev
> nodemon
[nodemon] watching path(s): src/**/*
[nodemon] watching extensions: ts,json
[nodemon] starting `ts-node ./src/index.ts`
Server is running on port 3001
```

## 4️⃣ Testar o Fluxo

### Via Frontend (Recomendado)

1. Abra http://localhost:3001/planos.html
2. Clique em um plano pago (ex: "Pro" ou "Premium")
3. Se não logado, faça login ou crie conta
4. Confirme a seleção do plano
5. Será redirecionado para checkout do Mercado Pago
6. Use um cartão de teste:
   - **Aprovado**: `5031 7557 3453 0604`, CVV: `123`, Exp: `11/25`
   - **Rejeitado**: `4509 9535 6623 3704`, CVV: `123`, Exp: `11/25`
7. Complete o pagamento
8. Será redirecionado para `/pagamento-retorno.html`
9. Verá o status: ✅ Sucesso, ❌ Erro, ou ⏳ Pendente

### Via cURL (Teste Manual)

```bash
# 1. Fazer login
curl -X POST http://localhost:3001/api/usuarios/login \
  -H "Content-Type: application/json" \
  -d '{"email":"seu@email.com","senha":"senha123"}'

# Copie o token da resposta

# 2. Criar preferência de pagamento
curl -X POST http://localhost:3001/api/payments/create-preference \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer seu_token_aqui" \
  -d '{"planId":"seu_plan_id_aqui"}'

# Resposta conterá:
# {
#   "preferenceId": "123456789",
#   "initPoint": "https://www.mercadopago.com.br/checkout/v1/...",
#   "publicKey": "APP_USR-..."
# }

# 3. Abrir a URL initPoint no navegador para fazer o pagamento
```

## 5️⃣ Verificar Webhook

O webhook deve ser testado para garantir que o pagamento é ativado corretamente.

### Testando localmente com ngrok

Se estiver testando localmente e precisa de HTTPS:

```bash
# 1. Instale ngrok: https://ngrok.com/download

# 2. Inicie ngrok (em outro terminal)
ngrok http 3001

# Você receberá algo como:
# Forwarding https://abc123.ngrok.io -> http://localhost:3001

# 3. Configure webhook URL no Mercado Pago:
# https://abc123.ngrok.io/api/payments/webhook

# 4. Agora webhooks locais funcionarão
```

### Verificar Logs

No terminal do servidor, você verá logs como:

```
[Payment] Preferência criada: 123456789 para subscription abc123
[Webhook] Payment 987654321 status: approved
[Subscription] Subscription ativada: abc123
✅ Email enviado para seu@email.com
```

## 6️⃣ Troubleshooting

### "Assinatura inválida" no webhook
- Verifique se `MERCADO_PAGO_WEBHOOK_SECRET` está correto
- No Mercado Pago, copie o secret exatamente como mostrado

### Pagamento não ativa subscription
- Verifique logs do servidor para mensagens de erro
- Se webhook não chegou, veja se URL está configurada corretamente
- Teste manualmente: `GET /api/payments/status/:paymentId`

### Email não foi enviado
- Verifique se `SENDGRID_API_KEY` está configurada
- Sem SendGrid, vê mensagem: "⚠️  SENDGRID_API_KEY não configurada"
- Verifique email do usuário está correto

### Preferência não foi criada
- Verifique se plano tem `preco > 0`
- Verifique se usuário não tem subscription ativa

## 7️⃣ Próximos Passos

Depois de testar e validar:

1. **Produção Mercado Pago**:
   - Atualize para credenciais de produção
   - Configure webhook URL de produção (HTTPS)

2. **Deploy**:
   - Deploy backend com variáveis de produção
   - Deploy frontend

3. **Monitoramento**:
   - Monitore logs de webhook
   - Configure alertas para falhas de pagamento

## 📞 Suporte

- **Documentação Mercado Pago**: https://www.mercadopago.com.br/developers/pt-BR
- **Status API**: https://status.mercadopago.com
- **Forum**: https://forum.mercadopago.com

## 🔗 Links Úteis

- [Dashboard Mercado Pago](https://www.mercadopago.com.br/home)
- [Gerenciar Aplicações](https://www.mercadopago.com.br/developers/pt-BR/guides/resources/api/basics)
- [Webhook Configuration](https://www.mercadopago.com.br/developers/pt-BR/guides/resources/webhooks/intro)
- [API Reference](https://www.mercadopago.com.br/developers/pt-BR/reference)

---

**Dica**: Se encontrar problemas, os logs do servidor (console) são seu melhor amigo! 🔍
