/**
 * Web App Bottom Navigation Handler
 * Gerencia navegação inferior em mobile
 */

class WebAppBottomNav {
    constructor() {
        this.navItems = document.querySelectorAll('.bottom-nav-item');
        this.currentPage = this.detectCurrentPage();
        this.init();
    }

    init() {
        // Marcar item ativo com base na página atual
        this.setActiveItem();

        // Adicionar event listeners
        this.navItems.forEach(item => {
            item.addEventListener('click', (e) => this.handleNavClick(e));
        });

        // Atualizar ao mudar de página
        window.addEventListener('load', () => this.updateActiveItem());
    }

    detectCurrentPage() {
        const path = window.location.pathname.toLowerCase();

        if (path.includes('index.html') || path.endsWith('/')) return 'home';
        if (path.includes('ordens.html')) return 'ordens';
        if (path.includes('clientes.html')) return 'clientes';
        if (path.includes('financeiro.html')) return 'financeiro';
        if (path.includes('configuracoes.html')) return 'configuracoes';

        return 'home';
    }

    setActiveItem() {
        this.navItems.forEach(item => {
            item.classList.remove('active');
        });

        const activeItem = document.querySelector(`.bottom-nav-item[data-page="${this.currentPage}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
        }
    }

    handleNavClick(e) {
        e.preventDefault();
        const target = e.currentTarget;
        const href = target.getAttribute('href');
        const page = target.getAttribute('data-page');

        if (href) {
            window.location.href = href;
        }
    }

    updateActiveItem() {
        this.currentPage = this.detectCurrentPage();
        this.setActiveItem();
    }
}

// Inicializar quando DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new WebAppBottomNav();
    });
} else {
    new WebAppBottomNav();
}

/**
 * Helper para adicionar notificação badge
 */
function setNotificationBadge(count) {
    const badge = document.querySelector('.bottom-nav-item[data-page="notificacoes"] .badge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count > 9 ? '9+' : count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}
