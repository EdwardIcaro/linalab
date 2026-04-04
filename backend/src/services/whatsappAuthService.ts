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
  // Normalizar número: remover caracteres não-numéricos, manter apenas últimos 11 dígitos
  const normalizedPhone = phoneNumber.replace(/\D/g, '').slice(-11);

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
    const adminPhone = instance.adminPhones.find(
      (ap) => ap.telefone.includes(normalizedPhone) || normalizedPhone.includes(ap.telefone.replace(/\D/g, '').slice(-11))
    );

    if (adminPhone) {
      return {
        type: 'admin',
        empresaId,
        nome: adminPhone.nome ?? 'Admin',
        telefone: adminPhone.telefone,
      };
    }
  }

  // 2. Buscar lavador por telefone
  const lavador = await prisma.lavador.findFirst({
    where: {
      empresaId,
      ativo: true,
      telefone: {
        contains: normalizedPhone,
      },
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
