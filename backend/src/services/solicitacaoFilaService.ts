import prisma from '../db';
import type { Extracao } from './emailExtracao';
import { createNotification } from './notificationService';

/**
 * Fila de solicitações de lavagem (Localiza).
 *
 * O e-mail de "Solicitação de Lavagem" vira um carro esperando alguém aceitar no portal;
 * o de "Cancelamento" tira o carro da fila. O escopo é o DONO da conta, não a empresa
 * que leu o e-mail: a mesma frota é atendida pelas lojas dele, e quem aceita leva a
 * ordem para a própria empresa.
 */

export const FORNECEDOR = 'localiza';
/** Solicitação que ninguém aceitou some sozinha depois disso (outro fornecedor pegou). */
export const VALIDADE_DIAS = 3;

/** "R$ 1.130,00" → 1130. Null quando não dá pra ler. */
export function precoNumero(texto: string | null | undefined): number | null {
  const limpo = String(texto ?? '').replace(/[^0-9,.]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

/** Chave do vínculo de serviço por valor: 130 → "130", 37.5 → "37.5". */
export function chavePreco(preco: number | null | undefined): string {
  return preco == null ? '' : String(Math.round(preco * 100) / 100);
}

export function normalizarPlaca(placa: string | null | undefined): string {
  return String(placa ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

async function donoDaEmpresa(empresaId: string): Promise<string | null> {
  const e = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { usuarioId: true } });
  return e?.usuarioId ?? null;
}

/** Cada veículo do e-mail de solicitação vira uma linha na fila (repetido é ignorado). */
async function registrarSolicitacao(empresaId: string, lido: Extracao): Promise<number> {
  const usuarioId = await donoDaEmpresa(empresaId);
  if (!usuarioId) return 0;
  const v = lido.valores;
  const dados = lido.itens
    .map((item) => {
      const placa = normalizarPlaca(item.placa);
      const numero = String(item.numero || v.valor || '').trim();
      if (placa.length < 7 || !numero) return null;
      return {
        usuarioId,
        origemEmpresaId: empresaId,
        fornecedor: FORNECEDOR,
        numero,
        placa,
        tipo: (item.tipo || '').replace(/\s+/g, ' ').trim() || item.servico || null,
        preco: precoNumero(item.preco),
        precoTexto: item.preco || null,
        solicitante: v.solicitante || null,
        agencia: v.agencia || null,
        diaAbertura: v.dia || null,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
  if (!dados.length) return 0;
  // A mesma solicitação pode chegar em duas caixas da conta — a chave única segura
  const r = await prisma.solicitacaoLavagem.createMany({ data: dados, skipDuplicates: true });
  return r.count;
}

/**
 * Cancelamento: tira da fila. Se alguém já tinha aceitado, NÃO apaga a ordem — marca e
 * avisa a empresa (na prática o carro nem foi buscado, mas quem decide é o gestor).
 */
async function registrarCancelamento(empresaId: string, lido: Extracao): Promise<number> {
  const usuarioId = await donoDaEmpresa(empresaId);
  if (!usuarioId) return 0;
  const numero = String(lido.valores.valor || '').trim();
  const placa = normalizarPlaca(lido.valores.placa);
  if (!numero) return 0;

  const alvos = await prisma.solicitacaoLavagem.findMany({
    where: { usuarioId, fornecedor: FORNECEDOR, numero, ...(placa.length >= 7 ? { placa } : {}), canceladaEm: null },
  });
  const quem = lido.valores.cancelou || null;
  for (const s of alvos) {
    if (s.status === 'PENDENTE') {
      await prisma.solicitacaoLavagem.updateMany({
        where: { id: s.id, status: 'PENDENTE' },
        data: { status: 'CANCELADA', canceladaEm: new Date(), canceladaPor: quem },
      });
      continue;
    }
    await prisma.solicitacaoLavagem.update({ where: { id: s.id }, data: { canceladaEm: new Date(), canceladaPor: quem } });
    if (s.status === 'ACEITA' && s.ordemId && s.aceitaEmpresaId) {
      const ordem = await prisma.ordemServico.findUnique({
        where: { id: s.ordemId },
        select: { id: true, numeroOrdem: true, observacoes: true },
      });
      if (ordem) {
        const aviso = '⚠️ Cancelada pela Localiza';
        if (!String(ordem.observacoes || '').includes(aviso)) {
          await prisma.ordemServico.update({
            where: { id: ordem.id },
            data: { observacoes: [aviso, ordem.observacoes].filter(Boolean).join(' — ') },
          });
        }
        await createNotification({
          empresaId: s.aceitaEmpresaId,
          mensagem: `A Localiza cancelou a lavagem de ${s.placa} (ordem #${ordem.numeroOrdem}). Confira se a ordem deve ser cancelada.`,
          link: `ordens.html?id=${ordem.id}`,
          type: 'ordemEditada',
        }).catch(() => {});
      }
    }
  }
  return alvos.length;
}

/** Chamado pelo poller quando uma regra com `fila` casa com um e-mail. */
export async function alimentarFila(empresaId: string, fila: string, lido: Extracao): Promise<number> {
  if (fila === 'SOLICITACAO') return registrarSolicitacao(empresaId, lido);
  if (fila === 'CANCELAMENTO') return registrarCancelamento(empresaId, lido);
  return 0;
}
