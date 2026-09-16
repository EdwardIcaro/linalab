import prisma from '../db';
import { sendMessage, getStatus } from './baileyService';

/**
 * Consumidor da fila `whatsapp_envios`.
 *
 * O backend enfileira a mensagem (automação de email) e o bot envia pelo número da Lina.
 * Assim a chave que descriptografa as senhas dos clientes fica só no servidor, e o envio
 * não depende do ngrok — o bot lê do banco no mesmo laço de 5s que já existe.
 */

const LOTE = 20;
const MAX_TENTATIVAS = 3;

export async function processarFilaEnvios(): Promise<void> {
  // Sem WhatsApp conectado não adianta consumir: a mensagem voltaria como erro
  if (getStatus() !== 'connected') return;

  let pendentes: { id: string; destino: string; texto: string; tentativas: number }[] = [];
  try {
    pendentes = await (prisma as any).whatsappEnvio.findMany({
      where: { status: 'PENDENTE', tentativas: { lt: MAX_TENTATIVAS } },
      orderBy: { createdAt: 'asc' },
      take: LOTE,
      select: { id: true, destino: true, texto: true, tentativas: true },
    });
  } catch (err: any) {
    // P1017 = Neon fechou conexão ociosa — reconecta e tenta no próximo ciclo
    if (err?.code === 'P1017') {
      await prisma.$disconnect();
      await prisma.$connect();
    } else {
      console.error('[FilaEnvio] Erro ao ler a fila:', err?.message ?? err);
    }
    return;
  }

  for (const envio of pendentes) {
    try {
      await sendMessage(envio.destino, envio.texto);
      // Texto é zerado depois do envio: a fila não guarda código de acesso à toa
      await (prisma as any).whatsappEnvio.update({
        where: { id: envio.id },
        data: { status: 'ENVIADO', enviadoEm: new Date(), texto: '', tentativas: envio.tentativas + 1 },
      });
      console.log(`[FilaEnvio] Enviado ${envio.id}`);
    } catch (err: any) {
      const tentativas = envio.tentativas + 1;
      const desistiu = tentativas >= MAX_TENTATIVAS;
      // Só a mensagem do erro, sem o texto da mensagem (que pode ter código)
      const motivo = String(err?.message ?? err).slice(0, 200);
      await (prisma as any).whatsappEnvio.update({
        where: { id: envio.id },
        data: {
          tentativas,
          erro: motivo,
          ...(desistiu ? { status: 'ERRO', texto: '' } : {}),
        },
      }).catch(() => { /* se o banco cair, tenta de novo no próximo ciclo */ });
      console.error(`[FilaEnvio] Falha no envio ${envio.id} (tentativa ${tentativas}/${MAX_TENTATIVAS}): ${motivo}`);
    }
  }
}

/** Limpa envios antigos — roda 1x por dia, junto do cron de limpeza que já existe. */
export async function limparEnviosAntigos(dias = 7): Promise<void> {
  try {
    const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const { count } = await (prisma as any).whatsappEnvio.deleteMany({
      where: { createdAt: { lt: limite }, status: { in: ['ENVIADO', 'ERRO'] } },
    });
    if (count > 0) console.log(`[FilaEnvio] ${count} envios antigos removidos`);
  } catch (err: any) {
    console.error('[FilaEnvio] Erro ao limpar envios antigos:', err?.message ?? err);
  }
}
