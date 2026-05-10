// Caracteres sem I, O, 0, 1 para evitar confusão visual
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function gerarTokenCurto(tamanho = 8): string {
  let token = '';
  for (let i = 0; i < tamanho; i++) {
    token += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return token;
}
