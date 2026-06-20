/**
 * Polling leve para confirmar ponto registrado via link (PORTAL_WPP).
 * O bot verifica a cada 3s se pontoTokenUsadoEm foi preenchido pelo backend
 * e envia a confirmação diretamente pelo sock — sem depender do ngrok.
 */

import prisma from '../db';

type SendFn = (jid: string, msg: string) => Promise<void>;

const pending = new Map<string, ReturnType<typeof setInterval>>();

function horaFormatadaBRT(ts: Date): string {
  return ts.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

export function registrarPontoPoller(
  funcId: string,
  jid: string,
  token: string,
  send: SendFn,
): void {
  // Cancela poll anterior deste funcionário (caso tipou "ponto" de novo)
  const existing = pending.get(funcId);
  if (existing) clearInterval(existing);

  const startedAt = Date.now();

  const timer = setInterval(async () => {
    // Expira após 7 min (token válido por 5 min + margem)
    if (Date.now() - startedAt > 7 * 60 * 1000) {
      clearInterval(timer);
      pending.delete(funcId);
      return;
    }

    try {
      const func = await (prisma as any).dpFuncionario.findUnique({
        where: { id: funcId },
        select: { pontoToken: true, pontoTokenUsadoEm: true },
      });

      // Token foi substituído (usuário pediu novo link)
      if (!func || func.pontoToken !== token) {
        clearInterval(timer);
        pending.delete(funcId);
        return;
      }

      // Token foi usado: backend confirmou a entrada/saída
      if (func.pontoTokenUsadoEm) {
        clearInterval(timer);
        pending.delete(funcId);

        const marcacao = await (prisma as any).dpMarcacao.findFirst({
          where: { funcionarioId: funcId, canal: 'PORTAL_WPP' },
          orderBy: { timestamp: 'desc' },
        });

        if (marcacao) {
          const hora  = horaFormatadaBRT(new Date(marcacao.timestamp));
          const emoji = marcacao.tipo === 'ENTRADA' ? '✅' : '👋';
          const label = marcacao.tipo === 'ENTRADA' ? 'Entrada' : 'Saída';
          await send(jid, `${emoji} *${label}* registrada às *${hora}*!`);
        }
      }
    } catch {
      // Ignora erros de poll silenciosamente
    }
  }, 3000);

  pending.set(funcId, timer);
}
