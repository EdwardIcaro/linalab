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
 * Identifica o usuário baseado no número de telefone do WhatsApp
 * Retorna { type: 'admin' | 'lavador' | 'unknown', ... }
 */
export async function identifyWhatsAppUser(
  phoneNumber: string,
  empresaId: string
): Promise<WhatsAppUser> {
  // Normalizar número: extrair apenas dígitos do JID (ex: 5599981956046@s.whatsapp.net → 5599981956046)
  const rawPhone = phoneNumber.replace(/\D/g, ''); // número completo com DDI
  const normalizedPhone = rawPhone.slice(-11); // últimos 11 dígitos (DDD + número)

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
        // Comparar apenas a parte numérica do JID
        const apJidNum = ap.jid.replace(/\D/g, '');
        if (apJidNum === rawPhone || apJidNum === normalizedPhone) return true;
      }

      // 2. Fallback: comparar por número de telefone
      const apRaw = ap.telefone.replace(/\D/g, '');
      const apLast11 = apRaw.slice(-11);
      return (
        apRaw === rawPhone ||
        apRaw === normalizedPhone ||
        apRaw.includes(normalizedPhone) ||
        rawPhone.includes(apLast11) ||
        normalizedPhone === apLast11
      );
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

  // 2. Buscar lavador por telefone (tenta número completo e últimos 11 dígitos)
  const lavador = await prisma.lavador.findFirst({
    where: {
      empresaId,
      ativo: true,
      OR: [
        { telefone: { contains: rawPhone } },
        { telefone: { contains: normalizedPhone } },
      ],
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
