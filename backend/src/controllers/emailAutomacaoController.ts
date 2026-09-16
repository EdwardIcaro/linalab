import { Request, Response } from 'express';
import prisma from '../db';
import { criptografar, descriptografar, aadDaConta, chaveConfigurada } from '../utils/credCrypto';
import { verificarRateLimit } from '../utils/rateLimiter';
import { testarLogin, listarRecentes, lerEmail as lerEmailImap, ErroImap } from '../services/emailImapService';
import { botSendCaptureJid } from '../services/botServiceClient';
import { resolverDestinos, enfileirarEnvios, DestinoRegra } from '../services/emailAutomacaoFila';

/**
 * Automação de Email por empresa (Features/automacao-email.md).
 *
 * Regras de segurança aplicadas aqui (revisão de 15/09, seção 5 da spec):
 * - empresaId SEMPRE do token (req.empresaId), nunca do corpo/query;
 * - toda busca por id filtra também por empresaId → id de outra empresa responde 404;
 * - senha nunca volta pro frontend e nunca vai pro log;
 * - limite de tentativas pra ninguém usar a Lina como testador de senha roubada;
 * - destinos são IDs de contatos da própria empresa, resolvidos em telefone só no envio.
 */

const LIMITE_CONTAS = 2;
const LIMITE_REGRAS_POR_CONTA = 10;
const MAX_REGEX = 300;
const MAX_TEMPLATE = 300;
const MAX_NOME = 60;

interface Req extends Request {
  empresaId?: string;
  usuarioId?: string;
  subaccountId?: string;
}

const empresaDo = (req: Req) => req.empresaId as string;
const autorDo = (req: Req) => (req.subaccountId || req.usuarioId || 'desconhecido') as string;

async function auditar(empresaId: string, autorId: string, acao: string, contaId?: string | null) {
  try {
    await prisma.emailAutomacaoAuditoria.create({ data: { empresaId, autorId, acao, contaId: contaId ?? null } });
  } catch (err) {
    console.error('[EmailAutomacao] Falha ao gravar auditoria:', err);
  }
}

/** Conta da empresa do token — devolve null quando o id é de outra empresa. */
async function contaDaEmpresa(id: string, empresaId: string) {
  return prisma.emailConta.findFirst({ where: { id, empresaId } });
}

const semSenha = {
  id: true, email: true, provedor: true, status: true, ultimoErro: true,
  verificadoEm: true, createdAt: true, updatedAt: true,
} as const;

function mensagemDeErroImap(err: unknown): { status: number; mensagem: string } {
  if (err instanceof ErroImap && err.tipo === 'CREDENCIAL_INVALIDA') {
    return { status: 422, mensagem: 'Email ou senha de app incorretos. A senha de app é diferente da sua senha normal do Gmail.' };
  }
  return { status: 502, mensagem: 'Não conseguimos falar com o Gmail agora. Tente de novo em alguns minutos.' };
}

/** Só Gmail nesta rodada (o host é fixo no servidor). */
function normalizarEmail(valor: unknown): string | null {
  const email = String(valor ?? '').trim().toLowerCase();
  return /^[^\s@]+@gmail\.com$/.test(email) ? email : null;
}

/** Senha de app: 16 letras; espaços do copiar/colar são removidos. */
function normalizarSenha(valor: unknown): string | null {
  const senha = String(valor ?? '').replace(/\s+/g, '');
  return senha.length === 16 ? senha : null;
}

// ── Contas ───────────────────────────────────────────────────────────────────

export async function listarContas(req: Req, res: Response) {
  try {
    const contas = await prisma.emailConta.findMany({
      where: { empresaId: empresaDo(req) },
      select: { ...semSenha, _count: { select: { regras: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ contas, limite: LIMITE_CONTAS, chaveConfigurada: chaveConfigurada() });
  } catch (err) {
    console.error('[EmailAutomacao] Erro ao listar contas:', err);
    return res.status(500).json({ error: 'Erro ao listar as contas de email' });
  }
}

export async function criarConta(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  if (!chaveConfigurada()) {
    console.error('[EmailAutomacao] EMAIL_CRED_KEY ausente — recusando cadastro de conta.');
    return res.status(503).json({ error: 'Serviço de automação de email indisponível. Fale com o suporte.' });
  }

  const email = normalizarEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: 'Por enquanto só aceitamos contas do Gmail (@gmail.com).' });
  const senha = normalizarSenha(req.body?.senha);
  if (!senha) return res.status(400).json({ error: 'A senha de app tem exatamente 16 letras. Confira se copiou tudo.' });

  // Trava contra usar a Lina pra testar senha roubada
  if (!verificarRateLimit(`email-conta:${empresaId}`, 5, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Tente de novo em 15 minutos.' });
  }

  try {
    const [qtd, jaExiste] = await Promise.all([
      prisma.emailConta.count({ where: { empresaId } }),
      prisma.emailConta.findFirst({ where: { empresaId, email }, select: { id: true } }),
    ]);
    if (jaExiste) return res.status(409).json({ error: 'Esse email já está conectado.' });
    if (qtd >= LIMITE_CONTAS) return res.status(409).json({ error: `Sua empresa já tem ${LIMITE_CONTAS} emails conectados.` });

    await testarLogin(email, senha);

    const conta = await prisma.emailConta.create({
      data: {
        empresaId, email, provedor: 'GMAIL', status: 'CONECTADO',
        senhaCriptografada: '', // preenchido abaixo: o AAD usa o id gerado
        verificadoEm: new Date(),
        criadoPor: autorDo(req),
      },
      select: semSenha,
    });
    await prisma.emailConta.update({
      where: { id: conta.id },
      data: { senhaCriptografada: criptografar(senha, aadDaConta(empresaId, conta.id)) },
    });

    await auditar(empresaId, autorDo(req), 'CONTA_CRIADA', conta.id);
    return res.status(201).json({ conta });
  } catch (err) {
    if (err instanceof ErroImap) {
      const { status, mensagem } = mensagemDeErroImap(err);
      return res.status(status).json({ error: mensagem });
    }
    console.error('[EmailAutomacao] Erro ao criar conta:', err);
    return res.status(500).json({ error: 'Erro ao conectar o email' });
  }
}

export async function trocarSenha(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  const id = req.params.id as string;
  const senha = normalizarSenha(req.body?.senha);
  if (!senha) return res.status(400).json({ error: 'A senha de app tem exatamente 16 letras. Confira se copiou tudo.' });
  if (!verificarRateLimit(`email-conta:${empresaId}`, 5, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas tentativas. Tente de novo em 15 minutos.' });
  }

  try {
    const conta = await contaDaEmpresa(id, empresaId);
    if (!conta) return res.status(404).json({ error: 'Conta de email não encontrada' });

    await testarLogin(conta.email, senha);

    await prisma.emailConta.update({
      where: { id: conta.id },
      data: {
        senhaCriptografada: criptografar(senha, aadDaConta(empresaId, conta.id)),
        status: 'CONECTADO', ultimoErro: null, verificadoEm: new Date(),
      },
    });
    await auditar(empresaId, autorDo(req), 'SENHA_TROCADA', conta.id);
    return res.json({ ok: true });
  } catch (err) {
    if (err instanceof ErroImap) {
      const { status, mensagem } = mensagemDeErroImap(err);
      return res.status(status).json({ error: mensagem });
    }
    console.error('[EmailAutomacao] Erro ao trocar senha:', err);
    return res.status(500).json({ error: 'Erro ao trocar a senha' });
  }
}

export async function verificarConta(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  const id = req.params.id as string;
  if (!verificarRateLimit(`email-verificar:${empresaId}:${id}`, 10, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas verificações seguidas. Tente de novo mais tarde.' });
  }
  try {
    const conta = await contaDaEmpresa(id, empresaId);
    if (!conta) return res.status(404).json({ error: 'Conta de email não encontrada' });

    const senha = descriptografar(conta.senhaCriptografada, aadDaConta(empresaId, conta.id));
    await testarLogin(conta.email, senha);

    await prisma.emailConta.update({
      where: { id: conta.id },
      data: { status: 'CONECTADO', ultimoErro: null, verificadoEm: new Date() },
    });
    await auditar(empresaId, autorDo(req), 'CONTA_VERIFICADA', conta.id);
    return res.json({ ok: true, status: 'CONECTADO' });
  } catch (err) {
    if (err instanceof ErroImap) {
      const { status, mensagem } = mensagemDeErroImap(err);
      if (err.tipo === 'CREDENCIAL_INVALIDA') {
        await prisma.emailConta.updateMany({
          where: { id, empresaId },
          data: { status: 'ERRO', ultimoErro: 'A senha de app foi recusada pelo Google. Troque a senha pra voltar a funcionar.' },
        });
      }
      return res.status(status).json({ error: mensagem });
    }
    console.error('[EmailAutomacao] Erro ao verificar conta:', err);
    return res.status(500).json({ error: 'Erro ao verificar a conta' });
  }
}

export async function removerConta(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  const id = req.params.id as string;
  try {
    const removidas = await prisma.emailConta.deleteMany({ where: { id, empresaId } });
    if (removidas.count === 0) return res.status(404).json({ error: 'Conta de email não encontrada' });
    await auditar(empresaId, autorDo(req), 'CONTA_REMOVIDA', id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[EmailAutomacao] Erro ao remover conta:', err);
    return res.status(500).json({ error: 'Erro ao remover a conta' });
  }
}

// ── Caixa de entrada (assistente) ────────────────────────────────────────────

export async function listarEmails(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  const id = req.params.id as string;
  if (!verificarRateLimit(`email-inbox:${empresaId}`, 30, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas consultas seguidas. Tente de novo mais tarde.' });
  }
  try {
    const conta = await contaDaEmpresa(id, empresaId);
    if (!conta) return res.status(404).json({ error: 'Conta de email não encontrada' });

    const senha = descriptografar(conta.senhaCriptografada, aadDaConta(empresaId, conta.id));
    const emails = await listarRecentes(conta.email, senha, { dias: 7, max: 20 });

    await auditar(empresaId, autorDo(req), 'EMAILS_LISTADOS', conta.id);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ emails });
  } catch (err) {
    if (err instanceof ErroImap) {
      const { status, mensagem } = mensagemDeErroImap(err);
      return res.status(status).json({ error: mensagem });
    }
    console.error('[EmailAutomacao] Erro ao listar emails:', err);
    return res.status(500).json({ error: 'Erro ao buscar os emails' });
  }
}

export async function lerEmail(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  const id = req.params.id as string;
  const uid = Number(req.params.uid);
  if (!Number.isInteger(uid) || uid <= 0) return res.status(400).json({ error: 'Email inválido' });
  if (!verificarRateLimit(`email-abrir:${empresaId}`, 60, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitas consultas seguidas. Tente de novo mais tarde.' });
  }
  try {
    const conta = await contaDaEmpresa(id, empresaId);
    if (!conta) return res.status(404).json({ error: 'Conta de email não encontrada' });

    const senha = descriptografar(conta.senhaCriptografada, aadDaConta(empresaId, conta.id));
    const email = await lerEmailImap(conta.email, senha, uid);

    await auditar(empresaId, autorDo(req), 'EMAIL_ABERTO', conta.id);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ email });
  } catch (err) {
    if (err instanceof ErroImap) {
      const { status, mensagem } = mensagemDeErroImap(err);
      return res.status(status).json({ error: mensagem });
    }
    console.error('[EmailAutomacao] Erro ao abrir email:', err);
    return res.status(500).json({ error: 'Erro ao abrir o email' });
  }
}

// ── Regras ───────────────────────────────────────────────────────────────────

type DestinoEntrada = { tipo?: unknown; id?: unknown };

/** Rejeita regex gigante, que não compila ou com repetição aninhada (trava a leitura). */
function erroNaRegex(regex: string): string | null {
  if (!regex || regex.length > MAX_REGEX) return `A regra de extração precisa ter até ${MAX_REGEX} caracteres.`;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(regex)) return 'Regra de extração com repetição dentro de repetição não é permitida.';
  try { new RegExp(regex, 'i'); } catch { return 'Regra de extração inválida.'; }
  return null;
}

/** Só aceita contatos cadastrados NA EMPRESA — impede usar o número da Lina pra spam. */
async function validarDestinos(empresaId: string, destinos: unknown): Promise<{ erro?: string; valor?: { tipo: string; id: string }[] }> {
  if (!Array.isArray(destinos) || destinos.length === 0) return { erro: 'Escolha pelo menos um destinatário.' };
  if (destinos.length > 20) return { erro: 'Escolha no máximo 20 destinatários.' };

  const limpos = (destinos as DestinoEntrada[]).map(d => ({ tipo: String(d?.tipo ?? ''), id: String(d?.id ?? '') }));
  if (limpos.some(d => !['ADMIN', 'BOT_USER', 'DESTINATARIO'].includes(d.tipo) || !d.id)) return { erro: 'Destinatário inválido.' };

  const idsAdmin = limpos.filter(d => d.tipo === 'ADMIN').map(d => d.id);
  const idsBot = limpos.filter(d => d.tipo === 'BOT_USER').map(d => d.id);
  const idsDest = limpos.filter(d => d.tipo === 'DESTINATARIO').map(d => d.id);
  const [admins, botUsers, destinatarios] = await Promise.all([
    idsAdmin.length ? prisma.whatsappAdminPhone.findMany({ where: { id: { in: idsAdmin }, empresaId }, select: { id: true } }) : [],
    idsBot.length ? prisma.whatsappBotUser.findMany({ where: { id: { in: idsBot }, empresaId }, select: { id: true } }) : [],
    idsDest.length ? prisma.emailDestinatario.findMany({ where: { id: { in: idsDest }, empresaId }, select: { id: true } }) : [],
  ]);
  if (admins.length !== idsAdmin.length || botUsers.length !== idsBot.length || destinatarios.length !== idsDest.length) {
    return { erro: 'Algum destinatário não pertence a esta empresa.' };
  }
  return { valor: limpos };
}

function erroNosCamposDaRegra(body: any): string | null {
  const nome = String(body?.nome ?? '').trim();
  if (!nome || nome.length > MAX_NOME) return `O nome precisa ter até ${MAX_NOME} caracteres.`;
  if (!String(body?.remetenteContem ?? '').trim()) return 'Informe parte do remetente.';
  const template = String(body?.template ?? '');
  if (!template || template.length > MAX_TEMPLATE) return `A mensagem precisa ter até ${MAX_TEMPLATE} caracteres.`;
  if (!template.includes('{{valor}}')) return 'A mensagem precisa conter {{valor}}.';
  return erroNaRegex(String(body?.regexExtracao ?? ''));
}

export async function listarRegras(req: Req, res: Response) {
  try {
    const regras = await prisma.emailRegra.findMany({
      where: { empresaId: empresaDo(req) },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ regras });
  } catch (err) {
    console.error('[EmailAutomacao] Erro ao listar regras:', err);
    return res.status(500).json({ error: 'Erro ao listar as automações' });
  }
}

export async function criarRegra(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  const erro = erroNosCamposDaRegra(req.body);
  if (erro) return res.status(400).json({ error: erro });

  try {
    const conta = await contaDaEmpresa(String(req.body?.contaId ?? ''), empresaId);
    if (!conta) return res.status(404).json({ error: 'Conta de email não encontrada' });

    const quantas = await prisma.emailRegra.count({ where: { contaId: conta.id } });
    if (quantas >= LIMITE_REGRAS_POR_CONTA) {
      return res.status(409).json({ error: `Cada email aceita até ${LIMITE_REGRAS_POR_CONTA} automações.` });
    }

    const destinos = await validarDestinos(empresaId, req.body?.destinos);
    if (destinos.erro) return res.status(400).json({ error: destinos.erro });

    const regra = await prisma.emailRegra.create({
      data: {
        empresaId, contaId: conta.id,
        nome: String(req.body.nome).trim(),
        ativo: req.body.ativo !== false,
        remetenteContem: String(req.body.remetenteContem).trim(),
        assuntoContem: req.body.assuntoContem ? String(req.body.assuntoContem).trim() : null,
        regexExtracao: String(req.body.regexExtracao),
        tipoValor: ['CODIGO', 'ALFANUMERICO', 'VALOR', 'LINK', 'AVANCADO'].includes(req.body.tipoValor) ? req.body.tipoValor : 'AVANCADO',
        ancora: req.body.ancora ? String(req.body.ancora).slice(0, 120) : null,
        template: String(req.body.template),
        destinos: destinos.valor,
        destinoTipo: 'NUMEROS', // legado (automação global) — não usado nas regras novas
        destinoValor: '',
      },
    });
    await auditar(empresaId, autorDo(req), 'REGRA_CRIADA', conta.id);
    return res.status(201).json({ regra });
  } catch (err) {
    console.error('[EmailAutomacao] Erro ao criar regra:', err);
    return res.status(500).json({ error: 'Erro ao criar a automação' });
  }
}

export async function atualizarRegra(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  const id = req.params.id as string;

  // Só o liga/desliga não exige o resto dos campos
  const soToggle = Object.keys(req.body ?? {}).length === 1 && typeof req.body?.ativo === 'boolean';
  if (!soToggle) {
    const erro = erroNosCamposDaRegra(req.body);
    if (erro) return res.status(400).json({ error: erro });
  }

  try {
    const atual = await prisma.emailRegra.findFirst({ where: { id, empresaId } });
    if (!atual) return res.status(404).json({ error: 'Automação não encontrada' });

    if (soToggle) {
      const regra = await prisma.emailRegra.update({ where: { id }, data: { ativo: req.body.ativo } });
      return res.json({ regra });
    }

    const destinos = await validarDestinos(empresaId, req.body?.destinos);
    if (destinos.erro) return res.status(400).json({ error: destinos.erro });

    const regra = await prisma.emailRegra.update({
      where: { id },
      data: {
        nome: String(req.body.nome).trim(),
        ativo: req.body.ativo !== false,
        remetenteContem: String(req.body.remetenteContem).trim(),
        assuntoContem: req.body.assuntoContem ? String(req.body.assuntoContem).trim() : null,
        regexExtracao: String(req.body.regexExtracao),
        tipoValor: ['CODIGO', 'ALFANUMERICO', 'VALOR', 'LINK', 'AVANCADO'].includes(req.body.tipoValor) ? req.body.tipoValor : 'AVANCADO',
        ancora: req.body.ancora ? String(req.body.ancora).slice(0, 120) : null,
        template: String(req.body.template),
        destinos: destinos.valor,
      },
    });
    await auditar(empresaId, autorDo(req), 'REGRA_ATUALIZADA', atual.contaId);
    return res.json({ regra });
  } catch (err) {
    console.error('[EmailAutomacao] Erro ao atualizar regra:', err);
    return res.status(500).json({ error: 'Erro ao atualizar a automação' });
  }
}

export async function removerRegra(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  const id = req.params.id as string;
  try {
    const removidas = await prisma.emailRegra.deleteMany({ where: { id, empresaId } });
    if (removidas.count === 0) return res.status(404).json({ error: 'Automação não encontrada' });
    await auditar(empresaId, autorDo(req), 'REGRA_REMOVIDA');
    return res.json({ ok: true });
  } catch (err) {
    console.error('[EmailAutomacao] Erro ao remover regra:', err);
    return res.status(500).json({ error: 'Erro ao remover a automação' });
  }
}

// ── Contatos e teste de envio ────────────────────────────────────────────────

/** Contatos que podem receber mensagem (para o assistente montar a lista). */
export async function listarContatos(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  try {
    const [admins, botUsers, destinatarios] = await Promise.all([
      prisma.whatsappAdminPhone.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, telefone: true, jid: true } }),
      prisma.whatsappBotUser.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, telefone: true, jid: true, role: true } }),
      prisma.emailDestinatario.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, telefone: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const mascarar = (t?: string | null) => {
      const d = String(t ?? '').replace(/\D/g, '');
      return d.length >= 8 ? `${d.slice(0, 4)}•••••${d.slice(-4)}` : (d ? '•••••' : 'pareado');
    };
    return res.json({
      contatos: [
        ...admins.map(a => ({ tipo: 'ADMIN', id: a.id, nome: a.nome || 'Admin', grupo: 'Admins', telefoneMascarado: mascarar(a.telefone) })),
        ...botUsers.map(b => ({ tipo: 'BOT_USER', id: b.id, nome: b.nome, grupo: b.role === 'LAVADOR' ? 'Lavadores' : 'Funcionários', telefoneMascarado: mascarar(b.telefone) })),
        ...destinatarios.map(d => ({ tipo: 'DESTINATARIO', id: d.id, nome: d.nome, grupo: 'Só automações', telefoneMascarado: mascarar(d.telefone) })),
      ],
    });
  } catch (err) {
    console.error('[EmailAutomacao] Erro ao listar contatos:', err);
    return res.status(500).json({ error: 'Erro ao listar os contatos' });
  }
}

/**
 * Cadastra quem vai receber as automações. NÃO vira admin do bot: não entra em
 * Usuários & Acesso e não recebe resumo diário, alerta de caixa etc.
 *
 * Como é número avulso (não escolhido da lista), manda uma mensagem avisando —
 * serve também para confirmar que o número existe no WhatsApp e pegar o JID real.
 */
export async function criarDestinatario(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  const nome = String(req.body?.nome ?? '').trim().slice(0, 60);
  const telefone = String(req.body?.telefone ?? '').replace(/\D/g, '');

  if (!nome) return res.status(400).json({ error: 'Informe o nome do contato.' });
  if (telefone.length < 10 || telefone.length > 15) return res.status(400).json({ error: 'Número inválido. Use DDD + número.' });
  if (!verificarRateLimit(`email-destinatario:${empresaId}`, 10, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitos contatos cadastrados seguidos. Tente de novo mais tarde.' });
  }

  try {
    const jaExiste = await prisma.emailDestinatario.findFirst({ where: { empresaId, telefone }, select: { id: true, nome: true } });
    if (jaExiste) return res.status(409).json({ error: `Esse número já está cadastrado como "${jaExiste.nome}".` });

    const quantos = await prisma.emailDestinatario.count({ where: { empresaId } });
    if (quantos >= 20) return res.status(409).json({ error: 'Limite de 20 destinatários por empresa.' });

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true } });

    // Envia e captura o JID real de uma vez (resolve o caso @lid do WhatsApp novo)
    let jid: string | null = null;
    try {
      jid = await botSendCaptureJid(
        telefone,
        `Olá${nome ? ' ' + nome : ''}! Você foi incluído por *${empresa?.nome ?? 'sua empresa'}* para receber avisos automáticos por aqui (como códigos recebidos por email).\n\nSe não reconhece, é só ignorar esta mensagem.`
      );
    } catch (err) {
      console.error('[EmailAutomacao] Não foi possível avisar o contato novo:', err);
    }

    const destinatario = await prisma.emailDestinatario.create({
      data: { empresaId, nome, telefone, jid, criadoPor: autorDo(req) },
      select: { id: true, nome: true, telefone: true },
    });
    await auditar(empresaId, autorDo(req), 'DESTINATARIO_CRIADO');
    return res.status(201).json({
      destinatario: { tipo: 'DESTINATARIO', id: destinatario.id, nome: destinatario.nome, grupo: 'Só automações', telefoneMascarado: destinatario.telefone.replace(/^(\d{4})\d+(\d{4})$/, '$1•••••$2') },
      avisado: !!jid,
    });
  } catch (err) {
    console.error('[EmailAutomacao] Erro ao cadastrar destinatário:', err);
    return res.status(500).json({ error: 'Erro ao cadastrar o contato' });
  }
}

export async function removerDestinatario(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  const id = req.params.id as string;
  try {
    const removidos = await prisma.emailDestinatario.deleteMany({ where: { id, empresaId } });
    if (removidos.count === 0) return res.status(404).json({ error: 'Contato não encontrado' });
    await auditar(empresaId, autorDo(req), 'DESTINATARIO_REMOVIDO');
    return res.json({ ok: true });
  } catch (err) {
    console.error('[EmailAutomacao] Erro ao remover destinatário:', err);
    return res.status(500).json({ error: 'Erro ao remover o contato' });
  }
}

export async function testarEnvio(req: Req, res: Response) {
  const empresaId = empresaDo(req);
  const id = req.params.id as string;
  if (!verificarRateLimit(`email-teste-envio:${empresaId}`, 5, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Muitos testes seguidos. Tente de novo mais tarde.' });
  }
  try {
    const regra = await prisma.emailRegra.findFirst({ where: { id, empresaId } });
    if (!regra) return res.status(404).json({ error: 'Automação não encontrada' });

    const destinos = Array.isArray(regra.destinos) ? (regra.destinos as unknown as DestinoRegra[]) : [];
    const alvos = await resolverDestinos(empresaId, destinos);
    if (!alvos.length) return res.status(400).json({ error: 'Essa automação não tem destinatário válido.' });

    const exemplo = String(req.body?.valorExemplo ?? '123456').slice(0, 100);
    const texto = regra.template.replace(/\{\{valor\}\}/g, exemplo);
    const enfileirados = await enfileirarEnvios(empresaId, alvos, texto);

    await auditar(empresaId, autorDo(req), 'TESTE_ENVIO', regra.contaId);
    return res.json({ ok: true, enfileirados });
  } catch (err) {
    console.error('[EmailAutomacao] Erro no teste de envio:', err);
    return res.status(500).json({ error: 'Erro ao enviar o teste' });
  }
}
