# 🧪 Mapa de Testes — Ecossistema Lina (Fases 0–3)

> Criado em: 2026-05-11
> Cobre: fixes de build, Hub, Portal do Colaborador, Admin Planos, Data Point Fase 3

---

## ✅ Fixes de Build / Deploy

| # | O que testar | Como testar | Esperado |
|---|---|---|---|
| 1 | Build Railway subindo | Ver logs no Railway dashboard | Build verde, sem erros TypeScript |
| 2 | Rota `/api/hub` respondendo | Abrir `hub.html` logado | Hub carrega empresas sem 404 |

---

## 🏢 Hub de Empresas

| # | O que testar | Como testar | Esperado |
|---|---|---|---|
| 3 | Status "Vitalício" | Admin concede lifetime → abrir `hub.html` | Badge exibe "Vitalício" (não "Expirado") |
| 4 | Status "Trial" | Usuário em trial → `hub.html` | Badge exibe "Trial · X dias" |
| 5 | Status "Ativo" | Usuário com plano pago → `hub.html` | Badge exibe "Ativo" |
| 6 | Selecionar empresa Lina Wash | Clicar num card de empresa no hub | Redireciona para `index.html` com token scoped |
| 7 | Marketplace — abrir Data Point | Clicar "Explorar sistemas" → expandir Data Point | Mostra botão "Ver planos e contratar" (não "Em breve") |
| 8 | CTA Data Point | Clicar "Ver planos e contratar" | Redireciona para `data-point-planos.html` |

---

## 👤 Portal do Colaborador (`/p/TOKEN`)

### Geração de link

| # | O que testar | Como testar | Esperado |
|---|---|---|---|
| 9 | Gerar link permanente em `funcionarios.html` | Clicar no botão de gerar link de um lavador | Toast "Link permanente copiado", link no formato `/p/XXXXXXXX` |
| 10 | Gerar link permanente em `configuracoes.html` | Na seção de tokens, clicar "Copiar Link" | Gera e copia `/p/TOKEN` |
| 11 | "Acessar Link" em `configuracoes.html` | Clicar botão "Acessar Link" de um lavador | Abre nova aba com `/p/TOKEN` |
| 12 | Link antigo `lavador-publico.html` | Acessar `lavador-publico.html?token=XXXX` | Exibe tela "Link desatualizado — gere um novo" |

### Acesso e autenticação por PIN

| # | O que testar | Como testar | Esperado |
|---|---|---|---|
| 13 | Link inválido | Acessar `/p/XXXXXXXX` com token inexistente | Tela de erro "Link inválido" |
| 14 | Primeiro acesso — setup PIN | Lavador sem PIN acessa o link | Tela "Crie seu PIN de 4 dígitos" |
| 15 | Setup PIN — PINs diferentes | Digitar PINs diferentes nas duas etapas | Mensagem "Os PINs não coincidem" |
| 16 | Setup PIN — correto | Digitar mesmo PIN duas vezes | Entra no dashboard automaticamente |
| 17 | Login com PIN | Lavador com PIN acessa o link | Tela "Digite seu PIN" |
| 18 | PIN errado | Digitar PIN incorreto | Dots ficam vermelhos, mensagem de erro |
| 19 | PIN correto | Digitar PIN certo | Entra no dashboard |
| 26 | Rate limit PIN | Errar PIN 10x seguidas | Mensagem "Muitas tentativas. Tente em 1 hora" |

### Dashboard por tipo de remuneração

| # | O que testar | Como testar | Esperado |
|---|---|---|---|
| 20 | Dashboard `COMISSAO` | Lavador com `tipoRemuneracao = COMISSAO` | Mostra ganhos hoje, ordens do dia, resumo do mês |
| 21 | Dashboard `SALARIO` | Lavador com `tipoRemuneracao = SALARIO` | Mostra card de salário base, sem comissões |
| 22 | Dashboard `SALARIO_COMISSAO` | Lavador com `tipoRemuneracao = SALARIO_COMISSAO` | Mostra card salário + ganhos do dia |

### Sessão e navegação

| # | O que testar | Como testar | Esperado |
|---|---|---|---|
| 23 | Sessão persiste | Fechar e reabrir o link | Entra direto no dashboard sem pedir PIN |
| 24 | Botão Sair | Clicar "Sair" e confirmar | Volta para tela de PIN |
| 25 | Aba Histórico | Clicar "Histórico" na nav inferior | Mostra total do mês |

---

## 🛠️ Admin — Planos por Sistema

> **Pré-requisito:** executar o SQL abaixo no Neon antes de testar:
> ```sql
> ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "sistema" TEXT NOT NULL DEFAULT 'lina-wash';
> ```

| # | O que testar | Como testar | Esperado |
|---|---|---|---|
| 27 | Tab "Todos" em `plans.html` | Abrir `admin/plans.html` | Lista todos os planos (todos como Lina Wash por padrão) |
| 28 | Tab "Lina Wash" | Clicar tab Lina Wash | Filtra só planos Lina Wash |
| 29 | Tab "Data Point" | Clicar tab Data Point | Lista vazia (nenhum plano DP criado ainda) |
| 30 | Criar plano Data Point | "Novo Plano" → Sistema: Data Point → preencher e salvar | Plano aparece na tab Data Point com badge teal |
| 31 | Editar plano existente | Editar um plano Lina Wash | Campo Sistema mostra "Lina Wash", valores corretos |
| 32 | Filtro Sistema em `subscriptions.html` | Filtrar por "Data Point" | Mostra só assinaturas DP (vazio por enquanto) |
| 33 | Coluna Sistema na tabela | Ver lista de assinaturas | Coluna "Sistema" exibe emoji + nome do produto |

---

## ⏰ Data Point — Fase 3 (Contratação + Onboarding)

### Página de planos (`data-point-planos.html`)

| # | O que testar | Como testar | Esperado |
|---|---|---|---|
| 34 | Sem fidelidade | Usuário sem Lina Wash abre `data-point-planos.html` | Sem banner de fidelidade |
| 35 | Com fidelidade | Usuário com Lina Wash ativo abre `data-point-planos.html` | Banner "Desconto fidelidade Lina Wash" visível |
| 36 | Promoção aplicada | Admin cria promoção em plano DP → usuário abre planos | Preço riscado + badge "🏷️ -X% fidelidade" |
| 37 | Contratar trial | Clicar "Começar grátis" → confirmar | Redireciona para `data-point-onboarding.html` |
| 38 | Bloquear segundo trial | Tentar contratar novamente após já ter DP ativo | Banner "Data Point ativo" + botão "Ir para configuração" |

### Onboarding 3 passos (`data-point-onboarding.html`)

| # | O que testar | Como testar | Esperado |
|---|---|---|---|
| 39 | Passo 1 — carregamento | Abrir `data-point-onboarding.html` | Lista empresas do hub, slider de raio (padrão 80m), campo horário |
| 40 | Empresa já com DP | Empresa com DP já ativo aparece na lista | Card desabilitado com badge "✓ Ativo" |
| 41 | Avançar sem selecionar empresa | Clicar "Próximo" sem selecionar | Alert "Selecione uma empresa para continuar" |
| 42 | Passo 2 — lavadores | Selecionar empresa e avançar | Lista lavadores da empresa com checkboxes |
| 43 | Selecionar / desmarcar lavadores | Marcar e desmarcar lavadores | Rows ficam em teal ao selecionar, voltam ao normal ao desmarcar |
| 44 | Lavador já importado | Lavador que já tem `dp_funcionario` vinculado | Aparece desabilitado com badge "Já importado" |
| 45 | Passo 3 — resumo | Avançar para confirmação | Resumo: empresa, horário, raio, lista de selecionados |
| 46 | Editar do resumo | Clicar "Editar" em qualquer seção do resumo | Volta para o passo correspondente |
| 47 | Ativar Data Point | Clicar "Ativar Data Point" | Tela de sucesso animada com ícone ⏰ |
| 48 | Hub após ativação | Voltar ao hub após ativar | Empresa aparece na seção Data Point do hub |

---

## 📋 Checklist de SQL executado no Neon

| Data | SQL | Status |
|---|---|---|
| 2026-05-10 | Enums `TipoRemuneracao`, `BaseComissao`; campos `tipoRemuneracao`, `baseComissao`, `salario` em `lavadores` | ✅ |
| 2026-05-10 | Tabelas `empresa_sistemas`, `dp_funcionarios`, `dp_marcacoes`, `gorjetas` | ✅ |
| 2026-05-11 | `ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "sistema" TEXT NOT NULL DEFAULT 'lina-wash'` | ⏳ Pendente |

---

*Total: 48 casos de teste*
*Próxima fase: Fase 4 — Dashboard Data Point + Marcação de Ponto PWA*
