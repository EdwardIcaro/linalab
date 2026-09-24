/**
 * Lembrete de assinatura do espelho, no WhatsApp do funcionário.
 *
 * Sem isso, a assinatura depende de alguém lembrar de abrir o portal no dia certo — e
 * ninguém lembra. O espelho fecha, o mês passa, e a ciência que daria valor ao controle
 * simplesmente não acontece.
 *
 * Dois avisos diferentes:
 *  - "seu espelho fechou, confira e assine" — para quem ainda não assinou o mês anterior;
 *  - "o espelho mudou depois que você assinou" — quando o gestor corrigiu algo em seguida,
 *    e a ciência anterior deixou de valer para o documento atual.
 *
 * O primeiro sai três vezes ao longo do mês (dias 3, 10 e 17) e para por aí: cobrar todo
 * dia vira ruído, e quem não assinou depois de três lembretes precisa de conversa, não de
 * mais mensagem. O segundo é atrelado ao hash — cada alteração nova gera um aviso, a
 * mesma alteração nunca repete.
 */

import prisma from '../db';
import { getTodayStrBRT } from '../utils/dateUtils';
import { resolverCargaHorariaDia, cargaDaJornada } from '../utils/dpPontoUtils';
import {
  montarSnapshot, hashDoSnapshot, estadoDaAssinatura,
  competenciaAnterior, nomeDaCompetencia,
} from './dpAssinaturaService';
import { destinoWppFuncionario } from './dpPontoNotifier';
import { botSend } from './botServiceClient';

const DIAS_DE_LEMBRETE = [3, 10, 17];

function linkDoPortal(token: string | null): string {
  if (!token) return '';
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return base ? `\n\n${base}/p/${token}` : '';
}

async function jaAvisou(empresaId: string, chave: string): Promise<boolean> {
  const existe = await (prisma as any).notificacaoEnviada.findUnique({
    where: { empresaId_tipo_chave: { empresaId, tipo: 'DP_ASSINATURA', chave } },
    select: { id: true },
  });
  return !!existe;
}

async function marcarAvisado(empresaId: string, chave: string): Promise<void> {
  await (prisma as any).notificacaoEnviada.upsert({
    where: { empresaId_tipo_chave: { empresaId, tipo: 'DP_ASSINATURA', chave } },
    create: { empresaId, tipo: 'DP_ASSINATURA', chave },
    update: {},
  });
}

/** Envia e só então marca: bot fora do ar não consome o lembrete do dia. */
async function avisar(empresaId: string, funcionarioId: string, chave: string, texto: string): Promise<void> {
  if (await jaAvisou(empresaId, chave)) return;
  const destino = await destinoWppFuncionario(funcionarioId);
  if (!destino) return; // sem WhatsApp: esse funcionário assina pelo totem
  await botSend(destino, texto);
  await marcarAvisado(empresaId, chave);
}

export async function rodarLembretesAssinatura(): Promise<void> {
  const hoje = getTodayStrBRT();
  const diaDoMes = Number(hoje.slice(8));
  const competencia = competenciaAnterior(hoje);
  const mesPorExtenso = nomeDaCompetencia(competencia);

  const empresas = await prisma.empresaSistema.findMany({
    where: { sistema: 'data-point', ativo: true },
    select: { empresaId: true, config: true },
  });

  for (const emp of empresas) {
    try {
      const cfg = emp.config ? JSON.parse(emp.config as string) : {};
      const cargaDaEmpresa = cargaDaJornada(cfg.jornadaEntrada, cfg.jornadaSaida, cfg.intervaloMin);

      const funcionarios = await prisma.dpFuncionario.findMany({
        where: { empresaId: emp.empresaId, status: 'ATIVO' },
        select: {
          id: true, nome: true, cargaHorariaDia: true, linkToken: true, lavadorId: true,
          cargoRef: { select: { cargaHorariaDia: true } },
        },
      });

      for (const func of funcionarios) {
        const cargaEsperadaMin = resolverCargaHorariaDia(
          func.cargaHorariaDia, func.cargoRef?.cargaHorariaDia, cargaDaEmpresa,
        ) * 60;

        const snapshot = await montarSnapshot(emp.empresaId, { id: func.id, cargaEsperadaMin }, competencia, cfg);

        // Mês sem nenhuma batida não tem o que conferir — normalmente é gente que entrou
        // depois, ou período anterior à adoção do sistema.
        if (snapshot.marcacoes.length === 0) continue;

        const hash = hashDoSnapshot(snapshot);
        const estado = await estadoDaAssinatura(func.id, competencia, hash);
        const primeiroNome = (func.nome || '').trim().split(/\s+/)[0] || 'você';
        const link = linkDoPortal(func.linkToken);

        if (!estado) {
          if (!DIAS_DE_LEMBRETE.includes(diaDoMes)) continue;
          await avisar(
            emp.empresaId, func.id, `${func.id}:${competencia}:pendente:${diaDoMes}`,
            `📋 Oi, ${primeiroNome}! Seu espelho de ponto de *${mesPorExtenso}* está fechado ` +
            `e esperando sua conferência.\n\nDá uma olhada nos dias e assine quando puder — ` +
            `se algo estiver errado, é só pedir ajuste por ali mesmo.${link}\n\n` +
            `Se preferir, você também pode conferir e assinar no totem da empresa, ` +
            `depois de bater o ponto.`,
          ).catch((e) => console.error('[dp-assinatura] lembrete pendente:', e));
          continue;
        }

        if (!estado.atual) {
          const quando = estado.assinadoEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
          await avisar(
            emp.empresaId, func.id, `${func.id}:${competencia}:alterado:${hash.slice(0, 12)}`,
            `📋 Oi, ${primeiroNome}! Um registro de *${mesPorExtenso}* foi alterado depois ` +
            `que você assinou (em ${quando}).\n\nConfira o que mudou e assine de novo — ` +
            `sua assinatura anterior continua guardada.${link}`,
          ).catch((e) => console.error('[dp-assinatura] lembrete alterado:', e));
        }
      }
    } catch (error) {
      console.error(`[dp-assinatura] empresa ${emp.empresaId}:`, error);
    }
  }
}
