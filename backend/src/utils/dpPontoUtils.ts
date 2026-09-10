interface DpMarcacaoMinima {
  tipo: string;
  timestamp: Date;
}

const COOLDOWN_MIN = 5;

// Decide ENTRADA/SAIDA pela última marcação do dia e bloqueia repetição do
// mesmo tipo dentro do cooldown (evita duplo toque acidental).
export function determinarTipoEValidarCooldown(marcacoesHoje: DpMarcacaoMinima[]): {
  tipo: 'ENTRADA' | 'SAIDA';
  cooldownErro: string | null;
} {
  const ultima = marcacoesHoje[marcacoesHoje.length - 1];
  const tipo: 'ENTRADA' | 'SAIDA' = (!ultima || ultima.tipo === 'SAIDA') ? 'ENTRADA' : 'SAIDA';

  if (ultima && ultima.tipo === tipo) {
    const diffMin = (Date.now() - new Date(ultima.timestamp).getTime()) / 60000;
    if (diffMin < COOLDOWN_MIN) {
      const wait = Math.ceil(COOLDOWN_MIN - diffMin);
      return { tipo, cooldownErro: `Aguarde ${wait} minuto${wait !== 1 ? 's' : ''} para bater ponto novamente.` };
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
