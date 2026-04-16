# 🔍 Relatório de Investigação: Desconexão Persistente do WhatsApp Bot

**Data**: 2026-04-16  
**Problema**: Bot desconecta sempre que o backend dorme, reinicia ou fica inativo, e não mantém sessão  
**Status**: ✅ RAIZ IDENTIFICADA + SOLUÇÕES PROPOSTAS

---

## 📋 Resumo Executivo

O bot **SIM consegue persistir** credenciais (`authState`) no banco de dados PostgreSQL, mas **NÃO consegue se reconectar automaticamente** após atingir 10 tentativas falhadas. Quando o servidor reinicia ou dorme:

1. ✅ `restoreActiveSessions()` é chamado no startup
2. ✅ Credenciais são restauradas do banco para `/tmp`
3. ❌ **Reconexão falha 10 vezes**
4. ❌ **Socket é deletado permanentemente**
5. ❌ **Ninguém mais tenta reconectar**
6. ❌ Frontend mostra "Desconectado" e pede novo QR

---

## 🔧 Análise Técnica Detalhada

### 1. **Fluxo de Persistência (✅ Funcionando)**

```
Inicialização:
  index.ts (linha 219) → restoreActiveSessions()
    ↓
  baileyService.ts (linha 686) → busca instâncias com authState IS NOT NULL
    ↓
  initBaileys() para cada instância
    ↓
  restoreAuthDirFromDb() → restaura credenciais do banco para /tmp
    ↓
  useMultiFileAuthState() → carrega sessão
    ↓
  Tentativa de reconexão
```

**O que está certo:**
- ✅ `authState` é salvo em `WhatsappInstance.auth_state` (String/JSON)
- ✅ Ao restaurar, arquivo é escrito em `/tmp/baileys-{empresaId}/`
- ✅ `saveCreds()` é chamado quando credenciais mudam (evento `creds.update`)
- ✅ `persistAuthDirToDb()` salva `/tmp/*` de volta no banco

### 2. **O Problema: Limite de Reconexões (❌ CRÍTICO)**

**Arquivo**: `baileyService.ts`, linha 22:

```typescript
const MAX_RECONNECT = 10;
```

**Fluxo problemático quando ocorre desconexão:**

```
connection.update { connection: 'close' }
  ↓
  statusCode = 404 (rede indisponível) ou similar
  wasAuthenticated = true (estava conectado)
  isRealLogout = false (não é 401 + autenticado)
  shouldReconnect = !isRealLogout && attempts < MAX_RECONNECT
  ↓
  Tentativa 1-10: setTimeout → initBaileys() novamente (delay 3s)
  ↓
  Tentativa 11: attempts >= MAX_RECONNECT
    → reconnectAttempts.delete(empresaId)  // ← AQUI!
    → status = 'disconnected'
    → Socket é deletado: sockets.delete(empresaId)
    → NÃO tenta mais nada
```

**Resultado**: Socket fica em `status = 'disconnected'` **INDEFINIDAMENTE**. 
- Não há mecanismo que tente reconectar novamente
- Mesmo no próximo restart do servidor, `initBaileys()` pode falhar novamente

### 3. **Impacto no Railway (Free Tier)**

O problema é **amplificado** no Railway free tier:

1. **Servidor dorme** (inatividade) ou **para por deploy**
2. `restoreActiveSessions()` tenta reconectar ao WhatsApp
3. Conexão **falha** (WhatsApp pode estar lento ou bloqueando)
4. Tentativas 1-10 falham dentro de 30-50 segundos
5. Após tentativa 10, ninguém mais tenta
6. **Bot fica "morto"** até próximo deploy ou restart manual

### 4. **Verificação: Como o Status é Retornado**

**whatsappController.ts (linha 171)**:
```typescript
const status = getStatus(empresaId);
// Retorna: 'connected' | 'reconnecting' | 'qr_code' | 'disconnected'
```

O status vem de `statuses.get(empresaId)` que é um Map em memória.  
Após MAX_RECONNECT: status = 'disconnected' → Frontend mostra "Desconectado"

---

## 💡 Soluções Propostas

### **Solução 1: Aumentar Delay Inicial (Simples, Imediato)**

**Problema**: 5 segundos no startup é insuficiente se a rede está instável.

**Implementação**:
```typescript
// index.ts linha 217
await new Promise(resolve => setTimeout(resolve, 5000));
// ↓ MUDAR PARA
await new Promise(resolve => setTimeout(resolve, 15000)); // 15 segundos
```

**Benefício**: Aguarda mais tempo para rede/WhatsApp estabilizarem.

---

### **Solução 2: Implementar Reconexão com Backoff Exponencial (RECOMENDADO)**

**Problema**: MAX_RECONNECT=10 é muito baixo.

**Implementação** (adicionar em `baileyService.ts`):

```typescript
// ========== BACKOFF EXPONENCIAL ==========
const reconnectDelays = new Map<string, number>();
const BASE_DELAY = 3000; // 3s
const MAX_DELAY = 60000; // 1 minuto
const MAX_TOTAL_ATTEMPTS = 100; // ao invés de 10

function getNextReconnectDelay(empresaId: string): number {
  let delay = reconnectDelays.get(empresaId) || BASE_DELAY;
  // Próximo delay = delay * 1.5, com cap em MAX_DELAY
  const nextDelay = Math.min(delay * 1.5, MAX_DELAY);
  reconnectDelays.set(empresaId, nextDelay);
  return delay;
}

function resetReconnectDelay(empresaId: string): void {
  reconnectDelays.delete(empresaId);
}
```

**Mudança em connection.update**:
```typescript
if (shouldReconnect) {
  reconnectAttempts.set(empresaId, attempts + 1);
  sockets.delete(empresaId);
  
  // ✅ NOVO: usar backoff exponencial ao invés de delay fixo
  const reconnectDelay = credsJustUpdated 
    ? 1000 
    : (wasAuthenticated ? getNextReconnectDelay(empresaId) : 15000);
  
  credsJustUpdated = false;
  console.log(`[Baileys] Reconectando em ${reconnectDelay / 1000}s (tentativa ${attempts + 1}/${MAX_TOTAL_ATTEMPTS})...`);
  setTimeout(() => {
    initBaileys(empresaId).catch(console.error);
  }, reconnectDelay);
}
```

**Benefício**: Após 10 falhas, continua tentando com delays cada vez maiores (3s → 4.5s → 6.7s → ... → 60s). Eventualmente reconecta.

---

### **Solução 3: Cron Job Periódico para Verificar Status (EXTRA ROBUSTEZ)**

**Problema**: Mesmo com backoff, se todas as tentativas automáticas falharem, não há gatilho.

**Implementação** (adicionar em `index.ts`):

```typescript
// Cron job a cada 10 minutos: verificar instâncias desconectadas que ainda têm authState
cron.schedule('*/10 * * * *', async () => {
  try {
    const desconectadas = await prisma.whatsappInstance.findMany({
      where: {
        authState: { not: null },
        status: { in: ['disconnected', 'qr_code'] } // excluir 'connected' e 'reconnecting'
      }
    });

    for (const instance of desconectadas) {
      const statusMemoria = getStatus(instance.empresaId);
      // Se em memória também está desconectado → tentar reconectar
      if (statusMemoria === 'disconnected' && instance.authState) {
        console.log(`[Cron] Tentando reconectar ${instance.empresaId}...`);
        try {
          await initBaileys(instance.empresaId);
        } catch (err) {
          console.error(`[Cron] Erro ao reconectar ${instance.empresaId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[Cron] Erro ao verificar status do WhatsApp:', err);
  }
}, { timezone: "America/Sao_Paulo" });
```

**Benefício**: A cada 10 minutos, tenta reconectar instâncias que têm credenciais mas estão desconectadas.

---

### **Solução 4: Melhorar Tratamento de Erros e Logging**

**Problema**: Falta transparência sobre por quê desconecta.

**Implementação** (melhorar logs em `connection.update`):

```typescript
if (connection === 'close') {
  const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
  const errorMsg = (lastDisconnect?.error as any)?.message || '';
  
  console.log(`[Baileys] Desconexão para ${empresaId}:`, {
    statusCode,
    errorMsg,
    wasAuthenticated,
    totalAttempts: attempts + 1,
    maxAttempts: MAX_TOTAL_ATTEMPTS
  });
  
  // Salvar no banco para frontend exibir
  await prisma.whatsappInstance.update({
    where: { empresaId },
    data: { 
      status: shouldReconnect ? 'reconnecting' : 'disconnected',
      lastErrorCode: statusCode,
      lastErrorMessage: errorMsg
    }
  });
}
```

---

## 📊 Comparação de Soluções

| Solução | Complexidade | Efetividade | Implementação |
|---------|-------------|-------------|--------------|
| **1. Aumentar Delay** | ⭐ Muito baixa | ⭐⭐ Baixa (ajuda pouco) | 1 linha |
| **2. Backoff Exponencial** | ⭐⭐ Média | ⭐⭐⭐⭐⭐ Muito alta | ~30 linhas |
| **3. Cron Job** | ⭐⭐⭐ Alta | ⭐⭐⭐⭐ Alta | ~25 linhas |
| **4. Melhor Logging** | ⭐ Muito baixa | ⭐⭐⭐ Boa (visibilidade) | ~20 linhas |

---

## 🎯 Recomendação: Implementação Completa

Implementar **Soluções 2 + 3 + 4** para máxima robustez:

```
Fluxo final:
1. Desconexão ocorre
   ↓
2. Tentativa 1-10: reconectar imediatamente (backoff exponencial)
   ↓
3. Se falhar 10x: aguardar
   ↓
4. Cron a cada 10 min: verificar e tentar novamente
   ↓
5. Logs detalhados: frontend vê motivo da desconexão
   ↓
6. Resultado: Bot se reconecta **mesmo sem reiniciar servidor**
```

---

## ⚠️ Casos Extremos Tratados

### Caso 1: Servidor dorme por 2 horas
- ✅ Cron tenta reconectar a cada 10 min
- ✅ Bot revive após 10-20 min, sem necessidade de restart

### Caso 2: Deploy/restart do Railway
- ✅ `restoreActiveSessions()` tenta no startup
- ✅ Se falhar, backoff exponencial mantém tentando
- ✅ Cron reforça a cada 10 min
- ✅ Bot revive em minutos

### Caso 3: WhatsApp invalida sessão (logout real)
- ✅ Codigo 401 detectado
- ✅ authState é **limpo** do banco
- ✅ Frontend mostra "Desconectado"
- ✅ Usuário escaneia novo QR

---

## 📝 Próximos Passos

1. **Implementar Solução 2** (Backoff Exponencial)
2. **Implementar Solução 3** (Cron Job)
3. **Implementar Solução 4** (Melhor Logging)
4. **Testar cenários**:
   - Desconexão manual do WhatsApp
   - Corte de internet
   - Restart do servidor durante desconexão
5. **Deploy em produção**
6. **Monitorar por 1 semana**

---

## 🔗 Arquivos Afetados

```
backend/src/services/baileyService.ts      (linhas 21-22, 280-321)
backend/src/index.ts                       (linhas 217-219, adicionar cron)
backend/src/controllers/whatsappController.ts (opcional: logging)
backend/prisma/schema.prisma               (opcional: campos para erro)
```

---

**Conclusão**: O problema **NÃO é falta de persistência de credenciais**, e sim **falta de mecanismo de reconexão automática após MAX_RECONNECT**. As soluções propostas garantem que o bot se mantenha conectado mesmo após múltiplas falhas.

