# Update 13–15/04/2026

## Resumo
Sessão intensa de correções de bugs, melhorias de UX e novos recursos no sistema Lina X. Abrangeu backend (TypeScript/Prisma), frontend do funcionário (HTML/JS vanilla) e WhatsApp bot.

---

## 1. Sistema de Desconto no Pagamento (funcionário)

**Arquivos:** `ordens-funcionario.html`, `schema.prisma`, `ordemController.ts`, `usuarioController.ts`

- Modal de pagamento exibe desconto **somente** para usuários com `maxDesconto > 0` (carregado via `getMeuPerfil`)
- Dois inputs sincronizados: R$ e % (alterar um atualiza o outro em tempo real)
- Backend valida o limite: subaccount não pode ultrapassar sua porcentagem configurada
- OWNER sem `subaccountId` no JWT não tem restrição de desconto
- Pay-summary exibe o total original tachado quando desconto está ativo
- Campo `desconto Float @default(0)` adicionado ao model `OrdemServico` no schema
- `finalizarOrdem` valida, calcula `valorFinal` e salva no banco; comissão calculada sobre `valorFinal`

**SQL executado no Neon:**
```sql
ALTER TABLE "ordens_servico" ADD COLUMN IF NOT EXISTS "desconto" DOUBLE PRECISION DEFAULT 0;
```

---

## 2. Três Ajustes de UX no Modal de Pagamento (funcionário)

**Arquivo:** `DESKTOPV2/funcionario/ordens-funcionario.html`

### 2a. Desconto Colapsível
- Desconto removido do topo (onde ficava proeminente) e movido para botão colapsível no rodapé do modal
- Botão fica **verde** com valor aplicado quando desconto está ativo; fecha o painel automaticamente após aplicar
- Fechar o modal reseta o painel e os inputs

### 2b. PIX QR sob Demanda
- PIX era gerado automaticamente ao ser adicionado — agora não gera mais
- Ao adicionar PIX na lista de pagamentos, aparece botão **"QR"** verde no item
- Clicar abre bottom-sheet modal com loading → QR Code + botão "Copiar código PIX"

### 2c. Editar Ordem Inline
- Botão "Editar" não redireciona mais para `nova-ordem-funcionario.html`
- Abre bottom-sheet modal com:
  - Textarea de observações (pré-preenchida)
  - Chips clicáveis de todos os lavadores da empresa (selecionados = vinculados à ordem)
- Salvar chama `updateOrdem` com `{ observacoes, lavadorIds }` e recarrega o detalhe

---

## 3. Modelo do Veículo nos Cards de Ordem

**Arquivo:** `DESKTOPV2/funcionario/ordens-funcionario.html`

- Cards de ordem agora exibem badge cinza com o modelo do veículo (ex: "Gol") antes da placa
- Campo `modelo` já era retornado pela API — só não estava sendo renderizado
- CSS: classe `.card-model` com `background: var(--bg2)` e `border: 1px solid var(--border)`

---

## 4. Correção de Pendências no Financeiro

**Arquivo:** `DESKTOPV2/financeiro.html`

- Tabela de pendências exibia `valorTotal` da ordem em vez do valor pendente real
- Fix: soma apenas os pagamentos com `metodo === 'PENDENTE'`, que contém o valor exato da dívida

---

## 5. Fluxo Conversacional de Saídas no WhatsApp

**Arquivo:** `backend/src/services/whatsappCommandHandler.ts`

- Substituiu "tudo em uma mensagem + confirmar" por formulário conversacional por etapas
- Etapas coletadas: `descrição → forma de pagamento → fornecedor → confirmação`
- Groq extrai o que for possível da mensagem inicial; campos faltantes são pedidos um a um
- Forma de pagamento aceita número (1/2/3/4) ou texto livre ("pix", "dinheiro", etc.)
- Fornecedor: cria ou reutiliza registro existente no banco
- Cancelamento com "não"/"cancelar" funciona em qualquer etapa
- Sessão estendida para 10 minutos de inatividade

---

## 6. Correção de Timezone em Lançamentos de Despesa

**Arquivo:** `backend/src/controllers/caixaController.ts`

- Bug: `new Date("2026-04-13")` gerava `T00:00:00Z` (meia-noite UTC), antes do turno das 07:00, causando despesas aparecerem no dia anterior
- Fix: data-only agora interpretada como `T12:00:00` (meio-dia UTC), dentro do turno correto
- Corrigido em `createSaida` e `editSaida`

**Arquivo:** `DESKTOPV2/financeiro.html`
- Campo de data inicializava com `toISOString().slice(0,10)` (UTC) → trocado por data local do browser
- Modal de edição: data exibida em horário local

---

## 7. Modal "Trocar de Empresa / Sair"

**Arquivo:** `DESKTOPV2/nav-menu-helper.js`

- Botão "Sair" abre mini-modal com duas opções:
  - **Trocar de Empresa** → limpa `empresaId`/`empresaNome` do localStorage → redireciona para `selecionar-empresa.html`
  - **Sair do Sistema** → `localStorage.clear()` + redirect para `login.html`
- Modal injetado dinamicamente no DOM (sem HTML extra em cada página)

**Arquivo:** `DESKTOPV2/index.html`
- Função `logout()` atualizada para chamar `window.showSairModal()` quando disponível

---

## 8. Correção de Build no Railway (TypeScript)

**Arquivo:** `backend/package.json`

- Build falhava com `TS2322: Type 'string | string[]' not assignable to 'string'` em `ordemController.ts`
- Fix: adicionado cast `as string` no endpoint `gerarPixQr` (linha 1702)
- `prisma generate` adicionado ao script de build (`"build": "rm -rf dist && prisma generate && tsc"`)
  - Sem isso, o Prisma Client em cache no Railway não refletia mudanças de schema (campo `desconto` faltando)

---

## 9. Correção de Desconexão do WhatsApp após Deploy

**Arquivo:** `backend/src/services/baileyService.ts`

- Bug: `authState` era limpo no banco sempre que a conexão caia (inclusive por reinício do servidor)
- Fix: `authState: null` agora só é salvo em caso de **logout real** (erro 401 após estar conectado)
- Em falhas de rede ou reinício, `authState` é preservado — reconecta automaticamente
- `restoreActiveSessions` busca instâncias com `authState IS NOT NULL` (não apenas `status: 'connected'`)

**Arquivo:** `backend/src/index.ts`
- Adicionado delay de 5 segundos antes de `restoreActiveSessions()` para rede estabilizar após cold start

---

## 10. Campo Modelo na Fila de Entrada

**Arquivo:** `DESKTOPV2/funcionario/fila-entrada-funcionario.html`

- Quando placa não encontrada no banco (estado `manual`), exibe input de modelo com borda laranja
- Criação bloqueada enquanto modelo estiver vazio (linha manual)
- `_buildPayload` usa `row.modelo` no `novoVeiculo` em vez do texto genérico `'Veículo'` hardcoded
- Veículo encontrado pela placa: `row.modelo` preenchido automaticamente da API

---

## 11. Nome do Cliente Opcional em Todo o Sistema

**Arquivo:** `backend/src/utils/validate.ts`
- Removida validação obrigatória de `novoCliente.nome`
- Quando vazio, `sanitizedData` define `nome: 'N/A'`

**Arquivo:** `backend/src/controllers/ordemController.ts`
- `nomeCliente = novoCliente.nome?.trim() || 'N/A'` antes de criar/buscar o cliente
- Condição `if (!finalClienteId && novoCliente && novoCliente.nome)` → `if (!finalClienteId && novoCliente)`

**Arquivo:** `DESKTOPV2/funcionario/fila-entrada-funcionario.html`
- Campo nome com placeholder `"Nome (opcional — N/A se vazio)"`; payload envia string vazia

---

## 12. Redesign do CRM de Clientes (funcionário)

**Arquivo:** `DESKTOPV2/funcionario/clientes-funcionario.html`

Reescrito do zero. Principais mudanças:

| Antes | Depois |
|---|---|
| Tabela HTML (ilegível no mobile) | Grid de cards responsivo |
| CSS hardcoded `#0066cc` | Mesmo tema do sistema (`--navy`, `--blue-d`, etc.) |
| 2 modais centralizados separados | Drawer bottom-sheet unificado (detalhe + edição) |
| Código de renderização duplicado na busca | Uma função `clienteCard()` compartilhada |
| Sem stats no card | Visitas / Veículos / Total gasto por card |
| Avatar genérico | Inicial do nome como avatar colorido |
| Nome obrigatório no formulário | Opcional com hint explicativo |
| Botão WhatsApp perdido na tabela | Botão contextual no card e no detalhe |

- Cards exibem: avatar com inicial, nome, telefone, tags de placa/modelo, estatísticas, ações rápidas
- Busca unificada por nome, telefone, placa ou modelo
- Formulário com seções "Dados pessoais" e "Veículos" (adicionar/remover dinamicamente)
- Confirmação de exclusão via `confirm()` antes de deletar

---

## 13. Modais de Caixa Inline no Index do Funcionário

**Arquivo:** `DESKTOPV2/index-funcionario.html`

- Botão hero de caixa não redireciona mais para `financeiro-funcionario.html`
- Abre modal diretamente no index:
  - **Abrir Caixa**: inputs de troco inicial e responsável
  - **Fechar Caixa**: grid de inputs por método de pagamento ativo
  - **Relatório de Fechamento**: tabela Digitado × Computado × Diferença com badge CONFERIDO/DIVERGENTE
- Estilo idêntico ao modal de caixa do financeiro (modal centralizado com sombra, sem bottom-sheet)
- NFe sempre exibido no grid de fechamento (não condicional)

---

## 14. NFe no Modal de Fechamento do Financeiro

**Arquivo:** `DESKTOPV2/funcionario/financeiro-funcionario.html`

- Campo NFe agora aparece **sempre** no grid de fechamento de caixa
- Antes: `show: cfg.NFE === true` (ficava oculto pois o padrão é `false`)
- Depois: `show: true` (sempre visível)
- Coleta e envia o valor no `confirmarFechamento()` independentemente da config

---

## 15. Redesign Visual do Financeiro (funcionário)

**Arquivo:** `DESKTOPV2/funcionario/financeiro-funcionario.html`

- Atualizado para o padrão visual moderno do sistema:
  - Fonte **Inter** (via Google Fonts)
  - **Header navy** (`#0f172a`) com ícones semi-transparentes (igual às outras páginas)
  - CSS variables atualizadas para `--navy`, `--primary` (`#2563eb`), `--mid`, `--border` (`#e2e8f0`), `--light` (`#f1f5f9`)
  - Balance cards com tipografia Inter e tamanho reduzido para mobile
  - Tabs com `white-space: nowrap` + scroll horizontal no mobile
  - Botões de ação com `border-radius: 10px` e hover mais suave
  - Tabelas com cabeçalhos em uppercase/600 e hover `#f8fafc`
  - Status badges pill com cores semânticas (`#d1fae5`/`#fef3c7`)
  - Mobile nav com `height: 66px`, fonte Inter
  - Toast com `border-radius: 10px` e sombra md
  - Comissões com grid responsivo que colapsa em coluna única abaixo de 900px
  - Resumo de comissões com gradiente navy (dark) em vez de azul primário
