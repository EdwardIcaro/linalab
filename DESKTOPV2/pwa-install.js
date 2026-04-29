// Registro do Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
}

// Modal de instalação PWA — aparece apenas no primeiro acesso após login
(function () {
    const CHAVE_VISTO = 'linax_pwa_prompt_visto';

    // Não mostra se já foi visto antes
    if (localStorage.getItem(CHAVE_VISTO)) return;

    // Não mostra se já está rodando como PWA instalado
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Aguarda o usuário estar logado
    if (!localStorage.getItem('token')) return;

    let deferredPrompt = null;
    let modalAberto = false;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const ehFuncionario = window.location.pathname.includes('index-funcionario');
    const corPrimaria = ehFuncionario ? '#0066cc' : '#00bcd4';

    if (isIOS) {
        // Safari (iOS) não dispara beforeinstallprompt — instrução manual
        setTimeout(() => abrirModal(false), 3000);
    } else {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            if (!modalAberto) {
                modalAberto = true;
                setTimeout(() => abrirModal(true), 3000);
            }
        });
    }

    function abrirModal(temPromptNativo) {
        if (window.matchMedia('(display-mode: standalone)').matches) return;
        if (localStorage.getItem(CHAVE_VISTO)) return;
        if (document.getElementById('pwa-install-overlay')) return;

        const conteudo = temPromptNativo
            ? `<p class="pwa-desc">Instale o app para acesso rápido direto da tela inicial.</p>
               <ul class="pwa-lista">
                 <li><i class="fas fa-bolt"></i> Abre sem precisar do navegador</li>
                 <li><i class="fas fa-mobile-alt"></i> Ícone na tela inicial do celular</li>
                 <li><i class="fas fa-wifi"></i> Carrega mais rápido com internet lenta</li>
               </ul>
               <button id="pwa-btn-instalar" class="pwa-btn-primario" style="background:${corPrimaria}">
                 <i class="fas fa-download"></i>&nbsp; Instalar agora
               </button>
               <button id="pwa-btn-dispensar" class="pwa-btn-link">Agora não</button>`
            : `<p class="pwa-desc">Para instalar no Safari, siga os passos:</p>
               <ol class="pwa-passos-ios">
                 <li>Toque no botão <strong>Compartilhar</strong> <span class="pwa-ios-icon">⬆</span> na barra do Safari</li>
                 <li>Role e toque em <strong>"Adicionar à Tela de Início"</strong></li>
                 <li>Toque em <strong>Adicionar</strong></li>
               </ol>
               <button id="pwa-btn-dispensar" class="pwa-btn-primario" style="background:${corPrimaria}">
                 Entendi
               </button>`;

        const overlay = document.createElement('div');
        overlay.id = 'pwa-install-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Instalar aplicativo');
        overlay.innerHTML = `
            <div id="pwa-modal-card" class="pwa-modal-card">
                <div class="pwa-alca">
                    <div class="pwa-alca-barra"></div>
                </div>
                <div class="pwa-logo-row">
                    <img src="/image/logo-simples.png" alt="Logo Lina X" class="pwa-logo"
                         onerror="this.style.display='none'">
                    <div>
                        <h2 class="pwa-titulo">Instale o Lina X</h2>
                        <p class="pwa-subtitulo">Gratuito • Rápido • Sempre à mão</p>
                    </div>
                </div>
                ${conteudo}
            </div>`;

        const estilo = document.createElement('style');
        estilo.id = 'pwa-install-style';
        estilo.textContent = `
            #pwa-install-overlay {
                position: fixed; inset: 0; z-index: 99999;
                background: rgba(0,0,0,0.55);
                display: flex; align-items: flex-end; justify-content: center;
                animation: pwaFadeIn .25s ease;
            }
            @keyframes pwaFadeIn  { from { opacity: 0 } to { opacity: 1 } }
            @keyframes pwaSlideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
            .pwa-modal-card {
                width: 100%; max-width: 480px;
                background: #fff;
                border-radius: 20px 20px 0 0;
                padding: 0 24px 40px;
                box-shadow: 0 -4px 32px rgba(0,0,0,0.18);
                animation: pwaSlideUp .3s cubic-bezier(.25,.8,.25,1);
            }
            .pwa-alca { display: flex; justify-content: center; padding: 12px 0 16px; }
            .pwa-alca-barra { width: 40px; height: 4px; background: #e0e0e0; border-radius: 2px; }
            .pwa-logo-row { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
            .pwa-logo {
                width: 54px; height: 54px; object-fit: contain;
                border-radius: 14px; border: 1px solid #f0f0f0;
            }
            .pwa-titulo  { font-size: 18px; font-weight: 700; color: #111; margin: 0 0 3px; font-family: 'Poppins', sans-serif; }
            .pwa-subtitulo { font-size: 12px; color: #999; margin: 0; font-family: 'Poppins', sans-serif; }
            .pwa-desc { font-size: 14px; color: #555; margin: 0 0 14px; font-family: 'Poppins', sans-serif; line-height: 1.55; }
            .pwa-lista { list-style: none; padding: 0; margin: 0 0 22px; display: flex; flex-direction: column; gap: 10px; }
            .pwa-lista li { display: flex; align-items: center; gap: 12px; font-size: 14px; color: #333; font-family: 'Poppins', sans-serif; }
            .pwa-lista li i { width: 18px; text-align: center; opacity: .75; }
            .pwa-passos-ios { padding: 0 0 0 20px; margin: 0 0 22px; display: flex; flex-direction: column; gap: 10px; }
            .pwa-passos-ios li { font-size: 14px; color: #333; font-family: 'Poppins', sans-serif; line-height: 1.55; }
            .pwa-ios-icon { display: inline-block; background: #007aff; color: #fff; padding: 0 5px 1px; border-radius: 5px; font-size: 11px; }
            .pwa-btn-primario {
                width: 100%; padding: 14px 0;
                border: none; border-radius: 12px;
                color: #fff; font-size: 15px; font-weight: 600;
                cursor: pointer; font-family: 'Poppins', sans-serif;
                display: flex; align-items: center; justify-content: center; gap: 6px;
                margin-bottom: 12px; transition: opacity .15s;
            }
            .pwa-btn-primario:hover { opacity: .88; }
            .pwa-btn-link {
                display: block; width: 100%; padding: 10px 0;
                border: none; background: none;
                color: #aaa; font-size: 13px; cursor: pointer;
                font-family: 'Poppins', sans-serif; text-align: center;
            }
        `;

        document.head.appendChild(estilo);
        document.body.appendChild(overlay);

        // Fecha ao clicar no fundo escuro
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) dispensar();
        });

        document.getElementById('pwa-btn-instalar')?.addEventListener('click', async () => {
            dispensar();
            if (deferredPrompt) {
                await deferredPrompt.prompt();
                deferredPrompt = null;
            }
        });

        document.getElementById('pwa-btn-dispensar')?.addEventListener('click', dispensar);
    }

    function dispensar() {
        localStorage.setItem(CHAVE_VISTO, '1');
        const overlay = document.getElementById('pwa-install-overlay');
        if (!overlay) return;
        overlay.style.transition = 'opacity .2s';
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.remove();
            document.getElementById('pwa-install-style')?.remove();
        }, 200);
    }
})();
