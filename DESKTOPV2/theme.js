/**
 * Script para carregar e aplicar o tema da empresa dinamicamente.
 * Este script deve ser incluído em todas as páginas do sistema da empresa.
 */
(async function applyCompanyTheme() {
    // Não executa em páginas de login/cadastro ou no painel do owner
    const path = window.location.pathname;
    if (path.includes('login.html') || path.includes('signup.html') || path.includes('/admin/')) {
        return;
    }

    const empresaId = localStorage.getItem('empresaId');
    if (!empresaId) {
        return; // Se não houver empresa selecionada, usa o tema padrão.
    }

    try {
        // Busca a configuração do tema no backend
        const themeConfig = await window.api.call('GET', 'theme/config');

        // Gera o CSS customizado
        const customStyle = `
            :root {
                ${themeConfig.corPrimaria ? `--primary-color: ${themeConfig.corPrimaria};` : ''}
                ${themeConfig.corSecundaria ? `--secondary-color: ${themeConfig.corSecundaria};` : ''}
                ${themeConfig.fundoPainel ? `--background-color: ${themeConfig.fundoPainel};` : ''}
                ${themeConfig.corTextoPrincipal ? `--text-primary: ${themeConfig.corTextoPrincipal};` : ''}
                ${themeConfig.fonteFamilia ? `font-family: ${themeConfig.fonteFamilia};` : ''}
            }
            /* Aplica a fonte ao body para herança global */
            body {
                ${themeConfig.fonteFamilia ? `font-family: ${themeConfig.fonteFamilia};` : ''}
            }
        `;

        // Injeta o CSS no <head>
        const styleElement = document.createElement('style');
        styleElement.id = 'dynamic-theme-style';
        styleElement.innerHTML = customStyle;
        document.head.appendChild(styleElement);

        // Atualiza o logotipo se existir
        const logoElement = document.querySelector('.logo i');
        if (themeConfig.urlLogotipo && logoElement) {
            logoElement.outerHTML = `<img src="${themeConfig.urlLogotipo}" alt="Logo" style="height: 32px; width: auto;">`;
        }
    } catch (error) {
        console.error('Falha ao carregar o tema da empresa:', error);
    }
})();