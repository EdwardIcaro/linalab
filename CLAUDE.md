# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lina X is a car wash (lava jato) management system with multi-tenancy support. It handles service orders, customer/vehicle management, employee commissions, and financial tracking.

## Tech Stack

- **Backend**: Node.js + Express 5 + TypeScript + Prisma ORM + SQLite
- **Frontend**: Static HTML/CSS/JavaScript (no framework) in `DESKTOPV2/`
- **Package Manager**: pnpm

## Common Commands

```bash
# Backend (from /backend directory)
pnpm install          # Install dependencies
pnpm dev              # Start dev server with hot reload (port 3001)
pnpm build            # Build TypeScript to dist/
pnpm start            # Run production build

# Database
pnpm db:generate      # Generate Prisma client
pnpm db:push          # Push schema changes to database
pnpm db:migrate       # Create and apply migrations
pnpm db:studio        # Open Prisma Studio GUI
pnpm db:seed          # Seed database with initial data
```

## Architecture

### Request Flow
1. **Frontend** (`DESKTOPV2/*.html`) → calls `window.api.*` methods
2. **API Layer** (`DESKTOPV2/api.js`) → makes HTTP requests to backend
3. **Express Router** (`backend/src/index.ts`) → routes to specific resource routers
4. **Route Handler** (`backend/src/routes/*.ts`) → maps HTTP methods to controllers
5. **Controller** (`backend/src/controllers/*.ts`) → business logic
6. **Prisma** (`backend/prisma/schema.prisma`) → database operations

### Multi-Tenancy
- Users (`Usuario`) can own multiple companies (`Empresa`)
- All business data is scoped to an `empresaId`
- Two auth middlewares:
  - `userAuthMiddleware`: authenticates user only
  - `authMiddleware`: authenticates user + validates empresa scope
- JWT tokens contain `empresaId` after company selection

### Key Entities
- `Usuario` → `Empresa` (owner relationship)
- `Empresa` → `Cliente` → `Veiculo` (customer vehicles)
- `Empresa` → `Lavador` (employees/washers)
- `Empresa` → `Servico` + `Adicional` (services and add-ons)
- `Empresa` → `OrdemServico` → `Pagamento` (orders and payments)
- `Empresa` → `CaixaRegistro` + `FechamentoCaixa` (cash register)

### Permission System
- `Role` model with `Permissao` entries per company
- `permissionMiddleware.can('permission_name')` checks access
- Key permissions: `gerenciar_configuracoes`, `gerenciar_clientes`, `gerenciar_ordens`

### Background Jobs
- Cron job runs every 15 minutes to auto-finalize orders (`processarFinalizacoesAutomaticas`)

## Frontend Structure

- `login.html` → `selecionar-empresa.html` → `index.html` (dashboard)
- Main pages: `ordens.html`, `clientes.html`, `financeiro.html`, `comissoes.html`, `configuracoes.html`
- Order creation flow: `selecionar-tipo-veiculo.html` → `selecionar-subtipo-carro.html` → `novaordem.html`
- `api.js` contains all API calls via `window.api` object
- `utils.js` contains shared utilities

## Environment Variables

Backend requires `.env` file with:
- `DATABASE_URL`: SQLite connection string (default: `file:./prisma/dev.db`)
- `SECRET_KEY`: JWT signing secret
- `PORT`: Server port (default: 3001)
