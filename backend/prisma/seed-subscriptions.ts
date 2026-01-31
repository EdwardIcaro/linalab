import prisma from '../src/db';

/**
 * SEED DATA - Subscription Plans and Add-ons
 *
 * Este script popula o banco de dados com:
 * - 3 Planos de assinatura (Basic, Pro, Premium)
 * - 3 Add-ons complementares (Estoque, Calculadora de Consumo, PDV)
 *
 * Executar com: npx ts-node prisma/seed-subscriptions.ts
 */

async function main() {
  console.log('🌱 Iniciando seed de planos e add-ons...\n');

  // Limpar dados existentes (opcional - comentar se não desejar)
  // await prisma.subscriptionAddon.deleteMany({});
  // await prisma.subscriptionPlan.deleteMany({});
  // await prisma.addon.deleteMany({});

  // ===== PLANOS DE ASSINATURA =====

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
      preco: 8900, // R$ 89.00 em centavos
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
  console.log('✅ Plano Basic criado/atualizado');

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
      preco: 16900, // R$ 169.00 em centavos
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
  console.log('✅ Plano Pro criado/atualizado');

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
      preco: 27900, // R$ 279.00 em centavos
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
  console.log('✅ Plano Premium criado/atualizado');

  // ===== ADD-ONS =====

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
      preco: 3900, // R$ 39.00 em centavos
      featureKey: 'estoque_personalizado',
      ativo: true
    }
  });
  console.log('✅ Add-on Estoque Personalizado criado/atualizado');

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
      preco: 2900, // R$ 29.00 em centavos
      featureKey: 'calculadora_consumo',
      ativo: true
    }
  });
  console.log('✅ Add-on Calculadora de Consumo criado/atualizado');

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
      preco: 4900, // R$ 49.00 em centavos
      featureKey: 'pdv_simples',
      ativo: true
    }
  });
  console.log('✅ Add-on PDV Simples criado/atualizado');

  console.log('\n📊 Resumo do Seed:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📋 PLANOS:');
  console.log(`  1️⃣  ${basicPlan.nome}: R$ ${(basicPlan.preco / 100).toFixed(2)}/mês - ${basicPlan.maxEmpresas} empresa`);
  console.log(`  2️⃣  ${proPlan.nome}: R$ ${(proPlan.preco / 100).toFixed(2)}/mês - ${proPlan.maxEmpresas} empresas`);
  console.log(`  3️⃣  ${premiumPlan.nome}: R$ ${(premiumPlan.preco / 100).toFixed(2)}/mês - ${premiumPlan.maxEmpresas} empresas`);

  console.log('\n🎁 ADD-ONS:');
  console.log(`  • ${addonEstoque.nome}: R$ ${(addonEstoque.preco / 100).toFixed(2)}/mês`);
  console.log(`  • ${addonCalculadora.nome}: R$ ${(addonCalculadora.preco / 100).toFixed(2)}/mês`);
  console.log(`  • ${addonPDV.nome}: R$ ${(addonPDV.preco / 100).toFixed(2)}/mês`);

  console.log('\n✨ Seed concluído com sucesso!\n');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Erro ao executar seed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
