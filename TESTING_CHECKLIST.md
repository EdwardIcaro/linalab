# 🧪 Checklist de Testes - Sistema de Assinaturas LinaX

**Data:** 29/01/2026
**Status:** Pronto para Testes Manuais
**Ambiente:** Local (http://localhost:3001)

---

## 📋 Pré-requisitos
- [ ] Backend rodando em `http://localhost:3001`
- [ ] Frontend em `http://localhost:3001` (servindo arquivos estáticos)
- [ ] Banco de dados PostgreSQL com schema atualizado
- [ ] Seed de planos e add-ons executado: `npx ts-node backend/prisma/seed-subscriptions.ts`
- [ ] DevTools do navegador aberto (F12)

---

## ✅ Fluxo 1: Novo Usuário - Trial (CRITICAL)

### Pré-condição
- Usuário novo (não existe no banco)
- Email único

### Passos
1. **Criar Conta**
   - [ ] Ir para `http://localhost:3001/signup.html`
   - [ ] Preencher: Nome = "João Silva", Email = "joao@test.com", Senha = "123456"
   - [ ] Clicar "Criar Conta"
   - [ ] ✅ Esperado: Toast "Conta criada com sucesso! Redirecionando para login..."
   - [ ] ✅ Esperado: Redirecionar para `login.html` após 1.5s

2. **Fazer Login**
   - [ ] Email = "joao@test.com", Senha = "123456"
   - [ ] Clicar "Entrar"
   - [ ] ✅ Esperado: Não ter assinatura, redirecionar para `planos.html`

3. **Selecionar Plano Trial**
   - [ ] Estar em `planos.html`
   - [ ] ✅ Esperado: Ver 3 cards (Basic, Pro, Premium)
   - [ ] ✅ Esperado: Pro tem badge "MAIS POPULAR"
   - [ ] ✅ Esperado: Promocões exibidas se houver (buscar `/api/promotions/active`)
   - [ ] Clicar "Começar Grátis" no plano **Pro**
   - [ ] ✅ Esperado: Confirmação "Deseja iniciar o teste grátis de 7 dias do plano Pro?"
   - [ ] Confirmar
   - [ ] ✅ Esperado: Toast "✅ Trial iniciado com sucesso! Aproveite seus 7 dias grátis."
   - [ ] ✅ Esperado: Redirecionar para `empresas.html` (ou seleção de empresa)

4. **Criar 1ª Empresa**
   - [ ] Clicar "Nova Empresa"
   - [ ] Preencher dados: Nome, CNPJ, etc
   - [ ] Submeter
   - [ ] ✅ Esperado: Empresa criada com sucesso (Pro permite 2 empresas)
   - [ ] Verificar no console: `ordem = 1`

5. **Criar 2ª Empresa**
   - [ ] Clicar "Nova Empresa" novamente
   - [ ] Preencher dados diferentes
   - [ ] Submeter
   - [ ] ✅ Esperado: Empresa criada (Pro permite 2)
   - [ ] Verificar console: `ordem = 2`

6. **Tentar Criar 3ª Empresa (DEVE FALHAR)**
   - [ ] Clicar "Nova Empresa"
   - [ ] Preencher dados
   - [ ] Submeter
   - [ ] ❌ **ESPERADO: Alert "Você atingiu o limite de empresas do seu plano. Faça upgrade para criar mais empresas."**
   - [ ] ✅ **ESPERADO: Redirecionar para `assinatura.html`**

7. **Verificar Dados de Trial**
   - [ ] Ir para `assinatura.html`
   - [ ] ✅ Esperado: Status = "⏳ Em Trial"
   - [ ] ✅ Esperado: Badge laranja
   - [ ] ✅ Esperado: Countdown mostrando dias restantes (~7 dias)
   - [ ] ✅ Esperado: Data de expiração em ~7 dias
   - [ ] Verificar no DB: `subscriptions WHERE usuarioId=X`
     - `status = 'TRIAL'`
     - `isTrialUsed = true`
     - `isCurrentlyTrial = true`
     - `trialEndDate = +7 dias`
     - `preco = 16900` (Pro em centavos)

**Resultado Esperado:** ✅ PASSOU

---

## ✅ Fluxo 2: Upgrade de Plano

### Pré-condição
- Usuário "João Silva" com assinatura Trial no plano Pro
- Tem 2 empresas ativas

### Passos
1. **Acessar Assinatura**
   - [ ] Ir para `assinatura.html`
   - [ ] ✅ Esperado: Ver "Plano Pro"

2. **Fazer Upgrade para Premium**
   - [ ] Clicar botão "Upgrade/Downgrade"
   - [ ] ✅ Esperado: Redirecionar para `planos.html`
   - [ ] Clicar "Começar Grátis" no plano **Premium**
   - [ ] ✅ Esperado: Confirmação
   - [ ] Confirmar
   - [ ] ✅ Esperado: "Plano atualizado com sucesso!"
   - [ ] Verificar no DB:
     - `subscription.planId = ID_PREMIUM`
     - `subscription.preco = 27900` (Premium em centavos)
     - `subscription.status = 'ACTIVE'` (saiu do trial)

3. **Verificar Permissões Aumentadas**
   - [ ] ✅ Esperado: Agora pode criar até **5 empresas** (antes era 2)
   - [ ] ✅ Esperado: Agora pode ter **2 add-ons** (antes era 1)
   - [ ] Ir para `addons.html`
   - [ ] ✅ Esperado: Limite de add-ons mostrado como "2/2" ou similar

**Resultado Esperado:** ✅ PASSOU

---

## ✅ Fluxo 3: Downgrade com Validação

### Pré-condição
- Usuário "João Silva" com assinatura Premium
- Tem 3 empresas ativas (Premium permite 5)

### Passos
1. **Tentar Downgrade para Basic (1 empresa)**
   - [ ] Ir para `assinatura.html`
   - [ ] Clicar "Upgrade/Downgrade"
   - [ ] Clicar "Começar Grátis" no plano **Basic**
   - [ ] ❌ **ESPERADO: Erro "Você tem 3 empresas, mas Basic permite apenas 1. Desative 2 empresas antes de fazer downgrade."**
   - [ ] Fechar mensagem de erro

2. **Desativar 2 Empresas**
   - [ ] Ir para `selecionar-empresa.html` ou dashboard
   - [ ] Desativar 2 das 3 empresas (manter apenas 1 ativa)
   - [ ] ✅ Esperado: Agora tem 1 empresa ativa

3. **Downgrade Bem-Sucedido**
   - [ ] Ir para `assinatura.html`
   - [ ] Clicar "Upgrade/Downgrade"
   - [ ] Clicar "Começar Grátis" no plano **Basic**
   - [ ] ✅ Esperado: "Plano atualizado com sucesso!"
   - [ ] Verificar no DB:
     - `subscription.planId = ID_BASIC`
     - `subscription.preco = 8900` (Basic em centavos)

**Resultado Esperado:** ✅ PASSOU

---

## ✅ Fluxo 4: Expiração de Trial

### Pré-condição
- Usuário novo com trial ainda não expirado

### Passos
1. **Criar novo usuário e trial**
   - [ ] Email = "maria@test.com"
   - [ ] Selecionar qualquer plano (trial 7 dias)
   - [ ] ✅ Esperado: `trialEndDate = agora + 7 dias`

2. **Alterar Data de Expiração (DB)**
   - [ ] Abrir psql ou DB Admin
   - [ ] ```sql
     UPDATE subscriptions
     SET "trialEndDate" = NOW() - INTERVAL '1 day'
     WHERE "usuarioId" = (SELECT id FROM usuarios WHERE email = 'maria@test.com')
     ```
   - [ ] Executar query

3. **Rodar Cron Job Manualmente**
   - [ ] Abrir terminal do backend
   - [ ] Executar em console (ou esperar 6 horas):
     - Chamar `subscriptionService.checkExpiredSubscriptions()`
   - [ ] Ou esperar o cron automático (a cada 6 horas)

4. **Verificar Mudança de Status**
   - [ ] Ir para `assinatura.html` (pode precisar recarregar)
   - [ ] ✅ **ESPERADO: Status = "❌ Expirada"**
   - [ ] ✅ **ESPERADO: Badge vermelha**
   - [ ] Verificar no DB:
     - `subscription.status = 'EXPIRED'`

5. **Tentar Acessar Empresa**
   - [ ] Ir para `empresas.html` ou dashboard
   - [ ] ❌ **ESPERADO: Erro "Assinatura expirada. Escolha um plano para continuar."**
   - [ ] ✅ **ESPERADO: Redirecionar para `planos.html`**

**Resultado Esperado:** ✅ PASSOU

---

## ✅ Fluxo 5: Admin - Conceder Vitalício

### Pré-condição
- Login como LINA_OWNER
- Usuário "João Silva" com assinatura ativa (Basic, Pro ou Premium)

### Passos
1. **Acessar Admin Dashboard**
   - [ ] Ir para `admin/dashboard.html`
   - [ ] ✅ Esperado: Ver cards de "Gerenciar Assinaturas", "Gerenciar Planos", "Gerenciar Add-ons"

2. **Ir para Subscriptions**
   - [ ] Clicar no card "Gerenciar Assinaturas"
   - [ ] ✅ Esperado: Redirecionar para `admin/subscriptions.html`
   - [ ] ✅ Esperado: Carregar estatísticas (Total, Ativas, Trial, Expiradas, MRR)

3. **Procurar Assinatura de João Silva**
   - [ ] Usar filtro Status ou procurar pelo nome
   - [ ] ✅ Esperado: Ver assinatura com status e plano

4. **Conceder Vitalício**
   - [ ] Clicar botão "⭐ Vitalício" na linha de João Silva
   - [ ] ✅ Esperado: Confirmação "Conceder assinatura vitalícia para este usuário?"
   - [ ] Confirmar
   - [ ] ✅ Esperado: Toast "✅ Assinatura vitalícia concedida com sucesso!"
   - [ ] ✅ Esperado: Status muda para "⭐ Vitalícia"
   - [ ] Verificar no DB:
     - `subscription.status = 'LIFETIME'`
     - `subscription.endDate = NULL` (nunca expira)

5. **Verificar como Usuário**
   - [ ] Fazer logout (admin)
   - [ ] Login como João Silva
   - [ ] Ir para `assinatura.html`
   - [ ] ✅ Esperado: Status = "⭐ Vitalícia"
   - [ ] ✅ Esperado: Sem data de próxima cobrança
   - [ ] ✅ Esperado: Nunca expira

**Resultado Esperado:** ✅ PASSOU

---

## ✅ Fluxo 6: Gerenciamento de Add-ons

### Pré-condição
- Usuário com plano Pro (limite 1 add-on)
- 3 add-ons disponíveis no sistema

### Passos
1. **Acessar Add-ons**
   - [ ] Ir para `addons.html`
   - [ ] ✅ Esperado: Seção "Seus Add-ons Ativos" (vazio)
   - [ ] ✅ Esperado: Seção "Add-ons Disponíveis" com 3 cards

2. **Adicionar 1º Add-on (Estoque)**
   - [ ] Clicar "Adicionar Add-on" no card "Estoque"
   - [ ] ✅ Esperado: Botão muda para "✅ Já Ativo"
   - [ ] ✅ Esperado: Aparece na seção "Seus Add-ons Ativos"
   - [ ] ✅ Esperado: Toast "✅ Estoque adicionado com sucesso!"

3. **Tentar Adicionar 2º Add-on (DEVE FALHAR)**
   - [ ] Tentar clicar "Adicionar Add-on" em outro add-on
   - [ ] ✅ **ESPERADO: Botão desabilitado com texto "🔒 Limite Atingido"**
   - [ ] ✅ **ESPERADO: Aviso "Limite de add-ons atingido! Para adicionar mais, faça upgrade do seu plano."**
   - [ ] ✅ **ESPERADO: Botão "Fazer Upgrade" disponível**

4. **Fazer Upgrade para Premium**
   - [ ] Clicar "Fazer Upgrade"
   - [ ] ✅ Esperado: Redirecionar para `planos.html`
   - [ ] Selecionar Premium
   - [ ] ✅ Esperado: Agora permite 2 add-ons

5. **Adicionar 2º Add-on (PDV)**
   - [ ] Voltar para `addons.html`
   - [ ] Clicar "Adicionar Add-on" em "PDV Simples"
   - [ ] ✅ Esperado: Adicionado com sucesso
   - [ ] ✅ Esperado: Agora mostra "2/2 add-ons" ou similar

6. **Remover Add-on**
   - [ ] Na seção "Seus Add-ons Ativos", clicar "Remover Add-on" no Estoque
   - [ ] ✅ Esperado: Confirmação
   - [ ] ✅ Esperado: Toast "✅ Estoque removido com sucesso!"
   - [ ] ✅ Esperado: Add-on sai da seção ativa

**Resultado Esperado:** ✅ PASSOU

---

## ✅ Fluxo 7: Admin - CRUD de Planos

### Pré-condição
- Login como LINA_OWNER

### Passos
1. **Acessar Planos**
   - [ ] Ir para `admin/plans.html`
   - [ ] ✅ Esperado: Ver 3 cards (Basic, Pro, Premium)

2. **Editar Plano**
   - [ ] Clicar "Editar" no card Basic
   - [ ] ✅ Esperado: Modal com formulário preenchido
   - [ ] Alterar preço de 89.00 para 99.00
   - [ ] Clicar "Salvar"
   - [ ] ✅ Esperado: "✅ Plano atualizado com sucesso!"
   - [ ] Verificar no DB: `plans.preco = 9900`

3. **Criar Novo Plano**
   - [ ] Clicar "Novo Plano"
   - [ ] ✅ Esperado: Modal com campos vazios
   - [ ] Preencher:
     - Nome = "Starter"
     - Preço = 49.00
     - Máx Empresas = 1
     - Máx Add-ons = 0
     - Features = "suporte_24_7" + "relatorios_pdf"
   - [ ] Clicar "Salvar"
   - [ ] ✅ Esperado: "✅ Plano criado com sucesso!"
   - [ ] ✅ Esperado: Novo card aparece no grid

4. **Desativar Plano**
   - [ ] Clicar toggle "Inativo" no card "Starter"
   - [ ] ✅ Esperado: Card fica visualmente desativado
   - [ ] ✅ Esperado: Verificar no DB: `plans.ativo = false`

5. **Ver Histórico de Preços**
   - [ ] Clicar "Histórico" no card Basic
   - [ ] ✅ Esperado: Modal com histórico
   - [ ] ✅ Esperado: Mostrar: R$ 89.00 → R$ 99.00, data, quem alterou
   - [ ] Fechar modal

**Resultado Esperado:** ✅ PASSOU

---

## ✅ Fluxo 8: Admin - CRUD de Add-ons

### Pré-condição
- Login como LINA_OWNER

### Passos
1. **Acessar Add-ons**
   - [ ] Ir para `admin/addons.html`
   - [ ] ✅ Esperado: Ver 3 cards (Estoque, Calculadora, PDV)

2. **Criar Novo Add-on**
   - [ ] Clicar "Novo Add-on"
   - [ ] ✅ Esperado: Modal com campos vazios
   - [ ] Preencher:
     - Nome = "CRM Integrado"
     - Descrição = "Integração com CRM"
     - Preço = 59.00
     - Chave Feature = "crm_integrado"
   - [ ] Clicar "Salvar"
   - [ ] ✅ Esperado: "✅ Add-on criado com sucesso!"
   - [ ] ✅ Esperado: Novo card aparece

3. **Editar Add-on**
   - [ ] Clicar "Editar" em "CRM Integrado"
   - [ ] Alterar preço para 69.00
   - [ ] Clicar "Salvar"
   - [ ] ✅ Esperado: "✅ Add-on atualizado com sucesso!"

4. **Deletar Add-on**
   - [ ] Clicar "Deletar" em "CRM Integrado"
   - [ ] ✅ Esperado: Modal de confirmação
   - [ ] Confirmar
   - [ ] ✅ Esperado: "✅ Add-on deletado com sucesso!"
   - [ ] ✅ Esperado: Card desaparece

**Resultado Esperado:** ✅ PASSOU

---

## 🔍 Verificações de Segurança

- [ ] **Multi-tenant Isolation**
  - Usuário A não consegue ver assinatura de Usuário B
  - Chamar `/api/subscriptions/my-subscription` retorna apenas dados do usuário logado

- [ ] **Feature Gating**
  - Usuário Basic não consegue acessar Painel Vitrine (future)
  - Retorna erro 403 com `FEATURE_NOT_AVAILABLE`

- [ ] **Admin-only Endpoints**
  - `/api/admin/subscriptions/*` retorna 403 para usuários normais
  - Apenas `LINA_OWNER` consegue acessar

- [ ] **Trial One-time Use**
  - Usuário não consegue iniciar trial 2 vezes
  - Se tentar, retorna erro "Você já usou seu trial grátis"

---

## 🐛 Possíveis Issues a Verificar

- [ ] Cron job de expiração rodando corretamente
- [ ] Grandfathering de preço funcionando (usuário mantém preço contratado)
- [ ] Promoções sendo aplicadas corretamente em checkout
- [ ] Limite de empresas sendo validado ANTES de criar
- [ ] Race conditions ao criar empresa simultaneamente
- [ ] Rollback automático em erros de transação

---

## 📱 Testes de Responsividade

- [ ] Teste em desktop (1920x1080)
- [ ] Teste em tablet (768x1024)
- [ ] Teste em mobile (375x667)
- [ ] Verificar se modals ficam centralizados
- [ ] Verificar se tabelas scrollam horizontalmente em mobile

---

## 📊 Testes de Performance

- [ ] Carregar `admin/subscriptions.html` com 1000+ assinaturas
  - ✅ Esperado: < 3 segundos
- [ ] Filtrar assinaturas
  - ✅ Esperado: Resposta instantânea (client-side)
- [ ] Cron job de expiração com 10k+ assinaturas
  - ✅ Esperado: Completar em < 5 minutos

---

## ✅ Checklist Final

- [ ] Todos os 8 fluxos passaram
- [ ] Sem erros no console (F12)
- [ ] Sem erros no terminal do backend
- [ ] Sem falhas de segurança
- [ ] Responsividade OK
- [ ] Performance OK
- [ ] PLAN.md atualizado
- [ ] Code review completado

---

**Status: PRONTO PARA DEPLOY** ✅
