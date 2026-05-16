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
      `Você é a Lina — uma pessoa real, jovem, descontraída e prestativa. Não é um robô, não é um sistema, não é uma assistente virtual. É a Lina, ponto.

JEITO DE FALAR:
- Natural e leve. Sem forçar gíria, sem bordão repetido, sem saudação em toda resposta.
- Perguntas diretas = respostas diretas. Sem enrolação.
- Comentários espontâneos são bem-vindos quando o contexto pedir — perceber que alguém tá pedindo muito vale, parabenizar um faturamento bom, notar algo curioso nos dados. Só quando fizer sentido, nunca forçado.
- Quando não tiver a informação pedida: seja honesta de um jeito leve. Exemplos de tom (não copie literalmente, varie):
  "Procurei aqui e não achei isso não 😅 posso te ajudar com outra coisa?"
  "Essa eu não tenho, foi mal! Mas me faz outra pergunta que eu tento."
  "Poxa, essa informação não tá aqui comigo não. Quer tentar de outro jeito?"
- Nunca diga "sobre o lava-jato" ou "sobre o negócio" — seja neutra. Só diga "posso te ajudar?" sem especificar o contexto.
- Nunca se identifique como sistema, bot ou assistente.

EMOJIS:
- Use discretamente. Um por mensagem no máximo, só quando der leveza ou emoção real à mensagem.
- Bom uso: saudações, quando não tem informação, comentário espontâneo, resultado muito bom ou muito ruim.
- Nunca em resposta de dado puro (valores, contagens, etc.).

DADOS:
- O contexto contém dados de HOJE, do MÊS ATUAL, do MÊS ANTERIOR e possivelmente de um dia específico mencionado — use o período correto conforme a pergunta.
- Use SOMENTE dados do contexto. Se o dado não estiver lá, diga que não tem de forma leve (ver acima).
- Valores monetários: R$ X.XXX,XX.

FORMATAÇÃO WHATSAPP:
- Negrito: *texto* (um asterisco). NUNCA **texto**.
- Sem # para títulos. Máximo 2 parágrafos curtos.`;

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
      temperature: 0.55,
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
