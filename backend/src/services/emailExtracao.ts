/**
 * Extração dos dados de um email para montar a mensagem do WhatsApp.
 *
 * A primeira versão do motor sabia pegar UM valor por email (o código de acesso do
 * fornecedor) e o template só conhecia `{{valor}}`. Emails de rotina carregam mais de
 * uma informação útil — uma solicitação de lavagem traz placa, tipo, valor, quem pediu
 * e em qual agência — então a regra passou a aceitar:
 *
 *   - `campos`: uma regex por informação; cada uma vira `{{chave}}` no template.
 *   - `bloco`:  a linha que se repete (tabela de veículos); cada ocorrência vira uma
 *               linha do texto e o conjunto entra como `{{itens}}`.
 *
 * `regexExtracao` continua valendo e continua alimentando `{{valor}}`: as regras de
 * código criadas antes disso seguem funcionando sem alteração.
 */

export interface CampoRegra {
  /** Nome usado no template: `{{placa}}`. */
  chave: string;
  regex: string;
  /** Campo que pode faltar no email sem impedir o disparo (ex: tipo de lavagem em branco). */
  opcional?: boolean;
}

/**
 * Campo calculado a partir de outro, por tabela de correspondência.
 *
 * Existe porque o fornecedor pode parar de mandar uma informação que ainda dá pra
 * deduzir: a Localiza deixou de preencher "Tipo de Lavagem" em 01/2026, mas o preço
 * continua dizendo qual serviço é (R$ 30 = simples, R$ 130 = especial).
 */
export interface DerivadoRegra {
  /** Nome do campo novo: `{{servico}}`. */
  chave: string;
  /** Campo de origem (um campo da regra ou uma chave do bloco). */
  de: string;
  /** "30" → "Lavagem Simples". A busca ignora R$, pontuação e maiúsculas. */
  valores: Record<string, string>;
  /** Quando o valor não está na tabela. */
  padrao?: string;
}

export interface BlocoRegra {
  /** Casa UMA ocorrência; aplicada repetidamente para pegar todas. */
  regex: string;
  /** Nome de cada grupo de captura, na ordem: ['numero', 'placa', 'tipo', 'valor']. */
  chaves: string[];
  /** Texto de uma ocorrência, ex: "• {{placa}} — {{tipo}} — {{valor}}". */
  template: string;
  /** Entre as ocorrências. Padrão: quebra de linha. */
  separador?: string;
  /** Nome do conjunto no template principal. Padrão: `itens`. */
  chaveLista?: string;
  /** Campos calculados dentro de cada ocorrência (ex: serviço a partir do preço). */
  derivados?: DerivadoRegra[];
}

export interface RegraExtracao {
  remetenteContem: string;
  assuntoContem: string | null;
  /** Corta emails parecidos: "Solicitação de Lavagem" casaria com "Cancelamento Solicitação de Lavagem". */
  assuntoNaoContem?: string | null;
  regexExtracao: string;
  template: string;
  campos?: CampoRegra[] | null;
  bloco?: BlocoRegra | null;
  derivados?: DerivadoRegra[] | null;
  /** Campo que vem de fora do email (ex: modelo/cor do veículo pela placa). */
  enriquecer?: EnriquecerRegra | null;
}

/**
 * Campo preenchido por uma busca fora do email — quem resolve é o poller, que tem
 * banco; aqui só fica declarado onde ele entra.
 *
 * `sufixo` só é aplicado quando existe valor: assim a linha fecha certo tanto com
 * "TZS7C31 — Polo Prata — Lavagem" quanto com "TZS7C31 — Lavagem", sem traço solto.
 */
export interface EnriquecerRegra {
  /** Chave que alimenta a busca (ex: `placa`). */
  de: string;
  /** Chave criada (ex: `veiculo`). */
  chave: string;
  /** Onde a origem vive: em cada item do bloco ou no corpo da regra. */
  em: 'bloco' | 'regra';
  prefixo?: string;
  sufixo?: string;
}

export interface EmailLido {
  de: string;
  assunto: string;
  texto: string;
}

/** Corta o valor capturado: regex ampla não pode virar vazamento do email inteiro. */
const MAX_VALOR = 100;
/** O bloco é uma tabela de itens, não o corpo do email. */
const MAX_OCORRENCIAS = 20;

/** Espaços e quebras de linha viram um espaço só: o texto do email quebra no meio das palavras. */
function limpar(bruto: string | undefined): string {
  return String(bruto ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_VALOR);
}

/**
 * Reduz um valor a uma chave comparável: "R$ 130,00", "130,00" e "130" viram "130".
 * Texto que não tem número é comparado em minúsculas.
 */
function chaveDeBusca(bruto: string): string {
  const texto = String(bruto ?? '').trim();
  const numero = texto.replace(/[^0-9.,]/g, '');
  if (numero) {
    const inteiro = numero.split(',')[0].replace(/\./g, '');
    if (inteiro) return inteiro;
  }
  return texto.toLowerCase();
}

/** Cria os campos calculados a partir dos já extraídos. */
function aplicarDerivados(valores: Record<string, string>, derivados: DerivadoRegra[] | null | undefined): void {
  for (const d of derivados ?? []) {
    const origem = chaveDeBusca(valores[d.de] ?? '');
    const tabela = Object.entries(d.valores ?? {});
    const achado = tabela.find(([k]) => chaveDeBusca(k) === origem);
    valores[d.chave] = achado ? achado[1] : (d.padrao ?? '');
  }
}

function aplicar(template: string, valores: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (tudo, chave) =>
    Object.prototype.hasOwnProperty.call(valores, chave) ? valores[chave] : tudo
  );
}

/** Uma regex que não casa nada devolve null; uma regex inválida nunca derruba o ciclo. */
function casar(texto: string, regex: string): RegExpMatchArray | null {
  try {
    return texto.match(new RegExp(regex, 'i'));
  } catch {
    return null;
  }
}

/** Os valores de cada ocorrência do bloco — o texto só é montado em `renderizar`. */
function extrairBloco(texto: string, bloco: BlocoRegra): Record<string, string>[] {
  let re: RegExp;
  try {
    re = new RegExp(bloco.regex, 'gi');
  } catch {
    return [];
  }
  const itens: Record<string, string>[] = [];
  for (const m of texto.matchAll(re)) {
    const valores: Record<string, string> = {};
    bloco.chaves.forEach((chave, i) => { valores[chave] = limpar(m[i + 1]); });
    aplicarDerivados(valores, bloco.derivados);
    itens.push(valores);
    if (itens.length >= MAX_OCORRENCIAS) break;
  }
  return itens;
}

/** O que foi lido do email, antes de virar texto. */
export interface Extracao {
  valores: Record<string, string>;
  /** Uma entrada por ocorrência do bloco; vazio quando a regra não tem bloco. */
  itens: Record<string, string>[];
}

/**
 * Lê o email e devolve os valores, ou null quando o email não é esse.
 *
 * Não dispara se faltar o que identifica o email: o valor principal, um campo marcado
 * como obrigatório ou, havendo bloco, pelo menos uma ocorrência dele. Mandar a
 * mensagem pela metade seria pior que não mandar — alguém iria buscar um carro sem placa.
 */
export function extrair(regra: RegraExtracao, email: EmailLido): Extracao | null {
  const de = (email.de || '').toLowerCase();
  if (!de.includes(regra.remetenteContem.toLowerCase())) return null;

  const assunto = (email.assunto || '').toLowerCase();
  if (regra.assuntoContem && !assunto.includes(regra.assuntoContem.toLowerCase())) return null;
  if (regra.assuntoNaoContem && assunto.includes(regra.assuntoNaoContem.toLowerCase())) return null;

  const texto = email.texto || '';
  const valores: Record<string, string> = {};

  const principal = casar(texto, regra.regexExtracao);
  if (!principal) return null;
  valores.valor = limpar(principal[1] ?? principal[0]);

  for (const campo of regra.campos ?? []) {
    const m = casar(texto, campo.regex);
    if (!m && !campo.opcional) return null;
    valores[campo.chave] = m ? limpar(m[1] ?? m[0]) : '';
  }

  aplicarDerivados(valores, regra.derivados);

  let itens: Record<string, string>[] = [];
  if (regra.bloco) {
    itens = extrairBloco(texto, regra.bloco);
    if (!itens.length) return null;
  }

  return { valores, itens };
}

/** Escreve o campo enriquecido, com o sufixo só quando veio valor. */
export function aplicarEnriquecimento(
  alvo: Record<string, string>,
  regra: EnriquecerRegra,
  valor: string
): void {
  const limpo = limpar(valor);
  alvo[regra.chave] = limpo ? `${regra.prefixo ?? ''}${limpo}${regra.sufixo ?? ''}` : '';
}

/** Monta o texto final a partir do que foi extraído (e, se for o caso, enriquecido). */
export function renderizar(regra: RegraExtracao, ex: Extracao): string {
  const valores = { ...ex.valores };
  if (regra.bloco) {
    const linhas = ex.itens.map((item) => aplicar(regra.bloco!.template, item));
    valores[regra.bloco.chaveLista || 'itens'] = linhas.join(regra.bloco.separador ?? '\n');
  }
  return aplicar(regra.template, valores);
}

/** Atalho pra quem não precisa enriquecer nada no meio do caminho. */
export function montarMensagem(regra: RegraExtracao, email: EmailLido): string | null {
  const ex = extrair(regra, email);
  return ex ? renderizar(regra, ex) : null;
}
