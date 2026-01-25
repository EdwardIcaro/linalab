-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('LINA_OWNER', 'OWNER', 'MANAGER', 'USER');

-- CreateEnum
CREATE TYPE "public"."OrdemStatus" AS ENUM ('PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO', 'FINALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "public"."OrdemItemType" AS ENUM ('SERVICO', 'ADICIONAL');

-- CreateEnum
CREATE TYPE "public"."MetodoPagamento" AS ENUM ('DINHEIRO', 'CARTAO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX', 'OUTRO', 'PENDENTE', 'DEBITO_FUNCIONARIO');

-- CreateEnum
CREATE TYPE "public"."StatusPagamento" AS ENUM ('PENDENTE', 'PAGO', 'FALHOU', 'CANCELADO');

-- CreateEnum
CREATE TYPE "public"."StatusFechamento" AS ENUM ('PENDENTE', 'CONCLUIDO', 'DIVERGENCIA', 'CONFERIDO', 'DIVERGENTE');

-- CreateEnum
CREATE TYPE "public"."TipoCaixa" AS ENUM ('ENTRADA', 'SAIDA', 'SANGRIA', 'VALE', 'FECHAMENTO');

-- CreateEnum
CREATE TYPE "public"."FormaPagamento" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO', 'NA');

-- CreateTable
CREATE TABLE "public"."usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."empresas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "horarioAbertura" TEXT,
    "horarioFechamento" TEXT,
    "finalizacaoAutomatica" BOOLEAN DEFAULT false,
    "exigirLavadorParaFinalizar" BOOLEAN DEFAULT false,
    "paginaInicialPadrao" TEXT DEFAULT 'index.html',
    "notificationPreferences" JSONB,
    "paymentMethodsConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "usuarioId" TEXT NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notificacoes" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL DEFAULT 'info',
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."clientes" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."veiculos" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "modelo" TEXT,
    "cor" TEXT,
    "ano" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "veiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."lavadores" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "comissao" DOUBLE PRECISION NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lavadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."lavador_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "lavadorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lavador_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."fornecedores" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "telefone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."fechamentos_caixa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "faturamentoDia" DOUBLE PRECISION NOT NULL,
    "pix" DOUBLE PRECISION NOT NULL,
    "dinheiro" DOUBLE PRECISION NOT NULL,
    "cartao" DOUBLE PRECISION NOT NULL,
    "diferenca" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "public"."StatusFechamento" NOT NULL DEFAULT 'PENDENTE',
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fechamentos_caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CaixaRegistro" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" "public"."TipoCaixa" NOT NULL DEFAULT 'SAIDA',
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valor" DOUBLE PRECISION NOT NULL,
    "formaPagamento" "public"."FormaPagamento" NOT NULL,
    "fornecedorId" TEXT,
    "lavadorId" TEXT,
    "descricao" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaixaRegistro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tipo_veiculos" (
    "empresaId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tipo_veiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."servicos" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "preco" DOUBLE PRECISION NOT NULL,
    "duracao" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."adicionais" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "preco" DOUBLE PRECISION NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adicionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ordens_servico" (
    "id" TEXT NOT NULL,
    "numeroOrdem" INTEGER NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "lavadorId" TEXT,
    "status" "public"."OrdemStatus" NOT NULL DEFAULT 'PENDENTE',
    "valorTotal" DOUBLE PRECISION NOT NULL,
    "observacoes" TEXT,
    "dataInicio" TIMESTAMP(3),
    "dataFim" TIMESTAMP(3),
    "pago" BOOLEAN NOT NULL DEFAULT false,
    "comissao" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comissaoPaga" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fechamentoComissaoId" TEXT,

    CONSTRAINT "ordens_servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ordens_servico_lavadores" (
    "ordemId" TEXT NOT NULL,
    "lavadorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ordens_servico_lavadores_pkey" PRIMARY KEY ("ordemId","lavadorId")
);

-- CreateTable
CREATE TABLE "public"."ordens_servico_items" (
    "id" TEXT NOT NULL,
    "ordemId" TEXT NOT NULL,
    "tipo" "public"."OrdemItemType" NOT NULL,
    "servicoId" TEXT,
    "adicionalId" TEXT,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "precoUnit" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ordens_servico_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pagamentos" (
    "id" TEXT NOT NULL,
    "ordemId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "metodo" "public"."MetodoPagamento" NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "status" "public"."StatusPagamento" NOT NULL DEFAULT 'PENDENTE',
    "observacoes" TEXT,
    "pagoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."permissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subaccounts" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "maxDesconto" INTEGER NOT NULL DEFAULT 0,
    "empresaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subaccounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."adiantamentos" (
    "id" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "lavadorId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "caixaRegistroId" TEXT,
    "fechamentoComissaoId" TEXT,

    CONSTRAINT "adiantamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."fechamentos_comissao" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valorPago" DOUBLE PRECISION NOT NULL,
    "empresaId" TEXT NOT NULL,
    "lavadorId" TEXT NOT NULL,

    CONSTRAINT "fechamentos_comissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."themes" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "corPrimaria" TEXT NOT NULL DEFAULT '#F59E0B',
    "corSecundaria" TEXT NOT NULL DEFAULT '#1F2937',
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."_ServicoToTipoVeiculo" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ServicoToTipoVeiculo_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_nome_key" ON "public"."usuarios"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "public"."usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_nome_key" ON "public"."empresas"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_cnpj_key" ON "public"."empresas"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_email_key" ON "public"."clientes"("email");

-- CreateIndex
CREATE UNIQUE INDEX "veiculos_placa_key" ON "public"."veiculos"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "lavadores_nome_empresaId_key" ON "public"."lavadores"("nome", "empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "lavador_tokens_token_key" ON "public"."lavador_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "fornecedores_empresaId_nome_key" ON "public"."fornecedores"("empresaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "tipo_veiculos_empresaId_nome_categoria_key" ON "public"."tipo_veiculos"("empresaId", "nome", "categoria");

-- CreateIndex
CREATE UNIQUE INDEX "ordens_servico_empresaId_numeroOrdem_key" ON "public"."ordens_servico"("empresaId", "numeroOrdem");

-- CreateIndex
CREATE UNIQUE INDEX "roles_empresaId_nome_key" ON "public"."roles"("empresaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "subaccounts_email_key" ON "public"."subaccounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "adiantamentos_caixaRegistroId_key" ON "public"."adiantamentos"("caixaRegistroId");

-- CreateIndex
CREATE UNIQUE INDEX "themes_empresaId_key" ON "public"."themes"("empresaId");

-- CreateIndex
CREATE INDEX "_ServicoToTipoVeiculo_B_index" ON "public"."_ServicoToTipoVeiculo"("B");

-- AddForeignKey
ALTER TABLE "public"."empresas" ADD CONSTRAINT "empresas_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "public"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notificacoes" ADD CONSTRAINT "notificacoes_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."clientes" ADD CONSTRAINT "clientes_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."veiculos" ADD CONSTRAINT "veiculos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "public"."clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lavadores" ADD CONSTRAINT "lavadores_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lavador_tokens" ADD CONSTRAINT "lavador_tokens_lavadorId_fkey" FOREIGN KEY ("lavadorId") REFERENCES "public"."lavadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fornecedores" ADD CONSTRAINT "fornecedores_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fechamentos_caixa" ADD CONSTRAINT "fechamentos_caixa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CaixaRegistro" ADD CONSTRAINT "CaixaRegistro_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CaixaRegistro" ADD CONSTRAINT "CaixaRegistro_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "public"."fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CaixaRegistro" ADD CONSTRAINT "CaixaRegistro_lavadorId_fkey" FOREIGN KEY ("lavadorId") REFERENCES "public"."lavadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tipo_veiculos" ADD CONSTRAINT "tipo_veiculos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."servicos" ADD CONSTRAINT "servicos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."adicionais" ADD CONSTRAINT "adicionais_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ordens_servico" ADD CONSTRAINT "ordens_servico_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ordens_servico" ADD CONSTRAINT "ordens_servico_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "public"."clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ordens_servico" ADD CONSTRAINT "ordens_servico_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "public"."veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ordens_servico" ADD CONSTRAINT "ordens_servico_lavadorId_fkey" FOREIGN KEY ("lavadorId") REFERENCES "public"."lavadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ordens_servico" ADD CONSTRAINT "ordens_servico_fechamentoComissaoId_fkey" FOREIGN KEY ("fechamentoComissaoId") REFERENCES "public"."fechamentos_comissao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ordens_servico_lavadores" ADD CONSTRAINT "ordens_servico_lavadores_ordemId_fkey" FOREIGN KEY ("ordemId") REFERENCES "public"."ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ordens_servico_lavadores" ADD CONSTRAINT "ordens_servico_lavadores_lavadorId_fkey" FOREIGN KEY ("lavadorId") REFERENCES "public"."lavadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ordens_servico_items" ADD CONSTRAINT "ordens_servico_items_ordemId_fkey" FOREIGN KEY ("ordemId") REFERENCES "public"."ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ordens_servico_items" ADD CONSTRAINT "ordens_servico_items_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "public"."servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ordens_servico_items" ADD CONSTRAINT "ordens_servico_items_adicionalId_fkey" FOREIGN KEY ("adicionalId") REFERENCES "public"."adicionais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pagamentos" ADD CONSTRAINT "pagamentos_ordemId_fkey" FOREIGN KEY ("ordemId") REFERENCES "public"."ordens_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pagamentos" ADD CONSTRAINT "pagamentos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."roles" ADD CONSTRAINT "roles_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."permissions" ADD CONSTRAINT "permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subaccounts" ADD CONSTRAINT "subaccounts_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subaccounts" ADD CONSTRAINT "subaccounts_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."adiantamentos" ADD CONSTRAINT "adiantamentos_lavadorId_fkey" FOREIGN KEY ("lavadorId") REFERENCES "public"."lavadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."adiantamentos" ADD CONSTRAINT "adiantamentos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."adiantamentos" ADD CONSTRAINT "adiantamentos_caixaRegistroId_fkey" FOREIGN KEY ("caixaRegistroId") REFERENCES "public"."CaixaRegistro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."adiantamentos" ADD CONSTRAINT "adiantamentos_fechamentoComissaoId_fkey" FOREIGN KEY ("fechamentoComissaoId") REFERENCES "public"."fechamentos_comissao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fechamentos_comissao" ADD CONSTRAINT "fechamentos_comissao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."fechamentos_comissao" ADD CONSTRAINT "fechamentos_comissao_lavadorId_fkey" FOREIGN KEY ("lavadorId") REFERENCES "public"."lavadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."themes" ADD CONSTRAINT "themes_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_ServicoToTipoVeiculo" ADD CONSTRAINT "_ServicoToTipoVeiculo_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_ServicoToTipoVeiculo" ADD CONSTRAINT "_ServicoToTipoVeiculo_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."tipo_veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
