/**
 * Serviço de integração com Evolution API (WhatsApp Gateway)
 * Documentação: https://docs.evolution-api.com
 */

const EVOLUTION_URL = process.env.EVOLUTION_API_URL!;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY!;

interface EvolutionResponse {
  status: string;
  data?: any;
  error?: string;
}

/**
 * Realiza chamada HTTP para Evolution API
 */
async function apiCall(
  method: 'GET' | 'POST' | 'DELETE' | 'PUT',
  path: string,
  body?: any
): Promise<any> {
  const url = `${EVOLUTION_URL}${path}`;
  const headers = {
    'apikey': EVOLUTION_KEY,
    'Content-Type': 'application/json'
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Evolution API Error (${response.status}): ${errorData}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[Evolution API] Erro na chamada ${method} ${path}:`, error);
    throw error;
  }
}

/**
 * Cria uma nova instância de WhatsApp com webhook
 */
export async function createInstance(
  instanceName: string,
  webhookUrl: string
): Promise<any> {
  return apiCall('POST', '/instance/create', {
    instanceName,
    integration: 'WHATSAPP-BAILEYS'
  });
}

/**
 * Ativa/conecta uma instância para gerar QR code
 * RETORNA O QR CODE NA RESPOSTA!
 */
export async function startInstance(instanceName: string): Promise<any> {
  try {
    console.log('[Evolution] Ativando instância:', instanceName);
    const response = await apiCall('GET', `/instance/connect/${instanceName}`);

    console.log('[Evolution] Resposta do connect:');
    console.log('[Evolution] Tipo:', typeof response);
    console.log('[Evolution] Propriedades:', response ? Object.keys(response) : 'null');
    console.log('[Evolution] Completo:', JSON.stringify(response, null, 2));

    return response;
  } catch (error) {
    console.warn('[Evolution] Aviso ao ativar instância:', error);
    // Pode falhar se já está ativada, isso é ok
    return null;
  }
}

/**
 * Obtém código QR em base64 para conectar WhatsApp
 * Retorna null se a instância já está conectada ou QR ainda não foi gerado
 */
export async function getQRCode(instanceName: string): Promise<string | null> {
  try {
    console.log('[Evolution] Obtendo QR code para:', instanceName);

    const response = await apiCall('GET', `/instance/fetchInstances?instanceName=${instanceName}`);

    console.log('[Evolution] Tipo da resposta:', typeof response);
    console.log('[Evolution] É array?', Array.isArray(response));
    console.log('[Evolution] Resposta completa:', JSON.stringify(response, null, 2));

    // Response pode ser array ou objeto com .data
    const instances = Array.isArray(response) ? response : (response.data || []);

    console.log('[Evolution] Instâncias encontradas:', instances.length);
    console.log('[Evolution] Instâncias:', JSON.stringify(instances, null, 2));

    if (instances.length > 0) {
      const instance = instances[0];
      console.log('[Evolution] Instância encontrada:', {
        name: instance.name,
        connectionStatus: instance.connectionStatus,
        temQrcode: !!instance.qrcode,
        todasAsPropriedades: Object.keys(instance)
      });

      // Debug completo
      console.log('[Evolution] Objeto completo da instância:', JSON.stringify(instance, null, 2));

      // Evolution retorna QR em instance.qrcode quando em estado de "connecting"
      if (instance.qrcode) {
        console.log('[Evolution] Propriedades de qrcode:', Object.keys(instance.qrcode));
        console.log('[Evolution] QR code completo:', JSON.stringify(instance.qrcode, null, 2));

        // Tentar múltiplas propriedades
        const qrValue =
          instance.qrcode.base64 ||
          instance.qrcode.qr ||
          instance.qrcode.code ||
          instance.qrcode.pairingCode ||
          (typeof instance.qrcode === 'string' ? instance.qrcode : null);

        if (qrValue) {
          console.log('[Evolution] QR code encontrado em propriedade!');
          return qrValue;
        } else {
          console.log('[Evolution] qrcode existe mas nenhuma propriedade tem valor');
        }
      }

      // Se connectionStatus é 'connecting', QR pode estar sendo gerado
      if (instance.connectionStatus === 'connecting') {
        console.log('[Evolution] Instância em status "connecting" - QR pode estar sendo gerado');
      }

      // Se connectionStatus é 'close', QR ainda não foi gerado
      if (instance.connectionStatus === 'close') {
        console.log('[Evolution] Instância em status "close" - QR não foi gerado ainda');
      }

      return null;
    } else {
      console.log('[Evolution] Nenhuma instância encontrada com este nome');
    }

    return null;
  } catch (error) {
    console.error('[Evolution] Erro ao obter QR code:', error);
    return null;
  }
}

/**
 * Verifica estado de conexão da instância
 */
export async function getInstanceStatus(
  instanceName: string
): Promise<'open' | 'close' | 'connecting'> {
  try {
    const response = await apiCall('GET', `/instance/connectionState/${instanceName}`);

    if (response.status === 'success' && response.data) {
      return response.data.instance?.state || 'close';
    }
    return 'close';
  } catch (error) {
    console.error('Erro ao verificar status:', error);
    return 'close';
  }
}

/**
 * Obtém dados da instância conectada (número do proprietário, etc)
 */
export async function getInstanceInfo(instanceName: string): Promise<any> {
  try {
    const response = await apiCall('GET', `/instance/fetchInstances?instanceName=${instanceName}`);

    if (response.status === 'success' && response.data && response.data[0]) {
      return response.data[0];
    }
    return null;
  } catch (error) {
    console.error('Erro ao obter info da instância:', error);
    return null;
  }
}

/**
 * Envia mensagem de texto via WhatsApp
 */
export async function sendTextMessage(
  instanceName: string,
  to: string,
  message: string
): Promise<any> {
  // Formatar número: se não tiver @, adicionar @s.whatsapp.net
  const recipient = to.includes('@') ? to : `${to}@s.whatsapp.net`;

  return apiCall('POST', `/message/sendText/${instanceName}`, {
    number: to,
    text: message
  });
}

/**
 * Deleta instância e desconecta WhatsApp
 */
export async function deleteInstance(instanceName: string): Promise<any> {
  return apiCall('DELETE', `/instance/delete/${instanceName}`);
}

/**
 * Lista todas as instâncias
 */
export async function fetchInstances(): Promise<any> {
  return apiCall('GET', '/instance/fetchInstances');
}
