# Missing Features from Old Configuration Page

**Analysis Date:** 2026-01-21
**Source:** `C:\LinaX\old\old_conf.html`
**Target:** `C:\LinaX\DESKTOPV2\configuracoes.html`

---

## Summary

The old configuration page had **5 tabs** with advanced enterprise features. The current page has **3 tabs** with basic functionality. Below are the missing features that can be recovered.

---

## Current Tabs (3)

1. ✅ **Dados da Empresa** - Company name and business hours
2. ✅ **Tabela de Preços** - Services and Adicionais
3. ✅ **Aparência** - Theme customization

---

## Missing Tabs (2) - HIGH VALUE

### 1. **Tokens de Acesso** (Access Tokens Management)

**Purpose:** Manage employee access tokens for the public washer interface

**Features:**
- Table showing all generated tokens
- Columns: Employee name, Access link, Status (Active/Inactive), Actions
- **Copy Link** button - Copy token URL to clipboard
- **Status Toggle** - Activate/deactivate tokens via dropdown
- **Delete Token** - Permanently remove access
- **Direct Link** - Open public interface in new tab
- Real-time status updates

**API Endpoints Used:**
- `GET /api/lavadores/tokens` - List all tokens
- `PUT /api/lavadores/tokens/:id/status` - Update token status
- `DELETE /api/lavadores/tokens/:id` - Delete token

**UI Location in old file:** Lines 254-273, 687-803

**Why it's valuable:**
- Essential for giving employees secure access to their work interface
- No need to share company credentials
- Individual token control (activate/deactivate per employee)
- Audit trail of who has access

---

### 2. **Usuários e Permissões** (Users & Role-Based Permissions)

**Purpose:** Complete role-based access control (RBAC) system for subaccounts

**Features:**

#### **Roles (Functions) Section:**
- Create custom roles (e.g., "Gerente", "Operador", "Financeiro")
- Assign granular permissions to each role
- **Permission Groups:**
  - Dashboard (`ver_dashboard`)
  - Ordens (`gerenciar_ordens`)
  - Clientes (`gerenciar_clientes`)
  - Funcionários (`gerenciar_funcionarios`)
  - Financeiro (`ver_financeiro`)
  - Configurações (`gerenciar_configuracoes`) with sub-permissions:
    - Serviços e Adicionais (`config_ver_servicos`)
    - Dados da Empresa (`config_ver_empresa`)
    - Tokens de Acesso (`config_ver_tokens`)
    - Usuários e Permissões (`config_ver_usuarios`)
    - Preferências (`config_ver_preferencias`)
- Expandable accordion for sub-permissions
- Shows user count per role
- Edit/Delete roles (only if no users assigned)

#### **Users (Subaccounts) Section:**
- Create subaccounts with individual credentials
- Assign role to each user
- **Fields:**
  - Username (for login)
  - Email
  - Password (optional on edit)
  - Role selection
  - **Max Discount Allowed** (%) - Custom per user
- Edit/Delete users
- Table view: Name, Email, Role, Actions

**API Endpoints Used:**
- `GET /api/roles` - Get all roles and users
- `POST /api/roles` - Create/update role
- `DELETE /api/roles/:id` - Delete role
- `POST /api/roles/subaccount` - Create user
- `PATCH /api/roles/subaccount/:id` - Update user
- `DELETE /api/roles/subaccount/:id` - Delete user

**UI Location in old file:** Lines 275-303, 805-1065

**Why it's valuable:**
- Multi-user support for businesses
- Granular access control (e.g., employee can only see orders, not financials)
- Custom discount limits per user (fraud prevention)
- Professional team management
- Security best practice (least privilege principle)

---

## Missing Features in Existing Tabs - MEDIUM/HIGH VALUE

### 3. **Preferências Tab** (Preferences - Enhanced Version)

The current page has **NO** preferences tab. The old page had extensive preferences:

#### **A. Order Finalization Settings:**
- ✅ **Finalização Automática** (Automatic Finalization)
  - Toggle switch
  - Tooltip: "At end of business day, change old pending/in-progress orders to finalized with PENDING payment"
  - Database field: `empresa.finalizacaoAutomatica`

- ✅ **Exigir Lavador para Finalizar** (Require Washer Assignment)
  - Toggle switch
  - Tooltip: "System prevents finalizing orders without assigned washer"
  - Database field: `empresa.exigirLavadorParaFinalizar`

#### **B. Payment Methods Configuration:**
- Visual card-based interface (not just checkboxes)
- Enable/disable payment methods:
  - 💵 **Dinheiro** (Cash)
  - 💳 **PIX** (Instant payment)
  - 💳 **Cartão** (Card - debit/credit)
  - 👤 **Débito de Funcionário** (Employee debit/advance)
- Each card shows:
  - Icon with gradient background
  - Method name
  - Description
  - Toggle switch
- Cards have active state styling
- Click anywhere on card to toggle
- Warning message: "Disabling a payment method removes it from order finalization"
- Database field: `empresa.paymentMethodsConfig` (JSON)

#### **C. Notification Preferences:**
- Control which events trigger notifications:
  - ✅ Ordem de Serviço Criada (Order Created)
  - ✅ Ordem de Serviço Editada (Order Edited)
  - ✅ Ordem de Serviço Deletada (Order Deleted)
  - ✅ Aviso de Finalização Automática (Auto-finalization warning)
- Database field: `empresa.notificationPreferences` (JSON)

#### **D. Default Home Page:**
- Currently in "Dados da Empresa" tab, but should be in Preferências
- Dropdown to select landing page after login:
  - Dashboard (`index.html`)
  - Ordens de Serviço (`ordens.html`)
  - Nova Ordem (`selecionar-tipo-veiculo.html`)
- Database field: `empresa.paginaInicialPadrao`

**UI Location in old file:** Lines 99-252, 1332-1441

**Why it's valuable:**
- Business logic customization per company
- Automatic workflow (finalization at end of day)
- Quality control (require washer assignment)
- Payment flexibility (enable/disable methods)
- Reduce notification noise (customize alerts)
- UX personalization (choose landing page)

---

### 4. **Drag & Drop Service Reordering**

**Current Implementation:** Services display in database order only

**Old Implementation:**
- Uses **SortableJS** library
- Drag and drop table rows to reorder
- Auto-saves new order to backend
- Visual feedback (ghost class during drag)
- Toast notification on success/error
- Helpful hint: "Arraste e solte as linhas para reordenar os serviços"

**API Endpoint:**
- `POST /api/servicos/reorder` - Accepts array of service IDs in new order

**UI Location in old file:** Lines 16-17, 1067-1084, 326

**Why it's valuable:**
- Control how services appear in selection dropdowns
- Put most popular services first
- Better UX for employees creating orders
- Professional touch (many SaaS apps have this)

---

### 5. **Permission-Based UI Visibility**

**Current Implementation:** All tabs/buttons always visible

**Old Implementation:**
- Tabs hide if user lacks permission
- Buttons hide if user lacks permission
- Uses `data-permission` attributes on elements
- Functions:
  - `updateTabsVisibility()` - Hide tabs based on permissions
  - `updateActionButtonsVisibility()` - Hide "New Service", "New User" buttons
- Checks `hasPermission(requiredPermission)` from utils.js

**Example:**
```html
<button data-permission="config_ver_servicos" onclick="openServiceModal()">
    <i class="fas fa-plus"></i> Novo Serviço
</button>
```

If user role doesn't have `config_ver_servicos`, button is hidden.

**UI Location in old file:** Lines 1047-1065

**Why it's valuable:**
- Clean UI (users only see what they can use)
- Security (can't accidentally access restricted features)
- Professional multi-user system
- Works with Roles & Permissions feature

---

## Additional Enhancements in Old File

### 6. **Unified Settings Save Function**

**Old implementation:**
- Single function `saveAllSettings()` saves both Empresa and Preferências
- Avoids duplicate code
- Single API call updates all fields
- Stores settings in localStorage for quick access:
  - `empresaNome`
  - `paginaInicialPadrao`
  - `exigirLavadorParaFinalizar`

**Current implementation:**
- Separate save functions per tab
- Some settings not cached locally

**UI Location in old file:** Lines 1343-1380

---

### 7. **Visual Payment Method Cards**

**Design:**
- Card-based layout (not plain checkboxes)
- Gradient backgrounds matching payment type
- Icons:
  - 💵 `fa-money-bill-wave` for Cash (amber gradient)
  - 🏦 `fab fa-pix` for PIX (teal gradient)
  - 💳 `fa-credit-card` for Card (blue gradient)
  - 👤 `fa-user-tag` for Employee Debit (orange gradient)
- Active state: Border highlight + shadow
- Click card or toggle to change state
- Smooth animations

**UI Location in old file:** Lines 133-201, 1383-1413

**Why it's valuable:**
- Beautiful, modern UI
- Better UX (larger click target than checkbox)
- Visual distinction between payment types
- Professional look matching design system

---

## API Endpoints Needed (Backend Support)

To implement the missing features, these endpoints must exist:

### **Roles & Permissions:**
- ✅ `GET /api/roles` - Get all roles and subaccounts
- ✅ `POST /api/roles` - Create/update role
- ✅ `DELETE /api/roles/:id` - Delete role
- ✅ `POST /api/roles/subaccount` - Create subaccount
- ✅ `PATCH /api/roles/subaccount/:id` - Update subaccount
- ✅ `DELETE /api/roles/subaccount/:id` - Delete subaccount

### **Tokens:**
- ✅ `GET /api/lavadores/tokens` - List all tokens (already in api.js:131)
- ✅ `PUT /api/lavadores/tokens/:id/status` - Update status (already in api.js:133-136)
- ✅ `DELETE /api/lavadores/tokens/:id` - Delete token (already in api.js:137)

### **Services Reordering:**
- ❓ `POST /api/servicos/reorder` - Save new service order (need to check backend)

### **Empresa Settings:**
All fields below should be part of `PUT /api/empresas/:id`:
- ✅ `finalizacaoAutomatica` (boolean)
- ✅ `exigirLavadorParaFinalizar` (boolean)
- ✅ `paginaInicialPadrao` (string)
- ✅ `notificationPreferences` (JSON)
- ❓ `paymentMethodsConfig` (JSON) - need to check if backend supports this

**Database Schema Check:**
Based on `C:\LinaX\backend\prisma\schema.prisma`, the Empresa model has:
- ✅ Line 48: `finalizacaoAutomatica Boolean? @default(false)`
- ✅ Line 49: `exigirLavadorParaFinalizar Boolean? @default(false)`
- ✅ Line 50: `paginaInicialPadrao String? @default("index.html")`
- ✅ Line 51: `notificationPreferences Json?`
- ❌ **MISSING:** `paymentMethodsConfig` field (would need to add to schema)

---

## Features NOT Worth Recovering

### 1. **Old Top Bar Navigation**
- Old file has traditional top bar (lines 20-79)
- Current design uses side navigation cards
- **Decision:** Keep current design (cleaner, more modern)

### 2. **Theme Toggle in User Menu**
- Old file has theme toggle in dropdown (line 67-70)
- Current design has dedicated "Aparência" tab
- **Decision:** Keep current design (more discoverable)

### 3. **SortableJS for Services**
- Nice-to-have but not critical
- Can be added later if users request
- **Priority:** LOW (defer)

---

## Implementation Priority

### **CRITICAL (Must Have):**
1. ✅ **Preferências Tab** - Business logic settings essential for operations
   - Finalização automática
   - Exigir lavador para finalizar
   - Payment methods configuration
   - Notification preferences

### **HIGH (Should Have):**
2. ✅ **Usuários e Permissões Tab** - Multi-user support for professional teams
   - Roles with permissions
   - Subaccounts
   - Max discount per user

### **MEDIUM (Nice to Have):**
3. ✅ **Tokens de Acesso Tab** - Employee access management
4. ✅ **Payment Method Visual Cards** - Better UX than plain checkboxes
5. ✅ **Permission-Based Visibility** - Hide tabs/buttons by permission

### **LOW (Defer):**
6. ⏸️ **Drag & Drop Reordering** - Cosmetic improvement
7. ⏸️ **Unified Save Function** - Optimization (current approach works)

---

## Recommended Implementation Plan

### **Phase 1: Preferências Tab** (2-3 hours)
1. Create new tab "Preferências"
2. Add toggle switches:
   - Finalização Automática
   - Exigir Lavador para Finalizar
3. Add payment methods visual cards (DINHEIRO, PIX, CARTAO, DEBITO_FUNCIONARIO)
4. Add notification preferences checkboxes
5. Move "Página Inicial Padrão" from Empresa tab to Preferências
6. Update save function to handle new fields
7. **Backend check:** Verify `paymentMethodsConfig` field exists or add to schema

### **Phase 2: Usuários e Permissões Tab** (4-6 hours)
1. Verify backend endpoints exist (`/api/roles/*`)
2. Create "Usuários e Permissões" tab
3. Implement Roles section:
   - Table with role list
   - Modal for create/edit role
   - Permission accordion with groups/sub-permissions
   - Delete role functionality
4. Implement Users section:
   - Table with user list
   - Modal for create/edit user
   - Role dropdown
   - Max discount field
   - Delete user functionality
5. Add permission-based visibility logic
6. Update navigation menu visibility

### **Phase 3: Tokens de Acesso Tab** (1-2 hours)
1. Create "Tokens de Acesso" tab
2. Load tokens from API
3. Display table: Employee, Link, Status, Actions
4. Implement:
   - Copy link to clipboard
   - Status toggle (Active/Inactive)
   - Delete token with confirmation
   - Direct link to public interface

### **Phase 4: Polish** (1 hour)
1. Add permission checks to hide tabs user can't access
2. Add permission checks to hide action buttons
3. Test all features
4. Update documentation

---

## Files to Modify

1. **C:\LinaX\DESKTOPV2\configuracoes.html**
   - Add 2 new tabs (Preferências, Usuários e Permissões, Tokens de Acesso)
   - Add modals for roles and users
   - Add JavaScript functions from old file
   - Update save functions

2. **C:\LinaX\DESKTOPV2\configuracoes.css**
   - Add styles for permission accordion
   - Add styles for payment method cards
   - Add styles for role/user tables
   - Add active state for cards

3. **C:\LinaX\backend\prisma\schema.prisma** (if needed)
   - Add `paymentMethodsConfig Json?` field to Empresa model
   - Run migration: `npx prisma migrate dev`

4. **C:\LinaX\backend\src/***
   - Verify role endpoints exist
   - Verify token endpoints work
   - Add service reordering endpoint (if needed)
   - Add paymentMethodsConfig to empresa update

---

## Code Snippets to Reuse

### **Permission System Constants:**
```javascript
const allPermissions = [
     { label: 'Dashboard', name: 'ver_dashboard', icon: 'fa-home' },
     { label: 'Ordens', name: 'gerenciar_ordens', icon: 'fa-list-alt' },
     { label: 'Clientes', name: 'gerenciar_clientes', icon: 'fa-users' },
     { label: 'Funcionários', name: 'gerenciar_funcionarios', icon: 'fa-user-tie' },
     { label: 'Financeiro', name: 'ver_financeiro', icon: 'fa-chart-pie' },
     { label: 'Configurações', name: 'gerenciar_configuracoes', icon: 'fa-cog',
        sub_permissions: [
            { name: 'config_ver_servicos', label: 'Serviços e Adicionais' },
            { name: 'config_ver_empresa', label: 'Dados da Empresa' },
            { name: 'config_ver_tokens', label: 'Tokens de Acesso' },
            { name: 'config_ver_usuarios', label: 'Usuários e Permissões' },
            { name: 'config_ver_preferencias', label: 'Preferências' },
        ]
    },
];
```

### **Payment Methods Config:**
```javascript
const paymentMethods = [
    { id: 'DINHEIRO', label: 'Dinheiro', icon: 'fa-money-bill-wave', color: '#f59e0b', desc: 'Pagamento em espécie' },
    { id: 'PIX', label: 'PIX', icon: 'fab fa-pix', color: '#32BCAD', desc: 'Pagamento instantâneo' },
    { id: 'CARTAO', label: 'Cartão', icon: 'fa-credit-card', color: '#3b82f6', desc: 'Débito ou crédito' },
    { id: 'DEBITO_FUNCIONARIO', label: 'Débito de Funcionário', icon: 'fa-user-tag', color: '#f97316', desc: 'Lançar como adiantamento' }
];
```

---

## Testing Checklist

### **Preferências:**
- [ ] Toggle switches save correctly
- [ ] Payment method cards toggle on/off
- [ ] Card visual state updates (active class)
- [ ] Notification preferences save
- [ ] Default page selector works
- [ ] Settings persist after page reload

### **Usuários e Permissões:**
- [ ] Can create new role
- [ ] Can edit existing role
- [ ] Permission accordion expands/collapses
- [ ] Sub-permissions auto-check parent
- [ ] Can create new user
- [ ] Can edit user (password optional)
- [ ] Max discount saves correctly
- [ ] Can delete role (only if no users)
- [ ] Can delete user
- [ ] Permission-based visibility works

### **Tokens de Acesso:**
- [ ] Tokens load from API
- [ ] Can copy link to clipboard
- [ ] Status toggle updates immediately
- [ ] Can delete token with confirmation
- [ ] Direct link opens in new tab
- [ ] Table updates after changes

---

## Summary

**Total Missing Features:** 7 major features
**Critical Features:** 1 (Preferências)
**High-Value Features:** 2 (Roles/Users, Tokens)
**Medium-Value Features:** 2 (Payment Cards, Permission Visibility)
**Low-Value Features:** 2 (Drag/Drop, Unified Save)

**Recommended Focus:**
1. ✅ Preferências Tab (business-critical)
2. ✅ Usuários e Permissões Tab (team collaboration)
3. ✅ Tokens de Acesso Tab (employee management)
4. ⏸️ Defer drag-drop and optimizations for later

**Estimated Total Implementation Time:** 8-12 hours
**Recommended Phases:** 4 phases over 2-3 development sessions

---

**Next Steps:**
1. User decides which features to implement
2. Verify backend API endpoints are available
3. Start with Phase 1 (Preferências Tab)
4. Adapt Alpine.js patterns from current code to old features
5. Test thoroughly before deploying
