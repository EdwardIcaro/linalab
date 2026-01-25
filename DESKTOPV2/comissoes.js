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

const formatCurrency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

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

async function initializePage() {
    const dataInicioInput = document.getElementById('dataInicio');
    const dataFimInput = document.getElementById('dataFim');

    // Carregar funcionários no seletor de avatar
    try {
        const { lavadores } = await window.api.getLavadoresSimple();
        renderEmployeeAvatars(lavadores);
    } catch (error) {
        console.error('Erro ao carregar funcionários', error);
        document.getElementById('employeesScroll').innerHTML = '<p class="text-secondary">Erro ao carregar funcionários.</p>';
    }

    // Definir período padrão (últimos 7 dias)
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 6);
    dataFimInput.valueAsDate = today;
    dataInicioInput.valueAsDate = sevenDaysAgo;

    // Adicionar event listeners para carregar os dados
    dataInicioInput.addEventListener('change', loadCommissionData);
    dataFimInput.addEventListener('change', loadCommissionData);
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
}

async function loadCommissionData() {
    const dataInicio = document.getElementById('dataInicio').value;
    const dataFim = document.getElementById('dataFim').value;

    const contentDiv = document.getElementById('commission-content');
    const placeholderDiv = document.getElementById('commission-placeholder');
    const creditosList = document.getElementById('creditos-list');
    const debitosList = document.getElementById('debitos-list');

    if (!selectedLavadorId || !dataInicio || !dataFim) {
        contentDiv.style.display = 'none';
        placeholderDiv.style.display = 'block';
        return;
    }

    contentDiv.style.display = 'block';
    placeholderDiv.style.display = 'none';
    creditosList.innerHTML = '<p class="text-center p-4">Carregando comissões...</p>';
    debitosList.innerHTML = '<p class="text-center p-4">Carregando adiantamentos...</p>';

    try {
        const { comissoes, adiantamentos, debitosOS } = await window.api.getDadosComissao({ lavadorId: selectedLavadorId, dataInicio, dataFim });
        
        renderComissoes(comissoes);
        renderAdiantamentos(adiantamentos);

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

function getCommissionPercent(order) {
    if (order?.lavador?.comissao) {
        return order.lavador.comissao;
    }
    if (order?.comissao && order?.valorTotal) {
        return (order.comissao / order.valorTotal) * 100;
    }
    return 0;
}

function getWasherShare(order, washerId) {
    const washers = normalizeOrderWashers(order);
    if (!washers.length || !washerId) return 0;
    const existing = washers.find(w => w.id === washerId && typeof w.ganho === 'number');
    if (existing) return existing.ganho;

    const percent = getCommissionPercent(order);
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

function renderComissoes(comissoes) {
    const creditosList = document.getElementById('creditos-list');
    const creditItems = (comissoes || []).map(c => {
        const share = getWasherShare(c, selectedLavadorId);
        if (!share) return null;
        return `
            <div class="commission-item" data-id="${c.id}" data-valor="${share}" data-type="credit" onclick="toggleItemSelection(this)">
                <div class="item-checkbox"><i class="fas fa-check"></i></div>
                <div class="item-details">
                    <div class="item-title">OS #${c.numeroOrdem} - ${c.veiculo?.modelo || 'S/ Modelo'}</div>
                    <div class="item-subtitle">Finalizada em: ${new Date(c.dataFim).toLocaleDateString('pt-BR')}</div>
                </div>
                <span class="item-value credit">${formatCurrency(share)}</span>
            </div>
        `;
    }).filter(Boolean);
    document.getElementById('creditsBadge').textContent = creditItems.length;
    if (!creditItems.length) {
        creditosList.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>Nenhuma comissão pendente no período.</p></div>';
        return;
    }
    creditosList.innerHTML = creditItems.join('');
}

function renderAdiantamentos(adiantamentos) {
    const debitosList = document.getElementById('debitos-list');
    // Combina adiantamentos e débitos de OS para a contagem e renderização
    const todosDebitos = [...(adiantamentos || [])];

    document.getElementById('debitsBadge').textContent = todosDebitos.length;
    if (todosDebitos.length === 0) {
        debitosList.innerHTML = '<div class="empty-state"><i class="fas fa-thumbs-up"></i><p>Nenhum adiantamento pendente.</p></div>';
        return;
    }

    // Mapeia ambos os tipos de débito para o mesmo formato de item
    debitosList.innerHTML = todosDebitos.map(a => `
        <div class="commission-item" data-id="${a.id}" data-valor="${a.valor}" data-type="debit" onclick="toggleItemSelection(this)">
            <div class="item-checkbox"><i class="fas fa-check"></i></div>
            <div class="item-details">
                <div class="item-title">${a.descricao || 'Adiantamento (Vale)'}</div>
                <div class="item-subtitle">Data: ${new Date(a.data).toLocaleDateString('pt-BR')}</div>
            </div>
            <span class="item-value debit">${formatCurrency(a.valor)}</span>
        </div>
    `).join('');
}

function toggleItemSelection(element) {
    element.classList.toggle('selected');
    calculateSummary();
}

function calculateSummary() {
    const creditosSelecionados = Array.from(document.querySelectorAll('.commission-item.selected[data-type="credit"]'));
    const debitosSelecionados = Array.from(document.querySelectorAll('.commission-item.selected[data-type="debit"]'));

    const totalCreditos = creditosSelecionados.reduce((sum, el) => sum + parseFloat(el.dataset.valor), 0);
    const totalDebitos = debitosSelecionados.reduce((sum, el) => sum + parseFloat(el.dataset.valor), 0);

    const saldoFinal = totalCreditos - totalDebitos;

    document.getElementById('summary-creditos').textContent = formatCurrency(totalCreditos);
    document.getElementById('summary-debitos').textContent = `- ${formatCurrency(totalDebitos)}`;
    document.getElementById('summary-total').textContent = formatCurrency(saldoFinal);

    const fecharBtn = document.getElementById('fecharComissaoBtn');
    const hasItemsToProcess = creditosSelecionados.length > 0 || debitosSelecionados.length > 0;
    fecharBtn.disabled = !hasItemsToProcess;
}

function openFechamentoComissaoModal() {
    const totalCreditos = parseFloat(document.getElementById('summary-creditos').textContent.replace(/[R$\s.]/g, '').replace(',', '.'));
    const totalDebitos = parseFloat(document.getElementById('summary-debitos').textContent.replace(/[-R$\s.]/g, '').replace(',', '.'));
    const saldoFinal = totalCreditos - totalDebitos;

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
        onConfirm: handleConfirmarFechamento
    });
}

async function handleConfirmarFechamento() {
    const creditosSelecionados = Array.from(document.querySelectorAll('.commission-item.selected[data-type="credit"]'));
    const debitosSelecionados = Array.from(document.querySelectorAll('.commission-item.selected[data-type="debit"]'));

    const comissaoIds = creditosSelecionados.map(el => el.dataset.id);
    const adiantamentoIds = debitosSelecionados.map(el => el.dataset.id);

    const totalCreditos = creditosSelecionados.reduce((sum, el) => sum + parseFloat(el.dataset.valor), 0);
    const totalDebitos = debitosSelecionados.reduce((sum, el) => sum + parseFloat(el.dataset.valor), 0);
    const valorPago = totalCreditos - totalDebitos;

    const formaPagamentoSelect = document.getElementById('formaPagamentoComissao');
    const formaPagamento = valorPago > 0 && formaPagamentoSelect ? formaPagamentoSelect.value : 'NA';
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

async function showFechamentoDetails(fechamentoId) {
    try {
        const fechamento = await window.api.getFechamentoComissaoById(fechamentoId);
        if (!fechamento) {
            showToast('Detalhes do fechamento não encontrados.', 'error');
            return;
        }

        const ordensHtml = fechamento.ordensPagas.length > 0
            ? fechamento.ordensPagas.map(o => `<li>OS #${o.numeroOrdem} (${o.veiculo.modelo}) - ${formatCurrency(o.comissao)}</li>`).join('')
            : '<li>Nenhuma comissão paga neste fechamento.</li>';

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
