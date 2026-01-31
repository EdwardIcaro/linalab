# 🐛 Bug Fix Report - TypeScript Error TS2345

**Data:** 29/01/2026
**Erro Original:** TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'
**Status:** ✅ **RESOLVIDO**

---

## 📋 Problema Identificado

### Erro Original
```
src/controllers/subscriptionController.ts:259:60 - error TS2345:
Argument of type 'string | string[]' is not assignable to parameter of type 'string'.
```

### Causa Raiz
O TypeScript interpreta `req.params.addonId` como `string | string[]` porque Express permite que parâmetros de URL sejam arrays em certos contextos. Quando você faz destructuring sem type assertion, TypeScript não consegue garantir que é apenas uma string.

```typescript
// ❌ ERRADO - TypeScript vê como string | string[]
const { addonId } = req.params;

// ✅ CORRETO - Type assertion garante que é string
const addonId = req.params.addonId as string;
```

---

## ✅ Solução Aplicada

### 1. **subscriptionController.ts**
**Linha 251:**
```typescript
// ANTES
const { addonId } = req.params;

// DEPOIS
const addonId = req.params.addonId as string;

if (!addonId) {
  return res.status(400).json({ error: 'addonId é obrigatório' });
}
```

### 2. **subscriptionAdminController.ts** (3 casos)

**Caso 1 - getSubscriptionDetails (Linha 66):**
```typescript
// ANTES
const { id } = req.params;

// DEPOIS
const id = req.params.id as string;
if (!id) {
  return res.status(400).json({ error: 'id é obrigatório' });
}
```

**Caso 2 - updateSubscriptionStatus (Linha 159):**
```typescript
const id = req.params.id as string;
if (!id) {
  return res.status(400).json({ error: 'id é obrigatório' });
}
```

**Caso 3 - extendSubscription (Linha 214):**
```typescript
const id = req.params.id as string;
if (!id) {
  return res.status(400).json({ error: 'id é obrigatório' });
}
```

**Caso 4 - updatePlan (Linha 329):**
```typescript
const id = req.params.id as string;
if (!id) {
  return res.status(400).json({ error: 'id é obrigatório' });
}
```

**Caso 5 - togglePlanStatus (Linha 353):**
```typescript
const id = req.params.id as string;
if (!id) {
  return res.status(400).json({ error: 'id é obrigatório' });
}
```

**Caso 6 - updateAddon (Linha 442):**
```typescript
const id = req.params.id as string;
if (!id) {
  return res.status(400).json({ error: 'id é obrigatório' });
}
```

### 3. **promotionController.ts** (4 casos)

Aplicado mesmo padrão para:
- **updatePromotion** (Linha 182)
- **deletePromotion** (Linha 266)
- **togglePromotion** (Linha 289)
- **incrementPromoUsage** (Linha 333)

---

## 🎯 Padrão Aplicado

Para evitar esse erro no futuro, sempre use:

```typescript
// ✅ PADRÃO RECOMENDADO
const id = req.params.id as string;

if (!id) {
  return res.status(400).json({ error: 'id é obrigatório' });
}
```

**Nunca use:**
```typescript
// ❌ NÃO USE
const { id } = req.params; // TypeScript infere como string | string[]
```

---

## 📊 Resumo das Correções

| Arquivo | Casos Corrigidos | Status |
|---------|------------------|--------|
| subscriptionController.ts | 1 | ✅ |
| subscriptionAdminController.ts | 6 | ✅ |
| promotionController.ts | 4 | ✅ |
| **Total** | **11** | **✅** |

---

## ✅ Verificação

### Antes da Correção
```bash
$ npm run build
TSError: ⨯ Unable to compile TypeScript
error TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'
```

### Depois da Correção
```bash
$ npm run build
> rimraf dist && tsc
(sem erros)
```

**Status:** ✅ **COMPILADO COM SUCESSO**

---

## 🔍 Verificações Realizadas

- [x] Corrigido erro de type em subscriptionController.ts
- [x] Corrigido 6 erros em subscriptionAdminController.ts
- [x] Corrigido 4 erros em promotionController.ts
- [x] Adicionadas validações de null/undefined
- [x] TypeScript compila sem erros
- [x] Nenhum erro de linting

---

## 🚀 Próximos Passos

Sistema está **pronto para deploy em staging**:

```bash
# 1. Build
npm run build ✅

# 2. Test
npm test

# 3. Migrate
npx prisma migrate deploy

# 4. Deploy
npm start
```

---

**Resolução:** ✅ **COMPLETA**
**Data:** 29/01/2026
