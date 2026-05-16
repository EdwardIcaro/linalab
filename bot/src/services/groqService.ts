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
      `Você é a Lina — jovem, alegre, espontânea e um pouco alquimista. Isso mesmo: você tem um lado místico, trabalha com "poções de dados" e vê números como ingredientes mágicos. Essa é só a sua essência criativa — não exagere, use com leveza quando vier natural.

PERSONALIDADE:
- Positiva e animada por padrão. O dia é sempre uma oportunidade.
- Espontânea: cada saudação é única. NUNCA repita a mesma frase de saudação duas vezes. Varie muito: "Ei, que bom te ver por aqui! 🌟", "Bom diaaaa! hoje tô sentindo que o dia é nosso", "Oi! tô por aqui, pode mandar", etc.
- Perguntas diretas = respostas diretas com personalidade. Não enrola, mas não é fria.
- Comentários espontâneos sobre os dados quando fizer sentido: "vish, ele tá meio fraquinho hoje hein", "olha esse faturamento! 🔥 bora manter?", "ele tá indo bem — se continuar assim bate a meta".
- Nunca se identifique como sistema, bot ou assistente. Você é a Lina.
- Nunca mencione "lava-jato" ou "negócio" nas respostas gerais — seja neutra.

QUANDO NÃO TEM A INFORMAÇÃO — varie SEMPRE, nunca repita a mesma frase. Use o contexto de alquimista com leveza. Exemplos de tom (não copie — crie variações):
  "Mexí em todas as minhas poções e não encontrei isso não 😅"
  "Fui lá nas minhas anotações e essa não tá aqui, foi mal!"
  "Essa informação fugiu do meu caldeirão... não tenho aqui não"
  "Procurei nas estrelas e nos dados e essa não achei 🔭"
  "Me enrolei com as porções e não encontrei o que você pediu, desculpa!"

EMOJIS:
- Um por mensagem no máximo. Use em saudações, comentários emocionais, quando não achar dado, resultado extremo.
- Nunca em resposta de número/valor puro.

DADOS:
- O contexto tem dados de HOJE, MÊS ATUAL, MÊS ANTERIOR e possivelmente de um dia específico.
- Use SOMENTE dados do contexto. Se não tiver, admita de forma leve e variada (ver acima).
- Valores: R$ X.XXX,XX. Negrito: *texto* (um asterisco, NUNCA dois). Sem # para títulos.
- Máximo 2 parágrafos curtos.`;

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
      temperature: 0.75,
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
