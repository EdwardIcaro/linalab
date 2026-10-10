/**
 * Arredonda as partes de uma comissão dividida para centavos SEM perder nem
 * criar centavo: a soma das partes arredondadas é exatamente o total
 * arredondado. Quem tem a maior fração recebe o centavo que sobra (empate:
 * a ordem da lista).
 *
 * Ex.: [6.125, 6.125] (R$ 12,25) → [6.13, 6.12]
 *      [15.1666…, 15.1666…, 15.1666…] (R$ 45,50) → [15.17, 15.17, 15.16]
 *
 * Antes cada parte ficava com a fração (6,125) e a tela arredondava cada uma
 * para 6,13 — a soma do que os funcionários viam passava 1 centavo do total.
 */
export function dividirEmCentavos(partes: number[]): number[] {
  if (partes.length === 0) return [];
  const brutos = partes.map(v => (Number.isFinite(v) ? v * 100 : 0));
  const pisos = brutos.map(c => Math.floor(c + 1e-9));
  const alvo = Math.round(brutos.reduce((s, c) => s + c, 0));
  let sobra = alvo - pisos.reduce((s, c) => s + c, 0);
  const ordem = brutos
    .map((c, i) => ({ i, frac: c - pisos[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of ordem) {
    if (sobra <= 0) break;
    pisos[i] += 1;
    sobra -= 1;
  }
  return pisos.map(c => c / 100);
}

/** Arredonda um valor monetário para centavos */
export const arredondarCentavos = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;
