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
        <a href="../perfil-funcionario.html" class="icon-btn" title="Meu Perfil">
          <i class="fas fa-user-circle"></i>
        </a>
        <button class="icon-btn" onclick="logout()" title="Sair">
          <i class="fas fa-sign-out-alt"></i>
        </button>
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
      <a href="../perfil-funcionario.html">
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
  const rows = Array.from({ length: 5 }, () => `
    <div class="sk-row">
      <div class="sk-base sk-name"></div>
      <div class="sk-base sk-mid"></div>
      <div class="sk-base sk-mid"></div>
      <div class="sk-base sk-mid"></div>
      <div class="sk-base sk-badge"></div>
    </div>
  `).join('');
  return `<div class="table-container"><div class="loading-skeleton">${rows}</div></div>`;
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
        <button class="btn-cancel" id="confirmCancel">
          Cancelar
        </button>
        <button class="btn-confirm" id="confirmConfirm">
          Confirmar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  const cancelBtn = dialog.querySelector('#confirmCancel');
  const confirmBtn = dialog.querySelector('#confirmConfirm');

  cancelBtn.addEventListener('click', () => {
    dialog.remove();
    if (onCancel && typeof onCancel === 'function') {
      onCancel();
    }
  });

  confirmBtn.addEventListener('click', () => {
    dialog.remove();
    if (onConfirm && typeof onConfirm === 'function') {
      onConfirm();
    }
  });
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
    () => {
      showToast('Até logo!', 'success');
      setTimeout(() => {
        if (typeof clearSession === 'function') { clearSession(); } else { localStorage.clear(); }
        window.location.href = '../login.html';
      }, 500);
    }
  );
}

// ===== LOAD USER INFO =====
async function loadUserInfo() {
  const usuarioNome = localStorage.getItem('usuarioNome') || 'Usuário';
  let empresaNome = localStorage.getItem('empresaNome');

  const empresaElement = document.getElementById('empresaNome');
  if (empresaElement) {
    // Se não temos empresaNome no localStorage, busca via API
    if (!empresaNome) {
      const empresaId = localStorage.getItem('empresaId');
      if (empresaId) {
        try {
          const empresaData = await window.api.getEmpresaById(empresaId);
          empresaNome = empresaData.nome || empresaData.name || 'Minha Empresa';
          // Salva para próximas vezes
          localStorage.setItem('empresaNome', empresaNome);
        } catch (error) {
          console.error('Erro ao carregar dados da empresa:', error);
          empresaNome = 'Minha Empresa';
        }
      } else {
        empresaNome = 'Minha Empresa';
      }
    }
    empresaElement.textContent = empresaNome;
  }

  document.title = document.title + ' - ' + usuarioNome;

  // Seletor multi-empresa — só aparece se o funcionário tiver acesso a 2+ empresas
  initEmpresaSwitcher();
}

// ===== SELETOR DE EMPRESA (MULTI-EMPRESA) =====
// Transforma o #empresaNome do header num dropdown quando o subaccount tem acesso
// a mais de uma empresa. Centralizado aqui → funciona em todas as páginas /funcionario.
async function initEmpresaSwitcher() {
  const el = document.getElementById('empresaNome');
  if (!el || el.dataset.switcherReady) return;
  el.dataset.switcherReady = '1'; // marca cedo para evitar inicialização concorrente

  let empresas = [];
  try {
    empresas = await window.api.getMinhasEmpresas();
  } catch (e) {
    return; // Sem acesso multi-empresa / não é subaccount → mantém comportamento normal
  }
  if (!Array.isArray(empresas) || empresas.length < 2) return;

  const currentId = localStorage.getItem('empresaId');

  if (!document.getElementById('emp-switch-styles')) {
    const st = document.createElement('style');
    st.id = 'emp-switch-styles';
    st.textContent = `
      .emp-switch-trigger { cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
      .emp-switch-trigger .emp-chev { font-size:.75em; opacity:.7; }
      .emp-switch-menu { position:fixed; z-index:9999; background:#fff; border:1px solid #e2e8f0; border-radius:12px;
        box-shadow:0 12px 32px rgba(0,0,0,.16); min-width:210px; max-width:80vw; padding:6px; opacity:0; transform:translateY(-6px);
        pointer-events:none; transition:opacity .15s, transform .15s; }
      .emp-switch-menu.open { opacity:1; transform:translateY(0); pointer-events:auto; }
      .emp-switch-item { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:8px; cursor:pointer;
        font-size:14px; color:#1e293b; }
      .emp-switch-item:hover { background:#f1f5f9; }
      .emp-switch-item.current { color:#0066cc; font-weight:600; }
      .emp-switch-item .emp-ck { width:14px; text-align:center; color:#0066cc; }
    `;
    document.head.appendChild(st);
  }

  el.classList.add('emp-switch-trigger');
  if (!el.querySelector('.emp-chev')) {
    const chev = document.createElement('i');
    chev.className = 'fas fa-chevron-down emp-chev';
    el.appendChild(chev);
  }

  let menu = document.getElementById('empSwitchMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'empSwitchMenu';
    menu.className = 'emp-switch-menu';
    document.body.appendChild(menu);
  }
  menu.innerHTML = empresas.map(e => {
    const nome = String(e.nome || '').replace(/</g, '&lt;');
    const isCur = e.id === currentId;
    return `<div class="emp-switch-item ${isCur ? 'current' : ''}" data-id="${e.id}">
      <span class="emp-ck">${isCur ? '✓' : ''}</span><span>${nome}</span></div>`;
  }).join('');

  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const r = el.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, r.left) + 'px';
    menu.classList.toggle('open');
  });
  document.addEventListener('click', () => menu.classList.remove('open'));
  window.addEventListener('resize', () => menu.classList.remove('open'));

  menu.addEventListener('click', async (ev) => {
    const item = ev.target.closest('.emp-switch-item');
    if (!item) return;
    ev.stopPropagation();
    menu.classList.remove('open');
    const id = item.dataset.id;
    if (id !== localStorage.getItem('empresaId')) await doSwitchEmpresa(id);
  });
}

async function doSwitchEmpresa(empresaId) {
  try {
    const res = await window.api.switchEmpresa(empresaId);
    if (!res?.token) throw new Error('Resposta inválida do servidor');
    localStorage.setItem('token', res.token);
    localStorage.setItem('empresaId', res.empresa.id);
    localStorage.setItem('empresaNome', res.empresa.nome);
    if (res.role?.permissoes) localStorage.setItem('permissoes', JSON.stringify(res.role.permissoes));
    if (res.role?.nome) localStorage.setItem('cargo', res.role.nome);
    if (typeof showToast === 'function') showToast(`Empresa: ${res.empresa.nome}`, 'success');
    setTimeout(() => location.reload(), 350);
  } catch (e) {
    if (typeof showToast === 'function') showToast(e?.message || 'Erro ao trocar de empresa', 'error');
  }
}

// Auto-inicializa o seletor de empresa assim que o header (#empresaNome) existir.
// Cobre páginas que não chamam loadUserInfo e headers injetados dinamicamente.
(function autoInitEmpresaSwitcher() {
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const el = document.getElementById('empresaNome');
    if (el && !el.dataset.switcherReady) initEmpresaSwitcher();
    if ((el && el.dataset.switcherReady) || tries >= 20) clearInterval(timer);
  }, 300);
})();

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

// ===== ESTILOS GLOBAIS (tap feedback + transição + skeleton) =====
function injectGlobalStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Remove tap highlight padrão do browser */
    .nav-item, .icon-btn, .btn-primary, .btn-confirm, .btn-cancel,
    .btn-copy-link, .btn-link-copy, .logo-link {
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    /* Feedback de toque imediato */
    .nav-item:active {
      color: var(--primary, #0066cc) !important;
      background: rgba(0, 102, 204, 0.1) !important;
      transform: scale(0.91);
      transition: transform 0.08s ease, background 0.08s ease;
    }
    .icon-btn:active {
      background: rgba(0, 0, 0, 0.07) !important;
      transform: scale(0.90);
      transition: transform 0.08s ease;
    }
    .btn-primary:active, .btn-confirm:active {
      transform: scale(0.95);
      filter: brightness(0.87);
      transition: transform 0.08s ease, filter 0.08s ease;
    }
    .btn-cancel:active {
      transform: scale(0.95);
      filter: brightness(0.93);
      transition: transform 0.08s ease, filter 0.08s ease;
    }
    .btn-copy-link:active, .btn-link-copy:active {
      transform: scale(0.93);
      transition: transform 0.08s ease;
    }

    /* Overlay de transição entre páginas */
    .page-transition {
      position: fixed;
      inset: 0;
      background: #f8f9fa;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      opacity: 0;
      transition: opacity 0.12s ease;
      pointer-events: none;
    }
    .page-transition.active { opacity: 1; pointer-events: all; }
    .pt-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(0, 102, 204, 0.15);
      border-top-color: #0066cc;
      border-radius: 50%;
      animation: pt-spin 0.65s linear infinite;
    }
    .pt-label {
      font-size: 13px;
      color: #999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    @keyframes pt-spin { to { transform: rotate(360deg); } }

    /* Skeleton loader */
    @keyframes sk-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .sk-base {
      background: linear-gradient(90deg, #eeeeee 25%, #e2e2e2 50%, #eeeeee 75%);
      background-size: 200% 100%;
      animation: sk-shimmer 1.4s infinite;
      border-radius: 6px;
    }
    .loading-skeleton { padding: 8px 0; }
    .sk-row {
      display: flex;
      gap: 12px;
      padding: 16px 16px;
      border-bottom: 1px solid #f2f2f2;
      align-items: center;
    }
    .sk-row:last-child { border-bottom: none; }
    .sk-name  { height: 13px; flex: 2; }
    .sk-mid   { height: 13px; flex: 1; }
    .sk-badge { height: 22px; width: 56px; border-radius: 20px; flex-shrink: 0; }
  `;
  document.head.appendChild(style);
}

// ===== NAVEGAÇÃO COM FEEDBACK VISUAL =====
function navigateTo(url) {
  if (window._navigating) return;
  window._navigating = true;

  const overlay = document.createElement('div');
  overlay.className = 'page-transition';
  overlay.innerHTML = `
    <div class="pt-spinner"></div>
    <span class="pt-label">Carregando...</span>
  `;
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add('active'));
  setTimeout(() => { window.location.href = url; }, 200);
}

// Intercepta cliques nos itens de navegação para mostrar transição
document.addEventListener('click', (e) => {
  const navLink = e.target.closest('.nav-item[href], .logo-link[href]');
  if (navLink && navLink.href && !navLink.href.includes('javascript')) {
    e.preventDefault();
    navigateTo(navLink.href);
  }
});

// Injetar estilos imediatamente ao carregar o script
injectGlobalStyles();

// ===== EXPORT =====
console.log('Utils Funcionário carregado');
