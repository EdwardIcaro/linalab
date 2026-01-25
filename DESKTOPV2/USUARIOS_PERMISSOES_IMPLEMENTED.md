# ✅ Usuários e Permissões Tab - Phase 2 Complete

**Date:** 2026-01-21
**Phase:** Phase 2 of 4
**Status:** READY FOR TESTING

---

## What Was Implemented

### **New Tab: "Usuários e Permissões"**

A complete Role-Based Access Control (RBAC) system has been added, featuring:

#### **1. Funções (Roles) Management**

✅ **Roles Table:**
- Lists all custom roles
- Shows user count per role
- Displays first 3 permissions (with "+X" badge for more)
- Edit and Delete actions

✅ **Create/Edit Role Modal:**
- Role name field
- **Permission Accordion System:**
  - Expandable permission groups
  - Master checkboxes for main permissions
  - Sub-checkboxes for granular control
  - Auto-checking parent when sub-permission selected
- Available Permissions:
  - 📊 Dashboard (`ver_dashboard`)
  - 📋 Ordens (`gerenciar_ordens`)
  - 👥 Clientes (`gerenciar_clientes`)
  - 👔 Funcionários (`gerenciar_funcionarios`)
  - 💰 Financeiro (`ver_financeiro`)
  - ⚙️ Configurações (`gerenciar_configuracoes`) with sub-permissions:
    - Serviços e Adicionais
    - Dados da Empresa
    - Tokens de Acesso
    - Usuários e Permissões
    - Preferências

✅ **Delete Role:**
- Confirmation modal
- Only allows deletion if no users assigned
- Clear error messaging

#### **2. Usuários (Subaccounts) Management**

✅ **Users Table:**
- Lists all subaccounts
- Shows: Name, Email, Role, Max Discount %
- Edit and Delete actions

✅ **Create/Edit User Modal:**
- Username field (for login)
- Email field
- Password field (optional on edit)
- Role selector (dropdown populated from roles)
- **Max Discount % field** - Custom per user
- Password hint on edit mode

✅ **Delete User:**
- Confirmation modal
- Permanent deletion warning

---

## Technical Implementation Details

### **Frontend Changes:**

#### **configuracoes.html**

**1. Added Tab Button:**
```html
<button class="tab-button" :class="{ 'active': activeTab === 'usuarios' }" @click="activeTab = 'usuarios'">
    <i class="fas fa-user-shield mr-2"></i> Usuários e Permissões
</button>
```

**2. Added Tab Content:**
- Two sections: Roles and Users
- Both use Alpine.js x-for for reactive tables
- Empty states when no data
- Action buttons with icons

**3. Added Modals:**
- **Role Modal:** 700px max-width, permission accordion
- **User Modal:** Standard width, role selector

**4. Updated Alpine.js Data Model:**
```javascript
// Modals state
modals: {
    role: false,
    user: false
}

// Data
roles: [],
users: [],
expandedPermissions: [],

// Forms
roleForm: {
    id: null,
    nome: '',
    selectedPermissions: []
},

userForm: {
    id: null,
    nome: '',
    email: '',
    senha: '',
    roleId: '',
    maxDesconto: 0
},

// Permissions definition
allPermissions: [
    { label: 'Dashboard', name: 'ver_dashboard', icon: 'fa-home' },
    // ... full permission tree
]
```

**5. Added Functions:**

**loadRolesAndUsers():**
- Calls `GET /api/roles`
- Populates `roles` and `users` arrays
- Silent fail if endpoint doesn't exist (Phase 2 graceful degradation)

**openRoleModal(role):**
- Opens modal for create/edit
- Populates form with existing role data
- Maps permission objects to selectedPermissions array

**closeRoleModal():**
- Closes modal
- Resets form state
- Clears expanded permissions

**saveRole():**
- Validates form data
- Calls `POST /api/roles` with: `{ id, nome, permissoes }`
- Updates/creates role
- Reloads roles and users
- Shows success/error toast

**deleteRole(id, nome):**
- Shows confirmation modal
- Calls `DELETE /api/roles/:id`
- Reloads data
- Shows success/error toast

**openUserModal(user):**
- Opens modal for create/edit
- Populates form fields
- Password not required on edit

**closeUserModal():**
- Closes modal
- Resets form state

**saveUser():**
- Validates form data
- Calls `POST /api/roles/subaccount` (create) or `PATCH /api/roles/subaccount/:id` (update)
- Only sends password if filled
- Includes maxDesconto field
- Reloads data
- Shows toast notifications

**deleteUser(id, nome):**
- Shows confirmation modal
- Calls `DELETE /api/roles/subaccount/:id`
- Reloads data

**togglePermissionGroup(permName):**
- Expands/collapses permission accordion
- Updates `expandedPermissions` array

**handleMasterCheckboxChange(perm):**
- When master checkbox toggled
- Auto-checks/unchecks all sub-permissions
- Maintains selectedPermissions array

**handleSubCheckboxChange(perm, sub):**
- When sub-checkbox toggled
- Auto-checks master if any sub-permission selected
- Auto-unchecks master if all sub-permissions unselected

**6. Updated loadData():**
- Added `loadRolesAndUsers()` to Promise.all
- Loads roles/users in parallel with other data
- Logs loaded counts

#### **configuracoes.css**

**Added Complete Styling:**

**1. Permission Accordion:**
- `.permissions-accordion` - Scrollable container (400px max-height)
- `.permission-group` - Gray background, rounded corners
- `.permission-group.expanded` - Primary border when open
- `.permission-group-header` - Clickable header with hover effect
- `.expand-icon` - Rotates 180° when expanded
- `.sub-permissions-list` - Hidden by default, shown when expanded
- `.sub-permission-item` - Hover effects, proper spacing

**2. Checkboxes:**
- `.form-checkbox` - 18px × 18px, rounded corners
- Gradient background when checked
- Primary border on hover
- Smooth transitions

**3. Badge Styling:**
- `.subtipo-badge` - Permission badges in table
- Gradient background with primary color
- Border matching brand
- Small font, proper padding

**4. Mobile Responsiveness:**
- Smaller accordion height on mobile
- Reduced padding for sub-permissions

---

## Files Modified

### **1. C:\LinaX\DESKTOPV2\configuracoes.html**

**Changes:**
- ✅ Added Usuários e Permissões tab button
- ✅ Added complete tab content (Roles + Users sections)
- ✅ Added Role modal with permission accordion
- ✅ Added User modal with role selector
- ✅ Updated modals state (added role, user)
- ✅ Added roles, users, expandedPermissions data arrays
- ✅ Added roleForm and userForm models
- ✅ Added allPermissions constant (permission tree)
- ✅ Added loadRolesAndUsers() function
- ✅ Added 10+ role/user management functions
- ✅ Updated loadData() to include loadRolesAndUsers()
- ✅ Updated tab validation to include 'usuarios'

**Total Lines Added:** ~350 lines

### **2. C:\LinaX\DESKTOPV2\configuracoes.css**

**Changes:**
- ✅ Added .permissions-accordion styles
- ✅ Added .permission-group styles (default + expanded states)
- ✅ Added .permission-group-header with hover
- ✅ Added .expand-icon with rotation animation
- ✅ Added .sub-permissions-list with show/hide logic
- ✅ Added .sub-permission-item with hover effects
- ✅ Added .form-checkbox styles (checked/unchecked/hover)
- ✅ Added .subtipo-badge styles for permission badges
- ✅ Added mobile responsiveness

**Total Lines Added:** ~120 lines

---

## Backend Requirements

### **API Endpoints Needed:**

✅ **GET /api/roles**
- Returns: `{ roles: [...], usuarios: [...] }`
- Roles include: `{ id, nome, permissoes: [{ name, nome }], _count: { usuarios } }`
- Users include: `{ id, nome, email, roleInt: { id, nome }, maxDesconto }`

✅ **POST /api/roles**
- Body: `{ id: string | null, nome: string, permissoes: string[] }`
- Creates new role (if id is null) or updates existing
- Returns: role object

✅ **DELETE /api/roles/:id**
- Deletes role by ID
- Should fail if role has users assigned
- Returns: success message

✅ **POST /api/roles/subaccount**
- Body: `{ nome, email, senha, roleId, maxDesconto }`
- Creates new subaccount
- Returns: user object

✅ **PATCH /api/roles/subaccount/:id**
- Body: `{ nome, email, senha?, roleId, maxDesconto }`
- Updates existing subaccount
- `senha` is optional (only update if provided)
- Returns: updated user object

✅ **DELETE /api/roles/subaccount/:id**
- Deletes subaccount by ID
- Returns: success message

### **Database Schema:**

Based on existing schema.prisma:
- ✅ `Usuario` model exists (line 16-29)
- ✅ `UserRole` enum exists (line 32-37)
- ✅ Relationships established

**Additional tables might be needed:**
- `Role` (internal roles) - for custom business roles
- `Permission` - for permission definitions
- `RolePermission` - many-to-many relation

**Check if backend has these implemented!**

---

## Testing Checklist

### **Visual Tests:**

- [ ] Usuários e Permissões tab button appears
- [ ] Tab content shows two sections (Roles and Users)
- [ ] Tables display properly
- [ ] Empty states show when no data
- [ ] Role modal opens and displays accordion
- [ ] User modal opens and displays form
- [ ] Checkboxes are styled correctly
- [ ] Permission groups expand/collapse smoothly

### **Functional Tests:**

#### **Roles Management:**
- [ ] Click "Nova Função" opens modal
- [ ] Enter role name
- [ ] Click permission groups to expand
- [ ] Check master checkbox selects all sub-permissions
- [ ] Check sub-permission auto-checks master
- [ ] Uncheck last sub-permission auto-unchecks master
- [ ] Click "Salvar" creates role
- [ ] Role appears in table with correct permissions
- [ ] Click "Editar" on role loads data correctly
- [ ] Update role and save
- [ ] Click "Excluir" shows confirmation
- [ ] Confirm deletion removes role
- [ ] Try to delete role with users (should fail gracefully)

#### **Users Management:**
- [ ] Click "Novo Usuário" opens modal
- [ ] All fields are editable
- [ ] Password is required for new user
- [ ] Role dropdown populated with roles
- [ ] Max desconto accepts 0-100
- [ ] Click "Salvar" creates user
- [ ] User appears in table
- [ ] Click "Editar" on user loads data
- [ ] Password field shows hint on edit
- [ ] Password not required on edit
- [ ] Save without password keeps existing password
- [ ] Save with new password updates password
- [ ] Click "Excluir" shows confirmation
- [ ] Confirm deletion removes user

#### **Data Persistence:**
- [ ] Create role with multiple permissions
- [ ] Save and reload page
- [ ] Role persists with correct permissions
- [ ] Create user assigned to role
- [ ] Reload page
- [ ] User persists with correct role

#### **Error Handling:**
- [ ] Try to save role without name (should show validation)
- [ ] Try to save user without required fields
- [ ] Backend error displays toast message
- [ ] Modals close after successful save
- [ ] Data reloads after create/update/delete

---

## Known Limitations

1. **Backend Dependency:** This feature requires backend endpoints that might not exist yet. The implementation includes graceful degradation (silent fail on load if endpoints missing).

2. **Permission Enforcement:** This UI only manages roles and permissions. Actual permission checking/enforcement must be implemented in:
   - Frontend (hide/show components based on user permissions)
   - Backend (API route protection)

3. **No Real-Time Updates:** Changes to roles/users require manual page reload to reflect in other sessions.

4. **No Bulk Operations:** Can't delete multiple roles/users at once.

5. **No Role Search/Filter:** With many roles, table might get long (could add search later).

---

## Integration Notes

### **How Permissions Work:**

**Permission Structure:**
```javascript
{
    name: 'ver_dashboard',      // Unique permission key
    label: 'Dashboard',          // Display name
    icon: 'fa-home'              // Icon class
    sub_permissions: [...]       // Optional sub-permissions
}
```

**Stored in Database as:**
```json
{
    "permissoes": ["ver_dashboard", "gerenciar_ordens", "config_ver_servicos"]
}
```

**Used in Frontend:**
```javascript
// Check if user has permission
if (hasPermission('gerenciar_ordens')) {
    // Show orders management features
}
```

**Used in Backend:**
```javascript
// Protect routes
router.get('/ordens', requirePermission('gerenciar_ordens'), getOrdens);
```

### **Max Discount Feature:**

The `maxDesconto` field (0-100) represents the maximum percentage discount a user can apply to an order.

**Example Use:**
```javascript
// In order creation/edit
const userMaxDiscount = currentUser.maxDesconto || 0; // e.g., 10 = 10%
if (orderDiscount > userMaxDiscount) {
    showToast(`Desconto máximo permitido: ${userMaxDiscount}%`, 'error');
    return;
}
```

---

## Next Steps

### **Immediate (Testing):**
1. ✅ Reload `configuracoes.html`
2. ✅ Click "Usuários e Permissões" tab
3. ✅ Check console for API errors
4. ❓ If backend endpoints exist:
   - Test creating a role
   - Test creating a user
   - Test permission accordion
5. ❓ If backend endpoints don't exist:
   - Tables will show empty states
   - This is expected - backend implementation needed

### **Backend Implementation Required:**
If endpoints don't exist, backend developer needs to implement:
1. Database models for internal roles and permissions
2. API routes: GET/POST/DELETE for roles
3. API routes: GET/POST/PATCH/DELETE for subaccounts
4. Permission middleware for route protection
5. Role assignment logic

### **Future Enhancements:**
- Permission-based UI visibility (hide tabs/buttons)
- Role templates (pre-configured permission sets)
- User search and filtering
- Bulk user import/export
- Activity log (who created/modified roles/users)
- Password complexity requirements
- Two-factor authentication

### **Phase 3 Preview:**
Next phase will add:
- **Tokens de Acesso Tab** (lavador token management)
- Token activation/deactivation
- Copy link functionality
- Direct access to public interface

---

## Troubleshooting

### **Issue: Tab shows but tables are empty**
- **Check:** Browser console for API errors
- **Likely Cause:** Backend doesn't have /api/roles endpoint
- **Fix:** Implement backend endpoints or mock data for testing

### **Issue: "Erro ao carregar roles e usuários"**
- **Check:** Network tab for 404/500 errors
- **Fix:** Verify backend is running and endpoints exist

### **Issue: Save button doesn't work**
- **Check:** Console for JavaScript errors
- **Check:** Network tab for API response
- **Fix:** Verify request format matches backend expectations

### **Issue: Permission accordion doesn't expand**
- **Check:** Alpine.js is loaded (check console)
- **Fix:** Hard reload (Ctrl+Shift+R)

### **Issue: Checkboxes don't work properly**
- **Check:** x-model bindings in code
- **Fix:** Verify selectedPermissions array is reactive

---

## Success Criteria

✅ **Phase 2 Complete When:**
1. Usuários e Permissões tab appears and loads
2. Both Roles and Users tables display
3. Role modal opens with permission accordion
4. Permission groups expand/collapse correctly
5. Master/sub checkbox logic works
6. User modal opens with role selector
7. Forms validate properly
8. Save/Delete operations work (if backend exists)
9. No console errors
10. Styles match design system

---

## Summary

**What You Have Now:**
- ✅ Complete RBAC system in frontend
- ✅ Role management with granular permissions
- ✅ User (subaccount) management
- ✅ Permission accordion with master/sub checkboxes
- ✅ Max discount per user
- ✅ Full CRUD operations
- ✅ Confirmation modals for delete operations
- ✅ Professional styling and UX

**What's Different from Old File:**
- ✅ Uses Alpine.js (reactive) instead of vanilla JS
- ✅ Modern accordion design
- ✅ Better UX (expanded states, hover effects)
- ✅ Integrated with configApp() state management
- ✅ Follows current page's Alpine patterns

**Backend Dependency:**
⚠️ This feature requires backend API endpoints. If they don't exist yet, the UI is ready but data operations won't work until backend is implemented.

**Ready for:** Integration testing with backend

**Next Phase:** Tokens de Acesso Tab (employee access token management)

---

**Last Updated:** 2026-01-21
**Implementation Time:** ~2 hours
**Lines of Code Added:** ~470 lines
**Files Modified:** 2 files
**Status:** ✅ COMPLETE - Ready for Backend Integration
