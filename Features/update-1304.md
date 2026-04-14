# Update 13/04/2026

## Resumo do dia
Sessão de correções de bugs, melhorias de UX e novos recursos no sistema Lina X.

---

## 1. Sistema de Desconto no Pagamento (funcionário)

**Arquivo:** `DESKTOPV2/funcionario/ordens-funcionario.html`

- Modal de pagamento exibe seção de desconto somente para usuários com `maxDesconto > 0`
- `maxDesconto` é carregado via `getMeuPerfil` ao abrir o modal
- Dois inputs sincronizados: R$ e % (alterar um atualiza o outro em tempo real)
- Backend valida o limite: subaccount não pode ultrapassar sua porcentagem configurada
- OWNER (sem `subaccountId` no JWT) não tem restrição de desconto
- Pay-summary exibe o total original tachado quando desconto está aplicado
- `desconto` é enviado no payload para `finalizarOrdem`

**Arquivo:** `backend/prisma/schema.prisma`
- Campo `desconto Float @default(0)` adicionado ao model `OrdemServico`

**Arquivo:** `backend/src/controllers/ordemController.ts`
- `finalizarOrdem` extrai e valida `desconto`, calcula `valorFinal`, salva no banco
- Comissão é calculada sobre `valorFinal` (não sobre valorTotal original)

**Arquivo:** `backend/src/controllers/usuarioController.ts`
- `getMeuPerfil` agora inclui `maxDesconto` na resposta

---

## 2. Correção de Pendências no Financeiro

**Arquivo:** `DESKTOPV2/financeiro.html`

- Tabela de pendências exibia `valorTotal` da ordem em vez do valor pendente real
- Fix: soma apenas os pagamentos com `metodo === 'PENDENTE'`, que contém o valor exato da dívida

---

## 3. Fluxo Conversacional de Saídas no WhatsApp

**Arquivo:** `backend/src/services/whatsappCommandHandler.ts`

- Substituiu o modelo "tudo em uma mensagem + confirmar" por formulário conversacional por etapas
- Etapas coletadas: `descrição → forma de pagamento → fornecedor → confirmação`
- Groq extrai o que for possível da mensagem inicial (valor obrigatório; demais campos, opcionais)
- Forma de pagamento aceita número (1/2/3/4) ou texto livre ("dinheiro", "pix", "cartão", "nfe")
- Fornecedor: cria ou reutiliza registro existente no banco (mesma lógica do financeiro)
- Cancelamento com "não"/"cancelar" funciona em qualquer etapa
- Sessão estendida para 10 minutos de inatividade (era 5 min)
- Categoria suporta: `Despesa | Adiantamento | Outro` (detectado via Groq)

---

## 4. Correção de Timezone em Lançamentos de Despesa

**Arquivo:** `backend/src/controllers/caixaController.ts`

- Bug: `new Date("2026-04-13")` criava `T00:00:00Z` (meia-noite UTC), antes do turno das 07:00
- Fix: data-only agora interpretada como `T12:00:00` (meio-dia UTC), dentro do turno correto
- Corrigido em `createSaida` e `editSaida`

**Arquivo:** `DESKTOPV2/financeiro.html`

- Valor inicial do campo de data usava `toISOString().slice(0,10)` (UTC), trocado por data local do browser
- Edit modal: data do registro exibida em horário local (não UTC slice)

---

## 5. Modal "Trocar de Empresa / Sair" no Botão Sair

**Arquivo:** `DESKTOPV2/nav-menu-helper.js`

- Botão "Sair" agora abre um mini-modal com duas opções:
  - **Trocar de Empresa** → limpa `empresaId`/`empresaNome` do localStorage e vai para `selecionar-empresa.html`
  - **Sair do Sistema** → `localStorage.clear()` + redirect para `login.html`
- Modal injetado dinamicamente no DOM (sem HTML extra em cada página)
- Token scoped é mantido na troca de empresa (userAuthMiddleware aceita `decoded.id` do token scoped)

**Arquivo:** `DESKTOPV2/index.html`
- `logout()` global atualizado para usar `window.showSairModal()` quando disponível

---

## SQL para Executar no Neon (produção)

```sql
-- Desconto em OrdemServico
ALTER TABLE "OrdemServico" ADD COLUMN IF NOT EXISTS "desconto" DOUBLE PRECISION DEFAULT 0;
```
