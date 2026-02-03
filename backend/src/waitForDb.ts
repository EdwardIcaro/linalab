import prisma from './db';

/**
 * Aguarda o PostgreSQL estar pronto antes de iniciar a aplicação
 * Tenta conectar até 30 vezes com delay de 2 segundos entre tentativas
 */
export async function waitForDatabase(maxAttempts = 30, delayMs = 2000): Promise<void> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      console.log(`🔄 Tentando conectar ao banco de dados (tentativa ${attempt + 1}/${maxAttempts})...`);

      // Tentar executar uma query simples
      await prisma.$queryRaw`SELECT 1`;

      console.log('✅ Banco de dados está pronto!');
      return;
    } catch (error) {
      attempt++;

      if (attempt >= maxAttempts) {
        console.error('❌ Não consegui conectar ao banco de dados após', maxAttempts, 'tentativas');
        console.error('Erro:', error);
        process.exit(1);
      }

      console.warn(`⏳ Aguardando ${delayMs}ms antes de tentar novamente...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
