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

  // txId interno apenas para rastreamento — NÃO vai no payload (evita "agendamento")
  const txId = `LINA${ordem.numeroOrdem}E${empresaId.substring(0, 6).toUpperCase()}`.replace(/[^A-Za-z0-9]/g, '');

  // Calcular expiração (referência interna)
  const expiracaoMin = bankIntegration.pixExpiracaoMin ?? 30;
  const expiraEm = new Date(Date.now() + expiracaoMin * 60 * 1000);

  // Montar nome do recebedor (máx 25 chars, sem acentos)
  const nomeRecebedor = normalizar(
    bankIntegration.nomeRecebedor ?? 'Lava Jato'
  ).substring(0, 25);

  // Gerar payload PIX estático
  // IMPORTANTE: transactionId = "***" é o padrão BCB para QR estático reutilizável.
  // Usar um txid real faz alguns bancos tratar como QR dinâmico → mostra "agendamento".
  const payload = fixarCRC16Pix(gerarPayloadPix({
    key: bankIntegration.chavePix,
    name: nomeRecebedor,
    city: 'Brasil',
    amount: ordem.valorTotal,
    transactionId: '***',
  }));

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
 * Gera QR Code PIX para um valor arbitrário (sem salvar na ordem).
 * Usado no modal de pagamento do frontend.
 */
export async function gerarQrPixAvulso(
  empresaId: string,
  valor: number
): Promise<{ payload: string; qrDataUrl: string; chavePix: string; nomeRecebedor: string }> {
  const bankIntegration = await prisma.bankIntegration.findUnique({
    where: { empresaId },
    select: { chavePix: true, ativo: true, nomeRecebedor: true },
  });

  if (!bankIntegration?.chavePix || !bankIntegration.ativo) {
    throw new Error('PIX não configurado para esta empresa.');
  }

  const nomeRecebedor = normalizar(
    bankIntegration.nomeRecebedor ?? 'Lava Jato'
  ).substring(0, 25);

  const pixPayload = fixarCRC16Pix(gerarPayloadPix({
    key: bankIntegration.chavePix,
    name: nomeRecebedor,
    city: 'Brasil',
    amount: valor,
    transactionId: '***',
  }));

  const qrDataUrl = await QRCode.toDataURL(pixPayload, { width: 400, margin: 2 });

  return {
    payload: pixPayload,
    qrDataUrl,
    chavePix: bankIntegration.chavePix,
    nomeRecebedor,
  };
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

/**
 * CRC16-CCITT com padding de 4 d\u00edgitos hex (corrige bug do pix-payload v1.0.4).
 * A spec BCB exige que o campo CRC16 tenha SEMPRE 4 d\u00edgitos hex mai\u00fasculos.
 * O pix-payload usa toString(16) sem padStart, gerando "6303ABC" quando deveria ser "63040ABC".
 */
function calcCRC16CCITT(subject: string): string {
  let result = 0xffff;
  for (let offset = 0; offset < subject.length; offset++) {
    result ^= subject.charCodeAt(offset) << 8;
    for (let bitwise = 0; bitwise < 8; bitwise++) {
      if ((result <<= 1) & 0x10000) result ^= 0x1021;
      result &= 0xffff;
    }
  }
  return result.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Corrige o campo CRC16 do payload PIX gerado pelo pix-payload.
 * O campo CRC16 (ID 63) deve SEMPRE ter comprimento 04 e 4 d\u00edgitos hex.
 * Quando o CRC < 0x1000 a biblioteca gera "6303XXX" \u2014 spec BCB exige "63040XXX".
 */
function fixarCRC16Pix(payload: string): string {
  // Encontra o campo CRC16 no final do payload: "63" + length(2) + crc(length hex)
  const match = payload.match(/^([\s\S]*)(63)(0[1-4])([0-9A-Fa-f]{1,4})$/);
  if (!match) return payload;
  const [, base, , , crc] = match;
  if (crc.length === 4) return payload; // j\u00e1 correto
  // Recalcula sobre base + "6304" (conforme spec BCB: CRC cobre o payload + "6304")
  return base + '6304' + calcCRC16CCITT(base + '6304');
}
