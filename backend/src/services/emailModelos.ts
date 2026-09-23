/**
 * Catálogo de automações prontas.
 *
 * Email de fornecedor é padronizado: todo prestador da Localiza recebe o mesmo layout
 * de "Solicitação de Lavagem". Então o que escala não é ensinar cada cliente a montar
 * a regra no dedo — é ter a regra pronta e o cliente só apontar pra caixa dele.
 *
 * O catálogo mora aqui (e não no banco) porque muda raramente e assim fica versionado
 * junto com o motor que o interpreta. Modelo novo = uma entrada nesta lista.
 *
 * O que NÃO entra em modelo: destinatários (são da empresa) e a tabela de preços, que
 * varia por contrato — o modelo traz uma sugestão e o cliente confirma na tela.
 */

import type { CampoRegra, BlocoRegra, DerivadoRegra } from './emailExtracao';

export interface ModeloAutomacao {
  id: string;
  nome: string;
  /** Uma linha explicando quando ela dispara, em português de cliente. */
  descricao: string;
  fornecedor: string;
  emoji: string;
  remetenteContem: string;
  assuntoContem: string | null;
  assuntoNaoContem: string | null;
  regexExtracao: string;
  tipoValor: string;
  campos: CampoRegra[];
  bloco: BlocoRegra | null;
  derivados: DerivadoRegra[] | null;
  template: string;
  /**
   * Tabela que o cliente deve conferir antes de ativar (o contrato dele pode ter outro
   * preço). Aponta onde ela está: no bloco ou na regra.
   */
  tabelaEditavel: { em: 'bloco' | 'regra'; chave: string; rotulo: string } | null;
}

/** "Bruno Amorim Lima" → "Bruno Amorim"; "Marcos da Silva Evangelista" → "Marcos da Silva". */
const DOIS_NOMES = '(\\S+(?:\\s+(?:d[aeo]s?|e)\\b)*\\s+\\S+)';

const SERVICO_POR_PRECO: DerivadoRegra = {
  chave: 'servico',
  de: 'preco',
  valores: { '30': 'Lavagem Simples', '130': 'Lavagem Especial' },
  padrao: 'Lavagem',
};

export const MODELOS: ModeloAutomacao[] = [
  {
    id: 'localiza-solicitacao-lavagem',
    nome: 'Solicitação de Lavagem',
    descricao: 'Avisa no WhatsApp quando a Localiza pede a lavagem de um veículo, com placa e valor.',
    fornecedor: 'Localiza',
    emoji: '🧼',
    remetenteContem: 'no-reply@localiza.com',
    assuntoContem: 'Solicitação de Lavagem',
    // O assunto do cancelamento CONTÉM o da solicitação — sem isto, um cancelamento
    // mandaria alguém buscar um carro que não vai mais ser lavado.
    assuntoNaoContem: 'Cancelamento',
    regexExtracao: 'Número da solicitação\\s+Placa\\s+Tipo de Lavagem\\s+Valor\\s+([0-9]{4,})',
    tipoValor: 'AVANCADO',
    campos: [
      { chave: 'solicitante', regex: `Respons[áa]vel pela Solicita[çc][ãa]o:\\s*${DOIS_NOMES}`, opcional: false },
      { chave: 'agencia', regex: 'Agencia da Abertura:\\s*(.+)', opcional: true },
      { chave: 'dia', regex: 'Data da Abertura da Solicita[çc][ãa]o:\\s*([0-9]{2}/[0-9]{2})', opcional: true },
    ],
    // Uma solicitação pode trazer mais de um veículo na mesma tabela
    bloco: {
      regex: '([0-9]{4,})\\s+([A-Z0-9]{7})\\s+([\\s\\S]*?)(R\\$\\s?[0-9.,]+)',
      chaves: ['numero', 'placa', 'tipo', 'preco'],
      derivados: [SERVICO_POR_PRECO],
      template: '🚗 *{{placa}}* — {{servico}} — {{preco}}',
    },
    derivados: null,
    template: '🧼 *Nova solicitação de lavagem*\n\n{{itens}}\n\n👤 {{solicitante}} · 🏢 {{agencia}} · 🗓 {{dia}}',
    tabelaEditavel: { em: 'bloco', chave: 'servico', rotulo: 'Seu preço por tipo de lavagem' },
  },
  {
    id: 'localiza-cancelamento-lavagem',
    nome: 'Cancelamento de Lavagem',
    descricao: 'Avisa quando a Localiza cancela uma solicitação, pra ninguém buscar o carro à toa.',
    fornecedor: 'Localiza',
    emoji: '❌',
    remetenteContem: 'no-reply@localiza.com',
    assuntoContem: 'Cancelamento Solicitação de Lavagem',
    assuntoNaoContem: null,
    regexExtracao: 'Número da solicitação:\\s*([0-9]{4,})',
    tipoValor: 'AVANCADO',
    campos: [
      { chave: 'placa', regex: 'Placa:\\s*([A-Z0-9]{7})', opcional: false },
      { chave: 'preco', regex: 'Valor:\\s*(R\\$\\s?[0-9.,]+)', opcional: true },
      { chave: 'cancelou', regex: `Respons[áa]vel pelo cancelamento:\\s*${DOIS_NOMES}`, opcional: true },
    ],
    bloco: null,
    derivados: [SERVICO_POR_PRECO],
    template: '❌ *Lavagem cancelada*\n\n🚗 *{{placa}}* — {{servico}} — {{preco}}\n👤 Cancelou: {{cancelou}}',
    tabelaEditavel: { em: 'regra', chave: 'servico', rotulo: 'Seu preço por tipo de lavagem' },
  },
  {
    id: 'localiza-codigo-portal',
    nome: 'Código do Portal de Fornecedores',
    descricao: 'Manda no WhatsApp o código de acesso que a Localiza envia pra entrar no portal.',
    fornecedor: 'Localiza',
    emoji: '🔑',
    remetenteContem: 'noreply.portalfornecedor@localiza.com',
    assuntoContem: 'Código de acesso',
    assuntoNaoContem: null,
    regexExtracao: 'a\\s+seguir:[^0-9A-Za-z]{0,40}([0-9]{6})(?![0-9])',
    tipoValor: 'CODIGO',
    campos: [],
    bloco: null,
    derivados: null,
    template: '🔑 Código Localiza: {{valor}}',
    tabelaEditavel: null,
  },
];

export function modeloPorId(id: string): ModeloAutomacao | undefined {
  return MODELOS.find((m) => m.id === id);
}
