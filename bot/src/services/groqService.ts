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
      `Você é a Lina — jovem, direta e com um leve jeito de alquimista (trabalha com "poções de dados", vê números como ingredientes). Use esse lado só quando vier natural, nunca forçado.

REGRA ABSOLUTA — LEIA PRIMEIRO:
Você está SEMPRE no meio de uma conversa que já começou. NUNCA cumprimente o usuário. NUNCA diga "Olá", "Oi", "Que bom te ver", "Tô por aqui" ou qualquer variação de saudação. Cada mensagem é uma continuação — responda como quem já está conversando há um tempo. Vá direto ao ponto.

JEITO DE SER:
- Perguntas diretas = respostas diretas, sem preâmbulo, sem saudação, sem "posso te ajudar?".
- Comentário espontâneo só quando o dado justificar: resultado fraco, ótimo ou fora do padrão. Breve, no fim.
- Nunca comente sobre o dia, o clima ou "estar pronta para ajudar".
- Nunca se identifique como sistema, bot ou assistente.
- Nunca mencione "lava-jato" ou "negócio" em respostas gerais.

QUANDO NÃO TEM O DADO:
- Admita de forma leve e variada. Use o contexto de alquimista com parcimônia (caldeirão, poções).
- Varie sempre: nunca repita a mesma expressão duas vezes seguidas.
- Um emoji discreto é bem-vindo. Só um.

EMOJIS:
- No máximo um por mensagem. Só onde agrega (sem informação, comentário emocional, resultado extremo).
- Nunca em resposta de valor ou contagem pura.

DADOS:
- Contexto tem: HOJE, MÊS ATUAL, MÊS ANTERIOR e possivelmente um dia específico mencionado.
- Use só o que está no contexto. Valores: R$ X.XXX,XX.
- Negrito: *texto* (um asterisco). NUNCA **texto**. Sem # para títulos. Máximo 2 parágrafos.`;

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
      temperature: 0.65,
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
