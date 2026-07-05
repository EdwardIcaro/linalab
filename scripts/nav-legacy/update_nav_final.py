#!/usr/bin/env python3
import os
import re

file_mapping = {
    'acesso-negado.html': 'acesso-negado',
    'addons.html': 'addons',
    'assinatura.html': 'assinatura',
    'clientes.html': 'clientes',
    'comissoes.html': 'comissoes',
    'configuracoes.html': 'configuracoes',
    'fechamento-detalhes.html': 'fechamento',
    'financeiro.html': 'financeiro',
    'funcionarios.html': 'funcionarios',
    'ganhos-calendario.html': 'ganhos',
    'gerenciar-addons.html': 'gerenciar-addons',
    'historico.html': 'historico',
    'lavador-publico.html': 'lavador',
    'login.html': 'login',
    'minha-assinatura.html': 'assinatura-minha',
    'nova-empresa.html': 'nova-empresa',
    'novaordem.html': 'novaordem',
    'ordens.html': 'ordens',
    'pagamento-retorno.html': 'pagamento',
    'perfil.html': 'perfil',
    'planos.html': 'planos',
    'selecionar-empresa.html': 'empresa',
    'selecionar-subtipo-carro.html': 'subtipo',
    'selecionar-tipo-veiculo.html': 'veiculo',
    'signup.html': 'signup',
}

bottom_nav_html = '''<nav class="bottom-navigation">
    <a href="index.html" class="bottom-nav-item" data-page="home" title="Dashboard">
        <i class="fas fa-home"></i>
        <span>Início</span>
    </a>
    <a href="ordens.html" class="bottom-nav-item" data-page="ordens" title="Minhas Ordens">
        <i class="fas fa-list-check"></i>
        <span>Ordens</span>
    </a>
    <a href="novaordem.html" class="bottom-nav-item" data-page="novaordem" title="Nova Ordem">
        <i class="fas fa-plus-circle"></i>
        <span>Nova</span>
    </a>
    <a href="clientes.html" class="bottom-nav-item" data-page="clientes" title="Clientes">
        <i class="fas fa-users"></i>
        <span>Clientes</span>
    </a>
    <a href="#" class="bottom-nav-item" data-page="menu" onclick="toggleMobileMenu(event)" title="Menu">
        <i class="fas fa-bars"></i>
        <span>Menu</span>
    </a>
</nav>'''

desktop_dir = r"C:\LinaX\DESKTOPV2"

for filename, data_page in file_mapping.items():
    filepath = os.path.join(desktop_dir, filename)
    
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        continue
    
    print(f"Processing: {filename}")
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    css_added = 0
    js_added = 0
    nav_added = False
    
    # Add CSS files if missing
    if 'webapp-mobile.css' not in content and '</head>' in content:
        content = content.replace('</head>', '<link rel="stylesheet" href="webapp-mobile.css">\n</head>')
        css_added += 1
    
    if 'fix-responsive.css' not in content and '</head>' in content:
        content = content.replace('</head>', '<link rel="stylesheet" href="fix-responsive.css">\n</head>')
        css_added += 1
    
    # Add JS files if missing
    if 'mobile-nav.js' not in content and '</body>' in content:
        content = content.replace('</body>', '<script src="mobile-nav.js"></script>\n</body>')
        js_added += 1
    
    if 'webapp-bottom-nav.js' not in content and '</body>' in content:
        content = content.replace('</body>', '<script src="webapp-bottom-nav.js"></script>\n</body>')
        js_added += 1
    
    # Add bottom navigation if missing
    if 'class="bottom-navigation"' not in content and '</body>' in content:
        content = content.replace('</body>', bottom_nav_html + '\n</body>')
        nav_added = True
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"  - CSS files added: {css_added > 0}")
    print(f"  - JS files added: {js_added > 0}")
    print(f"  - Bottom navigation added: {nav_added}")

print("\nAll files processed!")
