/**
 * Consumo do banco de horas na ordem em que as horas entraram.
 *
 * O prazo de compensação da CLT (art. 59: 6 meses por acordo individual, 12 por acordo
 * coletivo) conta a partir de quando a hora foi trabalhada — não do saldo total. Então
 * "o Felipe tem 12h" não responde a pergunta que importa, que é "quando essas 12h
 * vencem". Para responder, é preciso saber de que lote cada hora veio.
 *
 * A fila é FIFO porque é o que favorece o funcionário e o empregador ao mesmo tempo:
 * gasta primeiro o que está perto de vencer, e sobra menos coisa virando hora extra
 * devida por decurso de prazo.
 *
 * Funções puras — recebem os lançamentos e devolvem a conta. Nada de banco aqui.
 */

export interface Movimento {
  tipo: string;     // CICLO | FOLGA_COMP | PAGAMENTO | VENCIMENTO | AJUSTE
  horas: number;    // positivo credita, negativo debita
  data: string;     // YYYY-MM-DD
}

export interface LoteCredito {
  data: string;        // quando as horas foram creditadas
  horas: number;       // quanto ainda resta deste lote
  venceEm: string;     // último dia para compensar
  vencido: boolean;
}

export interface EstadoBanco {
  saldo: number;
  /** Créditos ainda não consumidos, do mais antigo para o mais novo. */
  lotes: LoteCredito[];
  /** Soma dos lotes que já passaram do prazo — viram hora extra a pagar. */
  horasVencidas: number;
  /** Soma dos lotes que vencem dentro da janela de alerta. */
  horasAVencer: number;
  /** Data do lote mais antigo ainda aberto — o que vence primeiro. */
  proximoVencimento: string | null;
  /** Débito que não encontrou crédito: jornada devida pelo funcionário. */
  saldoDevedor: number;
}

export function somarMeses(dia: string, meses: number): string {
  const [ano, mes, d] = dia.split('-').map(Number);
  const base = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  // Mantém o dia; se o mês de destino for mais curto, cai no último dia dele
  const ultimoDoMes = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, ultimoDoMes));
  return base.toISOString().slice(0, 10);
}

/**
 * Estado do banco de horas a partir do extrato.
 *
 * `hoje` define o que já venceu; `diasDeAlerta` define o que conta como "a vencer".
 */
export function estadoDoBanco(
  movimentos: Movimento[],
  prazoMeses: number,
  hoje: string,
  diasDeAlerta = 30,
): EstadoBanco {
  const ordenados = [...movimentos].sort((a, b) => a.data.localeCompare(b.data));

  const fila: { data: string; horas: number }[] = [];
  let devedor = 0; // débito sem crédito para consumir

  for (const m of ordenados) {
    if (m.horas > 0) {
      // Crédito novo primeiro quita o que o funcionário devia
      let entrando = m.horas;
      if (devedor > 0) {
        const abate = Math.min(devedor, entrando);
        devedor -= abate;
        entrando -= abate;
      }
      if (entrando > 0) fila.push({ data: m.data, horas: entrando });
    } else if (m.horas < 0) {
      let aConsumir = -m.horas;
      while (aConsumir > 0 && fila.length > 0) {
        const lote = fila[0];
        const usa = Math.min(lote.horas, aConsumir);
        lote.horas -= usa;
        aConsumir -= usa;
        if (lote.horas <= 0.0001) fila.shift();
      }
      if (aConsumir > 0.0001) devedor += aConsumir;
    }
  }

  const limiteAlerta = somarDias(hoje, diasDeAlerta);
  const lotes: LoteCredito[] = fila.map((l) => {
    const venceEm = somarMeses(l.data, prazoMeses);
    return { data: l.data, horas: arred(l.horas), venceEm, vencido: venceEm < hoje };
  });

  const horasVencidas = arred(lotes.filter((l) => l.vencido).reduce((s, l) => s + l.horas, 0));
  const horasAVencer = arred(
    lotes.filter((l) => !l.vencido && l.venceEm <= limiteAlerta).reduce((s, l) => s + l.horas, 0),
  );
  const abertos = lotes.filter((l) => !l.vencido);

  return {
    saldo: arred(lotes.reduce((s, l) => s + l.horas, 0) - devedor),
    lotes,
    horasVencidas,
    horasAVencer,
    proximoVencimento: abertos.length ? abertos[0].venceEm : null,
    saldoDevedor: arred(devedor),
  };
}

function somarDias(dia: string, n: number): string {
  const d = new Date(dia + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Duas casas: o saldo é lido por pessoas, não por contador de ponto flutuante. */
function arred(x: number): number {
  return Math.round(x * 100) / 100;
}

/** "2.5" → "2h30", com sinal. */
export function formatarHoras(x: number): string {
  const neg = x < 0;
  const abs = Math.abs(x);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return `${neg ? '−' : '+'}${h}h${String(m).padStart(2, '0')}`;
}
