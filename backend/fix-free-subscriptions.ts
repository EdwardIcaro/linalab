import prisma from './src/db';
import { subscriptionService } from './src/services/subscriptionService';

async function fixFreeSubscriptions() {
  try {
    console.log('🔧 Iniciando correção de assinaturas FREE...\n');

    // 1. Verificar se plano FREE existe
    const freePlan = await prisma.subscriptionPlan.findFirst({
      where: { nome: 'FREE' }
    });

    if (!freePlan) {
      console.error('❌ Plano FREE não encontrado!');
      process.exit(1);
    }

    console.log(`✅ Plano FREE encontrado (ID: ${freePlan.id})\n`);

    // 2. Encontrar usuários sem assinatura
    const usuariosSemAssinatura = await prisma.usuario.findMany({
      where: {
        subscriptions: {
          none: {}
        }
      }
    });

    console.log(`📊 Encontrados ${usuariosSemAssinatura.length} usuários sem assinatura\n`);

    // 3. Criar assinatura FREE para cada um
    let criadas = 0;
    let erros = 0;

    for (const usuario of usuariosSemAssinatura) {
      try {
        const sub = await subscriptionService.createFreeSubscriptionForNewUser(usuario.id);
        console.log(`✅ ${usuario.email} - FREE criado (ID: ${sub.id})`);
        criadas++;
      } catch (error: any) {
        console.error(`❌ ${usuario.email} - Erro: ${error.message}`);
        erros++;
      }
    }

    console.log(`\n════════════════════════════════════════`);
    console.log(`✅ Assinaturas criadas: ${criadas}`);
    console.log(`❌ Erros: ${erros}`);
    console.log(`════════════════════════════════════════`);

    process.exit(0);
  } catch (error) {
    console.error('ERRO FATAL:', error);
    process.exit(1);
  }
}

fixFreeSubscriptions();
