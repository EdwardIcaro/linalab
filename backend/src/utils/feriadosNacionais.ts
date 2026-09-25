/**
 * Feriados nacionais brasileiros, calculados sem depender de ninguém.
 *
 * Sem API externa de propósito: uma consulta que falha no dia 11 de outubro faz o
 * sistema tratar o dia 12 como expediente normal e cobrar jornada de todo mundo. A
 * tabela é curta, muda de década em década, e o cálculo dos móveis é fechado.
 *
 * Feriados municipais e estaduais não têm como ser adivinhados — esses o gestor cadastra
 * na tela de feriados, e continuam funcionando como antes.
 */

/** Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher (calendário gregoriano). */
function domingoDePascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function somarDias(base: Date, dias: number): string {
  const d = new Date(base.getTime() + dias * 86400000);
  return d.toISOString().slice(0, 10);
}

export interface FeriadoNacional {
  data: string; // YYYY-MM-DD
  nome: string;
  /** Ponto facultativo por lei federal, mas que a maioria do comércio fecha. */
  facultativo?: boolean;
}

// Datas fixas. 20/11 entrou na lista nacional pela Lei 14.759/2023.
const FIXOS: { md: string; nome: string }[] = [
  { md: '01-01', nome: 'Confraternização Universal' },
  { md: '04-21', nome: 'Tiradentes' },
  { md: '05-01', nome: 'Dia do Trabalho' },
  { md: '09-07', nome: 'Independência do Brasil' },
  { md: '10-12', nome: 'Nossa Senhora Aparecida' },
  { md: '11-02', nome: 'Finados' },
  { md: '11-15', nome: 'Proclamação da República' },
  { md: '11-20', nome: 'Consciência Negra' },
  { md: '12-25', nome: 'Natal' },
];

/** Todos os feriados nacionais de um ano, em ordem. */
export function feriadosNacionais(ano: number): FeriadoNacional[] {
  const pascoa = domingoDePascoa(ano);
  const moveis: FeriadoNacional[] = [
    { data: somarDias(pascoa, -48), nome: 'Carnaval (segunda)', facultativo: true },
    { data: somarDias(pascoa, -47), nome: 'Carnaval', facultativo: true },
    { data: somarDias(pascoa, -2), nome: 'Sexta-feira Santa' },
    { data: somarDias(pascoa, 60), nome: 'Corpus Christi', facultativo: true },
  ];
  const fixos = FIXOS.map((f) => ({ data: `${ano}-${f.md}`, nome: f.nome }));
  return [...fixos, ...moveis].sort((a, b) => a.data.localeCompare(b.data));
}

/** O feriado nacional de um dia, se houver. */
export function feriadoNacionalDo(dia: string): FeriadoNacional | null {
  const ano = Number(dia.slice(0, 4));
  return feriadosNacionais(ano).find((f) => f.data === dia) ?? null;
}

/** Feriados nacionais que caem entre duas datas (inclusive), cruzando o ano se preciso. */
export function feriadosNacionaisEntre(de: string, ate: string): FeriadoNacional[] {
  const anos = new Set([Number(de.slice(0, 4)), Number(ate.slice(0, 4))]);
  return [...anos]
    .flatMap((ano) => feriadosNacionais(ano))
    .filter((f) => f.data >= de && f.data <= ate)
    .sort((a, b) => a.data.localeCompare(b.data));
}
