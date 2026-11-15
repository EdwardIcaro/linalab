import prisma from '../db';
import { sendMessage, getStatus } from './baileyService';
import { getEmpresaStatus, sendEmpresaMessage } from './empresaWaService';

/**
 * Consumidor da fila `whatsapp_envios`.
 *
 * O backend enfileira a mensagem e o bot envia pelo número da Lina (automação de email)
 * ou pelo número da empresa (acompanhamento do veículo).
 * Assim a chave que descriptografa as senhas dos clientes fica só no servidor, e o envio
 * não depende do ngrok — o bot lê do banco no mesmo laço de 5s que já existe.
 */

const LOTE = 20;
const MAX_TENTATIVAS = 3;
// Mensagem pelo número da empresa que não saiu em 2 h (WhatsApp desconectado) perde o sentido
const VALIDADE_EMPRESA_MS = 2 * 60 * 60 * 1000;

type Envio = {
  id: string; empresaId: string; destino: string; texto: string; tentativas: number;
  canal: string; origem: string; ordemId: string | null; enviarApos: Date | null; createdAt: Date;
};

/**
 * canal LINA    → número da Lina (automação de e-mail)
 * canal EMPRESA → número da própria empresa (acompanhamento do veículo, 15/11/2026);
 *                 respeita `enviarApos` e, ao entregar o link, marca a ordem como enviada.
 */
let rodando = false; // o laço de 5s não pode sobrepor um lote ainda em envio (mandaria em dobro)

export async function processarFilaEnvios(): Promise<void> {
  if (rodando) return;
  rodando = true;
  try { await processarLote(); } finally { rodando = false; }
}

async function processarLote(): Promise<void> {
  const linaOk = getStatus() === 'connected';

  let pendentes: Envio[] = [];
  try {
    pendentes = await (prisma as any).whatsappEnvio.findMany({
      where: {
        status: 'PENDENTE',
        tentativas: { lt: MAX_TENTATIVAS },
        canal: { in: linaOk ? ['LINA', 'EMPRESA'] : ['EMPRESA'] },
        OR: [{ enviarApos: null }, { enviarApos: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      take: LOTE,
      select: { id: true, empresaId: true, destino: true, texto: true, tentativas: true, canal: true, origem: true, ordemId: true, enviarApos: true, createdAt: true },
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
    const daEmpresa = envio.canal === 'EMPRESA';
    if (daEmpresa && getEmpresaStatus(envio.empresaId).status !== 'CONECTADO') {
      const desde = (envio.enviarApos ?? envio.createdAt).getTime();
      if (Date.now() - desde > VALIDADE_EMPRESA_MS) {
        await (prisma as any).whatsappEnvio.update({
          where: { id: envio.id },
          data: { status: 'ERRO', texto: '', erro: 'WhatsApp da empresa desconectado' },
        }).catch(() => {});
      }
      continue; // espera a empresa reconectar
    }
    try {
      if (daEmpresa) await sendEmpresaMessage(envio.empresaId, envio.destino, envio.texto, envio.origem);
      else await sendMessage(envio.destino, envio.texto, { empresaId: envio.empresaId, tipo: 'EMAIL_AUTOMACAO' });
      // Texto é zerado depois do envio: a fila não guarda código de acesso à toa
      await (prisma as any).whatsappEnvio.update({
        where: { id: envio.id },
        data: { status: 'ENVIADO', enviadoEm: new Date(), texto: '', tentativas: envio.tentativas + 1 },
      });
      if (envio.ordemId && envio.origem.startsWith('ACOMP_')) {
        await (prisma as any).ordemServico.updateMany({
          where: { id: envio.ordemId, acompEnviadoEm: null },
          data: { acompEnviadoEm: new Date() },
        }).catch(() => {});
      }
      console.log(`[FilaEnvio] Enviado ${envio.id} (${envio.canal})`);
      if (daEmpresa) await new Promise((r) => setTimeout(r, 1500)); // espaça os envios do número da empresa
    } catch (err: any) {
      const motivo = String(err?.message ?? err).slice(0, 200);
      // Número que não existe no WhatsApp não melhora tentando de novo
      const semVolta = /não encontrado no WhatsApp/i.test(motivo);
      const tentativas = envio.tentativas + 1;
      const desistiu = semVolta || tentativas >= MAX_TENTATIVAS;
      await (prisma as any).whatsappEnvio.update({
        where: { id: envio.id },
        data: {
          tentativas,
          // Só a mensagem do erro, sem o telefone/texto
          erro: semVolta ? 'Número não encontrado no WhatsApp' : motivo,
          ...(desistiu ? { status: 'ERRO', texto: '' } : {}),
        },
      }).catch(() => { /* se o banco cair, tenta de novo no próximo ciclo */ });
      console.error(`[FilaEnvio] Falha no envio ${envio.id} (tentativa ${tentativas}/${MAX_TENTATIVAS}): ${semVolta ? 'número não encontrado' : motivo}`);
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
