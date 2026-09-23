interface DpMarcacaoMinima {
  tipo: string;
  timestamp: Date;
}

// Janela curta contra duplo toque. Não é "intervalo mínimo entre turnos": é o tempo
// que o aparelho leva pra dar retorno visual. Dados reais mostraram batidas do mesmo
// funcionário com 11s e até 0s de diferença (03/09 e 21/09/2026), sempre acidentais.
const COOLDOWN_SEG = 90;

// Decide ENTRADA/SAIDA pela última marcação do dia e bloqueia qualquer batida logo
// na sequência da anterior.
//
// ⚠️ A checagem antiga comparava o tipo calculado com o tipo da última marcação — só que
// o tipo calculado é SEMPRE o oposto do último, então a condição nunca era verdadeira e
// o cooldown nunca disparou. O efeito no mundo real era pior que uma batida a mais: o
// segundo toque virava ENTRADA logo depois da SAIDA e deixava o turno aberto, o que
// inflava o dia inteiro no espelho. Por isso a comparação agora é com a própria última
// marcação, qualquer que seja o tipo dela.
export function determinarTipoEValidarCooldown(marcacoesHoje: DpMarcacaoMinima[]): {
  tipo: 'ENTRADA' | 'SAIDA';
  cooldownErro: string | null;
} {
  const ultima = marcacoesHoje[marcacoesHoje.length - 1];
  const tipo: 'ENTRADA' | 'SAIDA' = (!ultima || ultima.tipo === 'SAIDA') ? 'ENTRADA' : 'SAIDA';

  if (ultima) {
    const diffSeg = (Date.now() - new Date(ultima.timestamp).getTime()) / 1000;
    if (diffSeg >= 0 && diffSeg < COOLDOWN_SEG) {
      return {
        tipo,
        cooldownErro: `Seu ponto de ${ultima.tipo.toLowerCase()} já foi registrado agora há pouco. Aguarde um instante antes de bater de novo.`,
      };
    }
  }
  return { tipo, cooldownErro: null };
}

// Feriado exato (data igual) ou recorrente (mesmo mês/dia, ano ignorado).
export function resolveFeriadoDia(
  dia: string,
  feriados: { data: string; nome: string; recorrente: boolean }[],
): string | null {
  for (const f of feriados) {
    if (f.data === dia) return f.nome;
    if (f.recorrente && f.data.slice(5) === dia.slice(5)) return f.nome;
  }
  return null;
}

// Comparação lexicográfica de strings YYYY-MM-DD é cronológica — sem parse de Date.
export function resolveAfastamentoDia(
  funcionarioId: string,
  dia: string,
  afastamentos: { funcionarioId: string; tipo: string; dataInicio: string; dataFim: string }[],
): string | null {
  const af = afastamentos.find(
    a => a.funcionarioId === funcionarioId && a.dataInicio <= dia && dia <= a.dataFim,
  );
  return af ? af.tipo : null;
}

// Dia da semana (0=dom...6=sáb) fora dos dias de funcionamento configurados pela empresa.
export function isDiaFechado(diaSemana: number, diasFuncionamento: number[]): boolean {
  return !diasFuncionamento.includes(diaSemana);
}

/** "08:30" → 510. Fora do formato vira 0, nunca NaN. */
export function horaParaMin(horaStr: string | null | undefined): number {
  const [h, m] = String(horaStr || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Carga diária que a jornada da empresa descreve: saída − entrada − intervalo.
 *
 * É o que o contrato diz, e vale mais que o 8h fixo que estava no código: uma empresa
 * 08:00–18:00 com 2h de almoço dá 8h por coincidência, mas 08:00–16:00 com 1h dá 7h e
 * o sistema continuaria cobrando 8h — falta de meia hora todo dia, no papel.
 * `null` quando a configuração não descreve uma jornada plausível.
 */
export function cargaDaJornada(
  entrada: string | null | undefined,
  saida: string | null | undefined,
  intervaloMin: number | null | undefined,
): number | null {
  if (!entrada || !saida) return null;
  let bruto = horaParaMin(saida) - horaParaMin(entrada);
  if (bruto <= 0) bruto += 24 * 60; // jornada que atravessa a meia-noite
  const liquido = bruto - (intervaloMin ?? 0);
  if (liquido <= 0 || liquido > 16 * 60) return null;
  return liquido / 60;
}

// Hierarquia da carga esperada, do mais específico pro mais geral:
// override individual > cargo > jornada da empresa > 8h.
export function resolverCargaHorariaDia(
  cargaIndividual: number | null | undefined,
  cargaCargo: number | null | undefined,
  cargaJornada?: number | null,
): number {
  return cargaIndividual ?? cargaCargo ?? cargaJornada ?? 8;
}

/** Última marcação é ENTRADA — ou seja, o turno nunca foi fechado. */
export function temTurnoAberto(marcacoes: DpMarcacaoMinima[]): boolean {
  const ultima = marcacoes[marcacoes.length - 1];
  return !!ultima && ultima.tipo === 'ENTRADA';
}

/**
 * Soma minutos trabalhados a partir de pares ENTRADA/SAÍDA.
 *
 * `fim` é o que fecha uma ENTRADA sem SAÍDA correspondente:
 *  - `Date`  → turno em andamento (hoje): conta até esse instante;
 *  - `null`  → dia já encerrado sem ninguém bater a saída: **não conta nada** do trecho
 *    aberto, e o dia é sinalizado como INCOMPLETO pra quem for corrigir.
 *
 * O `null` existe porque o comportamento antigo era fechar o trecho aberto no fim do dia
 * (23:59). Quem esquecia a saída ganhava o dia inteiro: em 09/2026 isso somava 158,9h
 * fantasmas em 15 dias-funcionário, e viraria crédito permanente de hora extra assim que o
 * banco de horas fosse ligado. Não contar é o único padrão seguro — o valor verdadeiro
 * entra quando o gestor corrigir ou o encerramento automático fechar o turno.
 */
export function calcMinutosTrabalhados(
  marcacoes: Array<{ tipo: string; timestamp: Date }>,
  fim: Date | null,
): number {
  let total = 0;
  let i = 0;
  while (i < marcacoes.length) {
    if (marcacoes[i].tipo === 'ENTRADA') {
      let j = i + 1;
      while (j < marcacoes.length && marcacoes[j].tipo !== 'SAIDA') j++;
      if (j < marcacoes.length) {
        total += Math.round((marcacoes[j].timestamp.getTime() - marcacoes[i].timestamp.getTime()) / 60000);
        i = j + 1;
      } else {
        if (fim) total += Math.round((fim.getTime() - marcacoes[i].timestamp.getTime()) / 60000);
        i++;
      }
    } else {
      i++;
    }
  }
  return total;
}

// Minutos depois do horário de saída. Folga generosa de propósito: cobrar cedo demais
// transforma atraso em cobrança, e o lembrete perde o tom de lembrete.
//
// Não existe lembrete de ENTRADA de propósito: ninguém consegue distinguir quem esqueceu
// de bater de quem simplesmente não veio, e mandar "não esqueça de bater seu ponto" pra
// quem está de atestado é constrangimento gratuito. O turno aberto é o oposto disso — a
// pessoa provadamente está lá, porque bateu a entrada.
export const LEMBRETE_SAIDA_MIN   = 15;  // turno aberto, depois da hora de sair
export const ENCERRA_APOS_MIN     = 120; // turno aberto: encerra e avisa o gestor

// Teto do que o sistema aceita fechar sozinho. Acima disso a entrada quase certamente
// não é uma entrada de verdade — é a saída da véspera que caiu do outro lado da
// meia-noite, ou uma batida errada — e fechar daria uma jornada que ninguém cumpriu.
export const MAX_TURNO_AUTO_MIN = 12 * 60;

export type AcaoPonto =
  | 'NADA'
  | 'LEMBRAR_SAIDA'
  | 'ENCERRAR'
  | 'CORRIGIR_MANUAL';

/**
 * O que fazer com o ponto de alguém, agora, olhando só para o dia de hoje.
 *
 * Tudo em minutos desde 00:00 BRT. `CORRIGIR_MANUAL` é o caso sem resposta honesta:
 * turno aberto que começou depois do fim da jornada (ou empresa que pediu encerramento
 * manual) não tem horário de saída plausível pra inventar — quem decide é o gestor.
 */
export function decidirAcaoPonto(params: {
  marcacoes: DpMarcacaoMinima[];
  inicioDiaMs: number; // 00:00 BRT do dia, em epoch — âncora de todos os minutos abaixo
  agoraMin: number;
  saidaMin: number;
  fechaSozinho: boolean;
}): AcaoPonto {
  const { marcacoes, inicioDiaMs, agoraMin, saidaMin, fechaSozinho } = params;

  // Dia sem nenhuma batida pode ser falta, folga ou esquecimento: o sistema não sabe,
  // então não fala nada com o funcionário.
  if (!temTurnoAberto(marcacoes)) return 'NADA';

  const aberta = marcacoes[marcacoes.length - 1];
  const abertaMin = Math.floor((aberta.timestamp.getTime() - inicioDiaMs) / 60000);

  if (agoraMin >= saidaMin + ENCERRA_APOS_MIN) {
    const cabeNoTeto = saidaMin - abertaMin <= MAX_TURNO_AUTO_MIN;
    return fechaSozinho && abertaMin < saidaMin && cabeNoTeto ? 'ENCERRAR' : 'CORRIGIR_MANUAL';
  }
  if (agoraMin >= saidaMin + LEMBRETE_SAIDA_MIN) return 'LEMBRAR_SAIDA';
  return 'NADA';
}

/**
 * Desconta o intervalo quando a pausa não foi registrada.
 *
 * Quem bate as quatro vezes já tem o almoço fora da conta — o par SAÍDA/ENTRADA do
 * meio do dia cuida disso sozinho. O problema é quem bate só duas: em 09/2026, 10 dos
 * 30 dias de um dos funcionários vieram assim, entrando 08:04 e saindo 18:26, e o
 * sistema lia 10h21 de trabalho e 2h21 de hora extra que não existiram.
 *
 * A dedução é uma presunção, e por isso tem dois limites: só vale para o dia já fechado
 * (turno aberto ainda pode receber a pausa) e nunca empurra o total abaixo da carga
 * contratada — quem ficou 8h30 sem pausa fica com 8h, não com 6h30. O espelho mostra
 * que o desconto foi presumido, para o gestor poder lançar a pausa real por cima.
 */
export function ajustarIntervaloPresumido(
  marcacoes: DpMarcacaoMinima[],
  minutosTrabalhados: number,
  cargaMin: number,
  intervaloMin: number | null | undefined,
): { minutos: number; intervaloPresumido: number } {
  const semDesconto = { minutos: minutosTrabalhados, intervaloPresumido: 0 };
  if (!intervaloMin || intervaloMin <= 0) return semDesconto;
  if (temTurnoAberto(marcacoes)) return semDesconto;
  if (minutosTrabalhados <= cargaMin) return semDesconto;

  const registrouPausa = marcacoes.some(
    (m, i) => i > 0 && marcacoes[i - 1].tipo === 'SAIDA' && m.tipo === 'ENTRADA',
  );
  if (registrouPausa) return semDesconto;

  const minutos = Math.max(cargaMin, minutosTrabalhados - intervaloMin);
  return { minutos, intervaloPresumido: minutosTrabalhados - minutos };
}
