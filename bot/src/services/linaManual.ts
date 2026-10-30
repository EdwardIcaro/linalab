/**
 * Manual do sistema pra Lina — o que ela consulta (ferramenta explicarSistema) quando
 * alguém pergunta como algo funciona. Texto curado: a IA não improvisa sobre o sistema.
 * Só vão pra IA os 2 tópicos mais parecidos com a pergunta (limite de tokens da Groq).
 */

export interface TopicoManual { id: string; chaves: string[]; texto: string }

export const MANUAL: TopicoManual[] = [
  {
    id: 'status',
    chaves: ['status', 'pendente', 'andamento', 'aguardando', 'finalizad', 'cancelad', 'fila', 'pátio', 'patio', 'reabrir', 'voltar'],
    texto: 'Status da ordem: *na fila* (PENDENTE — criada, ninguém começou), *em andamento* (lavador trabalhando), *aguardando pagamento* (serviço pronto, falta receber), *finalizada* (pronta e paga) e *cancelada*. Aguardando pagamento ainda não conta no faturamento nem na comissão dos relatórios — só a finalizada. Pátio = ordens abertas agora (na fila, em andamento e aguardando pagamento).',
  },
  {
    id: 'editar-ordem',
    chaves: ['editar', 'alterar', 'mudar', 'trocar', 'reabrir', 'reabre', 'voltar', 'corrigir', 'cancelar', 'cancela', 'tirar', 'lavador errado', 'valor errado'],
    texto: 'Mudar uma ordem: na tela *Ordens*, o ícone de lápis (*Editar*) de cada ordem troca o status, o(s) lavador(es) e os serviços; o botão de cancelar cancela a ordem. Não existe botão "reabrir" — voltar uma ordem é editar o status dela. Ordem *finalizada ou cancelada* só pode ser editada por quem tem a permissão "editar ordem finalizada" (o dono tem). Comissão já paga num fechamento fica presa a ele.',
  },
  {
    id: 'nova-ordem',
    chaves: ['nova ordem', 'criar ordem', 'abrir ordem', 'lançar ordem', 'lancar ordem', 'cadastrar carro', 'fila de entrada', 'várias ordens', 'varias ordens', 'em massa'],
    texto: 'Nova ordem (tela *Nova Ordem*): escolhe o tipo de veículo e a categoria, busca pela placa ou cliente (se não existir, cadastra o cliente na hora), escolhe serviços/adicionais e o lavador, revisa e salva. Também dá pra lançar ordem avulsa (tapete, banco…) sem placa. Pra muitos carros de uma vez (ex.: lote da Localiza) existe a *Fila de Entrada*, que cria várias ordens numa tela só.',
  },
  {
    id: 'pagamento',
    chaves: ['pagamento', 'pagar ordem', 'forma de pagamento', 'método', 'metodo', 'nfe', 'nota', 'faturado', 'troco', 'dinheiro', 'cartão', 'cartao', 'débito funcionário', 'debito funcionario'],
    texto: 'Pagamento da ordem: Dinheiro, PIX, Cartão, NFE (faturado/nota — ex.: Localiza, recebe depois) e Débito do funcionário (opcional, desconta do lavador; liga nas configurações). Dá pra dividir em mais de uma forma. No dinheiro, se digitar mais que o restante, o sistema mostra o troco e registra só o que faltava. A ordem finaliza quando os pagamentos cobrem o total.',
  },
  {
    id: 'comissao',
    chaves: ['comissão', 'comissao', 'comissões', 'comissoes', 'fechamento de comissão', 'fechar comissão', 'vale', 'adiantamento', 'ganho', 'porcentagem', '%'],
    texto: 'Comissão: cada serviço tem a sua % (ou vale a % do lavador). Com mais de um lavador na mesma ordem, a % de cada um é dividida pelo número de lavadores. Desconto na ordem reduz a comissão na mesma proporção. Só ordem finalizada gera comissão. Pagar comissão é na tela *Comissões* (fechamento): junta as ordens em aberto do lavador, desconta vales/adiantamentos e marca como paga. Depois de paga, a ordem fica presa àquele fechamento.',
  },
  {
    id: 'caixa',
    chaves: ['caixa', 'abertura', 'abrir caixa', 'fechamento de caixa', 'fechar caixa', 'saída', 'saida', 'despesa', 'sangria', 'diferença', 'diferenca'],
    texto: 'Caixa: abre com o valor inicial (abertura), lança saídas/despesas ao longo do dia e fecha digitando quanto tem em cada forma (dinheiro, PIX, cartão, NFE) — o sistema compara com o que ele calculou e mostra a diferença. Entradas do caixa = pagamentos recebidos no dia. O "dia" do caixa começa no horário de abertura configurado da empresa. Pelo WhatsApp: "saída 50 gasolina" lança uma despesa.',
  },
  {
    id: 'relatorios',
    chaves: ['faturamento', 'histórico', 'historico', 'financeiro', 'relatório', 'relatorio', 'diferente', 'não bate', 'nao bate', 'divergência', 'divergencia'],
    texto: 'Histórico x Financeiro contam coisas diferentes de propósito: o *Histórico* (e o faturamento dos relatórios) conta pela data em que o serviço foi concluído; o *Financeiro* conta pela data em que o dinheiro entrou (pagamento). Uma ordem feita ontem e paga hoje aparece no histórico de ontem e no financeiro de hoje. Ordem cancelada não entra em nenhum dos dois.',
  },
  {
    id: 'localiza',
    chaves: ['localiza', 'solicitação', 'solicitacao', 'e-mail', 'email', 'aceitar', 'checklist', 'avaria'],
    texto: 'Fila da Localiza: cada e-mail de "Solicitação de Lavagem" vira um cartão no início do portal da subconta (pra quem cuida de ordens). Quem aceita cria a ordem na empresa em que está, com o preço do e-mail; o checklist de avarias (fotos + itens) é opcional e avaria nova avisa o dono. Pedido não aceito some depois de 3 dias. E-mail de cancelamento cancela o cartão; se já virou ordem, só marca observação. Pelo WhatsApp a Lina mostra quais estão esperando, mas aceitar é pelo sistema.',
  },
  {
    id: 'contas',
    chaves: ['conta a pagar', 'contas a pagar', 'boleto', 'vencimento', 'vence', 'fornecedor', 'mensal', 'a prazo', 'lembrete'],
    texto: 'Contas a Pagar (no Financeiro): conta *avulsa* (uma vez), *mensal* (ao pagar, já cria a do mês seguinte) ou *a prazo* (compra + X dias, fica salva como item frequente). Lembrete no WhatsApp alguns dias antes e no dia, pro dono e pra quem vê o financeiro. Ao pagar no Lina Wash, já lança a saída no caixa. Pelo WhatsApp: "paguei a conta de luz" — a Lina mostra a conta e dá baixa no "sim".',
  },
  {
    id: 'portal-lavador',
    chaves: ['portal', 'link do lavador', 'pin', 'extrato', 'página do lavador', 'pagina do lavador', 'lavador ver'],
    texto: 'Portal do lavador: cada lavador tem um link próprio e entra com um PIN de 4 dígitos. Lá ele vê as ordens dele, quanto ganhou e o extrato das comissões (comissão, salário ou salário + comissão). O link é gerado no cadastro do lavador.',
  },
  {
    id: 'subcontas',
    chaves: ['subconta', 'funcionário', 'funcionario', 'cargo', 'permissão', 'permissao', 'acesso', 'gerente', 'outra empresa', 'trocar empresa'],
    texto: 'Subcontas (funcionários do escritório): cada uma tem um cargo com permissões — ver financeiro, gerenciar ordens, gerenciar clientes, gerenciar funcionários. O dono pode dar acesso a várias empresas dele, com cargo por empresa, e a pessoa troca de empresa sem sair. Pelo WhatsApp, a Lina só mostra pra cada um o que o cargo permite.',
  },
  {
    id: 'whatsapp',
    chaves: ['whatsapp', 'bot', 'lina', 'comando', 'o que você faz', 'o que voce faz', 'ajuda', 'consegue'],
    texto: 'No WhatsApp a Lina responde sobre caixa, faturamento, ordens (por dia, cliente, lavador, placa ou número), comissões e vales, contas a pagar, fila da Localiza e equipe. Faz: PIX de uma ordem ("pix 432"), lança saída ("saída 50 gasolina"), dá baixa em conta, e guarda lembretes ("lembra que…"). Ações só acontecem depois do "sim". Comandos rápidos: *resumo*, *caixa*, *ordens*, *pátio*, *lavadores*, *ajuda*.',
  },
  {
    id: 'planos',
    chaves: ['plano', 'planos', 'assinatura', 'preço do sistema', 'preco do sistema', 'valor do sistema', 'mensalidade', 'teste grátis', 'teste gratis'],
    texto: 'A Lina X tem 3 planos: *Basic* (R$89/mês, 1 empresa), *Pro* (R$169/mês, 2 empresas + Painel Vitrine) e *Premium* (R$279/mês, 5 empresas + Lina WhatsApp). Todo cadastro novo tem 7 dias de teste grátis.',
  },
  {
    id: 'data-point',
    chaves: ['data point', 'ponto', 'controle de ponto', 'bater ponto', 'banco de horas', 'jornada'],
    texto: 'Data Point é o módulo de controle de ponto CLT do ecossistema Lina — bate ponto com GPS ou QR code, calcula horas trabalhadas e afastamentos. É um sistema separado, ativado por empresa.',
  },
  {
    id: 'lina-center',
    chaves: ['lina center', 'oficina', 'mecânico', 'mecanico'],
    texto: 'Lina Center é o sistema da oficina no ecossistema Lina: ordens de serviço, mecânicos com comissão, portal e contas a pagar, separado do Lina Wash. A mesma placa pode ter histórico nos dois.',
  },
  {
    id: 'pix',
    chaves: ['pix', 'qr code', 'qrcode', 'chave pix'],
    texto: 'O PIX gerado pelo bot é um QR Code estático, feito com a chave PIX cadastrada da empresa (Configurações › WhatsApp) — serve pra qualquer valor e não expira. Pelo WhatsApp: "pix 432" gera o da ordem 432.',
  },
];

/** Os tópicos que mais combinam com a pergunta (máx. 2). */
export function consultarManual(pergunta: string): string {
  const t = pergunta.toLowerCase();
  const pontuados = MANUAL
    .map(m => ({ m, pontos: m.chaves.filter(k => t.includes(k)).length + (t.includes(m.id) ? 1 : 0) }))
    .filter(x => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 2);
  if (!pontuados.length) return `Não tenho essa explicação no manual. Tópicos que eu conheço: ${MANUAL.map(m => m.id).join(', ')}.`;
  return pontuados.map(x => x.m.texto).join('\n\n');
}
