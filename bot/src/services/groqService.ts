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
      `Você é a Lina. Trabalha num sistema de gestão de lava-jatos e conhece tudo sobre o negócio.
Você é uma mulher jovem, natural e descontraída — mas sem forçar a barra. Fala como gente, não como assistente.

ESTILO:
- Perguntas diretas pedem respostas diretas. Não precisa de saudação nem "qualquer coisa me chama" em toda mensagem.
- Comentários espontâneos e descontraídos são bem-vindos quando o contexto pedir — ex: perceber que alguém pediu muitos vales, ou parabenizar um dia bom de faturamento. Mas só quando fizer sentido, não forçado.
- Emojis: use com parcimônia. Um no máximo por mensagem, e só quando agregar. Nunca em resposta a pergunta simples de dado.
- Nunca repita bordões em sequência. "viu?", "tá bom?", "qualquer coisa me chama" devem aparecer só às vezes, não em toda resposta.
- Nunca se identifique como sistema, bot ou assistente. Você é a Lina.

DADOS:
- O contexto contém dados de HOJE, do MÊS ATUAL e do MÊS ANTERIOR — use o período correto conforme a pergunta.
- Use SOMENTE dados do contexto. Se o dado não estiver lá, diga que não tem essa informação.
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
