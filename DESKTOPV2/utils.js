/**
 * Verifica se o usuário logado possui uma permissão específica.
 * Concede acesso se a permissão estiver na lista ou se o usuário for o dono da empresa.
 * @param {string} requiredPermission O nome da permissão a ser verificada.
 * @returns {boolean} `true` se o usuário tiver a permissão, `false` caso contrário.
 */
function hasPermission(requiredPermission) {
    const permissions = JSON.parse(localStorage.getItem('permissoes') || '[]');
    if (!Array.isArray(permissions)) {
        return false;
    }

    // Lógica de herança: Se a permissão necessária for a principal de configurações
    // e o usuário tiver QUALQUER sub-permissão de configuração, conceda acesso.
    if (requiredPermission === 'gerenciar_configuracoes' && permissions.some(p => p.startsWith('config_'))) {
        return true;
    }

    return permissions.includes(requiredPermission);
}

/**
 * Exibe uma notificação toast na tela.
 * @param {string} message A mensagem a ser exibida.
 * @param {'success' | 'error'} type O tipo de notificação ('success' ou 'error').
 */
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconClass = type === 'success' ? 'fa-check-circle' : 'fa-times-circle';
    toast.innerHTML = `<i class="fas ${iconClass}"></i> ${message}`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 5000); // 5 segundos
}

/**
 * Exibe um modal de confirmação customizado.
 * @param {{title: string, message: string, onConfirm: () => void}} options
 */
function showCustomConfirm({ title, message, onConfirm, onCancel }) {
    const modal = document.getElementById('customConfirmModal');
    if (!modal) return;

    document.getElementById('customConfirmTitle').textContent = title;
    document.getElementById('customConfirmMessage').textContent = message;

    const confirmBtn = document.getElementById('customConfirmBtn');
    const cancelBtn = document.getElementById('customCancelBtn');

    confirmBtn.onclick = () => {
        modal.classList.remove('active');
        onConfirm();
    };
    cancelBtn.onclick = () => {
        modal.classList.remove('active');
        if (onCancel) onCancel();
    };

    modal.classList.add('active');
}

/**
 * Exibe um modal de confirmação customizado.
 * @param {{title: string, message: string, onConfirm: () => void, onCancel?: () => void, isHtml?: boolean}} options
 */
function showCustomConfirm({ title, message, onConfirm, onCancel, isHtml = false }) {
    const modal = document.getElementById('customConfirmModal');
    if (!modal) {
        console.error('Modal de confirmação não encontrado no DOM. Usando fallback.');
        // Fallback para o confirm nativo se o modal não existir
        if (confirm(`${title}\n${message}`)) {
            onConfirm();
        } else if (onCancel) {
            onCancel();
        }
        return;
    }

    document.getElementById('customConfirmTitle').textContent = title;
    const messageElement = document.getElementById('customConfirmMessage');
    if (isHtml) {
        messageElement.innerHTML = message;
    } else {
        messageElement.textContent = message;
    }

    const confirmBtn = document.getElementById('customConfirmBtn');
    const cancelBtn = document.getElementById('customCancelBtn');

    confirmBtn.onclick = () => { closeModal('customConfirmModal'); onConfirm(); };
    cancelBtn.onclick = () => { closeModal('customConfirmModal'); if (onCancel) onCancel(); };

    modal.classList.add('active');
}

/**
 * Exibe um modal de alerta customizado com um único botão "OK".
 * @param {{title: string, message: string}} options
 */
function showCustomAlert({ title, message }) {
    const modal = document.getElementById('customAlertModal');
    if (!modal) return;

    document.getElementById('customAlertTitle').textContent = title;
    document.getElementById('customAlertMessage').textContent = message;

    const closeBtn = document.getElementById('customAlertCloseBtn');
    closeBtn.onclick = () => modal.classList.remove('active');

    modal.classList.add('active');
}

/**
 * Abre um modal.
 * @param {string} modalId O ID do modal a ser aberto.
 */
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}
/**
 * Fecha qualquer modal ativo que tenha o ID fornecido.
 * @param {string} modalId O ID do modal a ser fechado.
 */
function closeModal(modalId) {
    document.getElementById(modalId)?.classList.remove('active');
}

/**
 * Verifica se o usuário tem a permissão necessária para ver a página.
 * Se não tiver, exibe um modal de acesso negado e redireciona para o index.
 * @param {string} requiredPermission A permissão necessária para a página.
 */
function enforcePermission(requiredPermission) {
    if (!hasPermission(requiredPermission)) {        
        // Mostra a tela de bloqueio imediatamente
        const modal = document.getElementById('screenLockModal');
        if (modal) {
            modal.classList.add('active');
        }

        // Adiciona um pequeno delay para o usuário ler a mensagem antes de redirecionar.
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 2500);
    }
}

/**
 * Initializes the user dropdown menu in the sidebar.
 */
function initializeUserMenu() {
    const trigger = document.getElementById('user-menu-trigger');
    const dropdown = document.getElementById('user-menu-dropdown');

    if (!trigger || !dropdown) {
        return;
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('active');
        trigger.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
            dropdown.classList.remove('active');
            trigger.classList.remove('active');
        }
    });
}

/**
 * Esconde os itens do menu de navegação principal com base nas permissões do usuário.
 * Procura por itens de lista com o atributo `data-permission`.
 */
function updateMenuVisibility() {
    const menuItems = document.querySelectorAll('.top-nav-links li[data-permission]');
    menuItems.forEach(item => {
        const requiredPermission = item.dataset.permission;
        if (!hasPermission(requiredPermission)) {
            item.style.display = 'none';
        }
    });
}

/**
 * Alterna o estado de um botão para "carregando".
 * Adiciona um spinner e desabilita o botão.
 * @param {HTMLButtonElement} button O botão a ser modificado.
 * @param {boolean} loading Se o estado é "carregando" ou não.
 */
function setButtonLoadingState(button, loading) {
    if (!button) return;
    const icon = button.querySelector('i');
    if (!icon) return;

    if (loading) {
        button.disabled = true;
        button.dataset.originalIcon = icon.className; // Salva o ícone original
        icon.className = 'fas fa-spinner fa-spin';
    } else {
        button.disabled = false;
        if (button.dataset.originalIcon) {
            icon.className = button.dataset.originalIcon; // Restaura o ícone original
            delete button.dataset.originalIcon;
        }
    }
}

/**
 * Verifica se há uma sessão de impersonação ativa e, se houver,
 * exibe um banner no topo da página com a opção de retornar ao admin.
 */
function handleImpersonationBanner() {
    const adminSessionJSON = localStorage.getItem('original_admin_session');
    if (!adminSessionJSON) {
        return; // Não está em modo de impersonação
    }

    const banner = document.createElement('div');
    banner.style.cssText = `
        background-color: #F59E0B; /* Amarelo/Laranja */
        color: #78350F;
        padding: 12px;
        text-align: center;
        font-weight: 600;
        font-size: 14px;
        position: fixed;
        top: var(--top-bar-height, 64px);
        left: 0;
        right: 0;
        z-index: 1500;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 16px;
    `;
    banner.innerHTML = `
        <i class="fas fa-user-secret"></i>
        <span>Você está visualizando como <strong>${localStorage.getItem('usuarioNome')}</strong>.</span>
        <button onclick="exitImpersonation()" style="background: #fff; color: #78350F; border: 1px solid #78350F; padding: 4px 12px; border-radius: 6px; cursor: pointer; font-weight: 600;">Voltar ao Admin</button>
    `;
    document.body.prepend(banner);
    document.querySelector('.main-content').style.paddingTop = 'calc(var(--top-bar-height) + 32px + 50px)';
}

function exitImpersonation() {
    const adminSessionJSON = localStorage.getItem('original_admin_session');
    if (!adminSessionJSON) return;

    const adminSession = JSON.parse(adminSessionJSON);

    // Limpeza seletiva em vez de localStorage.clear()
    localStorage.removeItem('token');
    localStorage.removeItem('usuarioNome');
    localStorage.removeItem('permissoes');
    localStorage.removeItem('original_admin_session');

    // Restaura a sessão completa do admin
    localStorage.setItem('token', adminSession.token);
    localStorage.setItem('usuarioNome', adminSession.usuarioNome);
    localStorage.setItem('userRole', adminSession.userRole);

    window.location.href = 'admin/dashboard.html'; // Volta para o painel do admin
}

/**
 * Busca e exibe notificações globais para o usuário.
 */
async function checkForGlobalNotifications() {
    try {
        const notificacoes = await window.api.call('GET', 'notificacoes-globais/active');
        if (!notificacoes || notificacoes.length === 0) return;

        notificacoes.forEach(n => {
            switch (n.tipoExibicao) {
                case 'MODAL':
                    renderUrgentModal(n);
                    break;
                case 'TOPO_ALERTA':
                    renderTopBanner(n);
                    break;
                case 'SINO':
                    // A lógica do sino já é complexa. Por enquanto, vamos logar.
                    // Idealmente, isso seria integrado ao sistema de notificações existente.
                    console.log('Notificação para o sino:', n.titulo);
                    break;
            }
        });
    } catch (error) {
        console.error("Erro ao buscar notificações globais:", error);
    }
}

function renderUrgentModal(notification) {
    // Cria um modal dinamicamente para não poluir o HTML de todas as páginas
    const modalId = `global-modal-${notification.id}`;
    if (document.getElementById(modalId)) return; // Já existe

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
                <h2 class="modal-title">${notification.titulo}</h2>
            </div>
            <div class="py-4">${notification.conteudo}</div>
            <div class="modal-actions">
                <button class="btn btn-primary">Entendi</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('button').addEventListener('click', async () => {
        await window.api.call('POST', `notificacoes-globais/${notification.id}/read`);
        modal.remove();
    });
}

function renderTopBanner(notification) {
    const bannerId = `global-banner-${notification.id}`;
    if (document.getElementById(bannerId)) return;

    const banner = document.createElement('div');
    banner.id = bannerId;
    banner.style.cssText = `
        background-color: var(--primary-color); color: white; padding: 12px; text-align: center;
        position: fixed; top: var(--top-bar-height, 64px); left: 0; right: 0; z-index: 1500;
        display: flex; justify-content: center; align-items: center; gap: 20px;
    `;
    banner.innerHTML = `
        <div>${notification.conteudo}</div>
        <button style="background:none; border:none; color:white; font-size: 18px; cursor:pointer;">&times;</button>
    `;
    document.body.prepend(banner);
    document.querySelector('.main-content').style.paddingTop = 'calc(var(--top-bar-height) + 32px + 50px)';

    banner.querySelector('button').addEventListener('click', async () => {
        await window.api.call('POST', `notificacoes-globais/${notification.id}/read`);
        banner.remove();
        document.querySelector('.main-content').style.paddingTop = 'calc(var(--top-bar-height) + 32px)';
    });
}