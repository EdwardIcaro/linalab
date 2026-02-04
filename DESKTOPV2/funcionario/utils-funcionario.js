/**
 * UTILS PARA FUNCIONÁRIOS
 * Componentes e funções reutilizáveis para páginas de funcionário
 */

// ===== VALIDAÇÃO =====
function validateFuncionarioAccess() {
  const userRole = localStorage.getItem('userRole');
  const token = localStorage.getItem('token');

  if (userRole !== 'USER' || !token) {
    showToast('Acesso não autorizado. Você não é um funcionário.', 'error');
    setTimeout(() => {
      window.location.href = '../login.html';
    }, 1500);
    return false;
  }
  return true;
}

// ===== HEADER FUNCIONÁRIO =====
function createFuncionarioHeader(pageTitle) {
  return `
    <header class="header-funcionario">
      <div class="header-left">
        <a href="../index-funcionario.html" class="logo-link">
          <div class="logo">
            <i class="fas fa-briefcase"></i>
          </div>
        </a>
        <div class="page-info">
          <h1 class="page-title">${pageTitle}</h1>
          <p class="page-subtitle" id="empresaNome">Carregando...</p>
        </div>
      </div>

      <div class="header-right">
        <button class="icon-btn" onclick="toggleMenu()" title="Menu">
          <i class="fas fa-ellipsis-v"></i>
        </button>
      </div>
    </header>
  `;
}

// ===== MENU DROPDOWN =====
function createFuncionarioMenu() {
  return `
    <div class="menu-dropdown" id="menuDropdown">
      <a href="../perfil.html">
        <i class="fas fa-id-card"></i>
        <span>Meu Perfil</span>
      </a>
      <a href="../index-funcionario.html">
        <i class="fas fa-home"></i>
        <span>Início</span>
      </a>
      <button onclick="logout()">
        <i class="fas fa-sign-out-alt"></i>
        <span>Sair</span>
      </button>
    </div>
    <div class="overlay" id="overlay" onclick="closeMenu()"></div>
  `;
}

// ===== MOBILE NAVIGATION =====
function createMobileNav(activePage) {
  const permissoes = JSON.parse(localStorage.getItem('permissoes') || '[]');

  let html = `
    <nav class="mobile-bottom-nav">
      <a href="../index-funcionario.html" class="nav-item ${activePage === 'home' ? 'active' : ''}" title="Início">
        <i class="fas fa-home"></i>
        <span>Início</span>
      </a>
  `;

  if (permissoes.includes('gerenciar_ordens')) {
    html += `
      <a href="ordens-funcionario.html" class="nav-item ${activePage === 'ordens' ? 'active' : ''}" title="Ordens">
        <i class="fas fa-list-alt"></i>
        <span>Ordens</span>
      </a>
    `;
  }

  if (permissoes.includes('gerenciar_clientes')) {
    html += `
      <a href="clientes-funcionario.html" class="nav-item ${activePage === 'clientes' ? 'active' : ''}" title="Clientes">
        <i class="fas fa-users"></i>
        <span>Clientes</span>
      </a>
    `;
  }

  if (permissoes.includes('gerenciar_funcionarios')) {
    html += `
      <a href="funcionarios-funcionario.html" class="nav-item ${activePage === 'funcionarios' ? 'active' : ''}" title="Equipe">
        <i class="fas fa-user-tie"></i>
        <span>Equipe</span>
      </a>
    `;
  }

  if (permissoes.includes('ver_financeiro')) {
    html += `
      <a href="financeiro-funcionario.html" class="nav-item ${activePage === 'financeiro' ? 'active' : ''}" title="Financeiro">
        <i class="fas fa-chart-line"></i>
        <span>Financeiro</span>
      </a>
    `;
  }

  if (permissoes.includes('config_ver_servicos')) {
    html += `
      <a href="servicos-funcionario.html" class="nav-item ${activePage === 'servicos' ? 'active' : ''}" title="Serviços">
        <i class="fas fa-wrench"></i>
        <span>Serviços</span>
      </a>
    `;
  }

  html += `
    <button class="nav-item" onclick="toggleMenu()" title="Menu">
      <i class="fas fa-bars"></i>
      <span>Menu</span>
    </button>
  </nav>
  `;

  return html;
}

// ===== EMPTY STATE =====
function createEmptyState(icon, title, message, actionText = null, actionFn = null) {
  let html = `
    <div class="empty-state">
      <i class="fas ${icon}"></i>
      <h2>${title}</h2>
      <p>${message}</p>
  `;

  if (actionText && actionFn) {
    html += `<button class="btn-primary" onclick="${actionFn}">${actionText}</button>`;
  }

  html += `</div>`;
  return html;
}

// ===== LOADING STATE =====
function createLoading() {
  return `
    <div class="loading-container">
      <div class="spinner"></div>
      <p>Carregando dados...</p>
    </div>
  `;
}

// ===== TOAST NOTIFICATION =====
function showToast(message, type = 'success') {
  // Remove toast anterior se existir
  const existingToast = document.getElementById('toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
      <span>${message}</span>
    </div>
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ===== CONFIRMATION DIALOG =====
function showConfirm(title, message, onConfirm, onCancel = null) {
  const dialog = document.createElement('div');
  dialog.className = 'confirm-dialog';
  dialog.innerHTML = `
    <div class="confirm-overlay"></div>
    <div class="confirm-box">
      <h2>${title}</h2>
      <p>${message}</p>
      <div class="confirm-buttons">
        <button class="btn-cancel" onclick="this.closest('.confirm-dialog').remove(); ${onCancel ? onCancel() : ''}">
          Cancelar
        </button>
        <button class="btn-confirm" onclick="this.closest('.confirm-dialog').remove(); ${onConfirm}">
          Confirmar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);
}

// ===== MENU FUNCTIONS =====
function toggleMenu() {
  const menu = document.getElementById('menuDropdown');
  const overlay = document.getElementById('overlay');

  if (menu && overlay) {
    menu.classList.toggle('active');
    overlay.classList.toggle('active');
  }
}

function closeMenu() {
  const menu = document.getElementById('menuDropdown');
  const overlay = document.getElementById('overlay');

  if (menu && overlay) {
    menu.classList.remove('active');
    overlay.classList.remove('active');
  }
}

// ===== LOGOUT =====
function logout() {
  showConfirm(
    'Sair',
    'Tem certeza que deseja sair?',
    'localStorage.clear(); window.location.href = "../login.html";'
  );
}

// ===== LOAD USER INFO =====
function loadUserInfo() {
  const usuarioNome = localStorage.getItem('usuarioNome') || 'Usuário';
  const empresaNome = localStorage.getItem('empresaNome') || 'Empresa';

  const empresaElement = document.getElementById('empresaNome');
  if (empresaElement) {
    empresaElement.textContent = empresaNome;
  }

  document.title = document.title + ' - ' + usuarioNome;
}

// ===== FORMAT CURRENCY =====
function formatCurrency(value) {
  if (!value) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

// ===== FORMAT DATE =====
function formatDate(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(date));
}

// ===== FORMAT PHONE =====
function formatPhone(phone) {
  if (!phone) return '-';
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.replace(/(\d{2})(\d{4,5})(\d{4})/, '($1) $2-$3');
}

// ===== CLOSE ALL MENUS =====
document.addEventListener('click', (e) => {
  const menu = document.getElementById('menuDropdown');
  const btn = document.querySelector('.icon-btn');

  if (menu && btn && !menu.contains(e.target) && !btn.parentElement.contains(e.target)) {
    closeMenu();
  }
});

// ===== ESCAPE KEY =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu();
  }
});

// ===== SKELETON LOADER =====
function createSkeleton(height = '20px', width = '100%') {
  return `<div class="skeleton" style="height: ${height}; width: ${width}; background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: loading 1.5s infinite;"></div>`;
}

// ===== GET USER LAVADOR =====
async function getUserLavador() {
  const usuarioId = localStorage.getItem('usuarioId');
  const response = await window.api.getLavadores();
  const lavadores = response.lavadores || [];
  return lavadores.find(l => l.usuarioId === usuarioId);
}

// ===== FILTER HELPERS =====
function getDatePreset(preset) {
  const today = new Date();

  switch(preset) {
    case 'today':
      return {
        dataInicio: today.toISOString().split('T')[0],
        dataFim: today.toISOString().split('T')[0]
      };
    case 'week':
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      return {
        dataInicio: weekStart.toISOString().split('T')[0],
        dataFim: today.toISOString().split('T')[0]
      };
    case 'month':
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      return {
        dataInicio: monthStart.toISOString().split('T')[0],
        dataFim: today.toISOString().split('T')[0]
      };
    default:
      return {
        dataInicio: today.toISOString().split('T')[0],
        dataFim: today.toISOString().split('T')[0]
      };
  }
}

// ===== EXPORT =====
console.log('Utils Funcionário carregado');
