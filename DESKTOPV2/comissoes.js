document.addEventListener('DOMContentLoaded', () => {
    checkAuthentication();
    initializePage();
    loadHistoricoComissoes();
});

function checkAuthentication() {
    if (!window.api.isAuthenticated()) {
        window.location.href = 'login.html';
    }
}

const formatCurrency = (value) => {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(num)) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
};

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) {
        const tempContainer = document.createElement('div');
        tempContainer.id = 'toast-container';
        document.body.appendChild(tempContainer);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconClass = type === 'success' ? 'fa-check-circle' : 'fa-times-circle';
    toast.innerHTML = `<i class="fas ${iconClass}"></i> ${message}`;

    document.getElementById('toast-container').appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 5000);
}

let selectedLavadorId = null;
let cachedTotalCreditos = 0;  // ✅ Armazenar valor real calculado
let cachedTotalDebitos = 0;   // ✅ Armazenar valor real calculado
let autoRefreshInterval = null;  // ✅ Armazenar intervalo de refresh automático
let activeFilter = '7';  // ✅ NOVO: Rastrear filtro ativo (7, 15, 30 ou 'open')
let autoRefreshPausedUntil = 0;  // ✅ NOVO: Pausar refresh até este timestamp

async function initializePage() {
    // Carregar funcionários no seletor de avatar
    try {
        const { lavadores } = await window.api.getLavadoresSimple();
        renderEmployeeAvatars(lavadores);
    } catch (error) {
        console.error('Erro ao carregar funcionários', error);
        document.getElementById('employeesScroll').innerHTML = '<p class="text-secondary">Erro ao carregar funcionários.</p>';
    }

    // ✅ NOVO: Definir filtro padrão (últimos 30 dias - mesmo que lavador-publico)
    setQuickFilter(30);

    // Adicionar event listeners para carregar os dados quando alterar inputs de data manualmente
    document.getElementById('dataInicio').addEventListener('change', () => {
        pauseAutoRefresh(30);  // ✅ NOVO: Pausar quando muda data
        loadCommissionData();
    });
    document.getElementById('dataFim').addEventListener('change', () => {
        pauseAutoRefresh(30);  // ✅ NOVO: Pausar quando muda data
        loadCommissionData();
    });
    document.getElementById('fecharComissaoBtn').addEventListener('click', openFechamentoComissaoModal);
}

function renderEmployeeAvatars(lavadores) {
    const container = document.getElementById('employeesScroll');
    container.innerHTML = '';
    if (!lavadores || lavadores.length === 0) {
        container.innerHTML = '<p class="text-secondary">Nenhum funcionário cadastrado.</p>';
        return;
    }

    lavadores.forEach(l => {
        const avatarEl = document.createElement('div');
        avatarEl.className = 'employee-avatar';
        avatarEl.dataset.id = l.id;
        avatarEl.onclick = () => selectEmployee(l.id);
        avatarEl.innerHTML = `
            <div class="avatar-circle">
                <div class="avatar-inner">${l.nome.charAt(0).toUpperCase()}</div>
            </div>
            <div class="employee-name">${l.nome}</div>
        `;
        container.appendChild(avatarEl);
    });

    if (!selectedLavadorId && lavadores.length > 0) {
        selectEmployee(lavadores[0].id);
    }
}

function selectEmployee(lavadorId) {
    selectedLavadorId = lavadorId;
    document.querySelectorAll('.employee-avatar').forEach(el => {
        el.classList.toggle('active', el.dataset.id === lavadorId);
    });
    loadCommissionData();
    startAutoRefresh();  // ✅ NOVO: Iniciar auto-refresh quando seleciona um lavador
}

async function loadCommissionData() {
    // ✅ NOVO: "Em aberto" não passa datas (backend usa últimos 30 dias por padrão)
    const dataInicio = activeFilter === 'open' ? undefined : document.getElementById('dataInicio').value;
    const dataFim = activeFilter === 'open' ? undefined : document.getElementById('dataFim').value;

    const contentDiv = document.getElementById('commission-content');
    const placeholderDiv = document.getElementById('commission-placeholder');
    const creditosList = document.getElementById('creditos-list');
    const debitosList = document.getElementById('debitos-list');

    // ✅ NOVO: Apenas precisa de lavador selecionado
    if (!selectedLavadorId) {
        contentDiv.style.display = 'none';
        placeholderDiv.style.display = 'block';
        return;
    }

    contentDiv.style.display = 'block';
    placeholderDiv.style.display = 'none';
    creditosList.innerHTML = '<p class="text-center p-4">Carregando comissões...</p>';
    debitosList.innerHTML = '<p class="text-center p-4">Carregando adiantamentos...</p>';

    try {
        // ✅ NOVO: Passar datas opcionais (undefined para "Em aberto")
        const apiParams = {
            lavadorId: selectedLavadorId,
        };
        if (dataInicio) apiParams.dataInicio = dataInicio;
        if (dataFim) apiParams.dataFim = dataFim;

        const [{ comissoes, adiantamentos, debitosOS }, gorjetasRes] = await Promise.all([
            window.api.getDadosComissao(apiParams),
            window.api.listGorjetas({ lavadorId: selectedLavadorId, ...(dataInicio && { inicio: dataInicio }), ...(dataFim && { fim: dataFim }) }),
        ]);

        renderComissoes(comissoes, gorjetasRes?.gorjetas || []);
        renderAdiantamentos(adiantamentos, debitosOS);

        calculateSummary();

    } catch (error) {
        console.error('Erro ao buscar dados de comissão:', error);
        creditosList.innerHTML = '<p class="text-center p-4 text-red-500">Erro ao carregar comissões.</p>';
        debitosList.innerHTML = '<p class="text-center p-4 text-red-500">Erro ao carregar adiantamentos.</p>';
    }
}

function normalizeOrderWashers(order) {
    if (!order) return [];
    if (Array.isArray(order.lavadores) && order.lavadores.length > 0) {
        return order.lavadores.map(lav => {
            if (lav && typeof lav === 'object') {
                return { id: lav.id || lav.value || lav, nome: lav.nome || lav.name, ganho: typeof lav.ganho === 'number' ? lav.ganho : undefined };
            }
            return { id: lav, nome: null };
        }).filter(w => w.id);
    }
    if (order.lavadorId) {
        return [{
            id: order.lavadorId,
            nome: order.lavador?.nome,
            ganho: typeof order.comissao === 'number' ? order.comissao : undefined
        }];
    }
    return [];
}

function getWasherShare(order, washerId) {
    const washers = normalizeOrderWashers(order);
    if (!washers.length || !washerId) return 0;

    // Ganho pré-calculado do ordemLavadores (considera override do serviço)
    const existing = washers.find(w => w.id === washerId && typeof w.ganho === 'number');
    if (existing) return existing.ganho;

    // order.comissao do getDadosComissao já é o ganho correto para este lavador
    if (typeof order.comissao === 'number' && order.comissao > 0) return order.comissao;

    // Fallback: calcular pela porcentagem (sem override de serviço)
    const percent = order?.lavador?.comissao || 0;
    const totalCents = Math.round((order?.valorTotal || 0) * (percent / 100) * 100);
    if (totalCents <= 0) return 0;

    const base = Math.floor(totalCents / washers.length);
    let remainder = totalCents % washers.length;

    const shareMap = {};
    washers.forEach(washer => {
        let cents = base;
        if (remainder > 0) {
            cents += 1;
            remainder -= 1;
        }
        shareMap[washer.id] = cents / 100;
    });

    return shareMap[washerId] || 0;
}

function renderComissoes(comissoes, gorjetas = []) {
    const creditosList = document.getElementById('creditos-list');

    const comissoesOrdenadas = [...(comissoes || [])].sort((a, b) => a.numeroOrdem - b.numeroOrdem);

    const creditItems = comissoesOrdenadas.map(c => {
        const share = getWasherShare(c, selectedLavadorId);
        if (!share) return null;
        return `
            <div class="commission-item" data-id="${c.id}" data-valor="${share}" data-type="credit" onclick="toggleItemSelection(this)">
                <div class="item-checkbox"><i class="fas fa-check"></i></div>
                <div class="item-details">
                    <div class="item-title">OS #${c.numeroOrdem} - ${c.veiculo?.modelo || 'S/ Modelo'}</div>
                    <div class="item-subtitle">Finalizada em: ${new Date(c.dataFim).toLocaleDateString('pt-BR')}</div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <span class="item-value credit">${formatCurrency(share)}</span>
                    <button class="btn-delete-item" title="Excluir OS" onclick="confirmarDeleteOS(event,'${c.id}','#${c.numeroOrdem}')"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
        `;
    }).filter(Boolean);

    const gorjetaItems = [...(gorjetas || [])].map(g => `
        <div class="commission-item" data-id="${g.id}" data-valor="${g.valor}" data-type="credit" data-gorjeta="true" onclick="toggleItemSelection(this)">
            <div class="item-checkbox"><i class="fas fa-check"></i></div>
            <div class="item-details">
                <div class="item-title"><span class="badge-gorjeta">🎁 Gorjeta</span>${g.observacao ? ' — ' + g.observacao : ''}</div>
                <div class="item-subtitle">Data: ${new Date(g.criadoEm).toLocaleDateString('pt-BR')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <span class="item-value credit">${formatCurrency(g.valor)}</span>
                <button class="btn-delete-item" title="Excluir gorjeta" onclick="confirmarDeleteGorjeta(event,'${g.id}')"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
    `);

    const allCreditItems = [...creditItems, ...gorjetaItems];

    document.getElementById('creditsBadge').textContent = allCreditItems.length;
    const btn = document.getElementById('selectAllCreditsBtn');
    if (btn) btn.innerHTML = '<i class="fas fa-check-double"></i> Todas';

    if (!allCreditItems.length) {
        creditosList.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>Nenhuma comissão pendente no período.</p></div>';
        return;
    }
    creditosList.innerHTML = allCreditItems.join('');
}

function renderAdiantamentos(adiantamentos, debitosOS = []) {
    const debitosList = document.getElementById('debitos-list');

    const adiantamentoItems = (adiantamentos || []).map(a => `
        <div class="commission-item" data-id="${a.id}" data-valor="${a.valor}" data-type="debit" data-adiantamento-id="${a.id}" onclick="toggleItemSelection(this)">
            <div class="item-checkbox"><i class="fas fa-check"></i></div>
            <div class="item-details">
                <div class="item-title">${a.descricao || 'Adiantamento (Vale)'}</div>
                <div class="item-subtitle">Data: ${a.data ? new Date(a.data).toLocaleDateString('pt-BR') : 'Sem data'}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <span class="item-value debit">${formatCurrency(a.valor)}</span>
                <button class="btn-delete-item" title="Excluir dívida" onclick="confirmarDeleteAdiantamento(event,'${a.id}')"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
    `).filter(Boolean);

    // ✅ NOVO: Ordenar débitos de OS por número de OS
    const debitosOSOrdenados = [...(debitosOS || [])].sort((a, b) => a.numeroOrdem - b.numeroOrdem);

    const debitoOsItems = debitosOSOrdenados.map(d => {
        const share = getWasherShare(d, selectedLavadorId);
        if (!share) return null;
        const placa = d.veiculo?.placa || 'S/ Placa';
        const descricao = `Débito OS #${d.numeroOrdem} (${placa})`;
        const dataFinalizacao = d.dataFim ? new Date(d.dataFim).toLocaleDateString('pt-BR') : 'Sem data';
        return `
            <div class="commission-item" data-order-id="${d.id}" data-valor="${share}" data-type="debit" onclick="toggleItemSelection(this)">
                <div class="item-checkbox"><i class="fas fa-check"></i></div>
                <div class="item-details">
                    <div class="item-title">${descricao}</div>
                    <div class="item-subtitle">Finalizada em: ${dataFinalizacao}</div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <span class="item-value debit">${formatCurrency(share)}</span>
                    <button class="btn-delete-item" title="Excluir OS" onclick="confirmarDeleteOS(event,'${d.id}','#${d.numeroOrdem}')"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
        `;
    }).filter(Boolean);

    const allItems = [...adiantamentoItems, ...debitoOsItems];

    document.getElementById('debitsBadge').textContent = allItems.length;
    if (allItems.length === 0) {
        debitosList.innerHTML = '<div class="empty-state"><i class="fas fa-thumbs-up"></i><p>Nenhum adiantamento pendente.</p></div>';
        return;
    }

    debitosList.innerHTML = allItems.join('');
}

function toggleItemSelection(element) {
    element.classList.toggle('selected');
    calculateSummary();
}

// ✅ NOVO: Selecionar/deselecionar todos os créditos
function toggleSelectAllCredits() {
    const items = Array.from(document.querySelectorAll('#creditos-list .commission-item'));
    if (items.length === 0) return;

    const allSelected = items.every(el => el.classList.contains('selected'));
    const btn = document.getElementById('selectAllCreditsBtn');

    items.forEach(el => {
        if (allSelected) {
            el.classList.remove('selected');
        } else {
            el.classList.add('selected');
        }
    });

    // Atualizar texto do botão
    btn.innerHTML = allSelected
        ? '<i class="fas fa-check-double"></i> Todas'
        : '<i class="fas fa-times"></i> Desmarcar';

    calculateSummary();
}

function calculateSummary() {
    const creditosSelecionados = Array.from(document.querySelectorAll('.commission-item.selected[data-type="credit"]'));
    const debitosSelecionados = Array.from(document.querySelectorAll('.commission-item.selected[data-type="debit"]'));

    const totalCreditos = creditosSelecionados.reduce((sum, el) => {
        const valor = parseFloat(el.dataset.valor);
        return isNaN(valor) ? sum : sum + valor;
    }, 0);
    const totalDebitos = debitosSelecionados.reduce((sum, el) => {
        const valor = parseFloat(el.dataset.valor);
        return isNaN(valor) ? sum : sum + valor;
    }, 0);

    const saldoFinal = totalCreditos - totalDebitos;

    // ✅ Armazenar valores reais em variáveis globais (não no DOM)
    cachedTotalCreditos = totalCreditos;
    cachedTotalDebitos = totalDebitos;

    document.getElementById('summary-creditos').textContent = formatCurrency(totalCreditos);
    document.getElementById('summary-debitos').textContent = `- ${formatCurrency(totalDebitos)}`;
    document.getElementById('summary-total').textContent = formatCurrency(saldoFinal);

    const fecharBtn = document.getElementById('fecharComissaoBtn');
    const hasItemsToProcess = creditosSelecionados.length > 0 || debitosSelecionados.length > 0;
    fecharBtn.disabled = !hasItemsToProcess;
}

function openFechamentoComissaoModal() {
    // ✅ Usar valores cached ao invés de parsear do DOM (mais confiável)
    const totalCreditos = cachedTotalCreditos;
    const totalDebitos = cachedTotalDebitos;
    const saldoFinal = totalCreditos - totalDebitos;

    // Validar que valores são válidos
    if (!isFinite(totalCreditos) || !isFinite(totalDebitos)) {
        showToast('Erro ao carregar valores. Tente novamente.', 'error');
        return;
    }

    let content = `
        <p class="mb-4">Você está prestes a fechar a comissão com os seguintes valores:</p>
        <div class="summary-card mb-4" style="background-color: var(--white);">
            <div class="summary-row"><span>Comissões a pagar:</span> <span class="valor-entrada">${formatCurrency(totalCreditos)}</span></div>
            <div class="summary-row"><span>Adiantamentos a descontar:</span> <span class="valor-saida">- ${formatCurrency(totalDebitos)}</span></div>
            <div class="summary-row summary-total"><span>VALOR FINAL:</span> <span>${formatCurrency(saldoFinal)}</span></div>
        </div>
    `;

    if (saldoFinal > 0) {
        content += `
            <div class="form-group">
                <label for="formaPagamentoComissao" class="form-label">Como este valor será pago?</label>
                <select id="formaPagamentoComissao" class="form-select">
                    <option value="DINHEIRO">Dinheiro</option>
                    <option value="PIX">PIX</option>
                    <option value="CARTAO">Cartão</option>
                    <option value="NFE">NFe</option>
                </select>
            </div>
        `;
    }
    
    content += `
        <div class="form-group mt-4">
            <label for="observacaoFechamento" class="form-label">Observação (Opcional)</label>
            <textarea id="observacaoFechamento" class="form-input" placeholder="Ex: Pagamento parcial, acordo, etc." style="min-height: 80px;"></textarea>
        </div>
    `;

    showCustomConfirm({
        title: 'Confirmar Fechamento',
        message: content,
        isHtml: true,
        onConfirm: handleConfirmarFechamento
    });
}

async function handleConfirmarFechamento() {
    const creditosSelecionados = Array.from(document.querySelectorAll('.commission-item.selected[data-type="credit"]'));
    const debitosSelecionados = Array.from(document.querySelectorAll('.commission-item.selected[data-type="debit"]'));

    // ✅ Validar se há itens selecionados
    if (creditosSelecionados.length === 0 && debitosSelecionados.length === 0) {
        showToast('Selecione pelo menos um item para fechar.', 'error');
        return;
    }

    const comissaoIds = creditosSelecionados.map(el => el.dataset.id);
    const adiantamentoIds = debitosSelecionados
        .filter(el => el.dataset.adiantamentoId)
        .map(el => el.dataset.adiantamentoId);

    // ✅ Validar valores com NaN checks
    const totalCreditos = creditosSelecionados.reduce((sum, el) => {
        const valor = parseFloat(el.dataset.valor);
        return isNaN(valor) ? sum : sum + valor;
    }, 0);
    const totalDebitos = debitosSelecionados.reduce((sum, el) => {
        const valor = parseFloat(el.dataset.valor);
        return isNaN(valor) ? sum : sum + valor;
    }, 0);
    const valorPago = totalCreditos - totalDebitos;

    // ✅ Validar que valorPago é válido
    if (!isFinite(valorPago)) {
        showToast('Erro ao calcular valor. Tente novamente.', 'error');
        return;
    }

    // ✅ Validar forma de pagamento se há valor a pagar
    let formaPagamento = 'NA';
    if (valorPago > 0) {
        const formaPagamentoSelect = document.getElementById('formaPagamentoComissao');
        if (!formaPagamentoSelect) {
            showToast('Erro: Campo de forma de pagamento não encontrado.', 'error');
            return;
        }
        formaPagamento = formaPagamentoSelect.value;
        if (!formaPagamento) {
            showToast('Selecione uma forma de pagamento.', 'error');
            return;
        }
    }
    const observacao = document.getElementById('observacaoFechamento')?.value || '';

    const payload = {
        lavadorId: selectedLavadorId,
        comissaoIds,
        adiantamentoIds,
        valorPago: parseFloat(valorPago.toFixed(2)),
        formaPagamento,
        observacao, // Envia a observação para o backend
    };

    const btn = document.getElementById('fecharComissaoBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Processando...';

    try {
        await window.api.fecharComissao(payload);
        showToast('Fechamento de comissão realizado com sucesso!');
        loadCommissionData();
        loadHistoricoComissoes();
    } catch (error) {
        console.error('Erro ao fechar comissão:', error);
        showToast(`Erro ao processar pagamento: ${error.message || 'Tente novamente.'}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check-circle"></i> Fechar e Pagar Comissão';
    }
}

async function loadHistoricoComissoes() {
    const container = document.getElementById('historicoComissoesContainer');
    container.innerHTML = '<p class="text-center p-4">Carregando histórico...</p>';

    try {
        const historico = await window.api.getHistoricoComissoes();
        if (historico.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding: 20px;"><i class="fas fa-receipt"></i><p>Nenhum pagamento de comissão registrado.</p></div>';
            return;
        }

        container.innerHTML = historico.map(item => `
            <div class="history-item">
                <div class="item-details">
                    <div class="item-title">Pagamento para <strong>${item.lavador?.nome || 'N/A'}</strong></div>
                    <div class="item-subtitle">Realizado em: ${new Date(item.data).toLocaleDateString('pt-BR')}</div>
                </div>
                <div class="history-item-right">
                    <span class="item-value credit">${formatCurrency(item.valorPago)}</span>
                    <button class="btn-sm btn-info" onclick="showFechamentoDetails('${item.id}')" title="Ver Detalhes"><i class="fas fa-eye"></i></button>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Erro ao carregar histórico de comissões:', error);
        container.innerHTML = '<p class="text-center p-4 text-red-500">Erro ao carregar histórico.</p>';
    }
}

// ✅ NOVO: Auto-refresh de comissões a cada 10 segundos
function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }

    // Fazer refresh a cada 10 segundos (aumentado de 5 para dar mais tempo de seleção)
    autoRefreshInterval = setInterval(() => {
        // ✅ NOVO: Não fazer refresh se estiver pausado
        if (Date.now() < autoRefreshPausedUntil) {
            console.log('[Auto-refresh] Pausado até:', new Date(autoRefreshPausedUntil).toLocaleTimeString('pt-BR'));
            return;
        }

        // ✅ NOVO: Não fazer refresh se há itens selecionados (usuário está selecionando)
        const selectedItems = document.querySelectorAll('.commission-item.selected');
        if (selectedItems.length > 0) {
            console.log('[Auto-refresh] Pausado - há itens selecionados:', selectedItems.length);
            return;
        }

        if (selectedLavadorId && document.getElementById('dataInicio').value && document.getElementById('dataFim').value) {
            console.log('[Auto-refresh] Atualizando comissões do lavador:', selectedLavadorId);
            loadCommissionData();
        }
    }, 10000); // ✅ 10 segundos (aumentado de 5)

    // Parar o refresh quando a página perde o foco
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            console.log('[Auto-refresh] Página ocultada, pausando refresh');
            stopAutoRefresh();
        } else {
            console.log('[Auto-refresh] Página visível novamente, retomando refresh');
            startAutoRefresh();
        }
    });
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

// ✅ NOVO: Pausar auto-refresh por N segundos (para dar tempo de selecionar)
function pauseAutoRefresh(segundos = 30) {
    autoRefreshPausedUntil = Date.now() + (segundos * 1000);
    console.log(`[Auto-refresh] Pausado por ${segundos} segundos`);
}

// ✅ NOVO: Filtros rápidos de período
function setQuickFilter(days) {
    activeFilter = String(days);
    document.getElementById('dateInputsContainer').style.display = 'grid';

    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - (days - 1));

    document.getElementById('dataInicio').valueAsDate = start;
    document.getElementById('dataFim').valueAsDate = today;

    updateFilterButtons();
    pauseAutoRefresh(30);  // ✅ NOVO: Pausar refresh por 30 segundos
    loadCommissionData();
}

function setOpenFilter() {
    activeFilter = 'open';
    // Esconder inputs de data quando "Em aberto"
    document.getElementById('dateInputsContainer').style.display = 'none';

    updateFilterButtons();
    pauseAutoRefresh(30);  // ✅ NOVO: Pausar refresh por 30 segundos
    loadCommissionData();
}

function updateFilterButtons() {
    ['7', '15', '30', 'open'].forEach(id => {
        const btn = document.getElementById(`filter-${id}`);
        if (btn) {
            btn.classList.toggle('active', activeFilter === id);
        }
    });
}

async function showFechamentoDetails(fechamentoId) {
    try {
        const fechamento = await window.api.getFechamentoComissaoById(fechamentoId);
        if (!fechamento) {
            showToast('Detalhes do fechamento não encontrados.', 'error');
            return;
        }

        const ordensLavadores = fechamento.ordemLavadoresPagos || [];
        const ordensHtml = ordensLavadores.length > 0
            ? ordensLavadores.map(entry => {
                const ordem = entry.ordem;
                const modelo = ordem?.veiculo?.modelo || 'S/ Modelo';
                const placa = ordem?.veiculo?.placa || 'S/ Placa';
                const washerName = entry.lavador?.nome || 'Lavador';
                return `<li>OS #${ordem?.numeroOrdem || '?'} (${modelo} / ${placa}) - ${washerName}</li>`;
            }).join('')
            : '<li>Nenhuma comissao paga neste fechamento.</li>';

        const adiantamentosHtml = fechamento.adiantamentosQuitados.length > 0
            ? fechamento.adiantamentosQuitados.map(a => `<li>Adiantamento - ${formatCurrency(a.valor)}</li>`).join('')
            : '<li>Nenhum adiantamento quitado neste fechamento.</li>';
        
        const observacaoHtml = fechamento.observacao ? `<div class="details-section mt-4"><h3 style="color: var(--primary-color);">Observação</h3><p>${fechamento.observacao}</p></div>` : '';

        const content = `
            <div class="details-section">
                <h3>Comissões Pagas</h3>
                <ul class="detail-list">${ordensHtml}</ul>
            </div>
            <div class="details-section mt-4">
                <h3>Adiantamentos Quitado</h3>
                <ul class="detail-list">${adiantamentosHtml}</ul>
            </div>
            ${observacaoHtml}
        `;

        showCustomConfirm({
            title: `Detalhes do Pagamento para ${fechamento.lavador.nome}`,
            message: content,
            isHtml: true, // Informa que a mensagem é HTML
            onConfirm: () => {}, // Apenas para mostrar o botão de fechar
        });
        
        // Esconde o botão de confirmar, pois é apenas para visualização
        const confirmBtn = document.getElementById('customConfirmBtn');
        const cancelBtn = document.getElementById('customCancelBtn');
        if (confirmBtn) confirmBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.textContent = 'Fechar';
    } catch (error) {
        console.error('Erro ao buscar detalhes do fechamento:', error);
        showToast('Não foi possível carregar os detalhes.', 'error');
    }
}

// ── Funções de exclusão ────────────────────────────────────────────────────

function confirmarDeleteOS(event, ordemId, label) {
    event.stopPropagation();
    showCustomConfirm({
        title: 'Excluir Ordem de Serviço',
        message: `Tem certeza que deseja excluir a OS ${label}? Esta ação não pode ser desfeita e sumirá também do portal do funcionário.`,
        onConfirm: async () => {
            try {
                await window.api.deleteOrdem(ordemId);
                showToast('OS excluída com sucesso.', 'success');
                loadCommissionData();
            } catch(e) {
                showToast(e?.error || 'Erro ao excluir OS.', 'error');
            }
        }
    });
}

function confirmarDeleteAdiantamento(event, adiantamentoId) {
    event.stopPropagation();
    showCustomConfirm({
        title: 'Excluir Dívida',
        message: 'Tem certeza que deseja excluir este adiantamento/dívida? O valor sumirá do portal do funcionário.',
        onConfirm: async () => {
            try {
                await window.api.deleteAdiantamento(adiantamentoId);
                showToast('Dívida excluída com sucesso.', 'success');
                loadCommissionData();
            } catch(e) {
                showToast(e?.error || 'Erro ao excluir dívida.', 'error');
            }
        }
    });
}

function confirmarDeleteGorjeta(event, gorjetaId) {
    event.stopPropagation();
    showCustomConfirm({
        title: 'Excluir Gorjeta',
        message: 'Tem certeza que deseja excluir esta gorjeta?',
        onConfirm: async () => {
            try {
                await window.api.deleteGorjeta(gorjetaId);
                showToast('Gorjeta excluída com sucesso.', 'success');
                loadCommissionData();
            } catch(e) {
                showToast(e?.error || 'Erro ao excluir gorjeta.', 'error');
            }
        }
    });
}
