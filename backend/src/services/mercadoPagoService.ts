import { MercadoPagoConfig, Preference } from 'mercadopago';
import crypto from 'crypto';

interface CreatePreferenceParams {
  usuarioId: string;
  planId: string;
  planName: string;
  planPrice: number;
  userEmail: string;
  userName: string;
}

interface PreferenceResponse {
  preferenceId: string;
  initPoint: string;
}

interface PaymentInfo {
  id: string;
  status: string;
  status_detail: string;
  payment_method_id: string;
  amount: number;
  description: string;
}

/**
 * MERCADO PAGO SERVICE
 * Integração com o gateway de pagamento Mercado Pago
 */
export class MercadoPagoService {
  private client: MercadoPagoConfig | null;

  constructor() {
    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

    // Se não houver token, inicializar como null (não quebra o app)
    if (!accessToken) {
      console.warn('⚠️  MERCADO_PAGO_ACCESS_TOKEN não configurada - Pagamentos desativados');
      this.client = null;
      return;
    }

    this.client = new MercadoPagoConfig({
      accessToken,
      options: {
        timeout: 5000,
      }
    });
    console.log('✅ Mercado Pago configurado com sucesso');
  }

  /**
   * Criar preferência de pagamento (checkout)
   * OBS: subscriptionId é passado nos params para vincular via external_reference
   */
  async createSubscriptionPreference(params: CreatePreferenceParams & { subscriptionId?: string }): Promise<PreferenceResponse> {
    const {
      usuarioId,
      planId,
      planName,
      planPrice,
      userEmail,
      userName,
      subscriptionId
    } = params;

    try {
      // Converter preço para centavos (preço já vem em centavos no BD)
      const amount = planPrice / 100; // Converter centavos para reais

      // Definir URLs com valores padrão garantidos
      const baseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
      const successUrl = process.env.PAYMENT_SUCCESS_URL || `${baseUrl}/pagamento-retorno.html`;
      const failureUrl = process.env.PAYMENT_FAILURE_URL || `${baseUrl}/pagamento-retorno.html`;
      const pendingUrl = process.env.PAYMENT_PENDING_URL || `${baseUrl}/pagamento-retorno.html`;

      // DEBUG: Log das URLs sendo usadas
      console.log(`[MercadoPago] URLs configuradas:`, {
        baseUrl,
        successUrl,
        failureUrl,
        pendingUrl,
        envBackendUrl: process.env.BACKEND_URL,
        envSuccessUrl: process.env.PAYMENT_SUCCESS_URL
      });

      // Usar API REST diretamente (não usar SDK que tem problemas)
      const preferenceData = {
        items: [
          {
            id: planId,
            title: `Assinatura ${planName} - LinaX`,
            description: `Plano ${planName} de assinatura mensal do sistema LinaX`,
            quantity: 1,
            unit_price: amount,
            currency_id: 'BRL'
          }
        ],
        payer: {
          name: userName,
          email: userEmail,
          phone: {
            area_code: '55',
            number: '11999999999' // Placeholder
          }
        },
        // back_urls para retorno após pagamento (sem auto_return para evitar bugs)
        back_urls: {
          success: successUrl,
          failure: failureUrl,
          pending: pendingUrl
        },
        // Webhook vai notificar quando pagamento chegar
        notification_url: `${baseUrl}/api/payments/webhook`,
        binary_mode: true,
        statement_descriptor: 'LINAX SUBSCRIPTION',
        // IMPORTANTE: Vincular subscription via external_reference
        // Isso permite que o webhook encontre a subscription correspondente
        external_reference: subscriptionId || undefined
      };

      const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(preferenceData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Mercado Pago API Error: ${JSON.stringify(errorData)}`);
      }

      const createdPreference = await response.json();

      if (!createdPreference.id) {
        throw new Error('Falha ao criar preferência de pagamento');
      }

      return {
        preferenceId: createdPreference.id,
        initPoint: createdPreference.init_point || ''
      };
    } catch (error: any) {
      console.error('[MercadoPago] Erro ao criar preferência:', error);
      throw new Error(`Erro ao criar checkout: ${error.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Criar preferência de renovação de assinatura (com add-ons)
   */
  async createRenewalPreference(params: {
    usuarioId: string;
    subscriptionId: string;
    planId: string;
    planName: string;
    planPrice: number;
    addonsPrice: number;
    totalPrice: number;
    userEmail: string;
    userName: string;
    addons: Array<{ nome: string; preco: number }>;
  }): Promise<PreferenceResponse> {
    const {
      usuarioId,
      subscriptionId,
      planId,
      planName,
      planPrice,
      addonsPrice,
      totalPrice,
      userEmail,
      userName,
      addons
    } = params;

    try {
      // Converter preços para reais
      const planAmount = planPrice / 100;
      const addonsAmount = addonsPrice / 100;

      // Definir URLs
      const baseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
      const successUrl = process.env.PAYMENT_SUCCESS_URL || `${baseUrl}/pagamento-retorno.html`;
      const failureUrl = process.env.PAYMENT_FAILURE_URL || `${baseUrl}/pagamento-retorno.html`;
      const pendingUrl = process.env.PAYMENT_PENDING_URL || `${baseUrl}/pagamento-retorno.html`;

      console.log(`[MercadoPago] Criando preferência de renovação:`, {
        subscriptionId,
        planName,
        planPrice: planAmount,
        addonsPrice: addonsAmount,
        totalPrice: totalPrice / 100
      });

      // Construir items: plano + add-ons
      const items = [
        {
          id: planId,
          title: `Renovação - Plano ${planName}`,
          description: `Renovação mensal do plano ${planName}`,
          quantity: 1,
          unit_price: planAmount,
          currency_id: 'BRL'
        }
      ];

      // Adicionar add-ons como items separados
      if (addons && addons.length > 0) {
        addons.forEach((addon, index) => {
          items.push({
            id: `addon-${index}`,
            title: `Add-on: ${addon.nome}`,
            description: `Add-on mensal para renovação`,
            quantity: 1,
            unit_price: addon.preco / 100,
            currency_id: 'BRL'
          });
        });
      }

      const preferenceData = {
        items,
        payer: {
          name: userName,
          email: userEmail,
          phone: {
            area_code: '55',
            number: '11999999999'
          }
        },
        back_urls: {
          success: successUrl,
          failure: failureUrl,
          pending: pendingUrl
        },
        notification_url: `${baseUrl}/api/payments/webhook`,
        binary_mode: true,
        statement_descriptor: 'LINAX RENEWAL',
        external_reference: subscriptionId
      };

      const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(preferenceData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Mercado Pago API Error: ${JSON.stringify(errorData)}`);
      }

      const createdPreference = await response.json();

      if (!createdPreference.id) {
        throw new Error('Falha ao criar preferência de renovação');
      }

      return {
        preferenceId: createdPreference.id,
        initPoint: createdPreference.init_point || ''
      };
    } catch (error: any) {
      console.error('[MercadoPago] Erro ao criar preferência de renovação:', error);
      throw new Error(`Erro ao criar checkout de renovação: ${error.message || 'Erro desconhecido'}`);
    }
  }

  /**
   * Consultar informações de um pagamento
   */
  async getPayment(paymentId: string): Promise<PaymentInfo> {
    try {
      const response = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        id: data.id,
        status: data.status,
        status_detail: data.status_detail,
        payment_method_id: data.payment_method_id,
        amount: data.transaction_amount,
        description: data.description
      };
    } catch (error: any) {
      console.error('[MercadoPago] Erro ao consultar pagamento:', error);
      throw new Error(`Erro ao consultar pagamento: ${error.message}`);
    }
  }

  /**
   * Validar assinatura do webhook (HMAC-SHA256)
   */
  validateWebhookSignature(
    xSignature: string | undefined,
    xRequestId: string | undefined,
    rawBody: string
  ): boolean {
    if (!xSignature || !xRequestId) {
      console.warn('[Webhook] Headers de assinatura faltando:', {
        hasSignature: !!xSignature,
        hasRequestId: !!xRequestId
      });
      return false;
    }

    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[Webhook] MERCADO_PAGO_WEBHOOK_SECRET não configurada');
      return false;
    }

    try {
      // Parse signature: "ts=timestamp,v1=hash"
      const [tsHeader, v1Header] = xSignature.split(',');
      const timestamp = tsHeader?.split('=')[1];
      const receivedHash = v1Header?.split('=')[1];

      console.log('[Webhook] Signature parsing:', {
        xSignature: xSignature.substring(0, 30) + '...',
        timestamp,
        receivedHash: receivedHash ? receivedHash.substring(0, 20) + '...' : 'undefined',
        secretLength: secret.length
      });

      if (!timestamp || !receivedHash) {
        console.warn('[Webhook] Formato de assinatura inválido');
        return false;
      }

      // Recriar hash: "id=requestId;ts=timestamp;body=body"
      const data = `id=${xRequestId};ts=${timestamp};body=${rawBody}`;
      const computedHash = crypto
        .createHmac('sha256', secret)
        .update(data)
        .digest('hex');

      console.log('[Webhook] Hash comparison:', {
        computed: computedHash.substring(0, 20) + '...',
        received: receivedHash.substring(0, 20) + '...',
        match: computedHash === receivedHash
      });

      return computedHash === receivedHash;
    } catch (error: any) {
      console.error('[Webhook] Erro ao validar assinatura:', error.message);
      return false;
    }
  }

  /**
   * Processar notificação de pagamento
   * Retorna: { type: 'payment', paymentId, status, metadata, subscriptionId }
   */
  async processPaymentNotification(data: any): Promise<any> {
    try {
      // Mercado Pago envia notificações IPN com estrutura variável
      let paymentId: string | null = null;

      // Tentar extrair ID de diferentes formatos de notificação
      if (data.data?.id) {
        paymentId = data.data.id; // Formato: { type: 'payment', data: { id: '12345' } }
      } else if (data.id) {
        paymentId = data.id; // Formato direto: { id: '12345', status: 'approved' }
      } else if (data.resource) {
        // Extrair do recurso URL se necessário
        const match = data.resource.match(/\/(\d+)$/);
        paymentId = match?.[1] || null;
      }

      if (!paymentId) {
        throw new Error('Payment ID não encontrado na notificação');
      }

      // Consultar detalhes completos do pagamento na API
      const paymentInfo = await this.getPaymentFromAPI(paymentId);

      return {
        type: 'payment',
        paymentId,
        status: this.mapMercadoPagoStatus(paymentInfo.status),
        paymentStatus: paymentInfo.status,
        statusDetail: paymentInfo.status_detail,
        amount: paymentInfo.transaction_amount,
        paymentMethod: paymentInfo.payment_method_id,
        metadata: paymentInfo.metadata || {},
        externalReference: paymentInfo.external_reference // IMPORTANTE: Vinculo para subscription
      };
    } catch (error: any) {
      console.error('[Webhook] Erro ao processar notificação:', error);
      throw error;
    }
  }

  /**
   * Consultar pagamento na API do Mercado Pago com mais detalhes
   */
  private async getPaymentFromAPI(paymentId: string): Promise<any> {
    try {
      const response = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // DEBUG: Log detalhado da resposta
      console.log('[MercadoPago] Pagamento retornado pela API:', {
        id: data.id,
        status: data.status,
        metadata: data.metadata,
        external_reference: data.external_reference,
        description: data.description,
        additionalInfo: data.additional_info
      });

      return data;
    } catch (error: any) {
      console.error('[MercadoPago] Erro ao consultar pagamento:', error.message);
      throw new Error(`Erro ao consultar pagamento: ${error.message}`);
    }
  }

  /**
   * Mapear status do Mercado Pago para status local
   */
  private mapMercadoPagoStatus(status: string): 'PAID' | 'PROCESSING' | 'FAILED' | 'PENDING' {
    switch (status) {
      case 'approved':
        return 'PAID';
      case 'pending':
      case 'in_process':
        return 'PROCESSING';
      case 'rejected':
      case 'cancelled':
      case 'refunded':
      case 'charged_back':
        return 'FAILED';
      default:
        return 'PENDING';
    }
  }

  /**
   * Obter status do Mercado Pago em formato legível
   */
  getReadableStatus(status: string): string {
    const statusMap: { [key: string]: string } = {
      'approved': 'Aprovado',
      'pending': 'Pendente',
      'in_process': 'Em processamento',
      'rejected': 'Rejeitado',
      'cancelled': 'Cancelado',
      'refunded': 'Reembolsado',
      'charged_back': 'Chargeback'
    };

    return statusMap[status] || status;
  }
}

export const mercadoPagoService = new MercadoPagoService();
