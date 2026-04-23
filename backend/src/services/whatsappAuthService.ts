/**
 * Autenticação de mensagens WhatsApp — socket único global.
 * Identifica o remetente sem precisar de empresaId implícito.
 */

import prisma from '../db';

export type WhatsAppUserType = 'admin' | 'lavador' | 'unknown';

export interface WhatsAppUser {
  type:      WhatsAppUserType;
  empresas?: Array<{ id: string; nome: string }>; // admin: todas as empresas vinculadas
  empresaId?: string;   // lavador: empresa única
  lavadorId?: string;
  nome?:     string;
  telefone?: string;
}

function getBrPhoneVariants(digits: string): string[] {
  const v = new Set<string>([digits]);
  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9')
    v.add('55' + digits.slice(2, 4) + digits.slice(5));
  if (digits.length === 12 && digits.startsWith('55'))
    v.add('55' + digits.slice(2, 4) + '9' + digits.slice(4));
  if (digits.length >= 11) v.add(digits.slice(-11));
  if (digits.length >= 8)  v.add(digits.slice(-8));
  return Array.from(v);
}

/**
 * Identifica o remetente de uma mensagem no socket global.
 * Retorna: admin (com lista de empresas), lavador (empresa única), ou unknown.
 */
export async function identifyWhatsAppUser(phoneNumber: string): Promise<WhatsAppUser> {
  const rawPhone  = phoneNumber.replace(/\D/g, '');
  const variants  = getBrPhoneVariants(rawPhone);

  // 1. Verificar se é admin cadastrado em alguma empresa
  // cast para any: empresaId existe no schema mas precisa de prisma generate após migration
  const adminRecords = await (prisma.whatsappAdminPhone as any).findMany({
    where: {
      ativo: true,
      OR: [
        { jid: phoneNumber },
        ...variants.map(v => ({ telefone: { contains: v } })),
      ],
    },
    select: { empresaId: true, nome: true, telefone: true, jid: true },
  }) as Array<{ empresaId: string; nome: string | null; telefone: string; jid: string | null }>;

  if (adminRecords.length > 0) {
    const empresaIds = [...new Set(adminRecords.map(r => r.empresaId))];
    const empresas   = await prisma.empresa.findMany({
      where: { id: { in: empresaIds } },
      select: { id: true, nome: true },
    });

    return {
      type:     'admin',
      empresas,
      nome:     adminRecords[0].nome ?? 'Admin',
      telefone: adminRecords[0].telefone,
    };
  }

  // 2. Verificar se é lavador em alguma empresa
  const lavador = await prisma.lavador.findFirst({
    where: {
      ativo: true,
      OR: variants.map(v => ({ telefone: { contains: v } })),
    },
    select: { id: true, nome: true, telefone: true, empresaId: true },
  });

  if (lavador) {
    return {
      type:      'lavador',
      empresaId: lavador.empresaId,
      lavadorId: lavador.id,
      nome:      lavador.nome,
      telefone:  lavador.telefone ?? undefined,
    };
  }

  return { type: 'unknown', telefone: phoneNumber };
}

export function hasPermission(user: WhatsAppUser, feature: string): boolean {
  if (user.type === 'admin') return true;
  if (user.type === 'lavador') {
    return ['minhas_comissoes', 'meu_faturamento', 'meu_status'].includes(feature);
  }
  return false;
}

export function getDeniedAccessMessage(user: WhatsAppUser): string {
  if (user.type === 'unknown')  return '🚫 Acesso não autorizado. Cadastre seu número com o administrador.';
  if (user.type === 'lavador')  return '⚠️ Esta função está disponível apenas para administradores.';
  return '❌ Acesso negado.';
}
