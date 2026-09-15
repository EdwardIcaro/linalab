// Erro com mensagem pensada pro usuário: pode ir na resposta HTTP.
// Qualquer outro erro (Prisma, rede, bug) vira mensagem genérica — o detalhe fica só no log do servidor.
export class ErroPublico extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroPublico';
  }
}
