/**
 * Script para carregar e aplicar o tema da empresa dinamicamente.
 * Este script deve ser incluído em todas as páginas do sistema da empresa.
 *
 * DISABLED BY DEFAULT: Only activates when user explicitly enables custom theme in configurações.html
 * FAIL-SAFE MODE: Errors loading theme will NOT cause page crashes or redirects.
 */
(async function applyCompanyTheme() {
    // ==========================================
    // CRITICAL: CHECK IF CUSTOM THEME IS ENABLED
    // ==========================================
    const themeEnabled = localStorage.getItem('customThemeEnabled');
    if (themeEnabled !== 'true') {
        console.log('[Theme] Custom theme disabled - using default theme');
        return; // Exit early - don't apply any custom theme
    }

    // Não executa em páginas de login/cadastro ou no painel do owner
    const path = window.location.pathname;
    if (path.includes('login.html') || path.includes('signup.html') || path.includes('/admin/')) {
        console.log('[Theme] Skipping theme on auth/admin pages');
        return;
    }

    const empresaId = localStorage.getItem('empresaId');
    if (!empresaId) {
        console.log('[Theme] No empresaId - using default theme');
        return; // Se não houver empresa selecionada, usa o tema padrão.
    }

    try {
        // FAIL-SAFE: Wait for api object to be available
        if (typeof window.api === 'undefined') {
            console.warn('[Theme] API not loaded yet, using default theme');
            return;
        }

        // Busca a configuração do tema no backend
        console.log('[Theme] Fetching custom theme config...');
        const themeConfig = await window.api.getThemeConfig();

        // Validate theme config response
        if (!themeConfig || typeof themeConfig !== 'object') {
            console.warn('[Theme] Invalid theme config received, using default');
            return;
        }

        // Only apply if colors are actually customized (not defaults)
        const hasCustomColors = themeConfig.corPrimaria && themeConfig.corPrimaria !== '#F59E0B';

        if (!hasCustomColors) {
            console.log('[Theme] No custom colors detected, using default theme');
            return;
        }

        // Gera o CSS customizado
        const customStyle = `
            :root {
                ${themeConfig.corPrimaria ? `--primary-color: ${themeConfig.corPrimaria} !important;` : ''}
                ${themeConfig.corPrimaria ? `--primary-purple: ${themeConfig.corPrimaria} !important;` : ''}
                ${themeConfig.corSecundaria ? `--text-primary: ${themeConfig.corSecundaria} !important;` : ''}
                ${themeConfig.corSecundaria ? `--text-secondary: ${themeConfig.corSecundaria} !important;` : ''}
            }
        `;

        // Injeta o CSS no <head>
        const styleElement = document.createElement('style');
        styleElement.id = 'dynamic-theme-style';
        styleElement.innerHTML = customStyle;
        document.head.appendChild(styleElement);

        // Atualiza o logotipo se existir
        if (themeConfig.logoUrl) {
            const logoElement = document.querySelector('.logo i');
            if (logoElement) {
                try {
                    logoElement.outerHTML = `<img src="${themeConfig.logoUrl}" alt="Logo" style="height: 32px; width: auto;">`;
                } catch (logoError) {
                    console.warn('[Theme] Failed to update logo:', logoError);
                }
            }
        }

        console.log('[Theme] ✅ Custom theme applied successfully');
    } catch (error) {
        // CRITICAL FIX: DO NOT redirect or throw on theme load failure
        // The page should continue to function with default theme
        console.warn('[Theme] ⚠️ Failed to load company theme, using default:', error.message || error);

        // Don't propagate the error - fail silently with default theme
    }
})();

// ==========================================
// GLOBAL FUNCTIONS FOR THEME CONTROL
// ==========================================

/**
 * Enable custom theme and reload page to apply
 */
window.enableCustomTheme = function() {
    localStorage.setItem('customThemeEnabled', 'true');
    console.log('[Theme] Custom theme enabled - reload page to apply');
};

/**
 * Disable custom theme and reload page to revert to default
 */
window.disableCustomTheme = function() {
    localStorage.removeItem('customThemeEnabled');
    console.log('[Theme] Custom theme disabled - reload page to apply default');

    // Remove existing custom theme styles
    const existingStyle = document.getElementById('dynamic-theme-style');
    if (existingStyle) {
        existingStyle.remove();
    }
};

/**
 * Check if custom theme is currently enabled
 */
window.isCustomThemeEnabled = function() {
    return localStorage.getItem('customThemeEnabled') === 'true';
};
