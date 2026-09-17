import prisma from '../db';
import { descriptografar, aadDaConta, chaveConfigurada } from '../utils/credCrypto';
import { buscarNovos, ErroImap } from './emailImapService';
import { resolverDestinos, enfileirarEnvios, DestinoRegra } from './emailAutomacaoFila';
import { subscriptionService } from './subscriptionService';

/**
 * Leitura das caixas de email dos clientes (automação de email).
 *
 * Roda NO SERVIDOR (não no bot) para a chave que abre as senhas ficar só aqui.
 * O que casa com uma regra vira mensagem na fila `whatsapp_envios`, que o bot envia.
 *
 * Privacidade: nada do email é gravado. Os logs levam só ids e contagens —
 * nunca remetente, assunto, corpo ou o valor capturado.
 */

const INTERVALO_MS = 30_000;
const MAX_CONTAS_POR_CICLO = 3;   // conexões IMAP simultâneas
const MAX_VALOR = 100;            // corta o valor capturado: regex ampla não vira vazamento do email

let rodando = false;

/** Aplica a regra no texto e devolve a mensagem pronta, ou null se não casar. */
function montarMensagem(
  regra: { remetenteContem: string; assuntoContem: string | null; regexExtracao: string; template: string },
  email: { de: string; assunto: string; texto: string }
): string | null {
  const de = (email.de || '').toLowerCase();
  if (!de.includes(regra.remetenteContem.toLowerCase())) return null;
  if (regra.assuntoContem && !(email.assunto || '').toLowerCase().includes(regra.assuntoContem.toLowerCase())) return null;

  let match: RegExpMatchArray | null = null;
  try {
    match = (email.texto || '').match(new RegExp(regra.regexExtracao, 'i'));
  } catch {
    return null; // regex inválida: a validação da rota já impede, mas nunca derruba o ciclo
  }
  if (!match) return null;

  const valor = String(match[1] ?? match[0]).slice(0, MAX_VALOR);
  return regra.template.replace(/\{\{valor\}\}/g, valor);
}

async function processarConta(conta: {
  id: string; empresaId: string; email: string; senhaCriptografada: string;
  ultimoUid: number | null; uidValidity: string | null;
}): Promise<void> {
  const regras = await prisma.emailRegra.findMany({
    where: { contaId: conta.id, empresaId: conta.empresaId, ativo: true },
  });
  if (!regras.length) return;

  let senha: string;
  try {
    senha = descriptografar(conta.senhaCriptografada, aadDaConta(conta.empresaId, conta.id));
  } catch (err) {
    console.error(`[EmailAutomacao] Conta ${conta.id}: não foi possível abrir a credencial.`);
    return;
  }

  try {
    const { uidValidity, ultimoUid, mensagens } = await buscarNovos(conta.email, senha, {
      ultimoUid: conta.ultimoUid,
      uidValidity: conta.uidValidity,
    });

    // 1º ciclo (ou caixa recriada): só marca o ponto de partida, sem processar histórico
    if (conta.ultimoUid === null || conta.uidValidity !== uidValidity) {
      await prisma.emailConta.update({ where: { id: conta.id }, data: { ultimoUid, uidValidity } });
      console.log(`[EmailAutomacao] Conta ${conta.id}: ponto de partida definido (UID ${ultimoUid}).`);
      return;
    }

    // Avança o checkpoint POR MENSAGEM, não só uma vez no fim do lote inteiro: se o
    // processo reiniciar no meio (ex: deploy do backend), o próximo ciclo não reprocessa
    // nem reenvia o que já foi tratado. Mesma classe de bug do resumo diário duplicado
    // em 16/09/2026 — lá a trava vivia em memória; aqui era o checkpoint só no fim do lote.
    let ultimoProcessado = conta.ultimoUid ?? 0;
    for (const msg of mensagens) {
      try {
        for (const regra of regras) {
          const texto = montarMensagem(regra, msg);
          if (!texto) continue;

          const alvos = await resolverDestinos(conta.empresaId, (regra.destinos ?? []) as unknown as DestinoRegra[]);
          if (!alvos.length) {
            console.warn(`[EmailAutomacao] Regra ${regra.id} casou mas está sem destinatário válido.`);
            continue;
          }

          const enfileirados = await enfileirarEnvios(conta.empresaId, alvos, texto);
          await prisma.emailRegra.update({
            where: { id: regra.id },
            data: { totalDisparos: { increment: 1 }, ultimoDisparoEm: new Date() },
          });
          console.log(`[EmailAutomacao] Regra ${regra.id} disparada — ${enfileirados} envio(s) na fila.`);
        }
      } catch (err) {
        // Um email com falha (ex: erro ao resolver destino) não pode travar os seguintes
        console.error(`[EmailAutomacao] Conta ${conta.id}: erro ao processar email UID ${msg.uid}:`, err instanceof Error ? err.message : err);
      } finally {
        ultimoProcessado = Math.max(ultimoProcessado, msg.uid);
        await prisma.emailConta.update({ where: { id: conta.id }, data: { ultimoUid: ultimoProcessado, uidValidity } }).catch(() => {});
      }
    }
  } catch (err) {
    if (err instanceof ErroImap && err.tipo === 'CREDENCIAL_INVALIDA') {
      // Para de tentar: insistir com senha recusada faz o Google bloquear a conta
      await prisma.emailConta.update({
        where: { id: conta.id },
        data: {
          status: 'ERRO',
          ultimoErro: 'A senha de app foi recusada pelo Google. Troque a senha pra voltar a funcionar.',
        },
      });
      console.warn(`[EmailAutomacao] Conta ${conta.id} pausada: credencial recusada.`);
      return;
    }
    console.error(`[EmailAutomacao] Conta ${conta.id}: falha no ciclo (${err instanceof Error ? err.message : 'desconhecida'}).`);
  }
}

/** Empresa perdeu o plano → pausa em vez de continuar lendo email de quem não paga. */
async function temPlano(empresaId: string): Promise<boolean> {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { usuarioId: true } });
  if (!empresa) return false;
  const acesso = await subscriptionService.hasFeatureAccess(empresa.usuarioId, 'lina_whatsapp');
  return acesso.hasAccess;
}

async function ciclo(): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    const contas = await prisma.emailConta.findMany({
      where: { status: 'CONECTADO', regras: { some: { ativo: true } } },
      select: { id: true, empresaId: true, email: true, senhaCriptografada: true, ultimoUid: true, uidValidity: true },
    });
    if (!contas.length) return;

    for (let i = 0; i < contas.length; i += MAX_CONTAS_POR_CICLO) {
      const lote = contas.slice(i, i + MAX_CONTAS_POR_CICLO);
      await Promise.all(lote.map(async (conta) => {
        if (!(await temPlano(conta.empresaId))) {
          await prisma.emailConta.update({
            where: { id: conta.id },
            data: { status: 'PAUSADO_PLANO', ultimoErro: 'A automação de email faz parte do plano Premium.' },
          });
          return;
        }
        await processarConta(conta);
      }));
    }
  } catch (err) {
    console.error('[EmailAutomacao] Erro no ciclo:', err instanceof Error ? err.message : err);
  } finally {
    rodando = false;
  }
}

export function iniciarEmailAutomacaoPoller(): void {
  if (!chaveConfigurada()) {
    console.error('[EmailAutomacao] EMAIL_CRED_KEY ausente — leitura de email NÃO foi iniciada.');
    return;
  }
  console.log(`[EmailAutomacao] Leitura de email ativa (a cada ${INTERVALO_MS / 1000}s).`);
  setInterval(() => { ciclo().catch(() => { /* já logado dentro do ciclo */ }); }, INTERVALO_MS);
}
