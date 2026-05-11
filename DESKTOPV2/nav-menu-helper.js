// Nav Menu Helper - Adiciona perfil e logout automaticamente
(function() {
    function getUserInitials() {
        const name = localStorage.getItem('usuarioNome') || 'U';
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
        }
        return name.charAt(0).toUpperCase();
    }

    function getUserName() {
        return localStorage.getItem('usuarioNome') || 'Usuário';
    }

    function getUserRole() {
        const role = localStorage.getItem('userRole');
        const roleNames = {
            'LINA_OWNER': '👑 Administrador Geral',
            'OWNER': '👑 Proprietário',
            'FUNCIONARIO': 'Funcionário',
            'LAVADOR': 'Lavador'
        };
        return roleNames[role] || 'Usuário';
    }

    function showSairModal() {
        // Remove qualquer modal anterior
        const existing = document.getElementById('__sairModal');
        if (existing) existing.remove();

        const empresaNome = localStorage.getItem('empresaNome') || '';

        const overlay = document.createElement('div');
        overlay.id = '__sairModal';
        overlay.style.cssText = `
            position:fixed;inset:0;z-index:99999;
            display:flex;align-items:center;justify-content:center;
            background:rgba(15,23,42,.55);backdrop-filter:blur(4px);
            animation:__fadeIn .15s ease;
        `;

        overlay.innerHTML = `
            <style>
                @keyframes __fadeIn{from{opacity:0}to{opacity:1}}
                @keyframes __slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
                #__sairCard{
                    background:#fff;border-radius:20px;padding:28px 24px 20px;
                    width:min(340px,90vw);box-shadow:0 24px 64px rgba(15,23,42,.22);
                    animation:__slideUp .18s ease;font-family:'Inter',sans-serif;
                }
                #__sairCard h3{
                    font-size:17px;font-weight:800;color:#0f172a;
                    margin:0 0 4px;letter-spacing:-.3px;
                }
                #__sairCard p{
                    font-size:13px;color:#64748b;margin:0 0 20px;
                }
                .__sair-options{display:flex;flex-direction:column;gap:10px;}
                .__sair-btn{
                    display:flex;align-items:center;gap:12px;
                    padding:14px 16px;border-radius:12px;border:none;
                    cursor:pointer;font-family:'Inter',sans-serif;
                    font-size:14px;font-weight:600;text-align:left;
                    transition:opacity .15s,transform .12s;
                }
                .__sair-btn:active{transform:scale(.97);}
                .__sair-btn:hover{opacity:.88;}
                .__sair-btn-icon{
                    width:36px;height:36px;border-radius:10px;flex-shrink:0;
                    display:flex;align-items:center;justify-content:center;
                    font-size:16px;
                }
                .__btn-empresa{background:#f0f9ff;color:#0369a1;}
                .__btn-empresa .__sair-btn-icon{background:#bfdbfe;color:#1d4ed8;}
                .__btn-sair{background:#fff1f2;color:#be123c;}
                .__btn-sair .__sair-btn-icon{background:#fecdd3;color:#e11d48;}
                .__sair-cancel{
                    margin-top:8px;width:100%;padding:10px;border:none;
                    background:none;color:#94a3b8;font-size:13px;
                    font-family:'Inter',sans-serif;cursor:pointer;font-weight:500;
                }
                .__sair-cancel:hover{color:#64748b;}
                .__sair-sub{font-size:12px;font-weight:400;color:inherit;opacity:.75;margin-top:1px;}
            </style>
            <div id="__sairCard">
                <h3>Até logo! 👋</h3>
                <p>${empresaNome ? `Empresa: <strong>${empresaNome}</strong>` : 'O que deseja fazer?'}</p>
                <div class="__sair-options">
                    <button class="__sair-btn __btn-empresa" id="__btnTrocar">
                        <div class="__sair-btn-icon"><i class="fas fa-building"></i></div>
                        <div>
                            Trocar de Empresa
                            <div class="__sair-sub">Selecionar outra empresa</div>
                        </div>
                    </button>
                    <button class="__sair-btn __btn-sair" id="__btnSair">
                        <div class="__sair-btn-icon"><i class="fas fa-sign-out-alt"></i></div>
                        <div>
                            Sair do Sistema
                            <div class="__sair-sub">Encerrar sessão completamente</div>
                        </div>
                    </button>
                </div>
                <button class="__sair-cancel" id="__btnCancelar">Cancelar</button>
            </div>
        `;

        document.body.appendChild(overlay);

        // Fechar ao clicar fora do card
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.getElementById('__btnCancelar').addEventListener('click', () => overlay.remove());

        document.getElementById('__btnTrocar').addEventListener('click', () => {
            overlay.remove();
            // Mantém o token (userAuthMiddleware aceita o token scoped para listar empresas)
            // Apenas limpa o escopo atual para forçar re-seleção
            localStorage.removeItem('empresaId');
            localStorage.removeItem('empresaNome');
            window.location.href = 'hub.html';
        });

        document.getElementById('__btnSair').addEventListener('click', () => {
            overlay.remove();
            localStorage.clear();
            window.location.href = 'login.html';
        });
    }

    function handleLogout() {
        showSairModal();
    }

    // Adiciona os botões de perfil, notificação e logout ao nav-menu quando o DOM carregar
    function initNavMenuActions() {
        const navMenu = document.querySelector('.nav-menu-card');
        if (!navMenu) return;

        // Verifica se já existe o nav-menu-actions
        if (navMenu.querySelector('.nav-menu-actions')) return;

        // Envolve os links existentes em nav-menu-links se ainda não estiver
        if (!navMenu.querySelector('.nav-menu-links')) {
            const links = Array.from(navMenu.children);
            const linksWrapper = document.createElement('div');
            linksWrapper.className = 'nav-menu-links';
            links.forEach(link => linksWrapper.appendChild(link));
            navMenu.appendChild(linksWrapper);
        }

        // Cria o container de ações
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'nav-menu-actions';
        actionsDiv.innerHTML = `
            <!-- Notification Bell -->
            <div class="notification-wrapper">
                <button id="notification-bell" class="icon-btn" title="Notificações">
                    <i class="fas fa-bell"></i>
                    <span id="notification-dot" class="notification-dot"></span>
                </button>
                <div id="notification-panel" class="notification-panel">
                    <div class="notification-panel-header">
                        <h4>Notificações</h4>
                        <button id="mark-all-read-btn" class="btn-link" style="font-size: 12px;">Marcar todas como lidas</button>
                    </div>
                    <div id="notification-list" class="notification-list">
                        <div class="empty-state">
                            <i class="fas fa-bell-slash"></i>
                            <p>Nenhuma notificação</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- User Profile -->
            <a href="perfil.html" class="nav-user-profile">
                <div class="nav-user-avatar">${getUserInitials()}</div>
                <div class="nav-user-info">
                    <span class="nav-user-name">${getUserName()}</span>
                    <span class="nav-user-role">${getUserRole()}</span>
                </div>
            </a>

            <!-- Logout Button -->
            <button class="nav-logout-btn" onclick="handleNavMenuLogout()">
                <i class="fas fa-sign-out-alt"></i>
                <span>Sair</span>
            </button>
        `;

        navMenu.appendChild(actionsDiv);

        // Inicializa notificações
        initNotifications();
    }

    // ==========================================
    // NOTIFICATIONS
    // ==========================================
    function initNotifications() {
        const bell = document.getElementById('notification-bell');
        const panel = document.getElementById('notification-panel');
        const dot = document.getElementById('notification-dot');
        const markAllBtn = document.getElementById('mark-all-read-btn');

        if (bell && panel) {
            bell.addEventListener('click', (e) => {
                e.stopPropagation();

                // Calcula a posição do botão do sino
                const bellRect = bell.getBoundingClientRect();

                // Posiciona o painel abaixo do sino, alinhado à direita
                panel.style.top = `${bellRect.bottom + 12}px`;
                panel.style.right = `${window.innerWidth - bellRect.right}px`;

                panel.classList.toggle('active');
                if (panel.classList.contains('active')) {
                    dot.style.display = 'none';
                }
            });

            document.addEventListener('click', (e) => {
                if (!panel.contains(e.target) && !bell.contains(e.target)) {
                    panel.classList.remove('active');
                }
            });

            // Reposiciona o painel ao redimensionar a janela
            window.addEventListener('resize', () => {
                if (panel.classList.contains('active')) {
                    const bellRect = bell.getBoundingClientRect();
                    panel.style.top = `${bellRect.bottom + 12}px`;
                    panel.style.right = `${window.innerWidth - bellRect.right}px`;
                }
            });
        }

        if (markAllBtn) {
            markAllBtn.addEventListener('click', async () => {
                try {
                    await window.api.marcarTodasComoLidas();
                    if (typeof showToast === 'function') {
                        showToast('Todas as notificações foram marcadas como lidas.');
                    }
                    loadNotifications();
                } catch (error) {
                    console.error('Error marking notifications:', error);
                }
            });
        }

        loadNotifications();
        setInterval(() => loadNotifications(), 30000); // Atualiza a cada 30 segundos
    }

    async function loadNotifications() {
        try {
            const response = await window.api.getNotificacoes();
            const notifications = response.notificacoes || [];
            const list = document.getElementById('notification-list');
            const dot = document.getElementById('notification-dot');

            if (!list) return;

            list.innerHTML = '';

            if (notifications.length > 0) {
                const hasUnread = notifications.some(n => !n.lida);
                if (dot) dot.style.display = hasUnread ? 'block' : 'none';

                notifications.forEach(n => {
                    const item = document.createElement('div');
                    item.className = `notification-item ${n.lida ? '' : 'unread'}`;
                    item.innerHTML = `
                        <div class="notification-icon ${n.type || 'info'}">
                            <i class="fas ${getNotificationIcon(n.type)}"></i>
                        </div>
                        <div class="notification-content">
                            <p>${n.mensagem}</p>
                            <small class="text-secondary">
                                ${new Date(n.createdAt).toLocaleDateString('pt-BR')} às
                                ${new Date(n.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </small>
                        </div>
                    `;
                    list.appendChild(item);
                });
            } else {
                if (dot) dot.style.display = 'none';
                list.innerHTML = '<div class="empty-state" style="padding: 20px;"><p>Nenhuma notificação nova.</p></div>';
            }
        } catch (error) {
            console.error('Error loading notifications:', error);
        }
    }

    function getNotificationIcon(type) {
        const icons = {
            ordemCriada: 'fa-plus-circle',
            ordemEditada: 'fa-pencil-alt',
            ordemDeletada: 'fa-trash-alt',
            finalizacaoAutomatica: 'fa-magic',
            info: 'fa-info-circle'
        };
        return icons[type] || 'fa-info-circle';
    }

    // Expõe funções globalmente
    window.handleNavMenuLogout = handleLogout;
    window.showSairModal = showSairModal;

    // Inicializa quando o DOM carregar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNavMenuActions);
    } else {
        initNavMenuActions();
    }
})();
