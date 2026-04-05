/**
 * Serviço de autenticação para mensagens WhatsApp
 * Identifica usuário (admin/lavador) ou bloqueia acesso não autorizado
 */

import prisma from '../db';

export type WhatsAppUserType = 'admin' | 'lavador' | 'unknown';
// Note: 'admin' aqui significa admin do bot (gerente), não LINA_OWNER do sistema

export interface WhatsAppUser {
  type: WhatsAppUserType;
  empresaId?: string;        // para admin
  lavadorId?: string;        // para lavador
  nome?: string;
  telefone?: string;
}

/**
 * Normalização do 9-dígito brasileiro.
 * Em BR, números móveis podem ter o "9" extra após o DDD.
 * Ex: 5599981956046 (13 dígitos) ↔ 559981956046 (12 dígitos) = mesmo número.
 * Retorna todas as variantes possíveis para comparação.
 */
function getBrPhoneVariants(digits: string): string[] {
  const variants = new Set<string>([digits]);

  // 13 dígitos com DDI 55: 55 + DDD(2) + 9 + local(8) → gerar versão sem o 9
  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') {
    variants.add('55' + digits.slice(2, 4) + digits.slice(5)); // remove o 9 extra
  }

  // 12 dígitos com DDI 55: 55 + DDD(2) + local(8) → gerar versão com o 9
  if (digits.length === 12 && digits.startsWith('55')) {
    variants.add('55' + digits.slice(2, 4) + '9' + digits.slice(4)); // adiciona o 9
  }

  // Sempre incluir últimos 11 e 8 dígitos como fallback
  if (digits.length >= 11) variants.add(digits.slice(-11));
  if (digits.length >= 8)  variants.add(digits.slice(-8));

  return Array.from(variants);
}

/**
 * Identifica o usuário baseado no número de telefone do WhatsApp
 * Retorna { type: 'admin' | 'lavador' | 'unknown', ... }
 */
export async function identifyWhatsAppUser(
  phoneNumber: string,
  empresaId: string
): Promise<WhatsAppUser> {
  // Normalizar número: extrair apenas dígitos do JID (ex: 5599981956046@s.whatsapp.net → 5599981956046)
  const rawPhone = phoneNumber.replace(/\D/g, '');
  const rawVariants = getBrPhoneVariants(rawPhone);

  // 1. Buscar admin por telefone
  const instance = await prisma.whatsappInstance.findUnique({
    where: { empresaId },
    include: {
      adminPhones: {
        where: { ativo: true },
      },
    },
  });

  if (instance) {
    const adminPhone = instance.adminPhones.find((ap: any) => {
      // 1. Comparar JID diretamente (resolve o problema do @lid)
      if (ap.jid) {
        if (ap.jid === phoneNumber) return true;
        // Comparar JID numérico com variantes do número recebido
        const apJidNum = ap.jid.replace(/\D/g, '');
        const jidVariants = getBrPhoneVariants(apJidNum);
        if (rawVariants.some(v => jidVariants.includes(v))) return true;
      }

      // 2. Comparar por número de telefone com variantes do 9-dígito
      const apRaw = ap.telefone.replace(/\D/g, '');
      const apVariants = getBrPhoneVariants(apRaw);
      return rawVariants.some(v => apVariants.includes(v));
    });

    if (adminPhone) {
      return {
        type: 'admin',
        empresaId,
        nome: adminPhone.nome ?? 'Admin',
        telefone: adminPhone.telefone,
      };
    }
  }

  // 2. Buscar lavador por telefone (tenta todas as variantes do 9-dígito)
  const lavador = await prisma.lavador.findFirst({
    where: {
      empresaId,
      ativo: true,
      OR: rawVariants.map(v => ({ telefone: { contains: v } })),
    },
  });

  if (lavador) {
    return {
      type: 'lavador',
      empresaId,
      lavadorId: lavador.id,
      nome: lavador.nome,
      telefone: lavador.telefone ?? undefined,
    };
  }

  // 3. Desconhecido
  return {
    type: 'unknown',
    telefone: phoneNumber,
  };
}

/**
 * Verifica se usuário tem permissão para executar uma função
 */
export function hasPermission(user: WhatsAppUser, feature: string): boolean {
  if (user.type === 'admin') {
    // Admin tem acesso a tudo
    return true;
  }

  if (user.type === 'lavador') {
    // Lavador pode apenas acessar:
    // - info: comissões em aberto, faturamento do mês
    // - não pode: relatórios de outros lavadores, comissões em aberto de todos
    const lavadorFeatures = [
      'minhas_comissoes',    // suas comissões
      'meu_faturamento',     // seu faturamento
      'meu_status',          // seus dados
    ];
    return lavadorFeatures.includes(feature);
  }

  // Unknown/não cadastrado: bloqueia tudo
  return false;
}

/**
 * Retorna mensagem de acesso negado customizada
 */
export function getDeniedAccessMessage(user: WhatsAppUser): string {
  if (user.type === 'unknown') {
    return '🚫 Acesso não autorizado. Por favor, cadastre seu número de WhatsApp com o administrador.';
  }

  if (user.type === 'lavador') {
    return '⚠️ Esta função está disponível apenas para administradores.';
  }

  return '❌ Acesso negado.';
}
