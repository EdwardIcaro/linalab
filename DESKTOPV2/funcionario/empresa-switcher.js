/**
 * Seletor de empresa para subaccounts com acesso multi-empresa.
 *
 * Autossuficiente: pode ser incluído em qualquer página do funcionário (raiz ou
 * subpasta). Transforma o #empresaNome do header num dropdown quando o funcionário
 * tem acesso a 2+ empresas. Zero efeito para quem tem 1 empresa.
 *
 * Robustez: o chevron é inserido como IRMÃO do #empresaNome (não filho), então
 * sobrevive a um posterior `empresaNome.textContent = ...` feito pela página.
 */
(function () {
  'use strict';

  function injectStyles() {
    if (document.getElementById('emp-switch-styles')) return;
    const st = document.createElement('style');
    st.id = 'emp-switch-styles';
    st.textContent = `
      #empresaNome.emp-switch-on { cursor:pointer; text-decoration:underline dotted; text-underline-offset:3px; }
      .emp-chev { cursor:pointer; margin-left:6px; font-size:.85em; color:#0066cc; user-select:none; transition:opacity .15s; }
      .emp-chev:hover { opacity:.7; }
      .emp-switch-menu { position:fixed; z-index:99999; background:#fff; border:1px solid #e2e8f0; border-radius:12px;
        box-shadow:0 12px 32px rgba(0,0,0,.18); min-width:210px; max-width:82vw; padding:6px; opacity:0; transform:translateY(-6px);
        pointer-events:none; transition:opacity .15s, transform .15s; }
      .emp-switch-menu.open { opacity:1; transform:translateY(0); pointer-events:auto; }
      .emp-switch-item { display:flex; align-items:center; gap:8px; padding:11px 12px; border-radius:8px; cursor:pointer;
        font-size:14px; color:#1e293b; }
      .emp-switch-item:hover { background:#f1f5f9; }
      .emp-switch-item.current { color:#0066cc; font-weight:600; }
      .emp-switch-item .emp-ck { width:14px; text-align:center; color:#0066cc; }
      .emp-switch-loading { position:fixed; inset:0; z-index:100000; display:flex; flex-direction:column; align-items:center;
        justify-content:center; gap:16px; background:rgba(255,255,255,.92); backdrop-filter:blur(3px); opacity:0;
        transition:opacity .15s; }
      .emp-switch-loading.show { opacity:1; }
      .emp-switch-loading .sp { width:44px; height:44px; border:4px solid #dbeafe; border-top-color:#0066cc; border-radius:50%;
        animation:emp-spin .7s linear infinite; }
      .emp-switch-loading .txt { color:#1e293b; font-size:15px; font-weight:600; }
      .emp-switch-loading .sub { color:#64748b; font-size:13px; margin-top:-8px; }
      @keyframes emp-spin { to { transform:rotate(360deg); } }
    `;
    document.head.appendChild(st);
  }

  function showSwitchLoading(nome) {
    let ov = document.getElementById('empSwitchLoading');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'empSwitchLoading';
      ov.className = 'emp-switch-loading';
      ov.innerHTML = '<div class="sp"></div><div class="txt">Trocando de empresa...</div><div class="sub"></div>';
      document.body.appendChild(ov);
    }
    ov.querySelector('.sub').textContent = nome ? ('→ ' + nome) : '';
    // força reflow p/ a transição de opacidade rodar
    void ov.offsetWidth;
    ov.classList.add('show');
  }
  function hideSwitchLoading() {
    const ov = document.getElementById('empSwitchLoading');
    if (ov) ov.classList.remove('show');
  }

  async function doSwitchEmpresa(empresaId, nome) {
    showSwitchLoading(nome);
    try {
      const res = await window.api.switchEmpresa(empresaId);
      if (!res || !res.token) throw new Error('Resposta inválida do servidor');
      localStorage.setItem('token', res.token);
      localStorage.setItem('empresaId', res.empresa.id);
      localStorage.setItem('empresaNome', res.empresa.nome);
      if (res.role && res.role.permissoes) localStorage.setItem('permissoes', JSON.stringify(res.role.permissoes));
      if (res.role && res.role.nome) localStorage.setItem('cargo', res.role.nome);
      // mantém o overlay visível até o reload trocar de página
      setTimeout(function () { location.reload(); }, 300);
    } catch (e) {
      hideSwitchLoading();
      if (typeof showToast === 'function') showToast((e && e.message) || 'Erro ao trocar de empresa', 'error');
      else alert((e && e.message) || 'Erro ao trocar de empresa');
    }
  }

  async function initEmpresaSwitcher() {
    const el = document.getElementById('empresaNome');
    if (!el || el.dataset.switcherReady) return;
    if (!window.api || typeof window.api.getMinhasEmpresas !== 'function') return;
    el.dataset.switcherReady = '1'; // marca cedo para evitar init concorrente

    let empresas = [];
    try {
      empresas = await window.api.getMinhasEmpresas();
    } catch (e) {
      return; // não é subaccount / sem acesso multi-empresa → mantém comportamento normal
    }
    if (!Array.isArray(empresas) || empresas.length < 2) return;

    injectStyles();
    const currentId = localStorage.getItem('empresaId');

    el.classList.add('emp-switch-on');

    // Chevron como IRMÃO do #empresaNome (sobrevive a textContent posterior)
    let chev = el.nextElementSibling;
    if (!chev || !chev.classList || !chev.classList.contains('emp-chev')) {
      chev = document.createElement('span');
      chev.className = 'emp-chev';
      chev.title = 'Trocar de empresa';
      chev.innerHTML = '<i class="fas fa-right-left"></i>'; // ícone de troca
      el.insertAdjacentElement('afterend', chev);
    }

    let menu = document.getElementById('empSwitchMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'empSwitchMenu';
      menu.className = 'emp-switch-menu';
      document.body.appendChild(menu);
    }
    menu.innerHTML = empresas.map(function (e) {
      const nome = String(e.nome || '').replace(/</g, '&lt;');
      const isCur = e.id === currentId;
      return '<div class="emp-switch-item ' + (isCur ? 'current' : '') + '" data-id="' + e.id + '">' +
        '<span class="emp-ck">' + (isCur ? '✓' : '') + '</span><span>' + nome + '</span></div>';
    }).join('');

    function toggleMenu(ev) {
      ev.stopPropagation();
      const r = el.getBoundingClientRect();
      menu.style.top = (r.bottom + 6) + 'px';
      menu.style.left = Math.max(8, r.left) + 'px';
      menu.classList.toggle('open');
    }
    el.addEventListener('click', toggleMenu);
    chev.addEventListener('click', toggleMenu);
    document.addEventListener('click', function () { menu.classList.remove('open'); });
    window.addEventListener('resize', function () { menu.classList.remove('open'); });

    menu.addEventListener('click', function (ev) {
      const item = ev.target.closest('.emp-switch-item');
      if (!item) return;
      ev.stopPropagation();
      menu.classList.remove('open');
      const id = item.dataset.id;
      const nome = item.lastElementChild ? item.lastElementChild.textContent : '';
      if (id !== localStorage.getItem('empresaId')) doSwitchEmpresa(id, nome);
    });
  }

  // Auto-init: espera o header (#empresaNome) existir — cobre headers injetados
  // dinamicamente e páginas que não chamam loadUserInfo.
  let tries = 0;
  const timer = setInterval(function () {
    tries++;
    const el = document.getElementById('empresaNome');
    if (el && !el.dataset.switcherReady) initEmpresaSwitcher();
    if ((el && el.dataset.switcherReady) || tries >= 25) clearInterval(timer);
  }, 250);

  window.initEmpresaSwitcher = initEmpresaSwitcher;
})();
