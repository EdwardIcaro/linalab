/**
 * Trilha de auditoria das marcações de ponto.
 *
 * Um controle de jornada só serve como prova se for possível mostrar o que foi
 * registrado, o que foi alterado depois, por quem e quando. Sem isso, um espelho
 * assinado não significa nada — o documento pode ter mudado depois da assinatura.
 *
 * A batida normal do funcionário não gera log: ela é o registro original. O que se
 * guarda aqui é toda intervenção posterior sobre ela, e o lançamento que não veio do
 * funcionário (manual do gestor, encerramento automático do sistema).
 *
 * Falha de log nunca derruba a operação — mas é gravada no console, porque log de
 * auditoria que some em silêncio é pior que não ter.
 */

import prisma from '../db';

export type AcaoMarcacao = 'CRIADA_MANUAL' | 'CRIADA_AUTO' | 'EDITADA' | 'EXCLUIDA' | 'RESTAURADA';

export interface Autor {
  nome: string;
  id?: string | null;
}

/** Quem está pedindo a mudança, do ponto de vista do registro. */
export function autorDaRequest(req: any): Autor {
  return {
    nome: req?.usuarioNome || 'Gestor',
    id: req?.subaccountId || req?.usuarioId || null,
  };
}

export const SISTEMA: Autor = { nome: 'Sistema', id: null };

export async function logarMarcacao(params: {
  empresaId: string;
  marcacaoId: string;
  funcionarioId: string;
  acao: AcaoMarcacao;
  autor: Autor;
  antes?: { tipo: string; timestamp: Date } | null;
  depois?: { tipo: string; timestamp: Date } | null;
  motivo?: string | null;
}): Promise<void> {
  const { empresaId, marcacaoId, funcionarioId, acao, autor, antes, depois, motivo } = params;
  try {
    await prisma.dpMarcacaoLog.create({
      data: {
        empresaId,
        marcacaoId,
        funcionarioId,
        acao,
        tipoAntes: antes?.tipo ?? null,
        timestampAntes: antes?.timestamp ?? null,
        tipoDepois: depois?.tipo ?? null,
        timestampDepois: depois?.timestamp ?? null,
        autorNome: autor.nome,
        autorId: autor.id ?? null,
        motivo: motivo ?? null,
      },
    });
  } catch (error) {
    console.error('[dp-auditoria] falha ao gravar log da marcação', marcacaoId, error);
  }
}

/** Histórico de um conjunto de marcações, do mais recente pro mais antigo. */
export async function historicoDasMarcacoes(marcacaoIds: string[]) {
  if (marcacaoIds.length === 0) return [];
  return prisma.dpMarcacaoLog.findMany({
    where: { marcacaoId: { in: marcacaoIds } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, marcacaoId: true, acao: true, autorNome: true, motivo: true, createdAt: true,
      tipoAntes: true, timestampAntes: true, tipoDepois: true, timestampDepois: true,
    },
  });
}
