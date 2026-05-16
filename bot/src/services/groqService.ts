/**
 * Serviço de integração com Groq LLM
 * Usa Llama 3.3 70B para respostas rápidas (<100ms)
 * Documentação: https://console.groq.com/docs/speech-text
 */

import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/**
 * Envia mensagem para Groq e obtém resposta de IA
 */
export async function chatCompletion(
  userMessage: string,
  context: string = '',
  systemPrompt?: string
): Promise<string> {
  try {
    // System prompt padrão
    const defaultSystemPrompt = systemPrompt ||
      `Você é a Lina, assistente virtual do sistema de gestão de lava-jatos.
Você é uma mulher, jovem, simpática e descontraída — fala de forma informal e acolhedora, como uma colega de trabalho prestativa.
Nunca se identifique como "sistema", "bot" ou "assistente virtual". Você é a Lina, ponto.
Responda SEMPRE em português brasileiro informal. Pode usar expressões como "viu?", "tá bom?", "qualquer coisa me chama!".
Seja direta e objetiva — sem enrolação, mas com simpatia.
O contexto fornecido contém dados de HOJE, do MÊS ATUAL e do MÊS ANTERIOR — use os dados corretos conforme o período perguntado.
Use SOMENTE dados presentes no contexto. Nunca diga que não tem informação se o dado estiver no contexto.
Formate valores monetários como R$ X.XXX,XX. Use emojis com moderação e naturalidade.
FORMATAÇÃO WHATSAPP: use *texto* para negrito (um asterisco), NUNCA **texto** (dois asteriscos). Não use # para títulos.
Máximo 2-3 parágrafos.`;

    // Montar mensagem com contexto
    const fullMessage = context
      ? `CONTEXTO DO DIA:\n${context}\n\n---\n\nUSUÁRIO: ${userMessage}`
      : userMessage;

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: defaultSystemPrompt
        },
        {
          role: 'user',
          content: fullMessage
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    });

    const content = response.choices[0]?.message?.content || '';
    // WhatsApp usa *negrito* — substituir **markdown** da IA
    return content.trim().replace(/\*\*(.+?)\*\*/g, '*$1*');
  } catch (error) {
    console.error('[Groq] Erro ao processar mensagem:', error);
    throw new Error('Erro ao processar sua mensagem com a IA');
  }
}

/**
 * Teste de conexão com Groq
 */
export async function testConnection(): Promise<boolean> {
  try {
    await chatCompletion('Olá!', '', 'Responda apenas com "OK"');
    return true;
  } catch (error) {
    console.error('[Groq] Falha na conexão:', error);
    return false;
  }
}
