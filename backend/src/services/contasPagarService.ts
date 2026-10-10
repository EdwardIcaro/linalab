import prisma from '../db';
import { botGetStatus } from './botServiceClient';
import { notifyAdmins, notifyByPermission } from './whatsappNotificationService';
import { getTodayStrBRT } from '../utils/dateUtils';

/**
 * CONTAS A PAGAR — regras de data e o lembrete diário no WhatsApp.
 * Datas de vencimento são "dias" (sem hora): gravadas ao meio-dia UTC para não
 * escorregarem de fuso, e comparadas com o "hoje" em BRT.
 */

export const TIPOS_CONTA = ['AVULSA', 'MENSAL', 'A_PRAZO'] as const;
export type TipoConta = typeof TIPOS_CONTA[number];

/** 'YYYY-MM-DD' → Date ao meio-dia UTC */
export function diaParaDate(dia: string): Date {
  return new Date(`${dia.slice(0, 10)}T12:00:00.000Z`);
}

/** Date → 'YYYY-MM-DD' (usa a parte UTC, coerente com diaParaDate) */
export function dateParaDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Soma dias a um 'YYYY-MM-DD' */
export function somarDias(dia: string, dias: number): string {
  const d = diaParaDate(dia);
  d.setUTCDate(d.getUTCDate() + dias);
  return dateParaDia(d);
}

/** Dias corridos de hoje (BRT) até o vencimento; negativo = vencida */
export function diasAteVencimento(vencimento: Date, hoje = getTodayStrBRT()): number {
  return Math.round((diaParaDate(dateParaDia(vencimento)).getTime() - diaParaDate(hoje).getTime()) / 86400000);
}

/** Vencimento de uma conta mensal num mês: dia pedido, limitado ao último dia do mês */
export function vencimentoMensal(ano: number, mes1a12: number, diaMensal: number): string {
  const ultimo = new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();
  const dia = Math.min(Math.max(1, diaMensal), ultimo);
  return `${ano}-${String(mes1a12).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Próximo vencimento de uma mensal a partir do vencimento atual */
export function proximoVencimentoMensal(vencimentoAtual: Date, diaMensal: number): string {
  const [ano, mes] = dateParaDia(vencimentoAtual).split('-').map(Number);
  const proxAno = mes === 12 ? ano + 1 : ano;
  const proxMes = mes === 12 ? 1 : mes + 1;
  return vencimentoMensal(proxAno, proxMes, diaMensal);
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d: Date) => dateParaDia(d).split('-').reverse().slice(0, 2).join('/');

/**
 * Lembrete diário (08:00 BRT, com retry): para cada empresa, junta numa mensagem
 * as contas que vencem hoje e as que estão no "X dias antes" configurado em cada uma.
 * Vai para o dono (WhatsApp admin) e para as subcontas com ver_financeiro.
 * Dedup durável por empresa+dia em notificacoes_enviadas (deploy no meio não duplica).
 */
export async function cronLembreteContasPagar(): Promise<void> {
  try {
    const bot = await botGetStatus();
    if (bot.status !== 'connected') return; // não marca como enviado: o retry tenta de novo
  } catch { return; }

  const hoje = getTodayStrBRT();
  try {
    // Janela: de hoje até 31 dias à frente (lembrete máximo configurável é 30 dias)
    const contas = await prisma.contaPagar.findMany({
      where: {
        status: 'PENDENTE',
        vencimento: { gte: diaParaDate(hoje), lte: diaParaDate(somarDias(hoje, 31)) },
      },
      select: { empresaId: true, descricao: true, valor: true, vencimento: true, lembrarDiasAntes: true },
      orderBy: { vencimento: 'asc' },
    });

    const porEmpresa = new Map<string, { hoje: typeof contas; antes: typeof contas }>();
    for (const c of contas) {
      const d = diasAteVencimento(c.vencimento, hoje);
      const grupo = porEmpresa.get(c.empresaId) || { hoje: [], antes: [] };
      if (d === 0) grupo.hoje.push(c);
      else if (c.lembrarDiasAntes > 0 && d === c.lembrarDiasAntes) grupo.antes.push(c);
      else continue;
      porEmpresa.set(c.empresaId, grupo);
    }

    for (const [empresaId, grupo] of porEmpresa) {
      const ja = await prisma.notificacaoEnviada.findUnique({
        where: { empresaId_tipo_chave: { empresaId, tipo: 'CONTAS_PAGAR', chave: hoje } },
        select: { id: true },
      });
      if (ja) continue;

      const linhas: string[] = ['🔔 *Contas a pagar*'];
      if (grupo.hoje.length) {
        linhas.push('', '*Vencem hoje:*');
        grupo.hoje.forEach(c => linhas.push(`• ${c.descricao} — *${brl(c.valor)}*`));
      }
      if (grupo.antes.length) {
        linhas.push('', '*Vencem em breve:*');
        grupo.antes.forEach(c => linhas.push(`• ${c.descricao} — ${brl(c.valor)} · vence ${dataBR(c.vencimento)} (em ${diasAteVencimento(c.vencimento, hoje)} dias)`));
      }
      const total = [...grupo.hoje, ...grupo.antes].reduce((s, c) => s + c.valor, 0);
      linhas.push('', `Total: *${brl(total)}*`);
      const msg = linhas.join('\n');

      await notifyAdmins(empresaId, msg);
      await notifyByPermission(empresaId, 'ver_financeiro', msg);
      await prisma.notificacaoEnviada.upsert({
        where: { empresaId_tipo_chave: { empresaId, tipo: 'CONTAS_PAGAR', chave: hoje } },
        create: { empresaId, tipo: 'CONTAS_PAGAR', chave: hoje },
        update: {},
      });
    }
  } catch (e) {
    console.error('[ContasPagar] cronLembrete:', e);
  }
}
