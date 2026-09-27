/**
 * Aviso agrupado de alterações na página do lavador.
 *
 * O aviso por OS funciona, mas não escala no dia a dia: a mediana real é de 4 ordens por
 * lavador por dia e o pico chega a 7, então cada lavador recebia de 4 a 7 mensagens de
 * três linhas — e as que importam (comissão fechada, observação de um carro específico)
 * se perdiam no meio. Quem recebe muita mensagem para de ler.
 *
 * Aqui a lógica inverte: o bot não narra cada ordem, ele só diz que a página mudou e
 * manda o link. O lavador abre e vê tudo de uma vez, já organizado, com os valores
 * certos — a página sempre soube contar isso melhor que uma mensagem de texto.
 *
 * Dois gatilhos, o que vier primeiro:
 *  - acumulou N ordens (a leva já vale uma ida à página);
 *  - passou X minutos desde a primeira alteração da leva (ordem única não fica esquecida).
 *
 * A pendência mora no banco, não em memória: um deploy do Railway reinicia o processo e
 * um contador em memória sumiria com o aviso — o mesmo motivo que tornou durável a trava
 * do resumo diário.
 */

import prisma from '../db';
import { botSend, botGetStatus } from './botServiceClient';

/** Padrões: 3 ordens ou meia hora. Uma leva de 3 já vale a ida; 30 min não deixa esfriar. */
const AGRUPAMENTO_PADRAO = { ordens: 3, minutos: 30 };

export type ModoAviso = 'DESLIGADO' | 'IMEDIATO' | 'AGRUPADO';

function prefsDoLavador(empresa: { notificationPreferences: any }): any {
  let np = empresa.notificationPreferences;
  if (typeof np === 'string') {
    try { np = JSON.parse(np); } catch { np = {}; }
  }
  if (!np || typeof np !== 'object') return {};
  return np.whatsappRoles?.lavador ?? {};
}

/**
 * Como esta empresa avisa o lavador de uma ordem nova.
 *
 * Ausência de configuração é DESLIGADO — diferente das notificações de admin, onde o
 * padrão é receber. O lavador só entra no WhatsApp do bot se o gestor escolher isso.
 */
export function modoDeAviso(empresa: { notificationPreferences: any }): ModoAviso {
  const notifs = prefsDoLavador(empresa).notifs;
  if (!Array.isArray(notifs)) return 'DESLIGADO';
  // Se as duas estiverem marcadas, a agrupada ganha: foi ela que o gestor pediu para
  // reduzir o volume, e mandar as duas dobraria exatamente o que se quer cortar.
  if (notifs.includes('paginaAtualizada')) return 'AGRUPADO';
  if (notifs.includes('novaOrdemAtribuida')) return 'IMEDIATO';
  return 'DESLIGADO';
}

export function configDoAgrupamento(empresa: { notificationPreferences: any }): { ordens: number; minutos: number } {
  const cfg = prefsDoLavador(empresa).agrupamento ?? {};
  const ordens = Number(cfg.ordens);
  const minutos = Number(cfg.minutos);
  return {
    ordens: Number.isFinite(ordens) && ordens >= 1 ? Math.floor(ordens) : AGRUPAMENTO_PADRAO.ordens,
    minutos: Number.isFinite(minutos) && minutos >= 5 ? Math.floor(minutos) : AGRUPAMENTO_PADRAO.minutos,
  };
}

function linkDoPortal(token: string | null): string {
  if (!token) return '';
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return base ? `${base}/p/${token}` : '';
}

function textoDoAviso(nome: string, ordens: number, link: string): string {
  const primeiroNome = nome.trim().split(/\s+/)[0];
  const quantas = ordens === 1
    ? '1 ordem nova foi atribuída a você.'
    : `${ordens} ordens novas foram atribuídas a você.`;

  let msg = `👋 Oi, ${primeiroNome}! Houve alterações na sua página.\n${quantas}`;
  if (link) msg += `\n\nAbra para conferir:\n${link}`;
  return msg;
}

/**
 * Envia o aviso e só então apaga a pendência.
 *
 * A ordem importa: se o bot estiver fora do ar, a leva continua pendente e o próximo
 * ciclo tenta de novo. Apagar antes de enviar perderia o aviso em silêncio.
 */
async function enviarAviso(pendencia: {
  id: string;
  ordens: number;
  lavador: { nome: string; telefone: string | null; linkTokenCurto: string | null };
}): Promise<void> {
  const destino = pendencia.lavador.telefone;
  if (!destino) return; // sem WhatsApp vinculado não há para onde mandar

  const texto = textoDoAviso(pendencia.lavador.nome, pendencia.ordens, linkDoPortal(pendencia.lavador.linkTokenCurto));
  await botSend(destino, texto);
  await (prisma as any).lavadorAvisoPendente.deleteMany({ where: { id: pendencia.id } });
}

/**
 * Registra que a página do lavador mudou, e avisa se a leva já ficou grande.
 *
 * Chamado no mesmo ponto onde antes saía uma mensagem por ordem. Lavador sem telefone
 * vinculado é ignorado: acumular pendência para quem não tem destino só sujaria a tabela.
 */
export async function registrarAlteracaoPagina(
  empresaId: string,
  lavadorIds: string[],
  limiteOrdens: number,
): Promise<void> {
  if (lavadorIds.length === 0) return;

  const lavadores = await prisma.lavador.findMany({
    where: { id: { in: lavadorIds }, empresaId, ativo: true, telefone: { not: null } },
    select: { id: true, nome: true, telefone: true, linkTokenCurto: true },
  });

  for (const lav of lavadores) {
    try {
      const pendencia = await (prisma as any).lavadorAvisoPendente.upsert({
        where: { lavadorId: lav.id },
        create: { empresaId, lavadorId: lav.id, ordens: 1 },
        update: { ordens: { increment: 1 } },
        select: { id: true, ordens: true },
      });

      if (pendencia.ordens >= limiteOrdens) {
        await enviarAviso({ id: pendencia.id, ordens: pendencia.ordens, lavador: lav })
          .catch(e => console.error('[LavAviso] envio por volume:', e));
      }
    } catch (e) {
      console.error('[LavAviso] registrar:', e);
    }
  }
}

/**
 * Fecha as levas que já esperaram demais.
 *
 * Roda de 10 em 10 minutos na janela de expediente. Fora dela a pendência só espera: uma
 * ordem lançada às 23h vira aviso às 7h, não uma mensagem de madrugada.
 */
export async function flushAvisosPendentes(): Promise<void> {
  try {
    const bot = await botGetStatus();
    if (bot.status !== 'connected') return;
  } catch {
    return;
  }

  const pendencias = await (prisma as any).lavadorAvisoPendente.findMany({
    select: {
      id: true, ordens: true, desdeEm: true, empresaId: true,
      lavador: { select: { nome: true, telefone: true, linkTokenCurto: true } },
    },
  }) as Array<{
    id: string; ordens: number; desdeEm: Date; empresaId: string;
    lavador: { nome: string; telefone: string | null; linkTokenCurto: string | null };
  }>;
  if (pendencias.length === 0) return;

  // A janela de espera é por empresa: buscamos uma vez cada, não uma por pendência.
  const janelaPorEmpresa = new Map<string, number>();
  const agora = Date.now();

  for (const pen of pendencias) {
    try {
      let minutos = janelaPorEmpresa.get(pen.empresaId);
      if (minutos === undefined) {
        const empresa = await prisma.empresa.findUnique({
          where: { id: pen.empresaId },
          select: { notificationPreferences: true },
        });
        // Empresa que trocou de modo no meio da leva: a pendência deixa de fazer sentido.
        minutos = empresa && modoDeAviso(empresa) === 'AGRUPADO'
          ? configDoAgrupamento(empresa).minutos
          : -1;
        janelaPorEmpresa.set(pen.empresaId, minutos);
      }

      if (minutos < 0) {
        await (prisma as any).lavadorAvisoPendente.deleteMany({ where: { id: pen.id } });
        continue;
      }

      if (agora - pen.desdeEm.getTime() >= minutos * 60_000) {
        await enviarAviso(pen);
      }
    } catch (e) {
      console.error('[LavAviso] flush:', e);
    }
  }
}
