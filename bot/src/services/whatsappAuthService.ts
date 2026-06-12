/**
 * Autenticação de mensagens WhatsApp — socket único global.
 * Identifica o remetente sem precisar de empresaId implícito.
 */

import prisma from '../db';

export type WhatsAppUserType = 'admin' | 'lavador' | 'funcionario' | 'unknown';

export interface WhatsAppUser {
  type:      WhatsAppUserType;
  empresas?: Array<{ id: string; nome: string }>; // admin: todas as empresas vinculadas
  empresaId?: string;   // lavador/funcionario: empresa única
  lavadorId?: string;
  subaccountId?: string; // funcionario: id do Subaccount vinculado
  permissoes?: string[]; // funcionario: nomes das permissões do Role (painel)
  botFeatures?: string[]; // funcionario: comandos do bot habilitados para o Role
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
 * Retorna: admin (com lista de empresas), lavador (empresa única), funcionario (subaccount), ou unknown.
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
    const empresas   = (await prisma.empresa.findMany({
      where: { id: { in: empresaIds } },
      select: { id: true, nome: true },
    })).sort((a, b) => a.nome.localeCompare(b.nome));

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

  // 3. Verificar se é funcionário (subaccount) vinculado via WhatsappBotUser
  const botUser = await (prisma.whatsappBotUser as any).findFirst({
    where: {
      ativo: true,
      subaccountId: { not: null },
      OR: [
        { jid: phoneNumber },
        ...variants.map(v => ({ telefone: { contains: v } })),
      ],
    },
    select: {
      subaccountId: true,
      empresaId: true,
      telefone: true,
      subaccount: {
        select: {
          nome: true,
          roleInt: { select: { permissoes: { select: { name: true } }, botFeatures: true } },
        },
      },
    },
  });

  if (botUser?.subaccount) {
    const permissoes = botUser.subaccount.roleInt.permissoes.map((p: any) => p.name);
    const botFeatures = Array.isArray(botUser.subaccount.roleInt.botFeatures)
      ? botUser.subaccount.roleInt.botFeatures as string[]
      : permissoes; // sem config explícita do bot ainda → espelha as permissões do painel

    return {
      type:         'funcionario',
      empresaId:    botUser.empresaId,
      subaccountId: botUser.subaccountId,
      nome:         botUser.subaccount.nome,
      telefone:     botUser.telefone ?? undefined,
      permissoes,
      botFeatures,
    };
  }

  return { type: 'unknown', telefone: phoneNumber };
}

export function hasPermission(user: WhatsAppUser, feature: string): boolean {
  if (user.type === 'admin') return true;
  if (user.type === 'lavador') {
    return ['minhas_comissoes', 'meu_faturamento', 'meu_status'].includes(feature);
  }
  if (user.type === 'funcionario') {
    return (user.botFeatures ?? user.permissoes ?? []).includes(feature);
  }
  return false;
}

export function getDeniedAccessMessage(user: WhatsAppUser): string {
  if (user.type === 'unknown')  return 'Oi! Sou a Lina 👋\n\nSeu número ainda não tá cadastrado no sistema. Fala com o administrador do lava-jato pra te cadastrar, tá bom?';
  if (user.type === 'lavador')  return 'Essa função é só pra administradores, viu? Se precisar de algo, me chama com *ajuda*!';
  return 'Não consegui processar isso, não. Tenta de novo?';
}

export function getPermissionDeniedMessage(): string {
  return 'Você não tem permissão pra acessar essa informação. Fala com o administrador se precisar, viu?';
}
