-- CreateIndex - Performance indexes for order operations
CREATE INDEX IF NOT EXISTS "idx_ordem_empresa_status" ON "ordens_servico"("empresaId", "status");

CREATE INDEX IF NOT EXISTS "idx_ordem_empresa_status_createdat" ON "ordens_servico"("empresaId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_ordem_empresa_createdat" ON "ordens_servico"("empresaId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_ordem_cliente" ON "ordens_servico"("clienteId");

CREATE INDEX IF NOT EXISTS "idx_ordem_lavador" ON "ordens_servico"("lavadorId");

CREATE INDEX IF NOT EXISTS "idx_ordem_veiculo" ON "ordens_servico"("veiculoId");

-- Indexes for ordem_lavadores (junction table)
CREATE INDEX IF NOT EXISTS "idx_ordem_lavadores_ordem" ON "ordem_lavadores"("ordemId");

CREATE INDEX IF NOT EXISTS "idx_ordem_lavadores_lavador" ON "ordem_lavadores"("lavadorId");

-- Indexes for ordem_items
CREATE INDEX IF NOT EXISTS "idx_ordem_item_ordem" ON "ordem_items"("ordemId");

-- Indexes for pagamentos
CREATE INDEX IF NOT EXISTS "idx_pagamento_ordem" ON "pagamentos"("ordemId");

-- Index for search by veiculo placa (for full-text like queries)
CREATE INDEX IF NOT EXISTS "idx_veiculo_placa" ON "veiculos"("placa");

-- Index for search by cliente nome (for full-text like queries)
CREATE INDEX IF NOT EXISTS "idx_cliente_nome" ON "clientes"("nome");
