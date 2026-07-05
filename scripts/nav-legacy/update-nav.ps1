# Map of HTML files to their data-page values
$fileMapping = @{
    'acesso-negado.html' = 'acesso-negado'
    'addons.html' = 'addons'
    'assinatura.html' = 'assinatura'
    'clientes.html' = 'clientes'
    'comissoes.html' = 'comissoes'
    'configuracoes.html' = 'configuracoes'
    'fechamento-detalhes.html' = 'fechamento'
    'financeiro.html' = 'financeiro'
    'funcionarios.html' = 'funcionarios'
    'ganhos-calendario.html' = 'ganhos'
    'gerenciar-addons.html' = 'gerenciar-addons'
    'historico.html' = 'historico'
    'lavador-publico.html' = 'lavador'
    'login.html' = 'login'
    'minha-assinatura.html' = 'assinatura-minha'
    'nova-empresa.html' = 'nova-empresa'
    'novaordem.html' = 'novaordem'
    'ordens.html' = 'ordens'
    'pagamento-retorno.html' = 'pagamento'
    'perfil.html' = 'perfil'
    'planos.html' = 'planos'
    'selecionar-empresa.html' = 'empresa'
    'selecionar-subtipo-carro.html' = 'subtipo'
    'selecionar-tipo-veiculo.html' = 'veiculo'
    'signup.html' = 'signup'
}

$desktopDir = "C:\LinaX\DESKTOPV2"

foreach ($htmlFile in $fileMapping.GetEnumerator()) {
    $filePath = Join-Path $desktopDir $htmlFile.Name
    
    if (-not (Test-Path $filePath)) {
        Write-Host "File not found: $filePath"
        continue
    }
    
    Write-Host "Processing: $($htmlFile.Name)"
    
    # Read the file
    $content = Get-Content $filePath -Raw -Encoding UTF8
    
    # Check and add CSS files in head
    $cssAdded = $false
    if ($content -notmatch 'webapp-mobile\.css') {
        $content = $content -replace '</head>', '<link rel="stylesheet" href="webapp-mobile.css">`r`n</head>'
        $cssAdded = $true
    }
    
    if ($content -notmatch 'fix-responsive\.css') {
        $content = $content -replace '</head>', '<link rel="stylesheet" href="fix-responsive.css">`r`n</head>'
        $cssAdded = $true
    }
    
    # Check and add JS files before closing body
    $jsAdded = $false
    if ($content -notmatch 'mobile-nav\.js') {
        $content = $content -replace '</body>', '<script src="mobile-nav.js"></script>`r`n</body>'
        $jsAdded = $true
    }
    
    if ($content -notmatch 'webapp-bottom-nav\.js') {
        $content = $content -replace '</body>', '<script src="webapp-bottom-nav.js"></script>`r`n</body>'
        $jsAdded = $true
    }
    
    # Check and add bottom navigation
    $dataPage = $htmlFile.Value
    if ($content -notmatch 'class="bottom-navigation"') {
        $bottomNav = @"
<nav class="bottom-navigation">
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
</nav>
"@
        $replacement = $bottomNav + "`r`n</body>"
        $content = $content -replace '</body>', $replacement
    }
    
    # Write the modified content back
    Set-Content $filePath $content -Encoding UTF8 -NoNewline
    Write-Host "  - CSS files added: $cssAdded"
    Write-Host "  - JS files added: $jsAdded"
    Write-Host "  - Bottom navigation added/updated"
}

Write-Host "`nAll files processed!"
