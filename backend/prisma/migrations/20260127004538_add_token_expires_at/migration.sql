-- DropForeignKey
ALTER TABLE "ordens_servico_lavadores" DROP CONSTRAINT "ordens_servico_lavadores_fechamentoComissaoId_fkey";

-- AlterTable
ALTER TABLE "lavador_tokens" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "ordens_servico_lavadores" ADD CONSTRAINT "ordens_servico_lavadores_fechamentoComissaoId_fkey" FOREIGN KEY ("fechamentoComissaoId") REFERENCES "fechamentos_comissao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
