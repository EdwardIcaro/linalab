ALTER TABLE "ordens_servico_lavadores"
ADD COLUMN "comissaoPaga" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "fechamentoComissaoId" TEXT;

ALTER TABLE "ordens_servico_lavadores"
ADD CONSTRAINT "ordens_servico_lavadores_fechamentoComissaoId_fkey"
FOREIGN KEY ("fechamentoComissaoId") REFERENCES "fechamentos_comissao"("id") ON DELETE SET NULL;

