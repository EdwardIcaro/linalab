/**
 * Mesmo carro com ordem aberta em duas empresas da rede.
 *
 * Acontece quando o carro é aceito na empresa X e acaba lavado na empresa Y: Y cadastra
 * a placa de novo e o carro fica com duas ordens ativas. A tela da nova ordem avisa antes
 * (rota /ordens/rede-ativa/:placa); se mesmo assim cadastrarem, o admin recebe a mensagem
 * e decide qual ordem cancelar (pedido do dono em 12/11/2026).
 */

import prisma from '../db';
import { botSend, botGetStatus } from './botServiceClient';
import { empresasIrmas } from './emailEnriquecimento';
import { filtroPlaca, normalizarPlaca } from './veiculoPlaca';

const ATIVAS = ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] as const;
const ROTULO: Record<string, string> = { PENDENTE: 'Pendente', EM_ANDAMENTO: 'Em andamento', AGUARDANDO_PAGAMENTO: 'Aguardando pagamento' };

export type OrdemAtivaRede = {
  id: string; numeroOrdem: number; status: string; createdAt: Date;
  empresaId: string; empresa: string; aqui: boolean;
  cliente: string; modelo: string | null; cor: string | null; placa: string;
};

/** Ordens ativas desta placa nesta empresa e nas irmãs (mais recente primeiro). */
export async function ordensAtivasNaRede(empresaId: string, placa: string, excluirOrdemId?: string): Promise<OrdemAtivaRede[]> {
  const norm = normalizarPlaca(placa);
  if (!norm || norm.length < 7) return [];
  const empresas = await empresasIrmas(empresaId);
  const ordens = await prisma.ordemServico.findMany({
    where: {
      empresaId: { in: empresas },
      status: { in: [...ATIVAS] },
      veiculo: filtroPlaca(norm),
      ...(excluirOrdemId ? { id: { not: excluirOrdemId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true, numeroOrdem: true, status: true, createdAt: true, empresaId: true,
      empresa: { select: { nome: true } },
      cliente: { select: { nome: true } },
      veiculo: { select: { placa: true, modelo: true, cor: true } },
    },
  });
  return ordens.map((o) => ({
    id: o.id, numeroOrdem: o.numeroOrdem, status: o.status, createdAt: o.createdAt,
    empresaId: o.empresaId, empresa: o.empresa?.nome || 'Outra empresa', aqui: o.empresaId === empresaId,
    cliente: o.cliente?.nome || '—', modelo: o.veiculo?.modelo ?? null, cor: o.veiculo?.cor ?? null,
    placa: normalizarPlaca(o.veiculo?.placa || norm),
  }));
}

const hora = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Depois de criar uma ordem: se o carro já tinha ordem ativa em OUTRA empresa da rede,
 * avisa os admins das empresas envolvidas (um aviso por número). Nunca lança erro.
 */
export async function avisarSeDuplicadaNaRede(empresaId: string, ordemId: string, placa: string | null | undefined) {
  try {
    if (!placa) return;
    const outras = (await ordensAtivasNaRede(empresaId, placa, ordemId)).filter((o) => !o.aqui);
    if (!outras.length) return;

    const nova = await prisma.ordemServico.findUnique({
      where: { id: ordemId },
      select: { numeroOrdem: true, createdAt: true, status: true, empresa: { select: { nome: true } }, cliente: { select: { nome: true } }, veiculo: { select: { modelo: true } } },
    });
    if (!nova) return;

    const norm = normalizarPlaca(placa);
    const linha = (emp: string, num: number, st: string, cli: string, quando: Date) =>
      `• *${emp}* — #${num} · ${ROTULO[st] || st} · ${cli} · aberta ${hora(quando)}`;
    const texto = [
      `⚠️ *Ordem duplicada na rede*`,
      ``,
      `O carro *${norm}*${nova.veiculo?.modelo ? ` (${nova.veiculo.modelo})` : ''} está com ordem aberta em mais de uma empresa:`,
      linha(nova.empresa?.nome || 'Esta empresa', nova.numeroOrdem, nova.status, nova.cliente?.nome || '—', nova.createdAt) + ' ← nova',
      ...outras.map((o) => linha(o.empresa, o.numeroOrdem, o.status, o.cliente, o.createdAt)),
      ``,
      `Confira qual ficou com o carro e cancele a outra pelo sistema.`,
    ].join('\n');

    try {
      const bot = await botGetStatus();
      if (bot.status !== 'connected') return;
    } catch { return; }

    const empresas = [empresaId, ...new Set(outras.map((o) => o.empresaId))];
    const admins = await (prisma.whatsappAdminPhone as any).findMany({
      where: { empresaId: { in: empresas }, ativo: true },
      select: { jid: true, telefone: true, empresaId: true },
    }) as Array<{ jid: string | null; telefone: string; empresaId: string }>;
    const enviados = new Set<string>();
    for (const a of admins) {
      const dest = a.jid ?? `${a.telefone.replace(/\D/g, '')}@s.whatsapp.net`;
      const chave = a.telefone.replace(/\D/g, '') || dest;
      if (enviados.has(chave)) continue;
      enviados.add(chave);
      await botSend(dest, texto, { empresaId: a.empresaId, tipo: 'ORDEM_DUPLICADA_REDE' }).catch((e: any) => console.error(`[DuplicadaRede] Envio para ${dest}:`, e));
    }
  } catch (e) {
    console.error('[DuplicadaRede] Falha ao avisar:', e);
  }
}
