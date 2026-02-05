-- CreateIndex - Performance indexes for order operations
CREATE INDEX IF NOT EXISTS "idx_ordem_empresa_status" ON "OrdemServico"("empresaId", "status");

CREATE INDEX IF NOT EXISTS "idx_ordem_empresa_status_createdat" ON "OrdemServico"("empresaId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_ordem_empresa_createdat" ON "OrdemServico"("empresaId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_ordem_cliente" ON "OrdemServico"("clienteId");

CREATE INDEX IF NOT EXISTS "idx_ordem_lavador" ON "OrdemServico"("lavadorId");

CREATE INDEX IF NOT EXISTS "idx_ordem_veiculo" ON "OrdemServico"("veiculoId");

-- Indexes for ordemLavadores (junction table)
CREATE INDEX IF NOT EXISTS "idx_ordem_lavadores_ordem" ON "OrdemLavador"("ordemId");

CREATE INDEX IF NOT EXISTS "idx_ordem_lavadores_lavador" ON "OrdemLavador"("lavadorId");

-- Indexes for items
CREATE INDEX IF NOT EXISTS "idx_ordem_item_ordem" ON "OrdemItem"("ordemId");

-- Indexes for pagamentos
CREATE INDEX IF NOT EXISTS "idx_pagamento_ordem" ON "Pagamento"("ordemId");

-- Index for search by veiculo placa (for full-text like queries)
CREATE INDEX IF NOT EXISTS "idx_veiculo_placa" ON "Veiculo"("placa");

-- Index for search by cliente nome (for full-text like queries)
CREATE INDEX IF NOT EXISTS "idx_cliente_nome" ON "Cliente"("nome");
