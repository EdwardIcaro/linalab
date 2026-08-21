// Espelha a métrica usada no client (DESKTOPV2/face.js) — distância euclidiana
// entre descritores de 128 números. Mantém os dois lados calibrados igual.
export function distanciaEuclidiana(a: number[], b: number[]): number {
  let soma = 0;
  for (let i = 0; i < 128; i++) {
    const d = a[i] - b[i];
    soma += d * d;
  }
  return Math.sqrt(soma);
}

export function embeddingValido(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === 128 && v.every((n) => typeof n === 'number' && isFinite(n));
}
