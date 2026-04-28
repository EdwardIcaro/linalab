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
| Alpine.js | v3 (usado em páginas complexas) |

---

## Deploy & Produção

- **Frontend**: Vercel — auto-deploy ao push no GitHub. **Atualiza imediatamente a qualquer hora.**
- **Backend**: Railway — auto-deploy ao push no GitHub. ⚠️ **Railway free tier**: deploys bloqueados das **9h às 21h (horário de Brasília)**. Só funciona entre **21h–9h**.
- **Bot WhatsApp**: PC local — gerenciado via PM2 + **ngrok** (túnel público). **Não reinicia com deploys do backend.** Porta 3000.
- Toda mudança requer `git commit + push` para ser testada em produção.

> **Regra prática**: mudanças **só de frontend** (HTML/CSS/JS em `/DESKTOPV2`) são imediatas no Vercel.
> Mudanças de **backend** (controllers, rotas, services) só entram em produção a partir das **21h BRT**.
> Mudanças no **bot** (`/bot`) precisam de `pnpm build && pm2 restart lina-bot` no PC local.

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
                                 → pixTxId, pixStatus, pixQrCode, pixValor, pixExpiraEm
                  → CaixaRegistro + FechamentoCaixa + AberturaCaixa
                  → BankIntegration   (config PIX por empresa)
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
- ~~Cron a cada 10 min: reconexão WhatsApp~~ — removido; bot gerencia a própria sessão no VPS

---

## Estrutura de Arquivos

```
/backend
  /src
    /controllers     → lógica de requisição (caixaController, ordemController…)
    /services        → lógica de negócio (emailService, botServiceClient, pixService…)
                       ⚠️  baileyService.ts NÃO existe mais no backend — foi movido para /bot
    /routes          → mapeamento HTTP
    /middlewares     → authMiddleware, permissionMiddleware
    /@types          → declarações de tipos para pacotes sem @types (ex: pix-payload.d.ts)
  /prisma
    schema.prisma
    /migrations

/bot                 → Bot WhatsApp (deploy no Oracle VPS via PM2, não no Railway)
  /src
    index.ts         → Express server com endpoints REST protegidos por X-Bot-Secret
    /services        → baileyService, whatsappCommandHandler, pairingCodeStore, botUserCodeStore…
    /middleware
      botAuth.ts     → valida header X-Bot-Secret
  /scripts
    scan-local.ts    → rodar LOCALMENTE para scan inicial do QR e salvar auth no Neon
  /prisma
    schema.prisma    → cópia do schema do backend (manter sincronizado)

/DESKTOPV2           → Frontend (deploy na Vercel)
  api.js             → TODOS os chamados de API via window.api.*
  utils.js           → Utilitários compartilhados (admin)
  index.html         → Dashboard
  ordens.html        → Ordens de serviço
  historico.html     → Histórico de ordens finalizadas
  financeiro.html    → Financeiro (Alpine.js)
  clientes.html      → CRM
  comissoes.html     → Comissões
  configuracoes.html → Configurações da empresa
  configuracoes-whatsapp.html → Config WhatsApp + PIX (Alpine.js)
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
  ocr-placa.md                   ✅ Implementado
  whatsapp-pix.md                ✅ Fase 1 implementada (PIX estático)
  whatsapp-command-center.md     ⏳ Planejado
  whatsapp-vision.md             ⏳ Planejado

  /front             → Protótipos HTML estáticos (sem backend)
    nova-ordem.html  → Redesign da tela de nova ordem (Alpine.js + mock data)
    ⚠️  Estes arquivos são apenas para validação visual.
        Não modificar backend para servi-los.
        Dados são mock/hardcoded.
```

---

## Pasta `/Features` — Regra Importante

Antes de implementar qualquer feature nova, **leia o arquivo correspondente em `/Features`**.
Os arquivos contêm: fluxo completo, arquivos afetados, SQL necessário, UX esperada e observações.

### `/Features/front` — Protótipos Visuais
Antes de alterar qualquer página de produção em `/DESKTOPV2`, criar primeiro um protótipo em `/Features/front/`.
- Dados hardcoded (mock), sem chamadas de API
- Alpine.js via CDN para interatividade
- Usado para validar design antes de ir para produção

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
- `configuracoes-whatsapp.html`: componente inline com `x-data`
- `fila-entrada.html` / `fila-entrada-funcionario.html`: componente `filaEntrada`
- ⚠️ `<template x-for>` dentro de `<td>/<tr>` é relocado pelo parser HTML antes do Alpine processar → **sempre usar CSS Grid com `<div>` em vez de `<table>` para layouts tabulares Alpine**

### CSS Grid para layouts tabulares (Alpine)
```css
.fila-grid-row {
    display: grid;
    grid-template-columns: 36px 120px 170px 95px 115px 1fr 150px 105px 40px;
}
```

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
- O "dia" é calculado por `getWorkdayRangeBRT(date, horarioAbertura)` usando `horarioAbertura` da empresa

---

## Financeiro vs Histórico — Divergência de Design (Intencional)

As duas telas usam âncoras de data diferentes — isso é correto por design:

| Tela | Tabela | Campo de data | Pergunta respondida |
|---|---|---|---|
| `financeiro.html` | `Pagamento` | `pagoEm` | Quanto entrou no caixa neste período? |
| `historico.html` | `OrdemServico` | `dataFim` | Quais serviços foram concluídos neste período? |

**Regras aplicadas:**
- `historico.html` — exclui ordens com `pagamento.status === 'PENDENTE'` do total de receita
- `historico.html` — filtra por `dataFim` (não `createdAt`) quando `tipo=historico` no backend
- `financeiro.html` — conta apenas `Pagamento.status = 'PAGO'` no `totalEntradas`
- Ordens canceladas **não entram** em nenhum total: historico filtra por `FINALIZADO`; financeiro usa pagamentos `PAGO` que nunca existem em ordens canceladas (não é possível cancelar ordem já finalizada)

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

### SQL pendente para produção (PIX):
```sql
CREATE TABLE IF NOT EXISTS "bank_integrations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "empresaId" TEXT NOT NULL UNIQUE,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "chavePix" TEXT, "tipoPix" TEXT, "banco" TEXT,
  "clientId" TEXT, "clientSecret" TEXT, "certCrt" TEXT, "certKey" TEXT,
  "accessToken" TEXT, "tokenExpiresAt" TIMESTAMP(3),
  "pixExpiracaoMin" INTEGER NOT NULL DEFAULT 30,
  "nomeRecebedor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_integrations_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE
);
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "pixTxId" TEXT;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "pixStatus" TEXT;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "pixPagoEm" TIMESTAMP(3);
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "pixValor" DOUBLE PRECISION;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "pixQrCode" TEXT;
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "pixExpiraEm" TIMESTAMP(3);
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

## WhatsApp (Baileys)

### Arquitetura — Bot no PC Local via ngrok

```
[Backend Railway] ──HTTP POST /send──▶ [ngrok túnel] ──▶ [PC local :3000] ──▶ WhatsApp
                 ◀──status/QR──────────
```

- **Bot service**: roda no **PC local** na porta 3000, gerenciado por PM2
- **ngrok**: expõe a porta 3000 publicamente — a URL do ngrok é configurada em `BOT_SERVICE_URL` no Railway
- **Backend**: comunica via `botServiceClient.ts` — todas as chamadas WhatsApp são HTTP para o ngrok
- **Auth state**: persistido no Neon (`authState` em `WhatsappInstance`, instância `lina-global`)
- Deploys do backend **não afetam** o bot — sessão persiste

### Bot — Comandos PC Local
```bash
pm2 status                              # Ver status
pm2 logs lina-bot --lines 30           # Ver logs
pm2 flush lina-bot                     # Limpar logs acumulados

# Atualização só de código (sem mudança no schema Prisma):
git pull && pnpm build:fast && pm2 restart lina-bot

# Atualização com mudança no schema Prisma (precisa regenerar cliente):
pm2 stop lina-bot && git pull && pnpm build && pm2 start lina-bot
```
> `pnpm build:fast` pula o `prisma generate` → evita o erro EPERM de DLL bloqueada.
> Só usar `pnpm build` quando o `schema.prisma` foi alterado.

### Estado de conexão (`baileyService.ts` no bot)
```
disconnected → reconnecting → connected
                           → qr_code → connected
```

### Quando sessão expirar / for revogada
1. `rmdir /s /q "%TEMP%\baileys-scan-local"` (limpar cache local Windows)
2. `cd C:\LinaX\bot && npx ts-node --transpile-only scripts/scan-local.ts`
3. Escanear QR, aguardar `✅ Auth state salvo`
4. `pm2 restart lina-bot` (no PC local)

### Comandos PIX (Fase 1 — PIX estático)
- `pix 432` ou `pix ordem 432` → gera QR Code PIX e envia como imagem
- `reenviar pix 432` → reenvia QR existente sem criar novo
- `ordens` → lista ordens ativas da empresa
- PIX usa `transactionId: '***'` (BCB spec para QR estático reutilizável)
- ⚠️ Usar `transactionId` real causa bancos mostrarem como "PIX Agendado" — nunca fazer isso

### Config PIX por empresa
- Tabela `BankIntegration` com `chavePix`, `tipoPix`, `nomeRecebedor`, `pixExpiracaoMin`
- Configurado em `configuracoes-whatsapp.html`
- Fase 2 (PIX dinâmico via Cora/Inter) — aguardando aprovação de parceria

### Relatórios — filtro de status e âncora de data
Queries de resumo/faturamento no bot e no sistema usam:
```typescript
status: { in: ['FINALIZADO', 'AGUARDANDO_PAGAMENTO'] }
dataFim: { gte: start, lte: end }  // âncora: quando o serviço foi concluído
```
- `AGUARDANDO_PAGAMENTO` é incluído pois o serviço já foi concluído — apenas o pagamento está pendente
- `dataFim` é setado automaticamente ao mudar para `AGUARDANDO_PAGAMENTO` ou `FINALIZADO`
- Ordens canceladas nunca têm `dataFim` → ficam fora dos relatórios automaticamente

---

## Timezone — Regra Crítica

**O backend roda em UTC (Railway). O bot roda em UTC (Oracle VPS). Nunca usar `setHours()` ou `setDate()` diretamente.**

### Utilitário centralizado: `backend/src/utils/dateUtils.ts`

```typescript
import { getDateRangeBRT, getTodayRangeBRT, getMonthRangeBRT, getWorkdayRangeBRT } from '../utils/dateUtils';

// Dia completo em BRT a partir de string YYYY-MM-DD
const { start, end } = getDateRangeBRT('2026-04-28');
// → start = 2026-04-28T03:00:00Z (00:00 BRT)
// → end   = 2026-04-29T02:59:59.999Z (23:59 BRT)

// Hoje em BRT
const { start, end } = getTodayRangeBRT();

// Mês em BRT (month é 1-based)
const { start, end } = getMonthRangeBRT(2026, 4);

// Turno da empresa (usa horarioAbertura configurado)
const { start, end } = getWorkdayRangeBRT(new Date(), empresa.horarioAbertura);
```

### Por que isso importa
- `new Date()` e `setHours(0,0,0,0)` usam hora local do servidor (UTC no Railway/VPS)
- Meia-noite UTC = 21:00 BRT do dia anterior → janelas erradas
- `getDateRangeBRT('2026-04-28')` sempre devolve 00:00–23:59 BRT independente do servidor

### Âncora de data nas ordens
| Campo | Quando é preenchido | Usado por |
|---|---|---|
| `createdAt` | Criação da OS | Pátio (carros ativos criados hoje) |
| `dataFim` | Status → `AGUARDANDO_PAGAMENTO` ou `FINALIZADO` | Todos os relatórios de faturamento |
| `Pagamento.pagoEm` | Pagamento confirmado como PAGO | `getResumoDia` (caixa físico) |

**Regra:** relatórios de faturamento usam `dataFim`. A OS pertence ao dia em que o serviço foi concluído, não ao dia em que o pagamento entrou.

---

## Comissões — Regras de Cálculo

### Multi-lavador (divisão proporcional)
Quando múltiplos lavadores trabalham na mesma OS, cada um recebe sua % **dividida pelo número de lavadores**:

```
ganho = item.subtotal × (% do lavador ÷ N lavadores) ÷ 100
```

Ex: 2 lavadores (35% e 40%) em OS de R$100:
- Lavador A: R$100 × (35% ÷ 2) = **R$17,50**
- Lavador B: R$100 × (40% ÷ 2) = **R$20,00**
- Total pago pelo negócio: **R$37,50** (média das taxas)

### Desconto afeta a comissão
Ao finalizar com desconto, `ganho` de cada `OrdemServicoLavador` é recalculado:
```
ganho = item.subtotal × descontoFator × (% ÷ N) ÷ 100
descontoFator = valorFinal / valorTotal
```
O campo `OrdemServicoLavador.ganho` é atualizado na mesma transação atômica da finalização.

### comissaoPaga — verificação por lavador
Em multi-wash, `comissaoPaga` é por lavador em `OrdemServicoLavador`, não no `OrdemServico`.
Sempre checar `ordemLavadores.find(r => r.lavadorId === id).comissaoPaga` — não `ordem.comissaoPaga`.

---

## Variáveis de Ambiente

### Backend (Railway)
```
DATABASE_URL        → PostgreSQL Neon (prod)
SECRET_KEY          → JWT signing secret
PORT                → porta do servidor (padrão 3001)
SENDGRID_API_KEY    → email notifications
BOT_SERVICE_URL     → http://168.75.107.236:3000  (VPS Oracle)
BOT_SECRET          → segredo compartilhado com o bot (header X-Bot-Secret)
```

### Bot (Oracle VPS — ~/linalab/bot/.env)
```
DATABASE_URL        → mesmo Neon do backend
BOT_SECRET          → mesmo valor do backend
GROQ_API_KEY        → chave Groq para IA de comandos
PORT                → 3000
```
