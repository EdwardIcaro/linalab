# CLAUDE.md — Lina X

Guia para o Claude Code ao trabalhar neste repositório.

---

## Visão Geral

**Lina X** é um sistema de gestão para lava-jatos (SaaS multi-tenant). Gerencia ordens de serviço, clientes/veículos, funcionários, comissões, financeiro e controle de caixa.

**Idioma:** Todo o código, comentários e respostas em **português brasileiro**.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express 5 + TypeScript + Prisma ORM |
| Banco (dev) | SQLite |
| Banco (prod) | PostgreSQL via Neon |
| Frontend | HTML5 + CSS3 + JavaScript vanilla (sem framework) |
| Package Manager | pnpm |
| Alpine.js | v3 (usado em páginas complexas: `financeiro.html`, `fila-entrada.html`) |

---

## Deploy & Produção

- **Frontend**: Vercel — auto-deploy ao push no GitHub
- **Backend**: Railway — auto-deploy ao push no GitHub
- ⚠️ **Railway free tier**: deploys bloqueados das **9h às 21h (horário de Brasília)**. Só funciona entre 21h–9h.
- Toda mudança requer `git commit + push` para ser testada em produção.

---

## Comandos Comuns

```bash
# Backend (dentro de /backend)
pnpm dev              # Dev server com hot reload (porta 3001)
pnpm build            # Compila TypeScript → dist/
pnpm start            # Roda build de produção

# Banco de dados
pnpm db:generate      # Gera Prisma Client
pnpm db:push          # Aplica schema sem migrations (dev)
pnpm db:migrate       # Cria e aplica migrations
pnpm db:studio        # Abre Prisma Studio GUI
pnpm db:seed          # Seed inicial
```

---

## Arquitetura

### Fluxo de Requisição
```
Frontend HTML → window.api.* (api.js) → Express Router → Controller → Prisma → DB
```

### Multi-Tenancy
- `Usuario` pode ter múltiplas `Empresa`
- Todos os dados têm `empresaId`
- Dois middlewares de auth:
  - `userAuthMiddleware` — autentica usuário apenas
  - `authMiddleware` — autentica usuário + valida escopo da empresa
- JWT contém `empresaId` após seleção de empresa
- Middleware injeta `(req as any).empresaId` e `(req as any).usuarioNome`

### Entidades Principais
```
Usuario → Empresa → Cliente → Veiculo
                  → Lavador
                  → Servico + Adicional
                  → OrdemServico → Pagamento
                  → CaixaRegistro + FechamentoCaixa + AberturaCaixa
                  → Subscription
```

### Permissões
- Model `Role` com `Permissao[]` por empresa
- `permissionMiddleware.can('nome_permissao')` nas rotas
- Permissões chave: `ver_financeiro`, `gerenciar_ordens`, `gerenciar_clientes`, `gerenciar_configuracoes`

### Background Jobs
- Cron a cada 15 min: auto-finalização de ordens (`processarFinalizacoesAutomaticas`)
- Cron a cada 6h: expiração de assinaturas
- Cron 09h diário: avisos de trial expirando

---

## Estrutura de Arquivos

```
/backend
  /src
    /controllers     → lógica de requisição (caixaController, ordemController…)
    /services        → lógica de negócio (emailService, whatsappService…)
    /routes          → mapeamento HTTP
    /middlewares     → authMiddleware, permissionMiddleware
  /prisma
    schema.prisma
    /migrations

/DESKTOPV2           → Frontend (deploy na Vercel)
  api.js             → TODOS os chamados de API via window.api.*
  utils.js           → Utilitários compartilhados (admin)
  index.html         → Dashboard
  ordens.html        → Ordens de serviço
  financeiro.html    → Financeiro (Alpine.js)
  clientes.html      → CRM
  comissoes.html     → Comissões
  configuracoes.html → Configurações da empresa
  fila-entrada.html  → Criação em massa de ordens (Alpine.js)
  /funcionario       → Portal do funcionário (mobile-first)
    utils-funcionario.js
    index-funcionario.html
    ordens-funcionario.html
    financeiro-funcionario.html
    servicos-funcionario.html
    fila-entrada-funcionario.html
    comissoes-funcionario.html

/Features            → Specs de features futuras (leia antes de implementar!)
  fila-de-entrada.md             ✅ Implementado
  abertura-fechamento-caixa.md   ✅ Implementado
  ocr-placa.md                   ⏳ Planejado
  whatsapp-command-center.md     ⏳ Planejado
  whatsapp-vision.md             ⏳ Planejado
```

---

## Pasta `/Features` — Regra Importante

Antes de implementar qualquer feature nova, **leia o arquivo correspondente em `/Features`**.
Os arquivos contêm: fluxo completo, arquivos afetados, SQL necessário, UX esperada e observações.

---

## Portal do Funcionário (`/DESKTOPV2/funcionario`)

Acesso separado para usuários com role `USER`. Regras:
- Auth: `localStorage.getItem('token')` + `localStorage.getItem('userRole') === 'USER'`
- API path: `../api.js` (relativo à subpasta `/funcionario`)
- Utilitários: `utils-funcionario.js` (diferente do `utils.js` do admin)
- Tema: `--primary: #0066cc` (azul funcionário)
- Design: **mobile-first obrigatório** — todas as páginas devem funcionar bem em celular

---

## Frontend — Padrões Importantes

### api.js
- Todos os chamados HTTP passam por `window.api.*`
- `fetchApi(path, options)` é a função base interna

### Alpine.js
- `financeiro.html`: componente `financeDashboard`
- `fila-entrada.html` / `fila-entrada-funcionario.html`: componente `filaEntrada`
- ⚠️ `<template x-for>` dentro de `<td>/<tr>` é relocado pelo parser HTML antes do Alpine processar → **sempre usar CSS Grid com `<div>` em vez de `<table>` para layouts tabulares Alpine**

### CSS Grid para layouts tabulares (Alpine)
```css
.fila-grid-row {
    display: grid;
    grid-template-columns: 36px 120px 170px 95px 115px 1fr 150px 105px 40px;
}
```
Garante alinhamento imune a interferência do parser. Headers e data rows usam o mesmo template.

### Respostas de API — extrair corretamente
- `getLavadoresSimple()` → retorna `{ lavadores: [...] }` — extrair com `res.lavadores`
- `getServicos()` → retorna `{ servicos: [...], pagination: {} }` — extrair com `res.servicos`
- `getVeiculoByPlaca(placa)` → retorna objeto veículo ou null

---

## Controle de Caixa — Lógica Atual

```
Hoje tem AberturaCaixa?
  NÃO → notOpened: true, isOpen: false
  SIM →
    Hoje tem FechamentoCaixa?
      SIM → isOpen: false
      NÃO → isOpen: true
```

- `GET /caixa/status` → `{ isOpen, notOpened, paymentMethodsConfig, currentUserNome }`
- `POST /caixa/abertura` → `{ valorInicial, abertoPor }`
- `POST /caixa/fechamento` → `{ valoresDigitados: { DINHEIRO, PIX, CARTAO, NFE } }`
- O "dia" é calculado por `getWorkdayRange(empresaId)` usando `horarioAbertura` da empresa

---

## ⚠️ Prisma Migrations — SQL Manual para Neon

**TODA** alteração em `schema.prisma` deve gerar SQL puro para execução manual no Neon.

### Por quê?
- Neon free tier pode ter problemas com migrations automáticas
- Controle explícito do que foi executado em produção

### Fluxo obrigatório:
1. Alterar `schema.prisma`
2. Converter para SQL puro
3. Apresentar o SQL no chat para o usuário executar no **Neon Dashboard → SQL Editor**
4. Confirmar execução, então fazer `git push`

### Exemplo:
```sql
ALTER TABLE "FechamentoCaixa" ADD COLUMN IF NOT EXISTS "nfe" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "FechamentoCaixa" ADD COLUMN IF NOT EXISTS "relatorio" TEXT;
ALTER TABLE "FechamentoCaixa" ADD COLUMN IF NOT EXISTS "fechadoPor" TEXT;
```

⚠️ Não confiar em `npx prisma db push` ou migrations automáticas no Railway/Neon.

---

## SaaS — Sistema de Assinaturas

- **Basic**: R$ 89/mês — 1 empresa
- **Pro**: R$ 169/mês — 2 empresas + Painel Vitrine
- **Premium**: R$ 279/mês — 5 empresas + Lina WhatsApp
- Trial de 7 dias (one-time use por usuário)
- Modelos Prisma: `SubscriptionPlan`, `Subscription`, `SubscriptionAddon`, `Promotion`, `PriceHistory`
- Feature keys validadas por `requireFeature` middleware

---

## WhatsApp

- Bot implementado via **Baileys** (Evolution API)
- Instâncias por empresa em `WhatsappInstance`
- Auth state persistido no banco
- Comandos de texto processados por IA (Groq + LLaMA)
- Features futuras planejadas em `/Features/whatsapp-command-center.md` e `/Features/whatsapp-vision.md`

---

## Variáveis de Ambiente (Backend)

```
DATABASE_URL      → SQLite (dev) / PostgreSQL Neon (prod)
SECRET_KEY        → JWT signing secret
PORT              → porta do servidor (padrão 3001)
SENDGRID_API_KEY  → email notifications
```
