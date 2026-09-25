/**
 * Aviso de horas prestes a vencer.
 *
 * O prazo de compensação corre a partir do dia em que a hora foi trabalhada. Sem aviso,
 * o saldo acumula em silêncio até o dia em que vira hora extra devida com adicional —
 * e aí a empresa descobre pelo contador, não pelo sistema.
 *
 * Roda uma vez por semana: o prazo é de meses, alerta diário viraria ruído.
 */

import prisma from '../db';
import { getTodayStrBRT } from '../utils/dateUtils';
import { situacaoDoBanco, prazoDeCompensacao } from './dpBancoMovimentoService';
import { formatarHoras } from '../utils/bancoHorasFifo';
import { notifyAdmins } from './whatsappNotificationService';

const DIAS_DE_ALERTA = 45;

export async function rodarAvisoVencimentoBanco(): Promise<void> {
  const empresas = await prisma.empresaSistema.findMany({
    where: { sistema: 'data-point', ativo: true },
    select: { empresaId: true, config: true },
  });

  for (const emp of empresas) {
    try {
      const cfg = emp.config ? JSON.parse(emp.config as string) : {};
      if (cfg.bancoHorasAtivo !== true) continue;

      const prazoMeses = prazoDeCompensacao(cfg);
      const funcionarios = await prisma.dpFuncionario.findMany({
        where: { empresaId: emp.empresaId, status: 'ATIVO' },
        select: { id: true, nome: true },
        orderBy: { nome: 'asc' },
      });

      const vencidas: string[] = [];
      const aVencer: string[] = [];

      for (const f of funcionarios) {
        const st = await situacaoDoBanco(f.id, prazoMeses, DIAS_DE_ALERTA);
        if (st.horasVencidas > 0.01) {
          vencidas.push(`• *${f.nome}* — ${formatarHoras(st.horasVencidas).slice(1)} passaram do prazo`);
        } else if (st.horasAVencer > 0.01 && st.proximoVencimento) {
          const [a, m, d] = st.proximoVencimento.split('-');
          aVencer.push(`• *${f.nome}* — ${formatarHoras(st.horasAVencer).slice(1)} até ${d}/${m}`);
        }
      }

      if (!vencidas.length && !aVencer.length) continue;

      const partes = ['⏳ *Banco de horas — prazo de compensação*'];
      if (vencidas.length) {
        partes.push('', '🔴 Passaram do prazo (viram hora extra a pagar):', ...vencidas);
      }
      if (aVencer.length) {
        partes.push('', `🟡 Vencem nos próximos ${DIAS_DE_ALERTA} dias:`, ...aVencer);
      }
      partes.push('', 'Dá para compensar com folga ou pagar em folha. Veja em Data Point → Banco de horas.');

      await notifyAdmins(emp.empresaId, partes.join('\n'), 'bancoHorasVencendo')
        .catch((e) => console.error('[dp-banco] aviso:', e));
    } catch (error) {
      console.error(`[dp-banco] empresa ${emp.empresaId}:`, error);
    }
  }
}
