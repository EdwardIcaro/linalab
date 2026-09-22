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

/** Todas as ocorrências do bloco, já viradas em texto. */
function extrairBloco(texto: string, bloco: BlocoRegra): string[] {
  let re: RegExp;
  try {
    re = new RegExp(bloco.regex, 'gi');
  } catch {
    return [];
  }
  const linhas: string[] = [];
  for (const m of texto.matchAll(re)) {
    const valores: Record<string, string> = {};
    bloco.chaves.forEach((chave, i) => { valores[chave] = limpar(m[i + 1]); });
    linhas.push(aplicar(bloco.template, valores));
    if (linhas.length >= MAX_OCORRENCIAS) break;
  }
  return linhas;
}

/**
 * Aplica a regra e devolve a mensagem pronta, ou null quando o email não é esse.
 *
 * Não dispara se faltar o que identifica o email: o valor principal, um campo marcado
 * como obrigatório ou, havendo bloco, pelo menos uma ocorrência dele. Mandar a
 * mensagem pela metade seria pior que não mandar — alguém iria buscar um carro sem placa.
 */
export function montarMensagem(regra: RegraExtracao, email: EmailLido): string | null {
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

  if (regra.bloco) {
    const linhas = extrairBloco(texto, regra.bloco);
    if (!linhas.length) return null;
    valores[regra.bloco.chaveLista || 'itens'] = linhas.join(regra.bloco.separador ?? '\n');
  }

  return aplicar(regra.template, valores);
}
