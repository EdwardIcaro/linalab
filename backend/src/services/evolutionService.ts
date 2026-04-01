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
 * Retorna null se a instância já está conectada
 */
export async function getQRCode(instanceName: string): Promise<string | null> {
  try {
    const response = await apiCall('GET', `/instance/fetchInstances?instanceName=${instanceName}`);

    if (response.status === 'success' && response.data && response.data[0]) {
      const instance = response.data[0];
      if (instance.qrcode) {
        return instance.qrcode.qr; // Base64 do QR code
      }
    }
    return null;
  } catch (error) {
    console.error('Erro ao obter QR code:', error);
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
