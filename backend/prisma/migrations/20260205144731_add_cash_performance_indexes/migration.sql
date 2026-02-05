-- CreateIndex - Performance indexes for cash operations
CREATE INDEX IF NOT EXISTS "idx_pagamento_empresa_status_pagoeM" ON "Pagamento"("empresaId", "status", "pagoEm");

CREATE INDEX IF NOT EXISTS "idx_pagamento_empresa_status_createdat" ON "Pagamento"("empresaId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_caixaregistro_empresa_tipo_data" ON "CaixaRegistro"("empresaId", "tipo", "data");

CREATE INDEX IF NOT EXISTS "idx_caixaregistro_empresa_data" ON "CaixaRegistro"("empresaId", "data");

CREATE INDEX IF NOT EXISTS "idx_ordemservico_empresa_datafim" ON "OrdemServico"("empresaId", "dataFim");
