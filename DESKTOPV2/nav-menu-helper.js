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

    function handleLogout() {
        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm({
                title: 'Confirmar Saída',
                message: 'Tem certeza que deseja sair do sistema?',
                onConfirm: () => window.api.logout()
            });
        } else if (typeof logout === 'function') {
            logout();
        } else {
            if (confirm('Tem certeza que deseja sair do sistema?')) {
                window.api.logout();
            }
        }
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

    // Expõe a função de logout globalmente
    window.handleNavMenuLogout = handleLogout;

    // Inicializa quando o DOM carregar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNavMenuActions);
    } else {
        initNavMenuActions();
    }
})();
