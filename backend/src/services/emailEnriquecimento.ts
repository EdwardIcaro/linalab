/**
 * Preenche os campos da mensagem que não vêm do email.
 *
 * Hoje só um: modelo e cor do veículo, achados pela placa no cadastro. É a alternativa
 * gratuita à consulta paga de placa — cobria ~1/3 das solicitações da frota em 09/2026 e
 * sobe sozinha a cada carro que passa pela casa.
 *
 * Mora fora do poller porque a tela também precisa: a prévia de um modelo tem que mostrar
 * a mensagem como ela vai sair de verdade, com o modelo do carro incluído.
 */

import prisma from '../db';
import { aplicarEnriquecimento, Extracao, RegraExtracao } from './emailExtracao';

/**
 * Empresas do mesmo dono.
 *
 * O cadastro de veículos é do negócio, não de uma unidade: a mesma frota passa pelas
 * duas lojas e a placa é única no sistema inteiro. Autorizado pelo dono em 22/09/2026.
 */
export async function empresasIrmas(empresaId: string): Promise<string[]> {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { usuarioId: true } });
  if (!empresa) return [empresaId];
  const irmas = await prisma.empresa.findMany({ where: { usuarioId: empresa.usuarioId }, select: { id: true } });
  return irmas.length ? irmas.map((e) => e.id) : [empresaId];
}

/** Modelo e cor de uma placa já atendida. Vazio quando o carro é novo pra casa. */
export async function veiculoConhecido(empresas: string[], placa: string): Promise<string> {
  const limpa = String(placa || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (limpa.length < 7) return '';
  // O cadastro tem algumas placas gravadas com hífen — procura das duas formas
  const comHifen = `${limpa.slice(0, 3)}-${limpa.slice(3)}`;
  const veiculo = await prisma.veiculo.findFirst({
    where: { placa: { in: [limpa, comHifen] }, cliente: { empresaId: { in: empresas } } },
    select: { modelo: true, cor: true },
  });
  return [veiculo?.modelo, veiculo?.cor].filter(Boolean).join(' ');
}

/**
 * Preenche os campos externos da extração, no lugar certo (cada item do bloco ou o
 * corpo da regra). Busca que falhar vira campo vazio: avisar a lavagem não pode
 * depender de conhecer o veículo.
 */
export async function enriquecer(
  empresaId: string,
  regra: RegraExtracao,
  lido: Extracao,
  empresas?: string[]
): Promise<void> {
  const cfg = regra.enriquecer;
  if (!cfg) return;
  const escopo = empresas ?? (await empresasIrmas(empresaId));
  const alvos = cfg.em === 'bloco' ? lido.itens : [lido.valores];
  for (const alvo of alvos) {
    const achado = await veiculoConhecido(escopo, alvo[cfg.de] ?? '').catch(() => '');
    aplicarEnriquecimento(alvo, cfg, achado);
  }
}
