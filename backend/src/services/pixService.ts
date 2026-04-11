/**
 * Serviço de geração de QR Code PIX
 * Fase 1 — PIX Estático: usa pix-payload + qrcode (sem banco externo)
 */

import QRCode from 'qrcode';
import prisma from '../db';
import { payload as gerarPayloadPix } from 'pix-payload';

interface GerarPixResult {
  payload: string;        // string do PIX Copy&Paste
  qrCodeBuffer: Buffer;   // PNG pronto para enviar no WhatsApp
  txId: string;
  expiraEm: Date;
}

/**
 * Gera QR Code PIX para uma ordem e salva os dados na ordem.
 * Se a ordem já tem um QR válido, retorna o existente (sem criar novo).
 */
export async function gerarPixParaOrdem(
  ordemId: string,
  empresaId: string,
  reusar = false
): Promise<GerarPixResult> {
  // Buscar integração bancária da empresa
  const bankIntegration = await prisma.bankIntegration.findUnique({
    where: { empresaId },
  });

  if (!bankIntegration || !bankIntegration.chavePix || !bankIntegration.ativo) {
    throw new Error('Nenhuma integração PIX configurada para esta empresa.');
  }

  // Buscar a ordem com cliente e veículo
  const ordem = await prisma.ordemServico.findFirst({
    where: { id: ordemId, empresaId },
    include: {
      cliente: { select: { nome: true } },
      veiculo: { select: { modelo: true, placa: true } },
    },
  });

  if (!ordem) throw new Error('Ordem não encontrada.');

  const statusAtivo = ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'];
  if (!statusAtivo.includes(ordem.status)) {
    throw new Error(`Ordem #${ordem.numeroOrdem} não está ativa (status: ${ordem.status}).`);
  }

  // Se reusar=true e QR ainda válido, retornar sem criar novo
  if (reusar && ordem.pixQrCode && ordem.pixExpiraEm && ordem.pixExpiraEm > new Date()) {
    const buffer = await QRCode.toBuffer(ordem.pixQrCode, { width: 400, margin: 2 });
    return {
      payload: ordem.pixQrCode,
      qrCodeBuffer: buffer,
      txId: ordem.pixTxId ?? '',
      expiraEm: ordem.pixExpiraEm,
    };
  }

  // Gerar txId único: empresa+ordem codificados em base64url
  const txId = `LINA${ordem.numeroOrdem}E${empresaId.substring(0, 6).toUpperCase()}`.replace(/[^A-Za-z0-9]/g, '');

  // Calcular expiração
  const expiracaoMin = bankIntegration.pixExpiracaoMin ?? 30;
  const expiraEm = new Date(Date.now() + expiracaoMin * 60 * 1000);

  // Montar nome do recebedor (máx 25 chars, sem acentos)
  const nomeRecebedor = normalizar(
    bankIntegration.nomeRecebedor ?? 'Lava Jato'
  ).substring(0, 25);

  // Montar descrição (txid): "Ordem 321"
  const descricao = `Ordem ${ordem.numeroOrdem}`.substring(0, 35);

  // Gerar payload PIX estático
  const payload = gerarPayloadPix({
    key: bankIntegration.chavePix,
    name: nomeRecebedor,
    city: 'Brasil',
    amount: ordem.valorTotal,
    transactionId: txId.substring(0, 25),
  });

  // Gerar imagem PNG
  const qrCodeBuffer = await QRCode.toBuffer(payload, { width: 400, margin: 2 });

  // Salvar na ordem
  await prisma.ordemServico.update({
    where: { id: ordemId },
    data: {
      pixTxId: txId,
      pixStatus: 'PENDENTE',
      pixValor: ordem.valorTotal,
      pixQrCode: payload,
      pixExpiraEm: expiraEm,
      pixPagoEm: null,
    },
  });

  return { payload, qrCodeBuffer, txId, expiraEm };
}

/**
 * Remove acentos e caracteres especiais
 */
function normalizar(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9\s]/g, '')
    .trim();
}
