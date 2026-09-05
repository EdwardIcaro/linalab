/**
 * Relatório mensal de "Saúde Financeira" — roda todo dia, mas só executa o
 * trabalho de verdade no dia 1 do mês (BRT). Gera o relatório do mês recém-
 * fechado pra cada empresa ativa e manda o link pros admins pelo WhatsApp.
 */

import prisma from '../db';
import { sendMessage } from '../services/baileyService';
import { gerarRelatorioMensal } from '../services/relatorioFinanceiroService';

const PORTAL_URL = process.env.PORTAL_URL || 'https://linaforge.vercel.app';

function hojeBRT(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

export async function runRelatorioFinanceiroMensal(): Promise<void> {
  const hoje = hojeBRT();
  if (hoje.getUTCDate() !== 1) return; // só roda no dia 1 (BRT)

  const mesFechado = hoje.getUTCMonth() === 0 ? 12 : hoje.getUTCMonth();
  const anoFechado = hoje.getUTCMonth() === 0 ? hoje.getUTCFullYear() - 1 : hoje.getUTCFullYear();

  try {
    const empresas = await prisma.empresa.findMany({ where: { ativo: true }, select: { id: true } });
    console.log(`[RelatorioFinanceiro] Gerando relatório de ${anoFechado}-${String(mesFechado).padStart(2, '0')} para ${empresas.length} empresa(s)...`);

    for (const empresa of empresas) {
      try {
        const resultado = await gerarRelatorioMensal(empresa.id, anoFechado, mesFechado);
        if (!resultado) continue; // sem movimento no mês — não manda nada

        const admins = await prisma.whatsappAdminPhone.findMany({
          where: { empresaId: empresa.id, ativo: true },
          select: { jid: true, telefone: true },
        });
        if (admins.length === 0) continue;

        const link = `${PORTAL_URL}/relatorio-financeiro?token=${resultado.token}`;
        const msg = `📊 *Saúde Financeira — ${resultado.empresaNome}*\n\nSeu relatório do mês fechado está pronto (HP ${resultado.hp}/100).\n\n${link}\n\n_Link válido por 7 dias._`;

        for (const admin of admins) {
          const dest = admin.jid ?? admin.telefone;
          await sendMessage(dest, msg).catch(e => console.error(`[RelatorioFinanceiro] Erro ao enviar pra ${dest}:`, e));
        }
      } catch (e) {
        console.error(`[RelatorioFinanceiro] Erro na empresa ${empresa.id}:`, e);
      }
    }
  } catch (e) {
    console.error('[RelatorioFinanceiro] Erro geral:', e);
  }
}

/** Agenda a checagem diária às 08:00 BRT (11:00 UTC) — só faz trabalho de verdade no dia 1. */
export function scheduleRelatorioFinanceiroMensal(): void {
  const msUntilNext08h = (): number => {
    const now = new Date();
    const next = new Date();
    next.setUTCHours(11, 0, 0, 0); // 08:00 BRT
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  };

  const scheduleNext = () => {
    setTimeout(() => {
      runRelatorioFinanceiroMensal();
      setInterval(runRelatorioFinanceiroMensal, 24 * 60 * 60 * 1000);
    }, msUntilNext08h());
  };

  scheduleNext();
  console.log('[RelatorioFinanceiro] Agendado — checagem diária às 08:00 BRT (executa só no dia 1)');
}
