# Lina X – Deploy & Ambientes

## Arquitetura atual
- **Frontend (prod):** Vercel — serve `DESKTOPV2` (estático).  
  - Rewrites: `/api/* -> https://linacraft.up.railway.app/api/*`
- **Backend (prod):** Railway — Node/Express (somente API).  
- **Banco (prod):** Neon — Postgres (endpoint pooler).

## Variáveis de ambiente (prod)
### Backend (Railway)
> **⚠️ NUNCA commitar credenciais!** Use Railway secrets ou Vercel environment variables.

- `DATABASE_URL` = (Neon PostgreSQL connection string com pooler)
- `JWT_SECRET` = (Chave aleatória de 256+ caracteres)
- `BCRYPT_SALT_ROUNDS` = `12`
- `MERCADO_PAGO_ACCESS_TOKEN` = (Token de produção do Mercado Pago)
- `MERCADO_PAGO_PUBLIC_KEY` = (Chave pública do Mercado Pago)
- `MERCADO_PAGO_WEBHOOK_SECRET` = (Secret do webhook do Mercado Pago)
- `SENDGRID_API_KEY` = (API Key do SendGrid)
- `EMAIL_FROM` = (Email validado no SendGrid)
- `FRONTEND_URL` = `https://seu-dominio.vercel.app`
- `PAYMENT_SUCCESS_URL` = `https://seu-dominio.vercel.app/pagamento-retorno.html`
- `PAYMENT_FAILURE_URL` = `https://seu-dominio.vercel.app/pagamento-retorno.html`
- `PAYMENT_PENDING_URL` = `https://seu-dominio.vercel.app/pagamento-retorno.html`
- `NODE_ENV` = `production`
- (Remover `PORT`; Railway injeta automaticamente)

### Frontend (Vercel)
- `API_BASE_URL` = `https://linacraft.up.railway.app`
- (Demais variáveis do front são embutidas no build; chaves privadas não devem ir para o front.)

## Build/Deploy
### Vercel (frontend)
- `vercel.json` (já configurado):
  - `outputDirectory: DESKTOPV2`
  - `installCommand: echo "skip install (static front only)"`
  - `buildCommand: echo "no build step"`
  - `rewrites: /api/(.*) -> https://linacraft.up.railway.app/api/$1`
- Deploy:
  - `pnpm dlx vercel@latest --prod --force` (usa snapshot local) **ou**
  - push para o branch configurado (quando o limite de deploy permitir).

### Railway (backend)
- Só API (sem servir estáticos). `backend/src/index.ts` não faz `express.static`.
- Build/start via Nixpacks: roda `npm run build` e `npm start`.
- Redeploy pelo painel ou `railway up`/`railway redeploy`.

### Banco (Neon)
- Usar a `DATABASE_URL` pooler acima.
- Após trocar de DB, rodar:
  - `npx prisma migrate deploy` (ou `npx prisma db push` se não houver migrações).
  - Seed (opcional): `npx prisma db seed` (package.json já aponta para `ts-node prisma/seed.ts`).

## Fluxo de desenvolvimento local (sem afetar produção)
### Backend local
1. `cd backend`
2. `npm install`
3. Criar `.env.local` com um DB de teste (outro Neon ou Postgres local), por ex:
   ```
   DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
   JWT_SECRET=dev-secret
   BCRYPT_SALT_ROUNDS=12
   ```
4. `npm run dev` (nodemon/ts-node).

### Frontend local
1. `cd DESKTOPV2`
2. Servir estático (ex.: VSCode Live Server ou `python -m http.server 5500`).
3. Em `DESKTOPV2/api.js`, trocar temporariamente:
   ```
   const API_BASE_URL = 'http://localhost:3001/api';
   ```
   (ou apontar para o backend Railway se quiser testar contra prod/staging).
4. Abrir `http://localhost:5500/login.html` (ou a porta que usar).

### Produção não é afetada até:
- Fazer push/commit que acione deploy no Vercel/Railway **ou**
- Rodar `vercel --prod` **ou**
- Redeploy manual na Railway.

## Comandos úteis (manutenção)
### Vercel
- Deploy sem commit (usa diretório atual):  
  `pnpm dlx vercel@latest --prod --force`

### Railway (backend)
- Abrir shell remoto:  
  `railway ssh --project=<projId> --environment=<envId> --service=<serviceId>`
- Redeploy (CLI):  
  `railway redeploy --project=<projId> --environment=<envId> --service=<serviceId>`

### Prisma / Banco (Neon)
- Aplicar migrações:  
  `cd backend && npx prisma migrate deploy`
- Empurrar schema (se não houver migrations):  
  `cd backend && npx prisma db push`
- Seed:  
  `cd backend && npx prisma db seed`
- psql direto no Neon (CLI local):  
  `psql "postgresql://neondb_owner:npg_xMoSQ02kGscr@ep-weathered-hill-ahnzplv8-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require"`

### Local (dev)
- Backend dev:  
  `cd backend && npm run dev`
- Frontend estático local:  
  `cd DESKTOPV2 && python -m http.server 5500`  
  (ajuste `API_BASE_URL` em `DESKTOPV2/api.js` para `http://localhost:3001/api` quando usar backend local)

## Dicas importantes
- CORS: `FRONTEND_URL` no backend deve estar sem barra final e igual ao domínio do Vercel.
- Não fixe `PORT` no backend em produção; Railway injeta.
- Não coloque segredos no frontend/Vercel (somente chaves públicas).
- Evite usar `package-lock` em prod build do backend (scripts já instalam sem lock).
- Sempre rodar `prisma migrate deploy` após trocar de banco.

## Checklist rápido de sanidade
- `/health` no Railway responde 200.
- CORS: `FRONTEND_URL` sem barra final, igual ao domínio do Vercel.
- `API_BASE_URL` no front aponta para o domínio Railway.
- Migrações aplicadas no Neon.
- Sem variável `PORT` fixa no backend.
