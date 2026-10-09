import prisma from '../db';

/**
 * Sistema principal da empresa, para decidir a tela de quem entra nela.
 * Mesma regra do hub/subscriptionService: empresa com Lina Center ativo é do
 * Lina Center; qualquer outra é Lina Wash (padrão implícito).
 */
export async function sistemaPrincipalDaEmpresa(empresaId: string): Promise<'lina-center' | 'lina-wash'> {
  const lc = await prisma.empresaSistema.findFirst({
    where: { empresaId, sistema: 'lina-center', ativo: true },
    select: { id: true },
  });
  return lc ? 'lina-center' : 'lina-wash';
}
