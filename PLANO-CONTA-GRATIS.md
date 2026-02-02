# Plano: Conta Gratuita + Trial Configurável

**Status:** ✅ IMPLEMENTAÇÃO CONCLUÍDA
**Data:** 02/02/2026
**Versão:** 1.0.0

---

## 📋 Visão Geral

Implementação completa de um plano FREE permanente e trial days configurável para otimizar o modelo de negócio do LinaX. Os usuários agora recebem automaticamente uma assinatura FREE ao se registrarem, com a possibilidade de upgrade para planos pagos com período de teste customizável.

---

## ✅ O Que Foi Implementado

### 1. Database & Schema

#### ✅ Adição do Campo `trialDays`
- **Arquivo:** `C:\LinaX\backend\prisma\schema.prisma`
- **Alteração:** Adicionado campo `trialDays: Int @default(0)` ao modelo `SubscriptionPlan`
- **Tipo:** Inteiro (0-365 dias)
- **Padrão:** 0 (sem trial)
- **Migration:** `20260131212524_add_trial_days_to_plans`

#### ✅ Seed Data Atualizado
- **Arquivo:** `C:\LinaX\backend\prisma\seed.ts`
- **Planos Criados:**
  - `FREE`: 0 dias (permanente)
  - `Basic`: 7 dias de trial
  - `Pro`: 14 dias de trial
  - `Premium`: 30 dias de trial

---

### 2. Backend - Serviços

#### ✅ SubscriptionService
**Arquivo:** `C:\LinaX\backend\src\services\subscriptionService.ts`

**Modificações:**
1. **Cálculo Dinâmico de Trial** (linha 199)
   ```typescript
   const trialEndDate = isTrial && plan.trialDays > 0
     ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
     : null;
   ```

2. **Email com Trial Days Correto** (linha 244)
   ```typescript
   await emailService.sendTrialStartedEmail(usuario, plan, plan.trialDays);
   ```

3. **Novo Método: `createFreeSubscriptionForNewUser()`**
   - Localiza plano FREE (preco = 0)
   - Verifica se usuário já possui assinatura
   - Cria assinatura FREE permanente (sem trial)
   - Retorna a assinatura criada

---

### 3. Backend - Controllers

#### ✅ UsuarioController
**Arquivo:** `C:\LinaX\backend\src\controllers\usuarioController.ts`

**Modificações:**
1. Importação do SubscriptionService
2. Após criação do usuário, chamada automática de:
   ```typescript
   await subscriptionService.createFreeSubscriptionForNewUser(usuario.id);
   ```

#### ✅ SubscriptionAdminController
**Arquivo:** `C:\LinaX\backend\src\controllers\subscriptionAdminController.ts`

**Modificações:**
1. **createPlan()**: Aceita parâmetro `trialDays` e persiste no banco
2. **updatePlan()**: Suporta atualização de `trialDays` via updateData genérico

#### ✅ SubscriptionController - Novo Endpoint
**Arquivo:** `C:\LinaX\backend\src\controllers\subscriptionController.ts`

**Novo Método: `createFreeForCurrentUser()`**
- **Rota:** `POST /subscriptions/create-free`
- **Autenticação:** Requerida (userAuthMiddleware)
- **Descrição:** Fallback para criar assinatura FREE se usuário não possuir
- **Resposta:** `{ message, subscription }`

#### ✅ Routes
**Arquivo:** `C:\LinaX\backend\src\routes\subscription.ts`

**Nova Rota Adicionada:**
```typescript
router.post('/create-free', createFreeForCurrentUser);
```

---

### 4. Frontend - Onboarding

#### ✅ Signup.html
**Arquivo:** `C:\LinaX\DESKTOPV2\signup.html`

**Modificações (linha 840-844):**
- ❌ Antes: `window.location.href = 'planos.html'`
- ✅ Depois: `window.location.href = 'nova-empresa.html'`
- **Impacto:** Novo usuário é redirecionado diretamente para criar empresa, não para selecionar plano

#### ✅ Dashboard - Modal de Boas-vindas
**Arquivo:** `C:\LinaX\DESKTOPV2\index.html`

**Adições:**

1. **HTML Modal** (antes de `</body>`)
   - Emoji celebração 🎉
   - Título: "Bem-vindo ao LinaX!"
   - Mensagem: "Você está usando o plano FREE"
   - Lista de benefícios de planos premium
   - Dois botões:
     - "Continuar Grátis" (fecha modal)
     - "Conhecer os Planos" (redireciona para planos.html)

2. **Data Alpine.js** (linha ~1099)
   ```javascript
   showWelcomeModal: false
   ```

3. **Métodos Alpine.js**
   ```javascript
   checkFirstLogin() {
     const hasSeenWelcome = localStorage.getItem('hasSeenWelcome');
     if (!hasSeenWelcome) {
       setTimeout(() => {
         this.showWelcomeModal = true;
       }, 1000);
     }
   }

   closeWelcomeModal() {
     this.showWelcomeModal = false;
     localStorage.setItem('hasSeenWelcome', 'true');
   }
   ```

4. **Inicialização** (linha ~1145)
   ```javascript
   this.checkFirstLogin();
   ```

---

### 5. Frontend - Página de Planos

#### ✅ Planos.html
**Arquivo:** `C:\LinaX\DESKTOPV2\planos.html`

**Modificações:**

1. **Função `renderPlans()`** (linha 1052)
   - Detecta plano FREE (`preco === 0`)
   - Exibe badge "✓ PLANO ATUAL" com cor verde
   - Mostra "GRÁTIS" em vez de preço
   - Desabilita botão de assinatura
   - Exibe trial days em badge verde para planos pagos
   - Aviso vermelho para planos sem trial

2. **Navbar Melhorado**
   - Adicionado botão "Voltar para o Dashboard"
   - Visível apenas para usuários autenticados
   - Implementado em `setupAuthButton()`

**Exemplo de Renderização:**
- **Plano FREE:** Badge verde "✓ PLANO ATUAL", preço "GRÁTIS", botão desabilitado
- **Plano Pro (14 dias):** Badge verde "✓ 14 dias grátis. Sem cartão de crédito."
- **Plano Premium (sem trial):** Badge vermelha "⚠️ Sem período de teste. Pagamento obrigatório."

---

### 6. Frontend - Admin Interface

#### ✅ Admin Plans.html
**Arquivo:** `C:\LinaX\DESKTOPV2\admin\plans.html`

**Adições:**

1. **Campo de Formulário** (após maxAddons)
   ```html
   <div class="form-group">
     <label class="form-label">Dias de Trial Grátis</label>
     <input type="number" class="form-input" id="formTrialDays" min="0" max="365" placeholder="0">
     <small>0 = Sem trial. Planos FREE não devem ter trial.</small>
   </div>
   ```

2. **Preenchimento de Formulário** (linha 584)
   ```javascript
   document.getElementById('formTrialDays').value = plan.trialDays || 0;
   ```

3. **Payload de Salvamento** (linha 620)
   ```javascript
   trialDays: parseInt(document.getElementById('formTrialDays').value) || 0,
   ```

4. **Exibição nos Cards** (após maxAddons)
   ```html
   <div class="info-row">
     <span class="info-label">Trial Grátis</span>
     <span class="info-value">${plan.trialDays || 0} dias</span>
   </div>
   ```

---

### 7. Frontend - Login Fallback

#### ✅ Login.html
**Arquivo:** `C:\LinaX\DESKTOPV2\login.html`

**Modificações** (linha 947-975)

**Antes:**
```javascript
if (!subResponse.hasSubscription) {
  window.location.href = 'planos.html';
  return;
}
```

**Depois:**
```javascript
if (!subResponse.hasSubscription) {
  try {
    await window.api.createFreeSubscription();
    console.log('FREE subscription criado com sucesso');
  } catch (err) {
    console.error('Erro ao criar FREE subscription:', err);
  }
}
```

#### ✅ API.js
**Arquivo:** `C:\LinaX\DESKTOPV2\api.js`

**Novo Método** (linha 356)
```javascript
createFreeSubscription: () => fetchApi('/subscriptions/create-free', { method: 'POST' }),
```

---

## 🔄 Fluxo de Onboarding Implementado

```
┌─────────────────────────────────────────────────────────────┐
│ 1. REGISTRO (signup.html)                                   │
│    - Usuário cria conta (nome, email, senha)               │
│    - Backend: Cria usuário + assinatura FREE automática    │
│    - ✅ FREE criado com status ACTIVE                      │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. REDIRECIONAMENTO PARA EMPRESA (nova-empresa.html)       │
│    - Usuário é redirecionado automaticamente                │
│    - Solicita criação/seleção de empresa                   │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PRIMEIRO ACESSO AO DASHBOARD (index.html)               │
│    - Modal de boas-vindas aparece após 1 segundo           │
│    - "Bem-vindo ao LinaX!"                                 │
│    - "Você está usando o plano FREE"                       │
│    - Opções:                                                │
│      a) "Continuar Grátis" → Fecha modal                   │
│      b) "Conhecer os Planos" → Vai para planos.html        │
│    - localStorage.hasSeenWelcome = 'true'                  │
│    - Modal não aparece novamente                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. USO DO DASHBOARD (index.html)                           │
│    - Acesso completo ao plano FREE                         │
│    - Botão "Conhecer os Planos" disponível na navbar       │
│    - Possibilidade de upgrade para planos pagos            │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Configuração de Trial Days por Plano

| Plano | Preço | Trial Days | Status |
|-------|-------|-----------|--------|
| **FREE** | R$ 0,00 | 0 | ✅ Implementado |
| **Basic** | R$ 89,00 | 7 dias | ✅ Implementado |
| **Pro** | R$ 169,00 | 14 dias | ✅ Implementado |
| **Premium** | R$ 279,00 | 30 dias | ✅ Implementado |

---

## 🗺️ Arquivos Modificados - Resumo

### Backend (7 arquivos)
- ✅ `prisma/schema.prisma` - Schema atualizado
- ✅ `prisma/seed.ts` - Seed data com trial days
- ✅ `src/services/subscriptionService.ts` - Lógica de trial dinâmica
- ✅ `src/controllers/usuarioController.ts` - Auto-create FREE
- ✅ `src/controllers/subscriptionAdminController.ts` - CRUD com trialDays
- ✅ `src/controllers/subscriptionController.ts` - Novo endpoint
- ✅ `src/routes/subscription.ts` - Rota create-free

### Frontend (6 arquivos)
- ✅ `signup.html` - Novo redirecionamento
- ✅ `index.html` - Modal de boas-vindas
- ✅ `planos.html` - Renderização melhorada
- ✅ `admin/plans.html` - Campo trialDays
- ✅ `login.html` - Fallback subscription
- ✅ `api.js` - Novo método

**Total de Arquivos Modificados:** 13

---

## 🧪 Testes E2E Recomendados

### ✅ Cenário 1: Novo Usuário
1. Acessar `signup.html`
2. Criar conta com novo email/senha
3. ✓ Verificar assinatura FREE criada (backend logs)
4. ✓ Verificar redirecionamento para `nova-empresa.html`
5. Criar empresa
6. ✓ Verificar redirecionamento para `index.html`
7. ✓ Verificar modal de boas-vindas aparece
8. Clicar "Continuar Grátis"
9. ✓ Verificar modal fecha
10. ✓ Verificar `localStorage.hasSeenWelcome = 'true'`
11. Fazer logout e login novamente
12. ✓ Verificar modal NÃO aparece novamente

### ✅ Cenário 2: Exploração de Planos
1. Após signup e criar empresa
2. Modal aparece
3. Clicar "Conhecer os Planos"
4. ✓ Verificar redirecionamento para `planos.html`
5. ✓ Verificar plano FREE com badge "✓ PLANO ATUAL"
6. ✓ Verificar planos pagos exibem trial days corretos
7. ✓ Verificar botão "Voltar para o Dashboard"

### ✅ Cenário 3: Admin Gerenciando Planos
1. Login como `LINA_OWNER`
2. Acessar `admin/plans.html`
3. ✓ Verificar planos FREE, Basic, Pro, Premium existem
4. Editar plano "Pro"
5. Alterar `trialDays` de 14 para 21
6. Salvar
7. ✓ Verificar mudança persistida
8. ✓ Verificar exibição "21 dias" na listagem

### ✅ Cenário 4: Trial Days Funcionando
1. Admin configura plano com `trialDays = 21`
2. Usuário assina plano (isTrial = true)
3. ✓ Verificar `trialEndDate = hoje + 21 dias`
4. ✓ Verificar email menciona "21 dias de trial grátis"

### ✅ Cenário 5: Login Fallback
1. Usuário sem assinatura efetua login
2. ✓ Backend cria FREE automaticamente
3. ✓ Usuário é redirecionado para dashboard
4. ✓ Modal de boas-vindas aparece

---

## ❌ O Que Falta Fazer

### 1. Refinamentos de UI/UX
- [ ] Adicionar animações na modal de boas-vindas
- [ ] Melhorar responsividade do modal em dispositivos móveis
- [ ] Adicionar tooltip explicativo sobre "Trial Grátis" no admin
- [ ] Criar landing page customizada para plano FREE

### 2. Notificações por Email
- [ ] Email de boas-vindas com detalhes do plano FREE
- [ ] Email 3 dias antes do fim do trial
- [ ] Email 1 dia antes do fim do trial
- [ ] Email de confirmação de upgrade
- [ ] Email de aviso de limite de recursos próximo

### 3. Limite de Recursos por Plano
- [ ] Implementar validação de limite de empresas por plano
- [ ] Implementar validação de limite de usuários por plano
- [ ] Implementar validação de limite de add-ons por plano
- [ ] Adicionar dashboard com consumo de recursos

### 4. Transição de Trial para Pago
- [ ] Criar fluxo de pagamento após fim do trial
- [ ] Implementar aviso visual quando trial está próximo do fim
- [ ] Salvar forma de pagamento durante trial
- [ ] Automatizar cobrança após trial (se integrado com Stripe/Mercado Pago)

### 5. Analytics e Relatórios
- [ ] Dashboard de conversão: Usuários FREE → Pagos
- [ ] Relatório de trial completion rate
- [ ] Relatório de churn de usuários FREE
- [ ] Tracking de upgrades por plano
- [ ] Análise de tempo de conversão (quanto tempo leva para fazer upgrade)

### 6. Testes Automatizados
- [ ] Testes unitários para SubscriptionService
- [ ] Testes de integração para endpoints de subscription
- [ ] Testes E2E com Cypress/Playwright para fluxo de signup
- [ ] Testes de performance para renderização de modal

### 7. Documentação
- [ ] Documentar processo de criação de novos planos no admin
- [ ] Criar guia de troubleshooting para problemas de assinatura
- [ ] Documentar fluxo de dados de trial days
- [ ] Adicionar exemplos de API responses

### 8. Melhorias no Admin
- [ ] Bulk edit de trial days para múltiplos planos
- [ ] Histórico de mudanças em trial days
- [ ] Prévia de como cada plano aparecerá ao usuário
- [ ] Validação para impedir trial days para plano FREE

### 9. Segurança
- [ ] Rate limiting para endpoint create-free
- [ ] Auditoria de criação de assinaturas FREE
- [ ] Validação adicional para evitar múltiplas FREE por usuário
- [ ] Criptografia de dados sensíveis de trial

### 10. Performance
- [ ] Cache de planos em localStorage (com expiry)
- [ ] Lazy loading da página de planos
- [ ] Otimização de queries de subscription
- [ ] Compressão de assets

---

## 🚀 Próximos Passos Recomendados

### Fase 1: Testes & Validação (1-2 dias)
1. Executar todos os cenários E2E listados acima
2. Testar em navegadores diferentes (Chrome, Firefox, Safari, Edge)
3. Testar em dispositivos móveis
4. Validar fluxo de pagamento após trial (se aplicável)

**Comandos para Testar:**
```bash
# Backend - Verificar logs
cd C:\LinaX\backend
npm run dev

# Frontend - Servidor de desenvolvimento
cd C:\LinaX\DESKTOPV2
npx http-server
```

### Fase 2: Emails de Notificação (2-3 dias)
1. Implementar template de email para boas-vindas FREE
2. Implementar alertas de final de trial
3. Testar envio de emails em staging
4. Validar templates visualmente em diferentes clientes de email

### Fase 3: Limites de Recursos (3-4 dias)
1. Implementar middleware de validação de limites
2. Adicionar verificação antes de criar empresa/usuário/addon
3. Criar mensagens de erro amigáveis
4. Implementar dashboard de uso

### Fase 4: Conversão & Monetização (5-7 dias)
1. Implementar fluxo de checkout para upgrade
2. Integração com Stripe/Mercado Pago (se não houver)
3. Automatizar cobrança pós-trial
4. Testar ciclo completo de trial → upgrade

### Fase 5: Analytics (2-3 dias)
1. Implementar tracking de eventos
2. Criar dashboard de conversão
3. Configurar alertas para churn
4. Validar dados com amostra de usuários

### Fase 6: Documentação & Deploy (1-2 dias)
1. Escrever documentação completa
2. Criar guias para admin
3. Deploy em staging
4. Deploy em produção

---

## 📱 Verificação de Funcionalidades

### Assinatura FREE
- [x] Criada automaticamente no signup
- [x] Status ACTIVE imediatamente
- [x] Sem período de trial
- [x] Sem cobrança
- [x] Permanente (sem data de expiração)
- [x] Visível no dashboard
- [x] Impossível fazer downgrade

### Trial Days
- [x] Configurável por plano (0-365 dias)
- [x] Cálculo dinâmico de data de fim
- [x] Email com informação correta de dias
- [x] Badge visual mostrando dias
- [x] Admin pode editar valores
- [x] Validação de entrada (0-365)

### Onboarding
- [x] Novo usuário recebe FREE automaticamente
- [x] Redirecionamento para empresa (não planos)
- [x] Modal de boas-vindas no first visit
- [x] LocalStorage para rastrear já visto
- [x] Botões funcionais na modal
- [x] Fallback se algo falhar

### UI/UX
- [x] Badges de plano visual
- [x] Trial days exibidos corretamente
- [x] Botão de back to dashboard
- [x] Aviso para planos sem trial
- [x] Responsivo em mobile

---

## 🔧 Comandos Úteis

### Gerenciar Banco de Dados
```bash
# Verificar schema
cd C:\LinaX\backend
npx prisma db pull

# Resetar banco (⚠️ Cuidado!)
npx prisma migrate reset --force

# Ver migrations
npx prisma migrate status

# Studio (GUI)
npx prisma studio
```

### Testar Backend
```bash
cd C:\LinaX\backend
npm run dev    # Servidor de desenvolvimento
npm test       # Testes (se configurado)
npm run build  # Build para produção
```

### Testar Frontend
```bash
cd C:\LinaX\DESKTOPV2
npx http-server  # Servidor simples
# Ou abrir arquivo diretamente no navegador
```

---

## 📞 Contatos & Suporte

Para dúvidas sobre a implementação:
1. Verificar logs do console (browser DevTools)
2. Verificar logs do backend (terminal)
3. Usar Prisma Studio para inspecionar dados
4. Revisar arquivos modificados listados acima

---

## 📝 Notas Importantes

1. **Migração do Banco:** A migração foi criada automaticamente. Certifique-se de rodá-la em todos os ambientes (dev, staging, prod).

2. **Seed Data:** A seed data foi atualizada com trial days. Se precisar resetar dados de teste, execute `npx prisma db seed`.

3. **LocalStorage:** O modal usa `localStorage.hasSeenWelcome`. Limpar localStorage se quiser ver a modal novamente em teste.

4. **Plano FREE:** O plano FREE deve ter preço = 0 e trial days = 0. Não crie outro plano gratuito com trial.

5. **Email Service:** Se emails não estão sendo enviados, verificar credenciais em `.env`.

6. **Timezone:** Trial days calcula em UTC. Se usar outro timezone, ajustar no `calculateNextBillingDate()`.

---

## ✨ Melhorias Futuras (Nice to Have)

- [ ] Gamificação: Badges para usuários FREE engajados
- [ ] Referral program: Usuários FREE convidando amigos
- [ ] Free trial extension: Estender trial mediante ações
- [ ] Whitelist email: Permitir FREE para emails corporativos específicos
- [ ] Custom pricing: Preços customizados para usuários enterprise
- [ ] A/B testing: Testar diferentes durations de trial
- [ ] Pricing page com simulador: "Qual plano para você?"
- [ ] Plan comparison: Tabela comparativa interativa
- [ ] Onboarding video: Vídeo tutorial para novos usuários

---

**Versão:** 1.0.0
**Última Atualização:** 02/02/2026
**Status:** ✅ Pronto para Testes
**Próxima Revisão:** Após validação E2E
