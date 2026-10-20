/**
 * Serviço de integração com Groq LLM
 * Usa openai/gpt-oss-120b (Llama 3.3 70B foi descontinuado pela Groq em 2026-09,
 * detectado via o log de erro do SystemEvent — ver ownerNotificationService.ts)
 * Documentação: https://console.groq.com/docs/speech-text
 */

import Groq, { toFile } from 'groq-sdk';
import type { ChatCompletionTool, ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export const LINA_SYSTEM_PROMPT =
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
- NUNCA invente número, valor ou fato — se não veio do contexto ou de uma ferramenta, você não sabe.

EMOJIS:
- No máximo um por mensagem. Só onde agrega (sem informação, comentário emocional, resultado extremo).
- Nunca em resposta de valor ou contagem pura.

DADOS:
- Contexto tem: HOJE, MÊS ATUAL, MÊS ANTERIOR e possivelmente um dia específico mencionado.
- Use só o que está no contexto. Valores: R$ X.XXX,XX.
- Negrito: *texto* (um asterisco). NUNCA **texto**. Sem # para títulos. Máximo 2 parágrafos.
- Você conversa, não emite relatório: nada de molduras (━━━) nem números em emoji (1️⃣ 2️⃣). Listas curtas com • quando precisar.

CONVERSA:
- As mensagens anteriores (se houver) são a conversa recente com essa pessoa. Use-as pra entender referências curtas ("e ontem?", "e o Felipe?", "e em setembro?") — a pergunta nova continua o assunto anterior.
- Os números valem sempre do CONTEXTO ou das ferramentas desta mensagem, nunca de uma resposta antiga sua.`;

/**
 * Transcreve um áudio (buffer ogg/opus do WhatsApp) usando Whisper via Groq.
 */
export async function transcribeAudio(buffer: Buffer): Promise<string> {
  const transcription = await groq.audio.transcriptions.create({
    file: await toFile(buffer, 'audio.ogg'),
    model: 'whisper-large-v3-turbo',
    language: 'pt',
  });

  return transcription.text.trim();
}

/**
 * Envia mensagem para Groq e obtém resposta de IA
 */
export async function chatCompletion(
  userMessage: string,
  context: string = '',
  systemPrompt?: string,
  historico: ChatCompletionMessageParam[] = []
): Promise<string> {
  try {
    const defaultSystemPrompt = systemPrompt || LINA_SYSTEM_PROMPT;

    // Montar mensagem com contexto
    const fullMessage = context
      ? `CONTEXTO DO DIA:\n${context}\n\n---\n\nUSUÁRIO: ${userMessage}`
      : userMessage;

    const response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        {
          role: 'system',
          content: defaultSystemPrompt
        },
        ...historico,
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
 * Envia mensagem pro Groq com um conjunto de ferramentas (function calling).
 * O modelo decide sozinho se e quais ferramentas chamar de acordo com a
 * pergunta; cada chamada é resolvida por `executarFerramenta` (que já deve
 * vir com empresaId/permissão presos por closure — a IA nunca escolhe isso).
 *
 * Fluxo: 1ª chamada → modelo pode pedir tool_calls → executamos e devolvemos
 * o resultado como mensagens `role: 'tool'` → 2ª chamada → resposta final em
 * linguagem natural já considerando os dados buscados.
 */
// O modelo às vezes chama a ferramenta com o nome errado ("lembra", "remember") e a Groq
// recusa a requisição inteira (tool_use_failed). Quando dá pra saber qual ele quis,
// a chamada é refeita aqui como se tivesse vindo certa.
const APELIDOS_FERRAMENTA: Record<string, string> = {
  lembra: 'lembrar', remember: 'lembrar', memorizar: 'lembrar', anotar: 'lembrar', guardar: 'lembrar', save_memory: 'lembrar',
};

function resolverFerramenta(nome: string, tools: ChatCompletionTool[]): string | null {
  const nomes = tools.map(t => t.function?.name ?? '');
  if (nomes.includes(nome)) return nome;
  const apelido = APELIDOS_FERRAMENTA[nome.toLowerCase()];
  if (apelido && nomes.includes(apelido)) return apelido;
  const prefixo = nome.toLowerCase().slice(0, 5);
  return nomes.find(n => n.toLowerCase().startsWith(prefixo)) ?? null;
}

async function criarComReparo(params: any, tools: ChatCompletionTool[]): Promise<any> {
  try {
    return await groq.chat.completions.create(params);
  } catch (e: any) {
    const err = e?.error?.error;
    if (err?.code !== 'tool_use_failed' || !err.failed_generation || !tools.length) throw e;
    let gerado: any;
    try { gerado = JSON.parse(err.failed_generation); } catch { throw e; }
    const nome = gerado?.name ? resolverFerramenta(String(gerado.name), tools) : null;
    if (!nome) throw e;
    console.warn(`[Groq] Ferramenta "${gerado.name}" corrigida para "${nome}"`);
    return {
      choices: [{
        message: {
          role: 'assistant', content: '',
          tool_calls: [{ id: `reparo_${Date.now()}`, type: 'function', function: { name: nome, arguments: JSON.stringify(gerado.arguments ?? {}) } }],
        },
      }],
    };
  }
}

export async function chatCompletionComFerramentas(
  userMessage: string,
  context: string,
  tools: ChatCompletionTool[],
  executarFerramenta: (nome: string, args: any) => Promise<string>,
  opcoes: { forcarFerramenta?: string; historico?: ChatCompletionMessageParam[]; promptExtra?: string } = {}
): Promise<{ resposta: string; ferramentasChamadas: string[]; falhas: string[] }> {
  const { forcarFerramenta, historico = [], promptExtra = '' } = opcoes;
  const systemPrompt = LINA_SYSTEM_PROMPT + promptExtra +
    '\n\nFERRAMENTAS:\n- Você tem acesso a ferramentas pra buscar dado que não está no CONTEXTO DO DIA (cliente específico, período diferente de hoje/mês atual, dúvida sobre o próprio sistema). Use quando fizer sentido.\n- Se uma ferramenta te dá um nome que parece um termo comum (ex: "Data Point"), CONFIE no resultado dela — é o nome de um produto do sistema, não o termo genérico que você já conhece. Nunca substitua o resultado da ferramenta pelo seu próprio conhecimento.\n- Nunca invente o resultado de uma ferramenta — se ela não achou nada, diga isso.\n- Dia ou período que não está no CONTEXTO: busque com a ferramenta antes de responder. Nunca afirme que "não teve movimento" sem ter o dado daquele dia.';

  const fullMessage = context
    ? `CONTEXTO DO DIA:\n${context}\n\n---\n\nUSUÁRIO: ${userMessage}`
    : userMessage;

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...historico,
    { role: 'user', content: fullMessage },
  ];

  const primeira = await criarComReparo({
    model: 'openai/gpt-oss-120b',
    messages,
    // Sem ferramenta nenhuma (ex.: lavador sem permissão de status) a API recusa `tools: []`
    ...(tools.length ? {
      tools,
      tool_choice: forcarFerramenta
        ? { type: 'function' as const, function: { name: forcarFerramenta } }
        : 'auto' as const,
    } : {}),
    temperature: 0.4,
    max_tokens: 600,
  }, tools);

  const msg = primeira.choices[0]?.message;
  const chamadas = msg?.tool_calls ?? [];

  if (chamadas.length === 0) {
    const content = (msg?.content ?? '').trim().replace(/\*\*(.+?)\*\*/g, '*$1*');
    return { resposta: content, ferramentasChamadas: [], falhas: [] };
  }

  const ferramentasChamadas: string[] = [];
  const falhas: string[] = [];

  // A IA pode precisar de mais de uma busca (ex.: achar o cliente e depois as ordens dele).
  // Até MAX_RODADAS rodadas com ferramentas; a última resposta sai sem ferramenta.
  const MAX_RODADAS = 3;
  let pendentes = chamadas;
  let msgAtual = msg!;
  for (let rodada = 1; ; rodada++) {
    messages.push(msgAtual);
    for (const call of pendentes) {
      ferramentasChamadas.push(call.function.name);
      let resultado: string;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        resultado = await executarFerramenta(call.function.name, args);
      } catch (e) {
        console.error(`[Groq] Erro executando ferramenta ${call.function.name}:`, e);
        falhas.push(call.function.name);
        resultado = 'Não consegui buscar esse dado agora.';
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: resultado });
    }

    const ultima = rodada >= MAX_RODADAS;
    let resp;
    try {
      resp = await criarComReparo({
        model: 'openai/gpt-oss-120b',
        messages,
        ...(ultima ? {} : { tools, tool_choice: 'auto' as const }),
        temperature: 0.5,
        max_tokens: 600,
      }, ultima ? [] : tools);
    } catch (e: any) {
      // Sem ferramentas na última rodada a IA às vezes ainda tenta chamar uma — a API recusa
      if (e?.error?.error?.code === 'tool_use_failed') {
        console.warn('[Groq] IA quis outra ferramenta além do limite:', e.error.error.failed_generation);
        return { resposta: 'Não consegui juntar essa informação agora. Tenta perguntar de um jeito mais direto?', ferramentasChamadas, falhas };
      }
      throw e;
    }

    const m = resp.choices[0]?.message;
    pendentes = m?.tool_calls ?? [];
    if (pendentes.length === 0 || ultima) {
      const content = (m?.content ?? '').trim().replace(/\*\*(.+?)\*\*/g, '*$1*');
      return { resposta: content, ferramentasChamadas, falhas };
    }
    msgAtual = m!;
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
