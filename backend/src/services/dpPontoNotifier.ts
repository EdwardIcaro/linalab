import prisma from '../db';
import { botSend } from './botServiceClient';

/**
 * Notificação de ponto no WhatsApp do próprio funcionário.
 *
 * O número pode estar em dois lugares distintos, dependendo de como a pessoa
 * vinculou o WhatsApp ao bot:
 *
 *  - `dpFuncionario.wppJid`  → funcionário standalone do Data Point (o bot grava
 *    aqui quando ele manda "conectar CODIGO" e não existe Lavador com o código).
 *  - `lavador.telefone`      → quem também é Lavador do Lina Wash (caminho mais
 *    comum): o bot grava o telefone no Lavador e o `wppJid` do DpFuncionario
 *    vinculado fica nulo.
 *
 * Notificar só por `wppJid` deixava justamente o caso mais comum sem aviso, por
 * isso o fallback pelo `lavadorId` aqui.
 */
export async function destinoWppFuncionario(funcionarioId: string): Promise<string | null> {
  const func = await prisma.dpFuncionario.findUnique({
    where: { id: funcionarioId },
    select: { wppJid: true, lavadorId: true },
  });
  if (!func) return null;
  if (func.wppJid) return func.wppJid;

  if (func.lavadorId) {
    const lavador = await prisma.lavador.findUnique({
      where: { id: func.lavadorId },
      select: { telefone: true },
    });
    if (lavador?.telefone) return lavador.telefone;
  }
  return null;
}

/**
 * Envia a confirmação de ponto. Fire-and-forget: falha de bot/rede nunca pode
 * derrubar o registro do ponto, que já foi persistido antes da chamada.
 */
export async function notificarPontoRegistrado(
  funcionarioId: string,
  tipo: 'ENTRADA' | 'SAIDA',
  horaFormatada: string,
  alerta = '',
): Promise<void> {
  try {
    const destino = await destinoWppFuncionario(funcionarioId);
    if (!destino) return;

    const emoji = tipo === 'ENTRADA' ? '✅' : '👋';
    await botSend(destino, `${emoji} *${tipo}* registrada às ${horaFormatada}!${alerta}`);
  } catch (e) {
    console.error('[dpPonto] notificarPontoRegistrado:', e);
  }
}
