# SECURITY IMPLEMENTATION GUIDE

## Overview

This document details the security measures implemented in the Lina X Car Wash SaaS backend to prevent common vulnerabilities and ensure data isolation in a multi-tenant environment.

---

## 1. TENANT ISOLATION (CRITICAL)

### Problem Addressed
**Vertical Privilege Escalation**: User A attempting to access Company B's data by manipulating the empresa ID.

### Solution: Multi-Layer Verification

#### Layer 1: JWT Token Signature
- `empresaId` is embedded in the signed JWT token (not sent via header)
- Token tampering is prevented by HMAC signature validation
- Implementation: `authMiddleware.ts:69` - `jwt.verify(token, process.env.JWT_SECRET)`

#### Layer 2: Database Ownership Verification
```typescript
// authMiddleware.ts:85-95
const empresa = await prisma.empresa.findFirst({
  where: {
    id: decoded.empresaId,      // Token's empresa ID
    usuarioId: decoded.id,      // CRITICAL: Must be owner
    ativo: true,                // Must be active
  }
});
```

**This query validates THREE conditions:**
1. Empresa exists (ID match)
2. User is the owner (usuarioId match)
3. Empresa is active (not deleted/deactivated)

**If any condition fails → 403 Forbidden**

#### Layer 3: Double Verification
```typescript
// authMiddleware.ts:106-115
if (empresa.usuarioId !== decoded.id) {
  console.error('[SECURITY CRITICAL] Database inconsistency detected');
  return res.status(403).json({ error: 'Erro de validação de segurança' });
}
```

Paranoid checking to detect database corruption or race conditions.

#### Layer 4: Use DB Value, Not Token Value
```typescript
// authMiddleware.ts:120
authenticatedReq.empresaId = empresa.id; // Use DB, NOT decoded.empresaId
```

Always trust the database over the token for the final authorization decision.

---

### Security Guarantees

✅ **Prevents**: User A accessing Company B's data
✅ **Prevents**: Access after removal from company
✅ **Prevents**: Access to deactivated companies
✅ **Prevents**: Token forgery/tampering
✅ **Detects**: Database inconsistencies

### Attack Scenarios Blocked

| Attack | Blocked By |
|--------|-----------|
| Forged token with different empresaId | JWT signature validation |
| Valid token for empresa user no longer owns | Database ownership check |
| Token for deleted empresa | `ativo: true` check |
| Race condition (user removed during request) | Real-time DB verification |
| Token replay after deactivation | Database check on every request |

---

## 2. INPUT VALIDATION

### Problem Addressed
- **SQL Injection** (even with Prisma ORM, type coercion can cause issues)
- **XSS Attacks** (malicious data stored and displayed)
- **Business Logic Errors** (negative prices, invalid enums)
- **DoS Attacks** (excessively large strings, giant arrays)

### Solution: Validation Utilities

**File**: `backend/src/utils/validate.ts`

#### Generic Validators
```typescript
validators.isPositiveNumber(value, 'preco')
validators.isNonEmptyString(value, 'nome')
validators.isValidEnum(value, OrdemStatus, 'status')
validators.isValidEmail(value, 'email')
validators.isValidPlate(value, 'placa')
validators.sanitizeString(value) // Remove < > and limit length
```

#### Domain-Specific Validators
- `validateCreateOrder()` - Order creation
- `validateFinalizarOrdem()` - Order finalization
- `validateCliente()` - Client creation/update
- `validateServico()` - Service creation/update
- `validateQueryParams()` - Pagination and search

---

### Applied To Critical Endpoints

#### 1. Create Order (`POST /api/ordens`)

**Before** (❌ INSECURE):
```typescript
const { clienteId, itens, observacoes } = req.body;
if (!itens || !Array.isArray(itens) || itens.length === 0) {
  return res.status(400).json({ error: 'Dados incompletos' });
}
```

**After** (✅ SECURE):
```typescript
const validation = validateCreateOrder(req.body);
if (!validation.isValid) {
  return res.status(400).json({
    error: 'Dados inválidos',
    details: validation.errors, // ["itens[0].quantidade deve ser positivo"]
    code: 'VALIDATION_ERROR'
  });
}

const { clienteId, itens, observacoes } = validation.sanitizedData!;
// observacoes is sanitized (no <script> tags)
// quantidade is validated as positive number
// tipo is validated against OrdemItemType enum
```

**Validations Applied:**
- `clienteId` OR `novoCliente` required
- `veiculoId` OR `novoVeiculo` required
- `itens` must be non-empty array
- Each item: `tipo` ∈ {SERVICO, ADICIONAL}
- Each item: `quantidade` > 0
- Each item: `itemId` is valid CUID
- Plate format: ABC1234 or ABC1D23 (Mercosul)
- Strings sanitized (remove `<>`, limit to 1000 chars)

---

#### 2. Finalize Order (`POST /api/ordens/:id/finalizar`)

**Before** (❌ INSECURE):
```typescript
for (const pag of pagamentos) {
  if (!pag.valor || pag.valor <= 0) {
    return res.status(400).json({ error: 'Valor inválido' });
  }
}
```

**After** (✅ SECURE):
```typescript
const validation = validateFinalizarOrdem(req.body);
if (!validation.isValid) {
  return res.status(400).json({
    error: 'Dados de pagamento inválidos',
    details: validation.errors,
    code: 'VALIDATION_ERROR'
  });
}

const { pagamentos } = validation.sanitizedData!;
// All payments validated and sanitized
```

**Validations Applied:**
- `pagamentos` must be non-empty array
- Each payment: `metodo` ∈ {DINHEIRO, CARTAO_CREDITO, CARTAO_DEBITO, PIX, OUTRO}
- Each payment: `valor` > 0 (prevents negative payments)
- `observacoes` sanitized in each payment

---

## 3. ERROR HANDLING (SECURITY)

### Information Disclosure Prevention

**BEFORE** (❌ CRITICAL VULNERABILITY):
```typescript
res.status(500).json({
  error: 'Erro interno',
  stack: error.stack // ⚠️ EXPOSES SYSTEM INTERNALS
});
```

**AFTER** (✅ SECURE):
```typescript
res.status(500).json({
  error: 'Erro interno do servidor',
  details: error.message // Only message, no stack
});
```

**Never expose in production:**
- Stack traces
- Database error details
- File paths
- Environment variables
- JWT secrets

---

## 4. JWT TOKEN SECURITY

### Configuration Requirements

```env
# .env
JWT_SECRET=your-256-bit-secret-here  # REQUIRED - No fallback!
```

**Security Features:**
1. **No Fallback Secret**: Refuses to start if `JWT_SECRET` not configured
2. **Short-Lived Tokens**: Base token expires in 1 hour
3. **Scoped Tokens**: Empresa-scoped tokens required for data access
4. **Signature Verification**: HMAC-SHA256 signature on every request

### Token Flow

```
1. Login → Base Token (no empresa scope)
   Claims: { id, nome, role }

2. Select Empresa → Scoped Token
   Claims: { id, nome, role, empresaId, empresaNome }

3. API Request → Verify signature + Check ownership
```

---

## 5. ADDITIONAL SECURITY MEASURES

### 5.1 User Enumeration Prevention
```typescript
// Generic error message
if (!usuario || !isSenhaValida) {
  return res.status(401).json({ error: 'Credenciais inválidas' });
  // Don't say "user not found" vs "wrong password"
}
```

### 5.2 Password Hashing
```typescript
// bcrypt with 12 rounds
const hashedPassword = await bcrypt.hash(senha, 12);
```

### 5.3 SQL Injection Prevention
- All queries use Prisma ORM (prepared statements)
- Enums validated against TypeScript types
- IDs validated as CUIDs

### 5.4 XSS Prevention
```typescript
validators.sanitizeString(value)
  .trim()
  .replace(/[<>]/g, '') // Remove dangerous chars
  .substring(0, 1000);  // Limit length
```

### 5.5 Pagination Limits
```typescript
const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 15));
// Max 100 items per page (prevents DoS)
```

---

## 6. TESTING SECURITY

### Test Case 1: Tenant Isolation

```bash
# 1. Login as User A, select Company A
curl -X POST http://localhost:3001/api/usuarios/auth \
  -d '{"nome":"userA@example.com","senha":"password"}'

TOKEN_A="eyJhbGc..."

# 2. Get Company A's scoped token
curl -X POST http://localhost:3001/api/usuarios/scope-token \
  -H "Authorization: Bearer $TOKEN_A" \
  -d '{"empresaId":"company_A_id"}'

SCOPED_TOKEN_A="eyJhbGc..."

# 3. Try to access Company B's data (SHOULD FAIL)
curl -X GET http://localhost:3001/api/ordens \
  -H "Authorization: Bearer $SCOPED_TOKEN_A"

# Expected: 403 Forbidden
# Error: "Acesso negado: você não tem permissão para acessar esta empresa"
```

### Test Case 2: Input Validation

```bash
# Negative price (SHOULD FAIL)
curl -X POST http://localhost:3001/api/ordens/:id/finalizar \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "pagamentos": [
      {"metodo":"DINHEIRO","valor":-50.00}
    ]
  }'

# Expected: 400 Bad Request
# Error: {
#   "error": "Dados de pagamento inválidos",
#   "details": ["pagamentos[0].valor deve ser um número positivo"],
#   "code": "VALIDATION_ERROR"
# }
```

### Test Case 3: XSS Prevention

```bash
# Malicious script in observacoes (SHOULD BE SANITIZED)
curl -X POST http://localhost:3001/api/ordens \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "clienteId":"...",
    "veiculoId":"...",
    "itens":[...],
    "observacoes":"<script>alert(document.cookie)</script>Normal text"
  }'

# Stored in DB as: "scriptalert(document.cookie)/scriptNormal text"
# (< and > removed)
```

---

## 7. COMPLIANCE & AUDIT

### Logging Security Events

```typescript
// authMiddleware.ts
console.warn(
  `[SECURITY VIOLATION] Tenant isolation breach attempt: ` +
  `User ${decoded.id} attempted to access empresa ${decoded.empresaId}`
);
```

**Logged Events:**
- Tenant isolation violations (403)
- Invalid/expired tokens (401)
- JWT configuration errors (500)
- Database inconsistencies

**TODO: Implement structured logging (Winston/Pino) for production**

---

## 8. KNOWN LIMITATIONS & FUTURE WORK

### Current Limitations

1. **No Rate Limiting**
   - Login endpoint vulnerable to brute force
   - **Priority**: HIGH
   - **Solution**: Implement `express-rate-limit`

2. **No Multi-User Support per Empresa**
   - Only owners can access data (no team members)
   - **Priority**: HIGH
   - **Solution**: Add `CompanyUser` join table

3. **No Token Revocation/Blacklist**
   - Tokens valid until expiration even after logout
   - **Priority**: MEDIUM
   - **Solution**: Redis-based token blacklist

4. **No Audit Logging**
   - Who did what/when not tracked
   - **Priority**: MEDIUM (HIGH for compliance)
   - **Solution**: Add `AuditLog` model

5. **Email Validation Not Enforced**
   - Users can register with unverified emails
   - **Priority**: LOW
   - **Solution**: Email verification flow

---

## 9. CHECKLIST: Production Readiness

### Before Going Live

- [x] JWT_SECRET configured in production environment
- [x] Tenant isolation tested and verified
- [x] Input validation on all POST/PUT endpoints
- [x] Error stack traces removed from responses
- [x] Password hashing with bcrypt (12 rounds)
- [ ] Rate limiting on authentication endpoints
- [ ] HTTPS enforced (redirect HTTP → HTTPS)
- [ ] CORS configured for production domain only
- [ ] Helmet.js security headers
- [ ] Database connection pool limits
- [ ] Structured logging (Winston/Pino)
- [ ] Error monitoring (Sentry/DataDog)
- [ ] Regular security audits scheduled
- [ ] Dependency vulnerability scanning (npm audit)

---

## 10. CONTACT & REPORTING

**Security Issues**: Report to `security@linax.com` (placeholder)
**Bug Reports**: GitHub Issues (non-security bugs only)

---

**Last Updated**: 2026-01-20
**Version**: 2.0 (Security Hardened)
