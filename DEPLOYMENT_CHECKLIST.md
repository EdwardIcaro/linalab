# Checklist de Deploy - Mercado Pago Integration

## ✅ Pre-Deploy (Antes de Deploy)

### Backend
- [ ] Testar localmente com cartões sandbox
- [ ] Verificar todos os 4 endpoints de payment:
  - [ ] POST /api/payments/create-preference
  - [ ] POST /api/payments/webhook
  - [ ] GET /api/payments/status/:paymentId
  - [ ] POST /api/payments/retry-payment
- [ ] Testar webhook com ngrok ou outro tunneling
- [ ] Verificar logs de erro
- [ ] Confirmar database migrations foram aplicadas
- [ ] Validar que SubscriptionPayment está sendo criado

### Frontend
- [ ] Testar fluxo completo:
  - [ ] Login → Planos → Selecionar Pago → Checkout MP → Retorno
  - [ ] Verificar states (loading, success, error, pending)
  - [ ] Verificar emails são enviados (ou simulados)
- [ ] Testar mobile responsiveness em /pagamento-retorno.html
- [ ] Testar com JavaScript desabilitado (graceful degradation)

### Emails
- [ ] [ ] Configurar SENDGRID_API_KEY (ou similar)
- [ ] Testar sendPaymentSuccessEmail
- [ ] Testar sendPaymentFailedEmail
- [ ] Verificar sender email está registrado

## 📋 Production Setup

### 1. Mercado Pago Credenciais (Production)

- [ ] Fazer upgrade da conta para produção
- [ ] Obter credenciais de produção (não sandbox!)
- [ ] Copiar Access Token
- [ ] Copiar Public Key
- [ ] Gerar novo Webhook Secret
- [ ] Salvar credentials em local seguro (password manager)

### 2. Environment Variables

Atualizar `.env` em PRODUÇÃO com:

```bash
# Production
MERCADO_PAGO_ACCESS_TOKEN="APP_USR-[production-token]"
MERCADO_PAGO_PUBLIC_KEY="APP_USR-[production-key]"
MERCADO_PAGO_WEBHOOK_SECRET="[production-secret]"

# URLs de retorno HTTPS
PAYMENT_SUCCESS_URL="https://seudominio.com/pagamento-retorno.html"
PAYMENT_FAILURE_URL="https://seudominio.com/pagamento-retorno.html"
PAYMENT_PENDING_URL="https://seudominio.com/pagamento-retorno.html"

# Backend URL para webhook
BACKEND_URL="https://seudominio.com"

# SendGrid
SENDGRID_API_KEY="SG.[sua-chave]"
EMAIL_FROM="noreply@seudominio.com"

# Frontend
FRONTEND_URL="https://seudominio.com"
```

### 3. Mercado Pago Dashboard Configuration

- [ ] Acessar https://www.mercadopago.com.br/home
- [ ] Ir em Configurações → Webhooks
- [ ] Adicionar webhook URL: `https://seudominio.com/api/payments/webhook`
- [ ] Selecionar eventos: `payment.created`, `payment.updated`
- [ ] Copiar Webhook Secret e salvar em `.env`
- [ ] Testar webhook (Mercado Pago fornece botão de teste)

### 4. HTTPS/SSL

- [ ] Certificado SSL válido instalado
- [ ] Redirect HTTP → HTTPS funcionando
- [ ] Mercado Pago só aceita webhooks HTTPS em produção

### 5. Backend Deployment

```bash
cd C:\LinaX\backend

# Build
pnpm build

# Verificar se build foi bem-sucedido
npm test 2>/dev/null || echo "Tests skipped"

# Em produção, execute:
export NODE_ENV=production
node dist/index.js
```

- [ ] Build compila sem erros
- [ ] Banco de dados está acessível
- [ ] Migrations foram executadas
- [ ] Server inicia sem erros

### 6. Frontend Deployment

- [ ] Copiar arquivos para servidor web:
  - [ ] pagamento-retorno.html
  - [ ] planos.html (atualizado)
  - [ ] login.html (atualizado)
  - [ ] Todos os outros arquivos

- [ ] Verificar que URLs de API apontam para produção
- [ ] Verificar CORS está correto

### 7. Database

- [ ] Backup do banco antes de deploy
- [ ] Executar migrations: `pnpm prisma db push --skip-generate`
- [ ] Verificar que novos enums estão no banco:
  - [ ] SubscriptionStatus.PENDING
  - [ ] SubscriptionStatus.PAYMENT_FAILED

### 8. Logs e Monitoramento

- [ ] Configurar logging centralizado (ex: Sentry, LogRocket)
- [ ] Alertas para erros críticos
- [ ] Alertas para webhooks falhados
- [ ] Monitorar taxa de conversão pagamento

### 9. Testes de Produção

Fazer UM teste real (com valor pequeno):

- [ ] Completar fluxo inteiro com pagamento real
- [ ] Verificar subscription foi ativada
- [ ] Verificar email foi recebido
- [ ] Verificar webhook foi processado
- [ ] Verificar status de pagamento correto
- [ ] Verificar usuário pode criar empresa

## 🔍 Post-Deploy Verification

### Primeira Hora

- [ ] Verificar logs do servidor (sem erros críticos)
- [ ] Testar endpoint de health: GET /health
- [ ] Testar criar preferência de pagamento
- [ ] Verificar webhook está sendo recebido

### Primeiro Dia

- [ ] Monitorar conversão de usuários pagos
- [ ] Verificar não há erros recorrentes
- [ ] Validar emails de sucesso/falha estão sendo enviados
- [ ] Verificar performance de endpoints de payment

### Primeira Semana

- [ ] Revisar estatísticas de pagamento no Mercado Pago
- [ ] Calcular taxa de aprovação de pagamentos
- [ ] Identificar problemas comuns
- [ ] Documentar casos de erro e soluções

## 🚨 Rollback Plan

Se algo der errado:

1. **Parar novos pagamentos**:
   ```bash
   # Desabilitar endpoint de preferência
   # (comentar rota temporariamente)
   ```

2. **Redirecionar para trial/antigo fluxo**:
   - Atualizar planos.html para não oferecer planos pagos
   - Desabilitar rota de payment endpoints

3. **Investigar logs**:
   - Backend logs
   - Webhook logs do Mercado Pago
   - Database logs

4. **Revert de código**:
   ```bash
   git revert <commit-hash>
   git push
   ```

5. **Restaurar banco se necessário**:
   ```bash
   # Restaurar backup
   pg_restore -d linax backup.dump
   ```

## 📊 Métricas para Monitorar

Após deploy, acompanhe:

### Negócio
- [ ] Conversão trial → plano pago
- [ ] Taxa de aprovação de pagamentos
- [ ] Receita por plano
- [ ] Churn rate (cancelamentos)

### Técnico
- [ ] Latência de endpoints de payment
- [ ] Taxa de erro de webhook
- [ ] Taxa de retenta de pagamentos
- [ ] Tempo de resposta de `/api/payments/status`

### Qualidade
- [ ] Satisfação do usuário (feedback)
- [ ] Issues de pagamento reportadas
- [ ] Emails chegando corretamente
- [ ] Suporte recebendo reclamações

## 🔐 Security Checklist

- [ ] Webhooks validados com HMAC-SHA256
- [ ] Access Token não exposto em logs
- [ ] Webhook Secret não exposto em código
- [ ] Dados de pagamento não armazenados (PCI compliance)
- [ ] HTTPS obrigatório em produção
- [ ] Rate limiting em endpoints sensíveis

## 📞 Contatos Importantes

- **Mercado Pago Support**: https://forum.mercadopago.com
- **Status Page**: https://status.mercadopago.com
- **Seu DevOps**: [inserir contato]
- **PO/Produto**: [inserir contato]

## ✍️ Assinatura de Aprovação

Deploy aprovado por:
- [ ] Tech Lead: _____________ Data: _______
- [ ] Product Owner: _________ Data: _______
- [ ] QA: ____________________ Data: _______

---

**Nota**: Este checklist foi criado em 30/01/2026 para a implementação Mercado Pago. Atualize conforme necessário para sua infraestrutura específica.
