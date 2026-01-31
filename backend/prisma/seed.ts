import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Utility: Generate a random time for today between start and end hours
 */
function randomTimeToday(startHour: number, endHour: number): Date {
  const now = new Date();
  const hour = startHour + Math.floor(Math.random() * (endHour - startHour + 1));
  const minute = Math.floor(Math.random() * 60);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
}

/**
 * Utility: Add minutes to a date
 */
function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

async function main() {
  console.log('🌱 Starting seed process...\n');

  // =====================================================
  // 1. CLEANUP - Delete existing data for clean state
  // =====================================================
  console.log('🧹 Cleaning up existing data...');

  await prisma.pagamento.deleteMany({});
  await prisma.ordemServicoItem.deleteMany({});
  await prisma.ordemServico.deleteMany({});
  await prisma.caixaRegistro.deleteMany({});
  await prisma.fechamentoCaixa.deleteMany({});
  await prisma.adiantamento.deleteMany({});
  await prisma.fechamentoComissao.deleteMany({});
  await prisma.veiculo.deleteMany({});
  await prisma.cliente.deleteMany({});
  await prisma.lavadorToken.deleteMany({});
  await prisma.lavador.deleteMany({});
  await prisma.servico.deleteMany({});
  await prisma.adicional.deleteMany({});
  await prisma.tipoVeiculo.deleteMany({});
  await prisma.fornecedor.deleteMany({});
  await prisma.notificacao.deleteMany({});
  await prisma.empresa.deleteMany({});
  await prisma.usuario.deleteMany({});

  console.log('✅ Cleanup complete\n');

  // =====================================================
  // 2. CREATE SUPER ADMIN (SAAS OWNER)
  // =====================================================
  console.log('👑 Creating Super Admin (SaaS Owner)...');
  const hashedMasterPassword = await bcrypt.hash('master_password', 12);

  const superAdmin = await prisma.usuario.create({
    data: {
      nome: 'Edward Icaro (System Owner)',
      email: 'owner@linax.com',
      senha: hashedMasterPassword,
      role: 'LINA_OWNER', // ← CRITICAL: Grants access to admin/*
    },
  });
  console.log(`✅ Super Admin created: ${superAdmin.email} | Role: LINA_OWNER\n`);

  console.log('🏢 Creating SaaS Headquarters company...');
  const empresaHQ = await prisma.empresa.create({
    data: {
      nome: 'Lina Lab HQ',
      cnpj: '00.000.000/0001-00',
      ativo: true,
      usuarioId: superAdmin.id,
    },
  });
  console.log(`✅ HQ Company created: ${empresaHQ.nome}\n`);

  // =====================================================
  // 3. CREATE REGULAR USER (CAR WASH OWNER)
  // =====================================================
  console.log('👤 Creating regular admin user (Car Wash Owner)...');
  const hashedPassword = await bcrypt.hash('123456', 12);

  const usuario = await prisma.usuario.create({
    data: {
      nome: 'admin',
      email: 'admin@linax.com',
      senha: hashedPassword,
      role: 'OWNER', // ← Regular company owner role
    },
  });
  console.log(`✅ User created: ${usuario.email} | Role: OWNER\n`);

  console.log('🏢 Creating company...');
  const empresa = await prisma.empresa.create({
    data: {
      nome: 'Lina Wash',
      cnpj: '12.345.678/0001-90',
      ativo: true,
      horarioAbertura: '08:00',
      horarioFechamento: '18:00',
      finalizacaoAutomatica: false,
      exigirLavadorParaFinalizar: true,
      usuarioId: usuario.id,
    },
  });
  console.log(`✅ Company created: ${empresa.nome}\n`);

  // =====================================================
  // 4. CREATE VEHICLE TYPES
  // =====================================================
  console.log('🚗 Creating vehicle types...');

  const tipoHatch = await prisma.tipoVeiculo.create({
    data: { nome: 'CARRO', categoria: 'HATCH', empresaId: empresa.id },
  });

  const tipoSedan = await prisma.tipoVeiculo.create({
    data: { nome: 'CARRO', categoria: 'SEDAN', empresaId: empresa.id },
  });

  const tipoSuv = await prisma.tipoVeiculo.create({
    data: { nome: 'CARRO', categoria: 'SUV', empresaId: empresa.id },
  });

  const tipoPickup = await prisma.tipoVeiculo.create({
    data: { nome: 'CARRO', categoria: 'PICKUP', empresaId: empresa.id },
  });

  const tipoMoto = await prisma.tipoVeiculo.create({
    data: { nome: 'MOTO', categoria: 'STANDARD', empresaId: empresa.id },
  });

  console.log('✅ Vehicle types created: 5 types\n');

  // =====================================================
  // 5. CREATE SERVICES
  // =====================================================
  console.log('💼 Creating services...');

  const servicoLavagemSimples = await prisma.servico.create({
    data: {
      nome: 'Lavagem Simples',
      descricao: 'Lavagem externa do veículo',
      preco: 35.00,
      duracao: 20,
      empresaId: empresa.id,
      tiposVeiculo: { connect: [{ id: tipoHatch.id }, { id: tipoSedan.id }] },
    },
  });

  const servicoLavagemCompleta = await prisma.servico.create({
    data: {
      nome: 'Lavagem Completa',
      descricao: 'Lavagem externa + interna com aspiração',
      preco: 60.00,
      duracao: 40,
      empresaId: empresa.id,
      tiposVeiculo: { connect: [{ id: tipoHatch.id }, { id: tipoSedan.id }, { id: tipoSuv.id }] },
    },
  });

  const servicoCera = await prisma.servico.create({
    data: {
      nome: 'Cera Cristalizadora',
      descricao: 'Aplicação de cera protetora',
      preco: 80.00,
      duracao: 30,
      empresaId: empresa.id,
      tiposVeiculo: { connect: [{ id: tipoHatch.id }, { id: tipoSedan.id }, { id: tipoSuv.id }, { id: tipoPickup.id }] },
    },
  });

  const servicoHigienizacao = await prisma.servico.create({
    data: {
      nome: 'Higienização Completa',
      descricao: 'Higienização de ar-condicionado e interior',
      preco: 120.00,
      duracao: 60,
      empresaId: empresa.id,
      tiposVeiculo: { connect: [{ id: tipoHatch.id }, { id: tipoSedan.id }, { id: tipoSuv.id }] },
    },
  });

  const servicoPolimento = await prisma.servico.create({
    data: {
      nome: 'Polimento Cristalizado',
      descricao: 'Polimento profissional com cristalização',
      preco: 250.00,
      duracao: 120,
      empresaId: empresa.id,
      tiposVeiculo: { connect: [{ id: tipoHatch.id }, { id: tipoSedan.id }, { id: tipoSuv.id }, { id: tipoPickup.id }] },
    },
  });

  const servicoLavagemMoto = await prisma.servico.create({
    data: {
      nome: 'Lavagem de Moto',
      descricao: 'Lavagem completa de motocicleta',
      preco: 25.00,
      duracao: 15,
      empresaId: empresa.id,
      tiposVeiculo: { connect: [{ id: tipoMoto.id }] },
    },
  });

  console.log('✅ Services created: 6 services\n');

  // =====================================================
  // 6. CREATE ADICIONAIS
  // =====================================================
  console.log('➕ Creating additional services...');

  const adicionalPerfume = await prisma.adicional.create({
    data: {
      nome: 'Perfumação',
      descricao: 'Perfume especial para o interior',
      preco: 10.00,
      empresaId: empresa.id,
    },
  });

  const adicionalMotor = await prisma.adicional.create({
    data: {
      nome: 'Limpeza de Motor',
      descricao: 'Limpeza detalhada do motor',
      preco: 40.00,
      empresaId: empresa.id,
    },
  });

  console.log('✅ Additional services created: 2 items\n');

  // =====================================================
  // 7. CREATE LAVADORES
  // =====================================================
  console.log('👷 Creating washers (lavadores)...');

  const lavador1 = await prisma.lavador.create({
    data: {
      nome: 'João Silva',
      comissao: 25,
      ativo: true,
      empresaId: empresa.id,
    },
  });

  const lavador2 = await prisma.lavador.create({
    data: {
      nome: 'Maria Santos',
      comissao: 30,
      ativo: true,
      empresaId: empresa.id,
    },
  });

  const lavador3 = await prisma.lavador.create({
    data: {
      nome: 'Carlos Oliveira',
      comissao: 20,
      ativo: true,
      empresaId: empresa.id,
    },
  });

  console.log('✅ Washers created: 3 lavadores\n');

  // =====================================================
  // 8. CREATE CLIENTS AND VEHICLES
  // =====================================================
  console.log('👥 Creating clients and vehicles...');

  const clientsData = [
    { nome: 'Ana Paula Costa', telefone: '(11) 98765-4321', email: 'ana.costa@email.com', placa: 'ABC-1234', modelo: 'Civic', cor: 'Prata' },
    { nome: 'Bruno Almeida', telefone: '(11) 97654-3210', email: 'bruno.almeida@email.com', placa: 'DEF-5678', modelo: 'Corolla', cor: 'Preto' },
    { nome: 'Carlos Eduardo', telefone: '(11) 96543-2109', email: 'carlos.edu@email.com', placa: 'GHI-9012', modelo: 'Gol', cor: 'Branco' },
    { nome: 'Daniela Ferreira', telefone: '(11) 95432-1098', email: 'daniela.f@email.com', placa: 'JKL-3456', modelo: 'Onix', cor: 'Vermelho' },
    { nome: 'Eduardo Santos', telefone: '(11) 94321-0987', email: 'eduardo.s@email.com', placa: 'MNO-7890', modelo: 'HB20', cor: 'Azul' },
    { nome: 'Fernanda Lima', telefone: '(11) 93210-9876', email: 'fernanda.lima@email.com', placa: 'PQR-1234', modelo: 'EcoSport', cor: 'Cinza' },
    { nome: 'Gabriel Souza', telefone: '(11) 92109-8765', email: 'gabriel.souza@email.com', placa: 'STU-5678', modelo: 'Renegade', cor: 'Verde' },
    { nome: 'Helena Martins', telefone: '(11) 91098-7654', email: 'helena.m@email.com', placa: 'VWX-9012', modelo: 'Kicks', cor: 'Branco' },
    { nome: 'Igor Pereira', telefone: '(11) 90987-6543', email: 'igor.pereira@email.com', placa: 'YZA-3456', modelo: 'Hilux', cor: 'Prata' },
    { nome: 'Julia Rodrigues', telefone: '(11) 89876-5432', email: 'julia.rod@email.com', placa: 'BCD-7890', modelo: 'Compass', cor: 'Preto' },
  ];

  const clientes = [];
  for (const clientData of clientsData) {
    const cliente = await prisma.cliente.create({
      data: {
        nome: clientData.nome,
        telefone: clientData.telefone,
        email: clientData.email,
        empresaId: empresa.id,
        veiculos: {
          create: {
            placa: clientData.placa,
            modelo: clientData.modelo,
            cor: clientData.cor,
            ano: 2020 + Math.floor(Math.random() * 5),
          },
        },
      },
      include: { veiculos: true },
    });
    clientes.push(cliente);
  }

  console.log(`✅ Clients created: ${clientes.length} clients with vehicles\n`);

  // =====================================================
  // 9. CREATE SERVICE ORDERS (DASHBOARD DATA)
  // =====================================================
  console.log('📋 Creating service orders (spread across today)...');

  const servicos = [servicoLavagemSimples, servicoLavagemCompleta, servicoCera, servicoHigienizacao, servicoPolimento, servicoLavagemMoto];
  const lavadores = [lavador1, lavador2, lavador3];
  const statuses: Array<'PENDENTE' | 'EM_ANDAMENTO' | 'FINALIZADO'> = ['PENDENTE', 'EM_ANDAMENTO', 'FINALIZADO'];

  // Distribution: 2 PENDENTE, 3 EM_ANDAMENTO, 15 FINALIZADO
  const orderStatuses = [
    'PENDENTE', 'PENDENTE',
    'EM_ANDAMENTO', 'EM_ANDAMENTO', 'EM_ANDAMENTO',
    ...Array(15).fill('FINALIZADO')
  ] as Array<'PENDENTE' | 'EM_ANDAMENTO' | 'FINALIZADO'>;

  let orderNumber = 1;
  const orders = [];

  for (let i = 0; i < 20; i++) {
    const cliente = clientes[i % clientes.length];
    const veiculo = cliente.veiculos[0];
    const servico = servicos[Math.floor(Math.random() * servicos.length)];
    const lavador = lavadores[Math.floor(Math.random() * lavadores.length)];
    const status = orderStatuses[i];

    // Spread orders across business hours (8:00 to 17:00)
    const createdAt = randomTimeToday(8, 17);
    const duracao = servico.duracao || 30;
    const dataInicio = status !== 'PENDENTE' ? createdAt : null;
    const dataFim = status === 'FINALIZADO' ? addMinutes(createdAt, duracao) : null;

    // Calculate total (service + random chance of adicional)
    let valorTotal = servico.preco;
    const incluiAdicional = Math.random() > 0.6; // 40% chance of adicional
    const adicional = incluiAdicional ? (Math.random() > 0.5 ? adicionalPerfume : adicionalMotor) : null;
    if (adicional) valorTotal += adicional.preco;

    // Calculate commission
    const comissao = valorTotal * (lavador.comissao / 100);

    const ordem = await prisma.ordemServico.create({
      data: {
        numeroOrdem: orderNumber++,
        empresaId: empresa.id,
        clienteId: cliente.id,
        veiculoId: veiculo.id,
        lavadorId: lavador.id,
        status,
        valorTotal,
        comissao,
        pago: status === 'FINALIZADO',
        dataInicio,
        dataFim,
        createdAt,
        updatedAt: createdAt,
        items: {
          create: [
            {
              tipo: 'SERVICO',
              servicoId: servico.id,
              quantidade: 1,
              precoUnit: servico.preco,
              subtotal: servico.preco,
            },
            ...(adicional ? [{
              tipo: 'ADICIONAL' as const,
              adicionalId: adicional.id,
              quantidade: 1,
              precoUnit: adicional.preco,
              subtotal: adicional.preco,
            }] : []),
          ],
        },
      },
    });

    orders.push(ordem);

    // Create payment for FINALIZADO orders
    if (status === 'FINALIZADO') {
      const metodos: Array<'DINHEIRO' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'PIX'> = ['DINHEIRO', 'CARTAO_CREDITO', 'PIX'];
      const metodo = metodos[Math.floor(Math.random() * metodos.length)];

      await prisma.pagamento.create({
        data: {
          ordemId: ordem.id,
          empresaId: empresa.id,
          metodo,
          valor: valorTotal,
          status: 'PAGO',
          pagoEm: dataFim,
          createdAt: dataFim || new Date(),
        },
      });
    }
  }

  console.log(`✅ Service orders created: ${orders.length} orders\n`);

  // =====================================================
  // 10. CREATE FINANCIAL DATA (EXPENSES)
  // =====================================================
  console.log('💰 Creating expenses (financial transactions)...');

  // Create a fornecedor
  const fornecedor = await prisma.fornecedor.create({
    data: {
      nome: 'Distribuidora Clean Pro',
      cnpj: '98.765.432/0001-10',
      telefone: '(11) 3333-4444',
      empresaId: empresa.id,
    },
  });

  // Expense 1: Purchase of products
  await prisma.caixaRegistro.create({
    data: {
      empresaId: empresa.id,
      tipo: 'SAIDA',
      valor: 450.00,
      formaPagamento: 'DINHEIRO',
      fornecedorId: fornecedor.id,
      descricao: 'Compra de produtos de limpeza e shampoo automotivo',
      data: randomTimeToday(9, 10),
    },
  });

  // Expense 2: Team lunch
  await prisma.caixaRegistro.create({
    data: {
      empresaId: empresa.id,
      tipo: 'SAIDA',
      valor: 85.00,
      formaPagamento: 'PIX',
      descricao: 'Almoço da equipe',
      data: randomTimeToday(12, 13),
    },
  });

  // Expense 3: Sangria (cash withdrawal)
  await prisma.caixaRegistro.create({
    data: {
      empresaId: empresa.id,
      tipo: 'SANGRIA',
      valor: 300.00,
      formaPagamento: 'DINHEIRO',
      descricao: 'Sangria - retirada de dinheiro do caixa',
      data: randomTimeToday(15, 16),
    },
  });

  console.log('✅ Expenses created: 3 transactions\n');

  // =====================================================
  // 11. CREATE SUBSCRIPTION PLANS AND ADD-ONS
  // =====================================================
  console.log('📦 Creating subscription plans and add-ons...');

  // Plano BASIC - R$ 89/mês
  const basicPlan = await prisma.subscriptionPlan.upsert({
    where: { nome: 'Basic' },
    update: {
      descricao: 'Perfeito para pequenos negócios começando com gerenciamento digital',
      preco: 8900,
      maxEmpresas: 1,
      maxUsuarios: 1,
      maxAddons: 0,
      features: [
        'suporte_24_7',
        'relatorios_pdf',
        'gestao_vendas',
        'controle_servicos',
        'organizacao_financeira',
        'personalizacao_completa',
        'painel_administrativo',
        'dados_ilimitados'
      ]
    },
    create: {
      nome: 'Basic',
      descricao: 'Perfeito para pequenos negócios começando com gerenciamento digital',
      preco: 8900,
      intervalo: 'MONTHLY',
      ativo: true,
      ordem: 1,
      maxEmpresas: 1,
      maxUsuarios: 1,
      maxAddons: 0,
      features: [
        'suporte_24_7',
        'relatorios_pdf',
        'gestao_vendas',
        'controle_servicos',
        'organizacao_financeira',
        'personalizacao_completa',
        'painel_administrativo',
        'dados_ilimitados'
      ]
    }
  });

  // Plano PRO - R$ 169/mês
  const proPlan = await prisma.subscriptionPlan.upsert({
    where: { nome: 'Pro' },
    update: {
      descricao: 'Para negócios em crescimento que precisam gerenciar múltiplas unidades',
      preco: 16900,
      maxEmpresas: 2,
      maxUsuarios: 5,
      maxAddons: 1,
      features: [
        'suporte_24_7',
        'relatorios_pdf',
        'gestao_vendas',
        'controle_servicos',
        'organizacao_financeira',
        'personalizacao_completa',
        'painel_administrativo',
        'dados_ilimitados',
        'painel_vitrine',
        'catalogo_servicos'
      ]
    },
    create: {
      nome: 'Pro',
      descricao: 'Para negócios em crescimento que precisam gerenciar múltiplas unidades',
      preco: 16900,
      intervalo: 'MONTHLY',
      ativo: true,
      ordem: 2,
      maxEmpresas: 2,
      maxUsuarios: 5,
      maxAddons: 1,
      features: [
        'suporte_24_7',
        'relatorios_pdf',
        'gestao_vendas',
        'controle_servicos',
        'organizacao_financeira',
        'personalizacao_completa',
        'painel_administrativo',
        'dados_ilimitados',
        'painel_vitrine',
        'catalogo_servicos'
      ]
    }
  });

  // Plano PREMIUM - R$ 279/mês
  const premiumPlan = await prisma.subscriptionPlan.upsert({
    where: { nome: 'Premium' },
    update: {
      descricao: 'Solução completa para empresas consolidadas com múltiplos operacionais',
      preco: 27900,
      maxEmpresas: 5,
      maxUsuarios: 20,
      maxAddons: 2,
      features: [
        'suporte_24_7',
        'relatorios_pdf',
        'gestao_vendas',
        'controle_servicos',
        'organizacao_financeira',
        'personalizacao_completa',
        'painel_administrativo',
        'dados_ilimitados',
        'painel_vitrine',
        'catalogo_servicos',
        'lina_whatsapp',
        'notificacoes_automaticas',
        'prioridade_suporte',
        'webhooks_api'
      ]
    },
    create: {
      nome: 'Premium',
      descricao: 'Solução completa para empresas consolidadas com múltiplos operacionais',
      preco: 27900,
      intervalo: 'MONTHLY',
      ativo: true,
      ordem: 3,
      maxEmpresas: 5,
      maxUsuarios: 20,
      maxAddons: 2,
      features: [
        'suporte_24_7',
        'relatorios_pdf',
        'gestao_vendas',
        'controle_servicos',
        'organizacao_financeira',
        'personalizacao_completa',
        'painel_administrativo',
        'dados_ilimitados',
        'painel_vitrine',
        'catalogo_servicos',
        'lina_whatsapp',
        'notificacoes_automaticas',
        'prioridade_suporte',
        'webhooks_api'
      ]
    }
  });

  // Add-on: Estoque Personalizado
  const addonEstoque = await prisma.addon.upsert({
    where: { nome: 'Estoque Personalizado' },
    update: {
      descricao: 'Controle avançado de inventário com alertas de reposição',
      preco: 3900,
      featureKey: 'estoque_personalizado',
      ativo: true
    },
    create: {
      nome: 'Estoque Personalizado',
      descricao: 'Controle avançado de inventário com alertas de reposição',
      preco: 3900,
      featureKey: 'estoque_personalizado',
      ativo: true
    }
  });

  // Add-on: Calculadora de Consumo
  const addonCalculadora = await prisma.addon.upsert({
    where: { nome: 'Calculadora de Consumo' },
    update: {
      descricao: 'Calcule custos de consumo por serviço e maximize margens',
      preco: 2900,
      featureKey: 'calculadora_consumo',
      ativo: true
    },
    create: {
      nome: 'Calculadora de Consumo',
      descricao: 'Calcule custos de consumo por serviço e maximize margens',
      preco: 2900,
      featureKey: 'calculadora_consumo',
      ativo: true
    }
  });

  // Add-on: PDV Simples
  const addonPDV = await prisma.addon.upsert({
    where: { nome: 'PDV Simples' },
    update: {
      descricao: 'Ponto de Venda simplificado para vendas rápidas no balcão',
      preco: 4900,
      featureKey: 'pdv_simples',
      ativo: true
    },
    create: {
      nome: 'PDV Simples',
      descricao: 'Ponto de Venda simplificado para vendas rápidas no balcão',
      preco: 4900,
      featureKey: 'pdv_simples',
      ativo: true
    }
  });

  console.log('✅ Subscription plans created: 3 plans');
  console.log('✅ Add-ons created: 3 add-ons\n');

  // =====================================================
  // 12. SUMMARY
  // =====================================================
  console.log('════════════════════════════════════════════════');
  console.log('✅ SEED COMPLETED SUCCESSFULLY!');
  console.log('════════════════════════════════════════════════');
  console.log('\n👥 USERS CREATED:');
  console.log(`👑 Super Admin (LINA_OWNER)`);
  console.log(`   Email: ${superAdmin.email}`);
  console.log(`   Password: master_password`);
  console.log(`   Access: admin/* pages (Dashboard, Company Management, etc.)`);
  console.log(`   Company: ${empresaHQ.nome}`);
  console.log(`\n👤 Car Wash Owner (OWNER)`);
  console.log(`   Email: ${usuario.email}`);
  console.log(`   Password: 123456`);
  console.log(`   Access: Regular dashboard and company management`);
  console.log(`   Company: ${empresa.nome}`);
  console.log('\n📊 DATA CREATED:');
  console.log(`🚗 Vehicle Types: 5`);
  console.log(`💼 Services: 6`);
  console.log(`➕ Adicionais: 2`);
  console.log(`👷 Washers: 3`);
  console.log(`👥 Clients: ${clientes.length}`);
  console.log(`🚙 Vehicles: ${clientes.length}`);
  console.log(`📋 Orders: ${orders.length}`);
  console.log(`   - PENDENTE: ${orders.filter(o => o.status === 'PENDENTE').length}`);
  console.log(`   - EM_ANDAMENTO: ${orders.filter(o => o.status === 'EM_ANDAMENTO').length}`);
  console.log(`   - FINALIZADO: ${orders.filter(o => o.status === 'FINALIZADO').length}`);
  console.log(`💰 Expenses: 3`);
  console.log('\n💳 SUBSCRIPTION SYSTEM:');
  console.log(`📦 Plans: 3 (Basic R$ ${(basicPlan.preco / 100).toFixed(2)}, Pro R$ ${(proPlan.preco / 100).toFixed(2)}, Premium R$ ${(premiumPlan.preco / 100).toFixed(2)})`);
  console.log(`🎁 Add-ons: 3 (Estoque, Calculadora de Consumo, PDV)`);
  console.log('════════════════════════════════════════════════');
  console.log('\n✅ Role system ACTIVE - Login routing by role:');
  console.log('   LINA_OWNER → admin/dashboard.html');
  console.log('   OWNER/MANAGER/USER → selecionar-empresa.html');
  console.log('\n🚀 You can now test your dashboards with realistic data!');
  console.log('📊 Charts should show vehicles per hour distribution');
  console.log('💳 Financial module should display transactions and balance\n');
}

main()
  .catch((e) => {
    console.error('❌ Error during seed process:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
