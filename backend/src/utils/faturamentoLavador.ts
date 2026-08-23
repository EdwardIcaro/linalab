type OrdemParaSplit = {
  valorTotal: number;
  lavadorId: string | null;
  ordemLavadores: { lavadorId: string }[];
  pagamentos?: { metodo: string; valor: number }[];
};

/** Bruto líquido de cortesia da ordem (mesma regra usada no faturamento do resto do sistema). */
function valorLiquidoCortesia(o: { valorTotal: number; pagamentos?: { metodo: string; valor: number }[] }): number {
  const cortesia = (o.pagamentos ?? [])
    .filter(p => p.metodo === 'CORTESIA')
    .reduce((s, p) => s + p.valor, 0);
  return o.valorTotal - cortesia;
}

/**
 * Divide o bruto (líquido de cortesia) de cada ordem entre os lavadores atribuídos.
 * - Se houver linhas em ordemLavadores, divide por cabeça (ordemLavadores.length).
 * - Senão, se lavadorId estiver setado (ordem legado sem linha pivot), bruto inteiro pra ele.
 */
export function faturamentoBrutoPorLavador(
  ordens: OrdemParaSplit[],
): Map<string, { bruto: number; ordens: number }> {
  const map = new Map<string, { bruto: number; ordens: number }>();
  const add = (id: string, brutoParcela: number) => {
    const cur = map.get(id) ?? { bruto: 0, ordens: 0 };
    cur.bruto += brutoParcela;
    cur.ordens += 1;
    map.set(id, cur);
  };

  for (const o of ordens) {
    const net = valorLiquidoCortesia(o);
    if (o.ordemLavadores.length > 0) {
      const parcela = net / o.ordemLavadores.length;
      for (const ol of o.ordemLavadores) add(ol.lavadorId, parcela);
    } else if (o.lavadorId) {
      add(o.lavadorId, net);
    }
  }

  return map;
}
