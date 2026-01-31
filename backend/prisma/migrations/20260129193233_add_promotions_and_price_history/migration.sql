-- CreateEnum
CREATE TYPE "TipoPromo" AS ENUM ('PERCENTUAL', 'FIXO');

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" "TipoPromo" NOT NULL DEFAULT 'PERCENTUAL',
    "valor" DOUBLE PRECISION NOT NULL,
    "planId" TEXT,
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "dataFim" TIMESTAMP(3) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "usosMaximos" INTEGER,
    "usosAtuais" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_histories" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "precoAntigo" DOUBLE PRECISION NOT NULL,
    "precoNovo" DOUBLE PRECISION NOT NULL,
    "alteradoPor" TEXT NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promotions_nome_key" ON "promotions"("nome");

-- CreateIndex
CREATE INDEX "price_histories_planId_idx" ON "price_histories"("planId");

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_histories" ADD CONSTRAINT "price_histories_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
