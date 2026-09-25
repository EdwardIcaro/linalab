/**
 * Data Point — lembrete de ponto e encerramento automático do turno.
 *
 * Duas coisas que o sistema não fazia e o gestor vinha cobrindo na mão (12 marcações
 * MANUAIS até 09/2026, quase todas "saída 18:00"):
 *
 *  1. Lembrar o funcionário, com jeito, quando ele entrou e esqueceu de bater a saída.
 *  2. Fechar o turno que ninguém fechou, em vez de deixar o dia correr até a meia-noite.
 *
 * A ordem importa: o lembrete vem primeiro e dá chance da pessoa resolver sozinha; o
 * encerramento automático é o último recurso, e sempre avisa o gestor pra conferir.
 * O ponto encerrado assim fica gravado com canal AUTO e `ajustado: true` — nunca se
 * passa por uma batida real do funcionário.
 */

import prisma from '../db';
import { getTodayStrBRT, getDateRangeBRT } from '../utils/dateUtils';
import {
  isDiaFechado,
  resolveFeriadoDia,
  resolveAfastamentoDia,
  decidirAcaoPonto,
} from '../utils/dpPontoUtils';
import { destinoWppFuncionario } from './dpPontoNotifier';
import { botSend } from './botServiceClient';
import { notifyAdmins, notifyByPermission, permissaoRecebe } from './whatsappNotificationService';
import { logarMarcacao, SISTEMA } from './dpAuditoriaService';

function horaParaMin(horaStr: string): number {
  const [h, m] = (horaStr || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minParaHora(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function horaBRT(d: Date): string {
  return new Date(d.getTime() - 3 * 3600000).toISOString().slice(11, 16);
}

function primeiroNome(nome: string): string {
  return (nome || '').trim().split(/\s+/)[0] || 'você';
}

/** Uma mensagem por funcionário, por dia, por motivo — sobrevive a restart do backend. */
async function jaAvisou(empresaId: string, chave: string): Promise<boolean> {
  const existe = await (prisma as any).notificacaoEnviada.findUnique({
    where: { empresaId_tipo_chave: { empresaId, tipo: 'DP_PONTO', chave } },
    select: { id: true },
  });
  return !!existe;
}

async function marcarAvisado(empresaId: string, chave: string): Promise<void> {
  await (prisma as any).notificacaoEnviada.upsert({
    where: { empresaId_tipo_chave: { empresaId, tipo: 'DP_PONTO', chave } },
    create: { empresaId, tipo: 'DP_PONTO', chave },
    update: {},
  });
}

/**
 * Envia e só então registra o envio: se o bot estiver fora do ar, a marca não é gravada
 * e a próxima rodada (30 min depois) tenta de novo, em vez de engolir o aviso.
 */
async function avisarFuncionario(
  empresaId: string, funcionarioId: string, chave: string, texto: string,
): Promise<void> {
  if (await jaAvisou(empresaId, chave)) return;
  const destino = await destinoWppFuncionario(funcionarioId);
  if (!destino) return; // sem WhatsApp vinculado — nada a enviar, e nada a marcar
  await botSend(destino, texto);
  await marcarAvisado(empresaId, chave);
}

export async function rodarPontoPendente(): Promise<void> {
  const empresas = await prisma.empresaSistema.findMany({
    where: { sistema: 'data-point', ativo: true },
    select: { empresaId: true, config: true },
  });
  if (empresas.length === 0) return;

  const dia = getTodayStrBRT();
  const diaSemana = new Date(dia + 'T12:00:00').getDay();
  const { start: inicioDia, end: fimDia } = getDateRangeBRT(dia);
  const agoraMin = Math.floor((Date.now() - inicioDia.getTime()) / 60000);

  for (const emp of empresas) {
    try {
      const cfg = emp.config ? JSON.parse(emp.config as string) : {};
      const diasFuncionamento: number[] = cfg.diasFuncionamento ?? [1, 2, 3, 4, 5];
      if (isDiaFechado(diaSemana, diasFuncionamento)) continue;

      const feriados = await prisma.dpFeriado.findMany({
        where: { empresaId: emp.empresaId },
        select: { data: true, nome: true, recorrente: true },
      });
      if (resolveFeriadoDia(dia, feriados)) continue;

      const saidaMin = horaParaMin(cfg.jornadaSaida || '17:00');
      const fechaSozinho = (cfg.modoEncerramento ?? 'AUTOMATICO') === 'AUTOMATICO';

      const funcionarios = await prisma.dpFuncionario.findMany({
        where: { empresaId: emp.empresaId, status: 'ATIVO' },
        select: {
          id: true, nome: true,
          marcacoes: {
            where: { timestamp: { gte: inicioDia, lte: fimDia }, excluidaEm: null },
            select: { tipo: true, timestamp: true },
            orderBy: { timestamp: 'asc' },
          },
        },
        orderBy: { nome: 'asc' },
      });
      if (funcionarios.length === 0) continue;

      const afastamentos = await prisma.dpAfastamento.findMany({
        where: { empresaId: emp.empresaId, funcionarioId: { in: funcionarios.map(f => f.id) } },
        select: { funcionarioId: true, tipo: true, dataInicio: true, dataFim: true },
      });

      const encerrados: string[] = [];
      const paraCorrigir: string[] = [];

      for (const func of funcionarios) {
        if (resolveAfastamentoDia(func.id, dia, afastamentos)) continue;

        const nome = primeiroNome(func.nome);
        const aberta = func.marcacoes[func.marcacoes.length - 1];

        const acao = decidirAcaoPonto({
          marcacoes: func.marcacoes,
          inicioDiaMs: inicioDia.getTime(),
          agoraMin,
          saidaMin,
          fechaSozinho,
        });
        if (acao === 'NADA') continue;

        if (acao === 'LEMBRAR_SAIDA') {
          await avisarFuncionario(
            emp.empresaId, func.id, `${func.id}:${dia}:SAIDA`,
            `⏰ Oi, ${nome}! Seu ponto está aberto desde as ${horaBRT(aberta.timestamp)}. ` +
            `Não esquece de bater a saída, viu? 🙂`,
          ).catch(e => console.error('[dp-ponto] aviso saida:', e));
          continue;
        }

        if (acao === 'CORRIGIR_MANUAL') {
          paraCorrigir.push(`• *${func.nome}* — aberto desde ${horaBRT(aberta.timestamp)}`);
          continue;
        }

        // ENCERRAR: lança a saída no horário da jornada, marcada como automática
        const timestamp = new Date(inicioDia.getTime() + saidaMin * 60000);
        try {
          const criada = await prisma.dpMarcacao.create({
            data: {
              empresaId: emp.empresaId,
              funcionarioId: func.id,
              tipo: 'SAIDA',
              canal: 'AUTO',
              timestamp,
              ajustado: true,
            },
          });
          await logarMarcacao({
            empresaId: emp.empresaId, marcacaoId: criada.id, funcionarioId: func.id,
            acao: 'CRIADA_AUTO',
            autor: SISTEMA,
            depois: { tipo: 'SAIDA', timestamp },
            motivo: `Turno aberto desde ${horaBRT(aberta.timestamp)}, encerrado no horário da jornada`,
          });
        } catch (e: any) {
          // Já existe batida nesse minuto (o gestor acabou de corrigir): nada a fazer
          if (e?.code === 'P2002') continue;
          throw e;
        }
        encerrados.push(
          `• *${func.nome}* — entrada ${horaBRT(aberta.timestamp)}, saída lançada ${minParaHora(saidaMin)}`
        );

        const destino = await destinoWppFuncionario(func.id);
        if (destino) {
          await botSend(
            destino,
            `🔒 ${nome}, seu ponto de hoje ficou aberto e foi encerrado automaticamente às ` +
            `${minParaHora(saidaMin)}, que é o horário de saída da empresa.\n\n` +
            `Se você saiu em outro horário, fale com o gestor que ele ajusta.`,
          ).catch(e => console.error('[dp-ponto] aviso encerramento:', e));
        }
      }

      if (encerrados.length || paraCorrigir.length) {
        const partes = ['⏰ *Ponto — pendências de hoje*'];
        if (encerrados.length) {
          partes.push('', '🔒 Encerrados automaticamente:', ...encerrados);
        }
        if (paraCorrigir.length) {
          partes.push('', '✏️ Precisam de correção manual:', ...paraCorrigir);
        }
        partes.push('', 'Confira em Data Point → Espelho.');
        const texto = partes.join('\n');
        await notifyAdmins(emp.empresaId, texto, 'pontoPendente')
          .catch(e => console.error('[dp-ponto] aviso gestor:', e));
        // Quem acompanha a equipe no dia a dia costuma não ser quem está na lista de
        // admins do bot — é quem tem a permissão de ver o Data Point.
        if (await permissaoRecebe(emp.empresaId, 'ver_data_point_equipe', 'pontoPendente')) {
          await notifyByPermission(emp.empresaId, 'ver_data_point_equipe', texto)
            .catch(e => console.error('[dp-ponto] aviso equipe:', e));
        }
      }
    } catch (error) {
      console.error(`[dp-ponto] empresa ${emp.empresaId}:`, error);
    }
  }
}
