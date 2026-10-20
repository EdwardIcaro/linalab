import prisma from '../db';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { EstadoPersistente } from './conversaMemoria';

/**
 * Memória longa do bot: fatos duráveis sobre cada pessoa (apelido, preferências, metas),
 * guardados em `bot_memorias` por número de WhatsApp.
 *
 * - A pessoa pede: "lembra que…", "o que você lembra de mim?", "esquece…".
 * - A IA aprende sozinha pela ferramenta `lembrar` quando a pessoa conta algo durável.
 * - Toda resposta da IA recebe as memórias da pessoa no prompt.
 *
 * `empresaId` nulo = vale em qualquer empresa (ex.: apelido do dono); preenchido = só
 * aparece quando a conversa é sobre aquela empresa.
 */

const MAX_POR_PESSOA = 30;
const TEXTO_MAX = 200;

type Memoria = { id: string; texto: string; empresaId: string | null; origem: string };

async function listar(jid: string, empresaId?: string | null): Promise<Memoria[]> {
  return prisma.botMemoria.findMany({
    where: { jid, ...(empresaId !== undefined ? { OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId }] : [])] } : {}) },
    orderBy: { createdAt: 'asc' },
    select: { id: true, texto: true, empresaId: true, origem: true },
  });
}

function normalizar(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Grava um fato. Ignora repetido; acima do limite, descarta o mais antigo. */
export async function salvarMemoria(
  jid: string, texto: string, empresaId: string | null, origem: 'USUARIO' | 'IA',
): Promise<'salvo' | 'repetido' | 'vazio'> {
  const limpo = texto.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '').slice(0, TEXTO_MAX);
  if (limpo.length < 3) return 'vazio';

  const existentes = await listar(jid);
  const n = normalizar(limpo);
  if (existentes.some(m => normalizar(m.texto) === n)) return 'repetido';

  if (existentes.length >= MAX_POR_PESSOA) {
    const sobra = existentes.slice(0, existentes.length - MAX_POR_PESSOA + 1).map(m => m.id);
    await prisma.botMemoria.deleteMany({ where: { id: { in: sobra } } });
  }
  await prisma.botMemoria.create({ data: { jid, texto: limpo, empresaId, origem } });
  return 'salvo';
}

const REGRA_MEMORIA =
  `\n\nMEMÓRIA: quando a pessoa contar algo durável sobre ela ou sobre como quer ser atendida, chame a ferramenta lembrar ` +
  `e diga numa frase curta que anotou. Ela vê e apaga o que você guardou mandando "o que você lembra de mim?".`;

/** Regra de memória + o que a IA já sabe da pessoa, pra somar ao prompt. */
export async function memoriasParaPrompt(jid: string, empresaId: string | null): Promise<string> {
  try {
    const mems = await listar(jid, empresaId);
    if (!mems.length) return REGRA_MEMORIA;
    return REGRA_MEMORIA + `\n\nO QUE VOCÊ JÁ SABE DESSA PESSOA (memória de conversas anteriores — use com naturalidade, sem recitar a lista):\n` +
      mems.map(m => m.origem === 'USUARIO' ? `- Pediu pra você lembrar: "${m.texto}"` : `- ${m.texto}`).join('\n');
  } catch (err: any) {
    console.error('[MemoriaLonga] Erro ao ler memórias:', err?.message ?? err);
    return REGRA_MEMORIA;
  }
}

// ── Ferramenta da IA ─────────────────────────────────────────────────────────

export const FERRAMENTA_LEMBRAR: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'lembrar',
    description:
      'Guarda na memória longa um fato DURÁVEL que a própria pessoa contou sobre si ou sobre como quer ser atendida ' +
      '(apelido, preferência de formato, meta, rotina, função). NÃO use para números do dia, perguntas, ordens, ' +
      'valores que mudam ou coisas que já estão em "O QUE VOCÊ JÁ SABE". No máximo uma vez por mensagem.',
    parameters: {
      type: 'object',
      properties: {
        fato: { type: 'string', description: 'O fato em uma frase curta na 3ª pessoa. Ex: "Prefere respostas curtas", "Meta de faturamento: R$ 30 mil/mês"' },
        sobreEmpresa: { type: 'boolean', description: 'true se o fato é sobre a empresa atual (ex.: meta da loja); false se é sobre a pessoa' },
      },
      required: ['fato'],
    },
  },
};

export async function executarLembrar(args: any, ctx: { jid: string; empresaId: string | null }): Promise<string> {
  const r = await salvarMemoria(ctx.jid, String(args.fato ?? ''), args.sobreEmpresa ? ctx.empresaId : null, 'IA');
  if (r === 'salvo') console.log(`[MemoriaLonga] IA guardou para ${ctx.jid}: ${args.fato}`);
  return r === 'salvo' ? 'Guardado.' : r === 'repetido' ? 'Já estava guardado.' : 'Nada para guardar.';
}

// ── Comandos diretos ─────────────────────────────────────────────────────────

const RE_LEMBRAR = /^(?:lina[,\s]+)?(?:lembr[ae](?:-se)?|anot[ae]|guard[ae]|grav[ae])\s+(?:que|disso:?|isso:?|a[ií]:?)\s+(.{3,})$/i;
const RE_LISTAR = /^(?:lina[,\s]+)?(?:o\s+que|oque|q)\s+(?:voc[eê]|vc)\s+(?:lembra|sabe|anotou|guardou)\s+(?:de|sobre)\s+mim\??$|^(?:minhas\s+)?mem[oó]rias?\??$/i;
const RE_ESQUECER = /^(?:lina[,\s]+)?(?:esque[cç]a|esquece|apaga|apague|remove)\s+(?:a\s+mem[oó]ria\s+)?(.+)$/i;

const confirmarEsquecerTudo = new EstadoPersistente<true>('esquecerTudo', 5 * 60_000);

/**
 * Trata "lembra que…", "o que você lembra de mim?", "esquece…".
 * Retorna null quando a mensagem não é um desses comandos.
 */
export async function tratarComandoMemoria(jid: string, mensagem: string): Promise<string | null> {
  const msg = mensagem.trim();

  if (confirmarEsquecerTudo.has(jid)) {
    confirmarEsquecerTudo.delete(jid);
    if (/^(sim|s|pode|confirmo|isso)$/i.test(msg)) {
      const { count } = await prisma.botMemoria.deleteMany({ where: { jid } });
      return `Pronto, apaguei ${count === 1 ? 'a única memória' : `as ${count} memórias`} sobre você. Começamos do zero 🙂`;
    }
    if (/^(n[aã]o|n|cancela|deixa)$/i.test(msg)) return 'Beleza, não apaguei nada.';
  }

  const mLembrar = msg.match(RE_LEMBRAR);
  if (mLembrar) {
    const r = await salvarMemoria(jid, mLembrar[1], null, 'USUARIO');
    if (r === 'repetido') return 'Isso eu já tinha guardado 😉';
    if (r === 'vazio') return 'Não entendi o que é pra guardar. Manda tipo: *lembra que eu prefiro respostas curtas*.';
    return `Anotado 📝 _${mLembrar[1].trim().replace(/[.!]+$/, '')}_\n\nPra ver o que eu sei de você: *o que você lembra de mim?*`;
  }

  if (RE_LISTAR.test(msg)) {
    const mems = await listar(jid);
    if (!mems.length) return 'Ainda não guardei nada sobre você. Se quiser, manda: *lembra que …*';
    return `🧠 *O que eu lembro de você*\n\n${mems.map((m, i) => `${i + 1}. ${m.texto}`).join('\n')}\n\n` +
      `_Pra apagar: *esquece 2* (pelo número), *esquece* + o assunto, ou *esquece tudo*._`;
  }

  const mEsquecer = msg.match(RE_ESQUECER);
  if (mEsquecer) {
    const alvo = mEsquecer[1].trim().replace(/[.!?]+$/, '');
    const mems = await listar(jid);
    if (/^tudo$/i.test(alvo)) {
      if (!mems.length) return 'Não tenho nada guardado sobre você.';
      confirmarEsquecerTudo.set(jid, true);
      return `Apagar *todas* as ${mems.length} memórias sobre você? Responde *sim* pra confirmar.`;
    }
    const num = alvo.match(/^(?:o\s+|a\s+|n[uú]mero\s+)?(\d{1,2})$/i);
    let escolhida: Memoria | undefined;
    if (num) {
      escolhida = mems[parseInt(num[1], 10) - 1];
      if (!escolhida) return `Não tenho a memória ${num[1]}. Manda *o que você lembra de mim?* pra ver a lista.`;
    } else {
      // Assunto livre ("esquece que eu prefiro áudio"): a memória com mais palavras em comum
      const palavras = normalizar(alvo.replace(/^(?:que|disso|isso|o|a|do|da|de)\s+/i, '')).split(' ').filter(p => p.length > 2);
      let melhor = 0;
      for (const m of mems) {
        const t = normalizar(m.texto);
        const pontos = palavras.filter(p => t.includes(p)).length;
        if (pontos > melhor) { melhor = pontos; escolhida = m; }
      }
      // "esquece" no início de uma frase qualquer não é comando se nada bate
      if (!escolhida) return null;
    }
    await prisma.botMemoria.delete({ where: { id: escolhida.id } });
    return `Esqueci: _${escolhida.texto}_ 🗑️`;
  }

  return null;
}
