# 🧪 Guia de Testes - Validação Pós-Deployment

Checklist completo de testes para validar o deployment do LinaX no Railway.

---

## ✅ Setup Pré-Testes

Antes de executar testes, certifique-se que:

- [ ] Deploy completou com sucesso no Railway
- [ ] Todas as variáveis de ambiente estão configuradas
- [ ] PostgreSQL database está rodando
- [ ] Health check respondendo
- [ ] SendGrid conta verificada e pronta
- [ ] Mercado Pago sandbox credentials configuradas

---

## Fase 1: Testes de Infraestrutura (5 minutos)

### Teste 1.1: Health Check Endpoint

**Objetivo:** Verificar se API está respondendo

```bash
curl https://SEU_DOMINIO_RAILWAY.up.railway.app/health
```

**Resposta Esperada:**
```json
{
  "status": "OK",
  "timestamp": "2026-02-02T10:30:45.123Z",
  "version": "1.0.0"
}
```

**O que verificar:**
- [ ] Status code é 200
- [ ] Response tem formato JSON correto
- [ ] Timestamp é atual (dentro de 1 minuto)

**Se falhar:**
- Verificar logs do Railway
- Verificar variável PORT está configurada
- Verificar todas as dependências instaladas

### Teste 1.2: Conexão com Banco de Dados

**Objetivo:** Verificar PostgreSQL está conectado

**Via API - Criar usuário teste:**
1. Executar signup endpoint (ver Teste 2.1)
2. Logs do Railway não devem mostrar erros de conexão
3. Verificar logs para: `prisma` ou `database` errors

**Esperado:** Sem erros de conexão database

**Se falhar:**
- Verificar DATABASE_URL está configurada no Railway
- Verificar se PostgreSQL service está rodando
- Verificar credenciais estão corretas

### Teste 1.3: Arquivos Estáticos do Frontend

**Objetivo:** Verificar frontend está sendo servido

Abra no navegador:
```
https://SEU_DOMINIO_RAILWAY.up.railway.app/login.html
```

**Esperado:**
- [ ] Página carrega (pode não ter estilos completos)
- [ ] Elementos HTML visíveis
- [ ] Sem erros 404

**Se falhar:**
- Verificar se pasta DESKTOPV2 existe no repo
- Verificar caminho frontend em index.ts
- Verificar permissões dos arquivos

---

## Fase 2: Testes de Autenticação (10 minutos)

### Teste 2.1: Registro de Usuário

**Objetivo:** Verificar criação de usuário e envio de email

**Passos:**
1. Abra: `https://SEU_DOMINIO_RAILWAY.up.railway.app/signup.html`
2. Preencha formulário:
   - Email: `teste.usuario.1@example.com`
   - Senha: `TestPassword123!`
   - Confirmar Senha: `TestPassword123!`
   - Nome: `Teste User`
3. Clique "Criar Conta"
4. **Esperado:** Redirecionado para página de login

**O que verificar:**
- [ ] Página redireciona após signup
- [ ] Sem mensagens de erro
- [ ] Pode prosseguir para login

**Verificação de Email:**
1. Verificar inbox do email registrado
2. **Esperado:** Email de boas-vindas do LinaX
3. Se não receber:
   - Verificar pasta spam
   - Aguardar 30 segundos
   - Verificar logs do SendGrid no Railway

**Se registro falha:**
- Verificar API endpoint: `POST /api/usuarios/register`
- Verificar logs para validation errors
- Verificar todos os campos foram preenchidos
- Verificar DATABASE_URL

**Se email não é enviado:**
- Verificar SENDGRID_API_KEY está configurada
- Verificar EMAIL_FROM está configurada
- Verificar sender foi verificado no SendGrid
- Verificar quota SendGrid (100/dia free)

### Teste 2.2: Login de Usuário

**Objetivo:** Verificar autenticação funciona

**Passos:**
1. Abra: `https://SEU_DOMINIO_RAILWAY.up.railway.app/login.html`
2. Preencha:
   - Email: `teste.usuario.1@example.com`
   - Senha: `TestPassword123!`
3. Clique "Entrar"
4. **Esperado:** Redirecionado para seleção de empresa

**O que verificar:**
- [ ] Login sucede com credenciais corretas
- [ ] JWT token criado (verificar localStorage)
- [ ] Redireciona para próxima página

**Se login falha:**
- Verificar email está correto (case-sensitive)
- Verificar senha corresponde ao registro
- Verificar logs da API para auth errors
- Verificar JWT_SECRET está configurada

### Teste 2.3: Validação de JWT Token

**Objetivo:** Verificar tokens criados corretamente

**No Console do Navegador:**
```javascript
localStorage.getItem('token')
```

**Esperado:** String longa começando com "eyJ" (formato JWT)

**Decodificar token (em https://jwt.io):**
1. Copie token do localStorage
2. Visite: https://jwt.io
3. Cole token no campo "Encoded"
4. **Payload esperado deve incluir:**
   ```json
   {
     "id": "user_id",
     "email": "teste.usuario.1@example.com",
     "iat": timestamp,
     "exp": timestamp
   }
   ```

**Se token inválido:**
- Verificar JWT_SECRET corresponde entre execuções
- Verificar BCRYPT_SALT_ROUNDS setting
- Verificar token não expirou

---

## Fase 3: Testes Multi-Tenancy (10 minutos)

### Teste 3.1: Criar Empresa

**Objetivo:** Verificar suporte multi-empresa

**Passos:**
1. Após login, você deve ver "Selecionar ou Criar Empresa"
2. Clique "Criar Nova Empresa"
3. Preencha:
   - Nome: `Lava Jato Teste`
   - CNPJ: `00.000.000/0000-00`
   - Endereço: `Rua Teste, 123`
   - Cidade: `São Paulo`
   - Estado: `SP`
4. Clique "Criar"
5. **Esperado:** Dashboard carrega com contexto da empresa

**O que verificar:**
- [ ] Empresa criada com sucesso
- [ ] Dashboard mostra nome da empresa
- [ ] Seletor de empresa aparece (canto superior direito)
- [ ] Token atualizado com empresa context

**Se falha:**
- Verificar API: `POST /api/empresas`
- Verificar usuário está autenticado
- Verificar validação da empresa
- Verificar tabela empresa no database

### Teste 3.2: Seletor de Empresa

**Objetivo:** Verificar pode alternar entre empresas

**Passos:**
1. Crie uma segunda empresa (repetir Teste 3.1)
2. Clique seletor de empresa (geralmente canto superior direito)
3. Veja lista de todas as empresas
4. Clique empresa diferente
5. **Esperado:** Dashboard atualiza para empresa selecionada

**O que verificar:**
- [ ] Ambas empresas listadas
- [ ] Alternância funciona sem logout
- [ ] Dados são escopo da empresa
- [ ] Sem data leakage entre empresas

**Se falha:**
- Verificar middleware `multiEmpresa`
- Verificar token inclui `empresaId`
- Verificar API filtra por empresa

---

## Fase 4: Testes de Assinatura (15 minutos)

### Teste 4.1: Ativação Plano Gratuito

**Objetivo:** Verificar trial gratuito é concedido

**Passos:**
1. Após criar empresa, vá para: "Planos" ou "Assinatura"
2. **Esperado:** Veja "Plano Gratuito" marcado como "Ativo"
3. Deve mostrar:
   - Nome do plano: "Gratuito"
   - Status: "Ativo"
   - Dias de trial restantes: 7 (ou valor configurado)
   - Válido até: (data atual + 7 dias)

**O que verificar:**
- [ ] Plano gratuito automaticamente ativado
- [ ] Dias de trial mostrados corretamente
- [ ] Sem botão upgrade para plano gratuito
- [ ] Acesso a todas features gratuitas

**Se plano gratuito não ativo:**
- Verificar subscription middleware
- Verificar trial_days em SubscriptionPlan
- Verificar tabela Subscription no database
- Verificar logs para subscription creation error

### Teste 4.2: Ver Planos Disponíveis

**Objetivo:** Verificar planos de subscription são exibidos

**Passos:**
1. Vá para: "Planos" ou "Assinatura"
2. Rolar down para ver todos os planos
3. **Esperado:** Ver múltiplos planos:
   - Gratuito (Free) - com trial
   - Professional
   - Premium
   - Enterprise

**O que verificar:**
- [ ] Todos planos exibidos
- [ ] Preços mostrados corretamente
- [ ] Listas de features visíveis
- [ ] Info de período trial visível

**Se planos não aparecem:**
- Verificar API: `GET /api/subscriptions/plans`
- Verificar SubscriptionPlan table tem dados
- Verificar seed data do database
- Verificar planos marcados como `ativo: true`

### Teste 4.3: Ver Assinatura Atual

**Objetivo:** Verificar detalles da assinatura ativa

**Passos:**
1. Vá para: "Minha Assinatura" ou Profile → Subscription
2. **Esperado:** Ver detalhes do plano gratuito atual:
   - Nome do plano
   - Status (Ativo)
   - Data início
   - Data expiração
   - Features incluídas
   - Botão upgrade

**O que verificar:**
- [ ] Plano correto exibido
- [ ] Datas são precisas
- [ ] Lista de features mostra
- [ ] Botão upgrade visível

**Se falha:**
- Verificar API: `GET /api/subscriptions/me`
- Verificar usuário tem subscription record
- Verificar tabela Subscription
- Verificar datas da subscription

---

## Fase 5: Testes de Lógica de Negócio (15 minutos)

### Teste 5.1: Criar Cliente

**Objetivo:** Verificar funcionalidade CRM

**Passos:**
1. Vá para: "Clientes"
2. Clique: "+ Novo Cliente"
3. Preencha:
   - Nome: `João Silva`
   - Email: `joao@email.com`
   - Telefone: `(11) 99999-9999`
   - CPF/CNPJ: `123.456.789-00`
   - Endereço: `Rua Exemplo, 100`
4. Clique: "Salvar"
5. **Esperado:** Cliente aparece na lista

**O que verificar:**
- [ ] Cliente criado com sucesso
- [ ] Aparece na lista de clientes
- [ ] Pode clicar para ver detalhes
- [ ] Funcionalidade edit funciona
- [ ] Escopo da empresa atual

**Se falha:**
- Verificar API: `POST /api/clientes`
- Verificar autenticação middleware
- Verificar empresaId está na request
- Verificar tabela cliente no database

### Teste 5.2: Criar Serviço

**Objetivo:** Verificar catálogo de serviços

**Passos:**
1. Vá para: "Serviços" ou Admin settings
2. Clique: "+ Novo Serviço"
3. Preencha:
   - Nome: `Lavagem Simples`
   - Descrição: `Lavagem externa básica`
   - Preço: `50.00`
   - Duração: `30` minutos
4. Clique: "Salvar"
5. **Esperado:** Serviço adicionado à lista

**O que verificar:**
- [ ] Serviço criado e listado
- [ ] Preço mostra corretamente
- [ ] Pode editar serviço
- [ ] Pode deletar serviço
- [ ] Escopo da empresa

**Se falha:**
- Verificar API: `POST /api/servicos`
- Verificar validação de serviço
- Verificar tabela servico

### Teste 5.3: Criar Ordem

**Objetivo:** Verificar gerenciamento de ordens

**Passos:**
1. Vá para: "Ordens"
2. Clique: "+ Nova Ordem"
3. Preencha:
   - Selecione Cliente: `João Silva`
   - Selecione Veículo: (se existe, ou criar)
   - Selecione Serviços: `Lavagem Simples`
   - Notas: `Carro limpo por fora`
4. Clique: "Criar Ordem"
5. **Esperado:** Ordem criada com status "Pendente"

**O que verificar:**
- [ ] Ordem aparece na lista
- [ ] Status mostra "Pendente"
- [ ] Pode clicar para ver detalhes
- [ ] Pode editar ordem
- [ ] Mostra serviços corretos e preço
- [ ] Preço total calculado corretamente

**Se falha:**
- Verificar API: `POST /api/ordens`
- Verificar cliente existe
- Verificar preço do serviço
- Verificar tabela ordem_servico

### Teste 5.4: Finalizar Ordem

**Objetivo:** Verificar finalização de ordens

**Passos:**
1. Em detalhes da ordem, clique: "Finalizar"
2. Confirme ação
3. **Esperado:** Status da ordem muda para "Concluída"

**O que verificar:**
- [ ] Status atualiza imediatamente
- [ ] Não pode editar após finalização
- [ ] Payment record criado (se pago)
- [ ] Comissão do funcionário calculada (se aplicável)

**Se falha:**
- Verificar API: `PUT /api/ordens/:id`
- Verificar validação de status da ordem
- Verificar database update funciona

---

## Fase 6: Testes de Pagamento (20 minutos)

### Teste 6.1: Pagamento Sandbox Mercado Pago

**Objetivo:** Verificar integração de pagamento sem dinheiro real

**Pré-requisitos:**
- Credenciais TEST- do Mercado Pago configuradas
- Uma ordem pendente com pagamento

**Passos:**
1. Vá para: "Financeiro" ou detalhes da Ordem
2. Procure por ordem com pagamento pendente
3. Clique: "Pagar" ou botão similar
4. **Esperado:** Redirecionado para Mercado Pago sandbox
5. Preencha com cartão de teste:
   - Número: `4111 1111 1111 1111`
   - Expiração: `12/25`
   - CVV: `123`
   - Titular: `Test User`
6. Clique: "Pagar"
7. **Esperado:** Redirecionado de volta para página de sucesso

**O que verificar:**
- [ ] Redireciona para payment gateway
- [ ] Pode preencher cartão de teste
- [ ] Retorna para success URL
- [ ] Status da ordem atualizado para "Pago"
- [ ] Payment record criado

**Se falha:**
- Verificar MERCADO_PAGO_PUBLIC_KEY
- Verificar botão de pagamento funciona
- Verificar console do navegador para erros
- Verificar PAYMENT_SUCCESS_URL é HTTPS

### Teste 6.2: Verificar Webhook de Pagamento

**Objetivo:** Verificar payment updates são processados

**Passos:**
1. Após pagamento completar, verificar:
   - Status da ordem no sistema (deve ser "Pago")
   - Payment record no database
   - Email de notificação recebido
2. Verificar logs do Railway:
   - Procurar por `/api/payments/webhook` calls
   - Deve mostrar payment status: "approved"

**O que verificar:**
- [ ] Status da ordem atualizado
- [ ] Payment record criado
- [ ] Webhook foi chamado
- [ ] Email de notificação enviado (se habilitado)

**Se webhook não chamado:**
- Verificar webhook URL no Mercado Pago
- Verificar URL é HTTPS (obrigatório)
- Verificar MERCADO_PAGO_WEBHOOK_SECRET
- Verificar domínio acessível do Mercado Pago

### Teste 6.3: Notificações de Pagamento

**Objetivo:** Verificar emails de confirmação de pagamento

**Passos:**
1. Complete um pagamento
2. Verifique inbox do email
3. **Esperado:** Email de confirmação de pagamento recebido

**O que verificar:**
- [ ] Email chega dentro de 1 minuto
- [ ] Contém info de pagamento correto
- [ ] Tem número da ordem correto
- [ ] Enviado do endereço EMAIL_FROM

**Se email não recebido:**
- Verificar pasta spam
- Aguardar 1 minuto
- Verificar quota SendGrid (100/dia)
- Verificar SENDGRID_API_KEY

---

## Fase 7: Testes de Background Jobs (15 minutos)

### Teste 7.1: Cron Job - Finalização de Ordens

**Objetivo:** Verificar ordens são finalizadas automaticamente a cada 15 min

**Passos:**
1. Verifique logs do Railway: Railway Dashboard → Logs
2. Procure por mensagens como:
   ```
   [CRON] Verificando ordens para finalização automática...
   [CRON] Ordens finalizadas: X
   ```
3. Estas mensagens devem aparecer a cada 15 minutos

**O que verificar:**
- [ ] Log message aparece regularmente (a cada 15 min)
- [ ] Sem erros nos logs
- [ ] Ordens pendentes são auto-finalizadas
- [ ] Status atualizado corretamente

**Se não está rodando:**
- Verificar index.ts para configuração do cron
- Verificar node-cron está instalado
- Verificar logs para schedule errors

### Teste 7.2: Cron Job - Expiração de Assinatura

**Objetivo:** Verificar verificação de subscriptions a cada 6 horas

**Passos:**
1. Verifique logs do Railway para:
   ```
   [CRON] Verificando assinaturas expiradas...
   ```
2. Deve aparecer a cada 6 horas (00:00, 06:00, 12:00, 18:00)

**O que verificar:**
- [ ] Mensagem aparece nos logs
- [ ] Trata assinaturas expiradas
- [ ] Envia notificações se habilitado

**Se não funciona:**
- Verificar lógica de expiração de subscription
- Verificar queries do database
- Verificar notificações por email

### Teste 7.3: Cron Job - Aviso de Trial

**Objetivo:** Verificar avisos de trial são enviados diariamente

**Passos:**
1. Verifique logs para:
   ```
   [CRON] Verificando avisos de trial...
   ```
2. Deve aparecer diariamente por volta das 09:00

**O que verificar:**
- [ ] Mensagem aparece nos logs
- [ ] Envia emails para trials expirando (7 dias restantes)
- [ ] Subscription atualizada corretamente

**Se não funciona:**
- Verificar datas de expiração de trial
- Verificar envio de emails
- Verificar tempo de schedule

---

## Fase 8: Testes de Performance (10 minutos)

### Teste 8.1: Tempo de Resposta

**Objetivo:** Verificar performance aceitável da API

**DevTools Network Tab do Navegador:**
1. Abra: https://SEU_DOMINIO_RAILWAY.app/login.html
2. Abra DevTools (F12) → Abra Network tab
3. Faça ações:
   - Login
   - Criar ordem
   - Ver relatórios
4. Verifique tempo de resposta para cada request

**Tempos Esperados:**
- **API endpoints:** < 500ms
- **Page loads:** < 2000ms (primeiro load)
- **Database queries:** < 200ms

**Se lento:**
- Verificar CPU/Memory metrics do Railway
- Otimizar queries do database
- Considerar database indexes
- Verificar N+1 queries no código

### Teste 8.2: Uso de Memória

**Objetivo:** Verificar sem memory leaks

**Railway Dashboard → Metrics:**
1. Vá para: Service → Metrics
2. Verifique gráfico "Memory"
3. Deve manter constante (100-200 MB)
4. Não deve aumentar continuamente

**Esperado:** Memória estável ao longo do tempo

**Se aumentando:**
- Possível memory leak
- Verificar logs para padrões de error
- Reiniciar serviço se necessário

### Teste 8.3: Uso de CPU

**Objetivo:** Verificar uso eficiente de recursos

**Railway Dashboard → Metrics:**
1. Vá para: Service → Metrics
2. Verifique gráfico "CPU"
3. Deve ser baixo em repouso (< 5%)
4. Deve chegar a pico durante requests (< 80%)

**Esperado:** CPU retorna ao normal após requests

**Se sempre alto:**
- Verificar loops infinitos
- Verificar computações pesadas
- Profile código da aplicação

---

## Checklist Final de Testes

### Infraestrutura (9 testes)
- [ ] Health check respondendo
- [ ] Database conectado
- [ ] Frontend carregando
- [ ] Logs limpos
- [ ] CPU normal
- [ ] Memória estável
- [ ] Network funcionando
- [ ] HTTPS ativo
- [ ] Backups existem

### Autenticação (5 testes)
- [ ] Signup funciona
- [ ] Email de confirmação enviado
- [ ] Login funciona
- [ ] JWT token criado
- [ ] Token tem claims corretos

### Multi-Tenancy (2 testes)
- [ ] Criar empresa funciona
- [ ] Seletor de empresa funciona
- [ ] Isolação de dados verificada

### Assinaturas (3 testes)
- [ ] Plano gratuito ativado
- [ ] Planos exibidos
- [ ] Assinatura atual mostrada

### Lógica de Negócio (4 testes)
- [ ] Criação de cliente
- [ ] Criação de serviço
- [ ] Criação de ordem
- [ ] Finalização de ordem

### Pagamentos (3 testes)
- [ ] Pagamento sandbox funciona
- [ ] Webhook processing
- [ ] Email de notificação

### Background Jobs (3 testes)
- [ ] Finalização de ordens cron
- [ ] Expiração de subscriptions cron
- [ ] Avisos de trial cron

### Performance (3 testes)
- [ ] Tempo de resposta aceitável
- [ ] Uso de memória estável
- [ ] Uso de CPU razoável

### Integridade de Dados (2 testes)
- [ ] Isolação multi-empresa
- [ ] Backup database existe

### Segurança (5 testes)
- [ ] HTTPS forçado
- [ ] CORS funcionando
- [ ] SQL injection prevenido
- [ ] XSS prevenido
- [ ] Auth requerida em endpoints

### Monitoramento (3 testes)
- [ ] Logs limpos
- [ ] Metrics saudáveis
- [ ] Monitor uptime ativo

**Total de Testes:** 42
**Status:** Pronto para validação quando todos passarem ✅

---

**Pronto para testar!** 🚀

Siga cada fase em ordem. Pare em qualquer FALHA e faça troubleshoot antes de continuar.
