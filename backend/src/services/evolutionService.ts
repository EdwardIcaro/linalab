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
 * Obtém código QR em base64 para conectar WhatsApp
 * Retorna null se a instância já está conectada ou QR ainda não foi gerado
 */
export async function getQRCode(instanceName: string): Promise<string | null> {
  try {
    console.log('[Evolution] Obtendo QR code para:', instanceName);

    const response = await apiCall('GET', `/instance/fetchInstances?instanceName=${instanceName}`);

    console.log('[Evolution] Resposta fetchInstances:', JSON.stringify(response, null, 2));

    if (response.status === 'success' && response.data && response.data[0]) {
      const instance = response.data[0];
      console.log('[Evolution] Instância encontrada:', {
        instanceName: instance.instanceName,
        status: instance.status || instance.connectionStatus,
        temQrcode: !!instance.qrcode
      });

      if (instance.qrcode && instance.qrcode.qr) {
        console.log('[Evolution] QR code encontrado!');
        return instance.qrcode.qr; // Base64 do QR code
      } else if (instance.qrcode) {
        console.log('[Evolution] qrcode existe mas sem .qr:', instance.qrcode);
        // Tentar outras propriedades possíveis
        return instance.qrcode.base64 || instance.qrcode.base64Data || instance.qrcode.code || null;
      } else {
        console.log('[Evolution] Sem propriedade qrcode na instância');
      }
    } else {
      console.log('[Evolution] Resposta inesperada:', response);
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
