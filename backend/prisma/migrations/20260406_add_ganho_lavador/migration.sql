-- Adiciona campo ganho (comissão individual) em ordens_servico_lavadores
-- Cada lavador agora tem seu próprio valor de comissão calculado com base na sua % individual
ALTER TABLE "ordens_servico_lavadores" ADD COLUMN IF NOT EXISTS "ganho" DOUBLE PRECISION NOT NULL DEFAULT 0;
