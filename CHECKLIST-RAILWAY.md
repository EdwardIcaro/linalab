# ✅ Checklist de Configuração - Railway

Siga este checklist **NA ORDEM** para configurar o LinaX corretamente no Railway.

---

## Passo 1: Criar Projeto Railway

- [ ] Abra https://railway.app
- [ ] Faça login com GitHub
- [ ] Clique "New Project" → "Deploy from GitHub repo"
- [ ] Selecione repositório: `EdwardIcaro/linalab`

✅ **Status**: Projeto criado

---

## Passo 2: Provisionar PostgreSQL Database

- [ ] No Railway Dashboard do seu projeto
- [ ] Clique "+ New" (botão verde)
- [ ] Selecione "Database" → "PostgreSQL"
- [ ] Aguarde provisionamento (2-3 minutos)

✅ **Status**: PostgreSQL criado

---

## Passo 3: Configurar Variáveis de Ambiente

### ⚠️ IMPORTANTE: Ordem de Operações!

**Primeiro**, verifique se `DATABASE_URL` foi criada automaticamente:

1. Railway Dashboard → Seu Projeto
2. Selecione o **Service Node.js** (não PostgreSQL)
3. Clique em **"Variables"**
4. Procure por: `DATABASE_URL`

Se **DATABASE_URL não aparecer**:
- [ ] Clique "+ New Variable"
- [ ] Name: `DATABASE_URL`
- [ ] Clique na **PostgreSQL Service** na lateral
- [ ] Selecione `DATABASE_URL` (Railway vai copiar automaticamente)

✅ **DATABASE_URL está configurada?** (OBRIGATÓRIO!)

### Agora adicione as outras variáveis:

No mesmo painel de "Variables", adicione:

```
NODE_ENV=production
PORT=3001
JWT_SECRET=[Gere um novo: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"]
BCRYPT_SALT_ROUNDS=12
SENDGRID_API_KEY=SG.sua_chave_aqui
EMAIL_FROM=noreply@seudominio.com
FRONTEND_URL=${{RAILWAY_PUBLIC_DOMAIN}}
MERCADO_PAGO_ACCESS_TOKEN=TEST-5277956129999284-013022-a0433da8a4d2e282840ab5a3cd96efa0-182616510
MERCADO_PAGO_PUBLIC_KEY=TEST-2e6d0347-0e5c-40fe-8502-b371cd766ee2
MERCADO_PAGO_WEBHOOK_SECRET=db9ff2381b84a19f9c3ddd8e9e7fdf864277b6f65f4a12008a9ed1b3203e1b16
PAYMENT_SUCCESS_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
PAYMENT_FAILURE_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
PAYMENT_PENDING_URL=${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
```

- [ ] NODE_ENV = production
- [ ] PORT = 3001
- [ ] JWT_SECRET = [novo gerado]
- [ ] BCRYPT_SALT_ROUNDS = 12
- [ ] SENDGRID_API_KEY = [do SendGrid]
- [ ] EMAIL_FROM = noreply@seudominio.com
- [ ] FRONTEND_URL = ${{RAILWAY_PUBLIC_DOMAIN}}
- [ ] MERCADO_PAGO_ACCESS_TOKEN = TEST-...
- [ ] MERCADO_PAGO_PUBLIC_KEY = TEST-...
- [ ] MERCADO_PAGO_WEBHOOK_SECRET = db9ff...
- [ ] PAYMENT_SUCCESS_URL = ${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
- [ ] PAYMENT_FAILURE_URL = ${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html
- [ ] PAYMENT_PENDING_URL = ${{RAILWAY_PUBLIC_DOMAIN}}/pagamento-retorno.html

✅ **Status**: Todas variáveis configuradas

---

## Passo 4: Deploy da Aplicação

- [ ] Railway → Seu Projeto → Service Node.js
- [ ] Clique em **"Deploy"** (botão azul)
- [ ] Ou: Faça `git push origin master` (auto-deploy)

✅ **Deploy iniciado**

---

## Passo 5: Monitorar Deploy

Railway Dashboard → Logs:

- [ ] Procurar por: "npm install" (começou)
- [ ] Procurar por: "tsc" (compilando TypeScript)
- [ ] Procurar por: "Prisma Client" (gerando)
- [ ] Procurar por: "Servidor Lina X rodando" (sucesso!)

⚠️ **Se vir erros**:
- Verifique DATABASE_URL está configurada
- Verifique JWT_SECRET foi gerado corretamente
- Leia a seção "Troubleshooting" abaixo

✅ **Status**: Deploy completo e server rodando

---

## Passo 6: Obter Domínio Público

- [ ] Railway → Service Node.js → Settings → Domains
- [ ] Copiar domínio: `linax-production-xxxx.up.railway.app`

✅ **Domínio obtido**: https://linax-production-xxxx.up.railway.app

---

## Passo 7: Testar Aplicação

1. **Health Check**:
   ```
   https://linax-production-xxxx.up.railway.app/health
   ```
   Deve retornar JSON com status "OK"

2. **Login**:
   ```
   https://linax-production-xxxx.up.railway.app/login.html
   ```
   Deve carregar página de login

3. **Criar Conta**:
   - Clique "Sign Up"
   - Preencha dados
   - Verifique se email chega

- [ ] Health check respondendo
- [ ] Login page carregando
- [ ] Signup funciona
- [ ] Email recebido

✅ **Status**: Aplicação funcionando!

---

## Troubleshooting

### ❌ "Environment variable not found: DATABASE_URL"

**Solução:**
1. Railway → PostgreSQL Service → Variables
2. Copiar `DATABASE_URL`
3. Railway → Node.js Service → Variables
4. Colar em `DATABASE_URL`
5. Clique "Deploy" novamente

### ❌ "Cannot find module 'mercadopago'"

**Solução:**
- Deve estar resolvido (já foi adicionado ao package.json)
- Se persistir, tente "Redeploy"

### ❌ "Unsupported engine: requires node 20 or 22"

**Solução:**
- São apenas warnings, não quebra
- Aplicação roda normalmente

### ❌ Application crashes no startup

**Verificar:**
- [ ] DATABASE_URL foi configurada?
- [ ] JWT_SECRET foi gerado?
- [ ] PostgreSQL foi provisionado?

Se tudo ok, tente:
- [ ] Clique "Redeploy" no Railway
- [ ] Verifique logs completos

---

## Checklist Final ✅

- [ ] Projeto Railway criado
- [ ] PostgreSQL provisionado
- [ ] DATABASE_URL configurada
- [ ] Todas variáveis de ambiente setadas
- [ ] Deploy completo sem erros
- [ ] Domínio público obtido
- [ ] Health check respondendo
- [ ] Login page carregando
- [ ] Signup testado
- [ ] Email recebido

**Se tudo acima está checkado, sua aplicação está rodando!** 🎉

---

## Próximos Passos

1. Atualizar `DESKTOPV2/api.js` com domínio do Railway
2. Executar 42 testes de validação (TESTES-VALIDACAO.md)
3. Convidar usuários beta
4. Monitorar logs

---

**Guia:** GUIA-COMPLETO-RAILWAY.md (mais detalhes)
**Testes:** TESTES-VALIDACAO.md (validar tudo)
