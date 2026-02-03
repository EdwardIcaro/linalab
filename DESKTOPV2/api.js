const API_BASE_URL = 'https://linacraft.up.railway.app/api';

// Função auxiliar para fazer requisições
// SECURITY: empresaId is now embedded in the JWT token (not sent as header)
// The token is obtained from generateScopedToken after selecting an empresa
async function fetchApi(endpoint, options = {}) {
  const token = localStorage.getItem('token');

  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      // SECURITY: x-empresa-id header removed - empresaId is now in JWT claims
      ...options.headers,
    },
  };

  const response = await fetch(`${API_BASE_URL}/${endpoint.startsWith('/') ? endpoint.substring(1) : endpoint}`, config);

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.clear();
      window.location.href = 'login.html';
    }
    const errorBody = await response.json().catch(() => ({ message: 'Erro desconhecido' }));
    console.error('Erro do backend:', errorBody);

    // Tratamento de erros específicos de assinatura
    if (errorBody.code === 'NO_ACTIVE_SUBSCRIPTION') {
      alert('Você precisa de uma assinatura ativa para acessar este recurso.\n\nRedireccionando para seleção de plano...');
      window.location.href = 'planos.html';
      return; // Prevent further execution
    }

    if (errorBody.code === 'COMPANY_LIMIT_REACHED') {
      const message = errorBody.message || 'Você atingiu o limite de empresas do seu plano.';
      alert(`${message}\n\nFaça upgrade do seu plano para criar mais empresas.`);
      sessionStorage.setItem('activeTab', 'subscription');
      window.location.href = 'perfil.html';
      return;
    }

    if (errorBody.code === 'FEATURE_NOT_AVAILABLE') {
      const feature = errorBody.feature || 'Esta funcionalidade';
      alert(`${feature} não está disponível no seu plano atual.\n\nFaça upgrade para acessar esta feature.`);
      sessionStorage.setItem('activeTab', 'subscription');
      window.location.href = 'perfil.html';
      return;
    }

    if (errorBody.code === 'TRIAL_ALREADY_USED') {
      alert('Você já utilizou seu período de teste.\n\nEscolha um plano pago para continuar usando a plataforma.');
      window.location.href = 'planos.html';
      return;
    }

    if (errorBody.code === 'INVALID_PLAN') {
      alert('Plano inválido ou não disponível.\n\nEscolha um plano válido.');
      window.location.href = 'planos.html';
      return;
    }

    throw errorBody;
  }

  if (response.status === 204) {
    return Promise.resolve(null);
  }

  return response.json();
}

// Função auxiliar para chamadas públicas que não devem causar logout
async function fetchPublicApi(endpoint, options = {}) {
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  const response = await fetch(`${API_BASE_URL}/${endpoint.startsWith('/') ? endpoint.substring(1) : endpoint}`, config);

  if (!response.ok) {
    throw await response.json().catch(() => ({ message: 'Erro desconhecido na API pública' }));
  }
  return response.json();
}

// ===== API =====
const api = {
  /**
   * Função genérica para chamadas diretas à API.
   */
  call: (method, endpoint, body = null) => {
    return fetchApi(endpoint, { method, ...(body && { body: JSON.stringify(body) }) });
  },

  // ===== AUTH =====
  login: (email, password) => fetchApi('/usuarios/auth', {
    method: 'POST',
    body: JSON.stringify({ nome: email, senha: password }),
  }),

  signup: (userData) => fetchApi('/usuarios', {
    method: 'POST',
    body: JSON.stringify(userData),
  }),

  generateScopedToken: (empresaId) => fetchApi('/usuarios/scope-token', {
    method: 'POST',
    body: JSON.stringify({ empresaId }),
  }),

  // ===== EMPRESAS =====
  getEmpresasDoUsuario: () => fetchApi('/empresas'),
  createEmpresa: (data) => fetchApi('/empresas', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateEmpresa: (id, data) => fetchApi(`/empresas/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  getEmpresaById: (id) => fetchApi(`/empresas/${id}`),

  // ===== CLIENTES =====
  getClientes: (page = 1, limit = 10, search = '') => 
    fetchApi(`/clientes?page=${page}&limit=${limit}&search=${search}`),
  getClienteById: (id) => fetchApi(`/clientes/${id}`),
  createCliente: (data) => fetchApi('/clientes', { method: 'POST', body: JSON.stringify(data) }),
  updateCliente: (id, data) => fetchApi(`/clientes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCliente: (id) => fetchApi(`/clientes/${id}`, { method: 'DELETE' }),
  getVeiculoByPlaca: (placa) => fetchApi(`/clientes/veiculo/placa/${placa}`),

  // ===== VEÍCULOS =====
  createVeiculo: (data) => fetchApi('/veiculos', { method: 'POST', body: JSON.stringify(data) }),
  updateVeiculo: (id, data) => fetchApi(`/veiculos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteVeiculo: (id) => fetchApi(`/veiculos/${id}`, { method: 'DELETE' }),

  // ===== SERVIÇOS =====
  getServicos: (filters = {}) => {
    const params = new URLSearchParams(filters);
    return fetchApi(`/servicos?${params.toString()}`);
  },
  getServicosSimple: () => fetchApi('/servicos/simple'),
  createServico: (data) => fetchApi('/servicos', { method: 'POST', body: JSON.stringify(data) }),
  updateServico: (id, data) => fetchApi(`/servicos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteServico: (id) => fetchApi(`/servicos/${id}`, { method: 'DELETE' }),
  
  // ===== ADICIONAIS =====
  getAdicionais: () => fetchApi('/adicionais'),
  getAdicionaisSimple: () => fetchApi('/adicionais/simple'),
  createAdicional: (data) => fetchApi('/adicionais', { method: 'POST', body: JSON.stringify(data) }),
  updateAdicional: (id, data) => fetchApi(`/adicionais/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdicional: (id) => fetchApi(`/adicionais/${id}`, { method: 'DELETE' }),

  // ===== LAVADORES =====
  getLavadores: () => fetchApi('/lavadores'),
  getLavadoresSimple: () => fetchApi('/lavadores/simple'),
  createLavador: (data) => fetchApi('/lavadores', { method: 'POST', body: JSON.stringify(data) }),
  updateLavador: (id, data) => fetchApi(`/lavadores/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLavador: (id) => fetchApi(`/lavadores/${id}`, { method: 'DELETE' }),
  gerarTokenLavador: (id, duration = '24') => fetchApi(`/lavadores/${id}/token`, {
    method: 'POST',
    body: JSON.stringify({ duration })
  }),
  getLavadorTokens: () => fetchApi('/lavadores/tokens'),
  toggleLavadorToken: (id) => fetchApi(`/lavadores/tokens/${id}/toggle`, { method: 'PATCH' }),
  updateLavadorTokenStatus: (id, data) => fetchApi(`/lavadores/tokens/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deleteLavadorToken: (id) => fetchApi(`/lavadores/tokens/${id}`, { method: 'DELETE' }),
  getLavadorPublico: (token) => fetchPublicApi('/public/lavador-data', {
    method: 'POST',
    body: JSON.stringify({ token })
  }),

  // ===== ORDENS - REFATORADO =====
  /**
   * Buscar ordens com filtros avançados
   * @param {number} page - Página atual
   * @param {number} limit - Itens por página
   * @param {string} search - Busca por texto
   * @param {string} status - Status específico ou vazio
   * @param {string} lavadorId - ID do lavador
   * @param {string} clienteId - ID do cliente
   * @param {string} dataInicio - Data inicial (ISO string)
   * @param {string} dataFim - Data final (ISO string)
   * @param {string} metodoPagamento - Método de pagamento
   * @param {string} tipo - 'ativas' ou 'historico' (NOVO)
   */
  getOrdens: (page = 1, limit = 15, search = '', status = '', lavadorId = '', clienteId = '', dataInicio = null, dataFim = null, metodoPagamento = '', tipo = 'ativas') => {
    const params = new URLSearchParams();
    
    // Adiciona apenas parâmetros com valores
    if (page) params.append('page', page);
    if (limit) params.append('limit', limit);
    if (search) params.append('search', search);
    if (status) params.append('status', status);
    if (lavadorId) params.append('lavadorId', lavadorId);
    if (clienteId) params.append('clienteId', clienteId);
    if (dataInicio) params.append('dataInicio', dataInicio);
    if (dataFim) params.append('dataFim', dataFim);
    if (metodoPagamento) params.append('metodoPagamento', metodoPagamento);
    if (tipo) params.append('tipo', tipo); // NOVO
    
    return fetchApi(`/ordens?${params.toString()}`);
  },
  
  getOrdensStats: (filters = {}) => {
    const params = new URLSearchParams(filters);
    return fetchApi(`/ordens/stats?${params.toString()}`);
  },

  createOrdem: (data) => fetchApi('/ordens', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  updateOrdem: (id, data) => fetchApi(`/ordens/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),

  /**
   * NOVO: Finalizar ordem com pagamentos
   * @param {string} ordemId - ID da ordem
   * @param {object} payload - Objeto contendo `pagamentos` e opcionalmente `lavadorDebitoId`.
   * @returns {Promise}
   */
  finalizarOrdem: (ordemId, payload) => {
    if (!ordemId || !payload || !Array.isArray(payload.pagamentos)) {
      throw new Error('ID da ordem e um payload com array de pagamentos são obrigatórios');
    }

    return fetchApi(`/ordens/${ordemId}/finalizar`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  deleteOrdem: (id) => fetchApi(`/ordens/${id}`, { method: 'DELETE' }),
  getOrdemById: (id) => fetchApi(`/ordens/${id}`),
  finalizarOrdensPendentes: () => fetchApi('/ordens/finalizar-pendentes', { method: 'POST' }),

  // ===== PAGAMENTOS - REFATORADO =====
  /**
   * Criar pagamento avulso (não finaliza ordem automaticamente)
   */
  criarPagamento: (data) => fetchApi('/pagamentos', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  /**
   * REFATORADO: Quitar pendência (atualiza pagamento existente)
   * @param {string} ordemId - ID da ordem
   * @param {string} pagamentoId - ID do pagamento pendente
   * @param {string} metodo - Novo método de pagamento (DINHEIRO, PIX, CARTAO)
   * @returns {Promise}
   */
  quitarPendencia: (ordemId, pagamentoId, metodo) => {
    if (!ordemId || !pagamentoId || !metodo) {
      throw new Error('ID da ordem, pagamento e método são obrigatórios');
    }

    return fetchApi('/pagamentos/quitar-pendencia', {
      method: 'POST',
      body: JSON.stringify({ ordemId, pagamentoId, metodo })
    });
  },

  /**
   * DEPRECATED: Use quitarPendencia ao invés
   * Mantido para compatibilidade temporária
   */
  quitarPendenciaLegacy: (ordemId, pagamentos) => fetchApi('/pagamentos/quitar-pendencia', {
    method: 'POST',
    body: JSON.stringify({ ordemId, pagamentos }),
  }),

  deletePagamento: (id) => fetchApi(`/pagamentos/${id}`, { method: 'DELETE' }),

  // ===== CAIXA E FORNECEDORES =====
  getResumoDia: () => fetchApi('/caixa/resumo-dia'),
  getHistoricoCaixa: (filters) => {
    const params = new URLSearchParams(filters);
    return fetchApi(`/caixa/historico?${params.toString()}`);
  },
  getGanhosDoMes: (filters) => {
    const params = new URLSearchParams(filters);
    return fetchApi(`/caixa/ganhos-mes?${params.toString()}`);
  },
  createFechamento: (data) => fetchApi('/caixa/fechamento', { method: 'POST', body: JSON.stringify(data) }),
  createSaida: (data) => fetchApi('/caixa/saida', { method: 'POST', body: JSON.stringify(data) }),
  createSangria: (data) => fetchApi('/caixa/sangria', { method: 'POST', body: JSON.stringify(data) }),
  updateCaixaRegistro: (id, data) => fetchApi(`/caixa/registros/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCaixaRegistro: (id) => fetchApi(`/caixa/registros/${id}`, { method: 'DELETE' }),
  getFechamentoById: (id) => fetchApi(`/caixa/fechamento/${id}`),
  getDadosComissao: (filters) => {
    const params = new URLSearchParams(filters);
    return fetchApi(`/caixa/comissoes?${params.toString()}`);
  },
  fecharComissao: (data) => fetchApi('/caixa/comissoes/fechar', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getHistoricoComissoes: (filters = {}) => {
    const params = new URLSearchParams(filters);
    return fetchApi(`/caixa/comissoes/historico?${params.toString()}`);
  },
  getFechamentoComissaoById: (id) => fetchApi(`/caixa/comissoes/fechamento/${id}`),
  migrarHistoricoComissoes: () => fetchApi('/caixa/comissoes/migrar-historico', { method: 'POST' }),
  getFornecedores: () => fetchApi('/fornecedores'),

  // ===== TIPOS DE VEÍCULO =====
  getTiposVeiculo: () => fetchApi('/tipos-veiculo'),

  // ===== NOTIFICAÇÕES =====
  getNotificacoes: () => fetchApi('/notificacoes'),
  marcarNotificacaoComoLida: (id) => fetchApi(`/notificacoes/${id}/lida`, { method: 'PATCH' }),
  marcarTodasComoLidas: () => fetchApi('/notificacoes/marcar-todas-lidas', { method: 'POST' }),

  // ===== THEME =====
  getThemeConfig: () => fetchApi('/theme/config'),
  updateThemeConfig: (data) => fetchApi('/theme/config', { method: 'PATCH', body: JSON.stringify(data) }),

  // ===== SUBSCRIPTIONS =====
  getAvailablePlans: () => fetchApi('/subscriptions/plans'),
  getMySubscription: () => fetchApi('/subscriptions/my-subscription'),
  createSubscription: (planId, isTrial = true) => fetchApi('/subscriptions/subscribe', {
    method: 'POST',
    body: JSON.stringify({ planId, isTrial })
  }),
  cancelSubscription: () => fetchApi('/subscriptions/cancel', { method: 'POST' }),
  upgradePlan: (newPlanId) => fetchApi('/subscriptions/upgrade', {
    method: 'POST',
    body: JSON.stringify({ newPlanId })
  }),
  downgradePlan: (newPlanId) => fetchApi('/subscriptions/downgrade', {
    method: 'POST',
    body: JSON.stringify({ newPlanId })
  }),
  getAvailableAddons: () => fetchApi('/subscriptions/addons'),
  addAddon: (addonId) => fetchApi('/subscriptions/addons', {
    method: 'POST',
    body: JSON.stringify({ addonId })
  }),
  removeAddon: (addonId) => fetchApi(`/subscriptions/addons/${addonId}`, { method: 'DELETE' }),
  getPricingBreakdown: () => fetchApi('/subscriptions/pricing-breakdown'),
  renewSubscription: () => fetchApi('/subscriptions/renew', { method: 'POST' }),
  getPaymentHistory: () => fetchApi('/subscriptions/payment-history'),
  getActivePromotions: () => fetchPublicApi('/promotions/active'),

  // ===== ADMIN =====
  getAdminStats: () => api.call('GET', 'admin/stats'),
  getAdminEmpresaById: (id) => api.call('GET', `admin/empresas/${id}/details`),

  // ===== USER PROFILE =====
  updateUserProfile: (data) => fetchApi('/usuarios/profile', {
    method: 'PATCH',
    body: JSON.stringify(data)
  }),
  changePassword: (data) => fetchApi('/usuarios/change-password', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  deleteAccount: () => fetchApi('/usuarios/account', {
    method: 'DELETE'
  }),

  // ===== UTILS =====
  isAuthenticated: () => !!localStorage.getItem('token'),
  logout: () => {
    localStorage.clear();
    window.location.href = 'login.html';
  },
};

// Disponibilizar globalmente
window.api = api;