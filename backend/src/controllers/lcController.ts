import { Request, Response, NextFunction } from 'express';
import prisma from '../db';
import { gerarTokenCurto } from '../utils/tokenUtils';
import { getTodayRangeBRT, getMonthRangeBRT, getTodayStrBRT, getDateRangeBRT } from '../utils/dateUtils';

interface EmpresaRequest extends Request {
  empresaId?: string;
}

const ORDEM_STATUS_ABERTOS = ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'];

async function gerarLinkTokenUnico(): Promise<string> {
  let token = gerarTokenCurto(8);
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const existe = await prisma.lcFuncionario.findUnique({ where: { linkToken: token } });
    if (!existe) break;
    token = gerarTokenCurto(8);
  }
  return token;
}

/**
 * Garante que o sistema Lina Center está ativo para a empresa (empresa_sistemas)
 */
export const requireLcAtivo = async (req: EmpresaRequest, res: Response, next: NextFunction) => {
  try {
    const sistema = await prisma.empresaSistema.findFirst({
      where: { empresaId: req.empresaId, sistema: 'lina-center', ativo: true },
    });
    if (!sistema) {
      return res.status(403).json({ error: 'Lina Center não está ativo para esta empresa.' });
    }
    next();
  } catch (error) {
    console.error('Erro ao validar Lina Center ativo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── CLIENTES ────────────────────────────────────────────────────────────────

/**
 * Criar novo cliente (com veículo opcional inline)
 */
export const createLcCliente = async (req: EmpresaRequest, res: Response) => {
  try {
    const { nome, telefone, email, veiculo } = req.body;

    if (!nome) {
      return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });
    }
    if (veiculo && !veiculo.modelo) {
      return res.status(400).json({ error: 'Modelo do veículo é obrigatório.' });
    }

    const cliente = await prisma.lcCliente.create({
      data: {
        empresaId: req.empresaId!,
        nome,
        telefone: telefone || null,
        email: email || null,
        veiculos: veiculo
          ? {
              create: {
                modelo: veiculo.modelo,
                placa: veiculo.placa || null,
                cor: veiculo.cor || null,
                ano: veiculo.ano ? Number(veiculo.ano) : null,
              },
            }
          : undefined,
      },
      include: { veiculos: true },
    });

    res.status(201).json({ message: 'Cliente criado com sucesso', cliente });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Já existe um veículo cadastrado com essa placa.' });
    }
    console.error('Erro ao criar cliente (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Listar clientes da empresa (busca por nome, telefone, email, placa ou modelo)
 */
export const getLcClientes = async (req: EmpresaRequest, res: Response) => {
  try {
    const { page = 1, limit = 100, search } = req.query as { page?: string; limit?: string; search?: string };
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = { empresaId: req.empresaId };
    if (search) {
      const palavras = search.trim().split(/\s+/).filter(Boolean);
      where.AND = palavras.map((palavra) => ({
        OR: [
          { nome: { contains: palavra, mode: 'insensitive' } },
          { telefone: { contains: palavra } },
          { email: { contains: palavra, mode: 'insensitive' } },
          { veiculos: { some: { OR: [
            { placa: { contains: palavra.toUpperCase() } },
            { modelo: { contains: palavra, mode: 'insensitive' } },
          ] } } },
        ],
      }));
    }

    const [clientes, total] = await Promise.all([
      prisma.lcCliente.findMany({
        where,
        include: {
          veiculos: true,
          _count: { select: { ordens: true, veiculos: true } },
        },
        orderBy: { nome: 'asc' },
        skip,
        take: Number(limit),
      }),
      prisma.lcCliente.count({ where }),
    ]);

    res.json({
      clientes,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    console.error('Erro ao listar clientes (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Buscar cliente por ID
 */
export const getLcClienteById = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const cliente = await prisma.lcCliente.findFirst({
      where: { id, empresaId: req.empresaId },
      include: {
        veiculos: true,
        ordens: {
          include: {
            veiculo: { select: { modelo: true, placa: true } },
            funcionario: { select: { nome: true } },
            items: { include: { servico: { select: { nome: true } } } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: { select: { ordens: true, veiculos: true } },
      },
    });

    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }
    res.json(cliente);
  } catch (error) {
    console.error('Erro ao buscar cliente (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Atualizar cliente (e opcionalmente o veículo vinculado)
 */
export const updateLcCliente = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { nome, telefone, email, ativo, veiculo } = req.body;

    const existente = await prisma.lcCliente.findFirst({
      where: { id, empresaId: req.empresaId },
      include: { veiculos: true },
    });
    if (!existente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    const cliente = await prisma.$transaction(async (tx) => {
      await tx.lcCliente.update({
        where: { id },
        data: {
          ...(nome !== undefined && { nome }),
          ...(telefone !== undefined && { telefone: telefone || null }),
          ...(email !== undefined && { email: email || null }),
          ...(ativo !== undefined && { ativo }),
        },
      });

      if (veiculo) {
        const veiculoAlvo = veiculo.id
          ? existente.veiculos.find((v) => v.id === veiculo.id)
          : existente.veiculos[0];

        if (veiculoAlvo) {
          await tx.lcVeiculo.update({
            where: { id: veiculoAlvo.id },
            data: {
              ...(veiculo.modelo !== undefined && { modelo: veiculo.modelo }),
              ...(veiculo.placa !== undefined && { placa: veiculo.placa || null }),
              ...(veiculo.cor !== undefined && { cor: veiculo.cor || null }),
              ...(veiculo.ano !== undefined && { ano: veiculo.ano ? Number(veiculo.ano) : null }),
            },
          });
        } else if (veiculo.modelo) {
          await tx.lcVeiculo.create({
            data: {
              clienteId: id,
              modelo: veiculo.modelo,
              placa: veiculo.placa || null,
              cor: veiculo.cor || null,
              ano: veiculo.ano ? Number(veiculo.ano) : null,
            },
          });
        }
      }

      return tx.lcCliente.findUnique({ where: { id }, include: { veiculos: true } });
    });

    res.json({ message: 'Cliente atualizado com sucesso', cliente });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Já existe um veículo cadastrado com essa placa.' });
    }
    console.error('Erro ao atualizar cliente (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Excluir cliente (bloqueia se houver ordens)
 */
export const deleteLcCliente = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const cliente = await prisma.lcCliente.findFirst({
      where: { id, empresaId: req.empresaId },
      select: { id: true, _count: { select: { ordens: true } } },
    });
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }
    if (cliente._count.ordens > 0) {
      return res.status(400).json({ error: 'Não é possível excluir cliente com ordens de serviço cadastradas.' });
    }

    await prisma.lcCliente.delete({ where: { id } });
    res.json({ message: 'Cliente excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir cliente (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── FUNCIONÁRIOS ────────────────────────────────────────────────────────────

/**
 * Criar novo funcionário — já sai com linkToken pronto para o portal (/p/:token)
 */
export const createLcFuncionario = async (req: EmpresaRequest, res: Response) => {
  try {
    const { nome, telefone, tipoRemuneracao, comissao, salario } = req.body;
    if (!nome) {
      return res.status(400).json({ error: 'Nome é obrigatório.' });
    }

    const linkToken = await gerarLinkTokenUnico();

    const funcionario = await prisma.lcFuncionario.create({
      data: {
        empresaId: req.empresaId!,
        nome,
        telefone: telefone || null,
        tipoRemuneracao: tipoRemuneracao || 'COMISSAO',
        comissao: comissao !== undefined && comissao !== '' ? Number(comissao) : null,
        salario: salario !== undefined && salario !== '' ? Number(salario) : null,
        linkToken,
      },
    });

    res.status(201).json({ message: 'Funcionário criado com sucesso', funcionario });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Já existe um funcionário com esse nome.' });
    }
    console.error('Erro ao criar funcionário (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Listar funcionários da empresa
 */
export const getLcFuncionarios = async (req: EmpresaRequest, res: Response) => {
  try {
    const funcionarios = await prisma.lcFuncionario.findMany({
      where: { empresaId: req.empresaId },
      include: { _count: { select: { ordens: true } } },
      orderBy: { nome: 'asc' },
    });
    res.json({ funcionarios });
  } catch (error) {
    console.error('Erro ao listar funcionários (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Lista simplificada (id + nome) — usada no seletor de Nova Ordem
 */
export const getLcFuncionariosSimple = async (req: EmpresaRequest, res: Response) => {
  try {
    const funcionarios = await prisma.lcFuncionario.findMany({
      where: { empresaId: req.empresaId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
    res.json({ funcionarios });
  } catch (error) {
    console.error('Erro ao listar funcionários (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Atualizar funcionário
 */
export const updateLcFuncionario = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { nome, telefone, tipoRemuneracao, comissao, salario, ativo } = req.body;

    const existente = await prisma.lcFuncionario.findFirst({ where: { id, empresaId: req.empresaId } });
    if (!existente) {
      return res.status(404).json({ error: 'Funcionário não encontrado.' });
    }

    const funcionario = await prisma.lcFuncionario.update({
      where: { id },
      data: {
        ...(nome !== undefined && { nome }),
        ...(telefone !== undefined && { telefone: telefone || null }),
        ...(tipoRemuneracao !== undefined && { tipoRemuneracao }),
        ...(comissao !== undefined && { comissao: comissao === '' ? null : Number(comissao) }),
        ...(salario !== undefined && { salario: salario === '' ? null : Number(salario) }),
        ...(ativo !== undefined && { ativo }),
      },
    });

    res.json({ message: 'Funcionário atualizado com sucesso', funcionario });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Já existe um funcionário com esse nome.' });
    }
    console.error('Erro ao atualizar funcionário (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Excluir funcionário (bloqueia se houver ordens)
 */
export const deleteLcFuncionario = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const funcionario = await prisma.lcFuncionario.findFirst({
      where: { id, empresaId: req.empresaId },
      select: { id: true, _count: { select: { ordens: true } } },
    });
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionário não encontrado.' });
    }
    if (funcionario._count.ordens > 0) {
      return res.status(400).json({ error: 'Não é possível excluir funcionário com ordens de serviço cadastradas. Desative-o em vez disso.' });
    }

    await prisma.lcFuncionario.delete({ where: { id } });
    res.json({ message: 'Funcionário excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir funcionário (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Reseta o PIN do portal — funcionário define um novo no próximo acesso
 */
export const resetarPinLcFuncionario = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const funcionario = await prisma.lcFuncionario.findFirst({ where: { id, empresaId: req.empresaId } });
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionário não encontrado.' });
    }

    await prisma.lcFuncionario.update({
      where: { id },
      data: { pin: null, pinDefinido: false, sessionVersion: { increment: 1 } },
    });

    res.json({ message: 'PIN redefinido. O funcionário deverá criar um novo PIN no próximo acesso ao portal.' });
  } catch (error) {
    console.error('Erro ao resetar PIN (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Regenera o link curto do portal (/p/:token) — invalida o link anterior
 */
export const regenerarLinkLcFuncionario = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const funcionario = await prisma.lcFuncionario.findFirst({ where: { id, empresaId: req.empresaId } });
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionário não encontrado.' });
    }

    const linkToken = await gerarLinkTokenUnico();
    const atualizado = await prisma.lcFuncionario.update({ where: { id }, data: { linkToken } });

    res.json({ message: 'Link regenerado com sucesso', linkToken: atualizado.linkToken });
  } catch (error) {
    console.error('Erro ao regenerar link (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Vincula uma subconta (role USER) ao funcionário — acesso ao portal via login normal
 */
export const vincularUsuarioLcFuncionario = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { subaccountId } = req.body;
    if (!subaccountId) {
      return res.status(400).json({ error: 'subaccountId é obrigatório.' });
    }

    const [funcionario, subaccount] = await Promise.all([
      prisma.lcFuncionario.findFirst({ where: { id, empresaId: req.empresaId } }),
      prisma.subaccount.findFirst({ where: { id: subaccountId, empresaId: req.empresaId } }),
    ]);
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionário não encontrado.' });
    }
    if (!subaccount) {
      return res.status(404).json({ error: 'Subconta não encontrada nesta empresa.' });
    }

    const atualizado = await prisma.lcFuncionario.update({ where: { id }, data: { usuarioId: subaccountId } });
    res.json({ message: 'Subconta vinculada com sucesso', funcionario: atualizado });
  } catch (error) {
    console.error('Erro ao vincular subconta (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── SERVIÇOS ────────────────────────────────────────────────────────────────

export const createLcServico = async (req: EmpresaRequest, res: Response) => {
  try {
    const { nome, descricao, preco, comissaoPercentual } = req.body;
    if (!nome || preco === undefined || preco === '') {
      return res.status(400).json({ error: 'Nome e preço são obrigatórios.' });
    }

    const servico = await prisma.lcServico.create({
      data: {
        empresaId: req.empresaId!,
        nome,
        descricao: descricao || null,
        preco: Number(preco),
        comissaoPercentual: comissaoPercentual !== undefined && comissaoPercentual !== '' ? Number(comissaoPercentual) : null,
      },
    });

    res.status(201).json({ message: 'Serviço criado com sucesso', servico });
  } catch (error) {
    console.error('Erro ao criar serviço (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

export const getLcServicos = async (req: EmpresaRequest, res: Response) => {
  try {
    const servicos = await prisma.lcServico.findMany({
      where: { empresaId: req.empresaId },
      orderBy: { nome: 'asc' },
    });
    res.json({ servicos });
  } catch (error) {
    console.error('Erro ao listar serviços (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

export const getLcServicosSimple = async (req: EmpresaRequest, res: Response) => {
  try {
    const servicos = await prisma.lcServico.findMany({
      where: { empresaId: req.empresaId, ativo: true },
      select: { id: true, nome: true, preco: true },
      orderBy: { nome: 'asc' },
    });
    res.json({ servicos });
  } catch (error) {
    console.error('Erro ao listar serviços (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

export const updateLcServico = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { nome, descricao, preco, comissaoPercentual, ativo } = req.body;

    const existente = await prisma.lcServico.findFirst({ where: { id, empresaId: req.empresaId } });
    if (!existente) {
      return res.status(404).json({ error: 'Serviço não encontrado.' });
    }

    const servico = await prisma.lcServico.update({
      where: { id },
      data: {
        ...(nome !== undefined && { nome }),
        ...(descricao !== undefined && { descricao: descricao || null }),
        ...(preco !== undefined && { preco: Number(preco) }),
        ...(comissaoPercentual !== undefined && { comissaoPercentual: comissaoPercentual === '' ? null : Number(comissaoPercentual) }),
        ...(ativo !== undefined && { ativo }),
      },
    });

    res.json({ message: 'Serviço atualizado com sucesso', servico });
  } catch (error) {
    console.error('Erro ao atualizar serviço (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

export const deleteLcServico = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const servico = await prisma.lcServico.findFirst({
      where: { id, empresaId: req.empresaId },
      select: { id: true, _count: { select: { ordemItems: true } } },
    });
    if (!servico) {
      return res.status(404).json({ error: 'Serviço não encontrado.' });
    }
    if (servico._count.ordemItems > 0) {
      return res.status(400).json({ error: 'Não é possível excluir serviço já usado em ordens. Desative-o em vez disso.' });
    }

    await prisma.lcServico.delete({ where: { id } });
    res.json({ message: 'Serviço excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir serviço (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── ORDENS DE SERVIÇO ───────────────────────────────────────────────────────

interface ItemInput {
  servicoId?: string;
  nomeCustom?: string;
  quantidade?: number;
  precoUnit?: number;
}

/**
 * Cria uma ordem — aceita clienteId existente OU dados de um cliente novo (+ veículo opcional).
 * O preço de cada item vem do catálogo (servicoId) sempre que possível — nunca confia
 * no preço enviado pelo client quando o item referencia um serviço cadastrado.
 */
export const createLcOrdem = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId!;
    const { clienteId, novoCliente, veiculoId, novoVeiculo, funcionarioId, itens, desconto, observacoes } = req.body as {
      clienteId?: string;
      novoCliente?: { nome: string; telefone?: string; email?: string };
      veiculoId?: string;
      novoVeiculo?: { modelo: string; placa?: string; cor?: string; ano?: number };
      funcionarioId?: string;
      itens: ItemInput[];
      desconto?: number;
      observacoes?: string;
    };

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: 'Ao menos um serviço é obrigatório.' });
    }
    if (!clienteId && !novoCliente?.nome) {
      return res.status(400).json({ error: 'Cliente é obrigatório.' });
    }
    if (novoVeiculo && !novoVeiculo.modelo) {
      return res.status(400).json({ error: 'Modelo do veículo é obrigatório.' });
    }

    const ordem = await prisma.$transaction(async (tx) => {
      let finalClienteId = clienteId || '';
      if (!finalClienteId) {
        const cliente = await tx.lcCliente.create({
          data: {
            empresaId,
            nome: novoCliente!.nome,
            telefone: novoCliente!.telefone || null,
            email: novoCliente!.email || null,
          },
        });
        finalClienteId = cliente.id;
      }

      let finalVeiculoId = veiculoId || null;
      if (!finalVeiculoId && novoVeiculo?.modelo) {
        const veiculo = await tx.lcVeiculo.create({
          data: {
            clienteId: finalClienteId,
            modelo: novoVeiculo.modelo,
            placa: novoVeiculo.placa || null,
            cor: novoVeiculo.cor || null,
            ano: novoVeiculo.ano ? Number(novoVeiculo.ano) : null,
          },
        });
        finalVeiculoId = veiculo.id;
      }

      const servicoIds = itens.filter((i) => i.servicoId).map((i) => i.servicoId!) as string[];
      const servicos = servicoIds.length
        ? await tx.lcServico.findMany({ where: { id: { in: servicoIds }, empresaId } })
        : [];
      const servicoMap = new Map(servicos.map((s) => [s.id, s]));

      const funcionario = funcionarioId
        ? await tx.lcFuncionario.findFirst({ where: { id: funcionarioId, empresaId } })
        : null;

      let valorTotal = 0;
      let comissaoTotal = 0;
      const itemsData = itens.map((item) => {
        const servico = item.servicoId ? servicoMap.get(item.servicoId) : undefined;
        const quantidade = item.quantidade && item.quantidade > 0 ? Number(item.quantidade) : 1;
        const precoUnit = servico ? servico.preco : Number(item.precoUnit || 0);
        const subtotal = precoUnit * quantidade;
        valorTotal += subtotal;

        const pctComissao = servico?.comissaoPercentual ?? funcionario?.comissao ?? 0;
        comissaoTotal += subtotal * (pctComissao / 100);

        return {
          servicoId: servico?.id ?? null,
          nomeCustom: servico ? null : (item.nomeCustom || 'Serviço avulso'),
          quantidade,
          precoUnit,
          subtotal,
        };
      });

      const descontoValor = desconto ? Number(desconto) : 0;
      const valorFinal = Math.max(0, valorTotal - descontoValor);
      const descontoFator = valorTotal > 0 ? valorFinal / valorTotal : 1;

      const ultimaOrdem = await tx.lcOrdemServico.findFirst({
        where: { empresaId },
        orderBy: { numeroOrdem: 'desc' },
        select: { numeroOrdem: true },
      });
      const numeroOrdem = (ultimaOrdem?.numeroOrdem || 0) + 1;

      return tx.lcOrdemServico.create({
        data: {
          numeroOrdem,
          empresaId,
          clienteId: finalClienteId,
          veiculoId: finalVeiculoId,
          funcionarioId: funcionario?.id ?? null,
          valorTotal: valorFinal,
          desconto: descontoValor,
          comissao: comissaoTotal * descontoFator,
          observacoes: observacoes || null,
          dataInicio: new Date(),
          items: { create: itemsData },
        },
        include: {
          cliente: { select: { nome: true, telefone: true } },
          veiculo: { select: { modelo: true, placa: true } },
          funcionario: { select: { id: true, nome: true } },
          items: { include: { servico: { select: { nome: true } } } },
        },
      });
    });

    res.status(201).json({ message: 'Ordem criada com sucesso', ordem });
  } catch (error) {
    console.error('Erro ao criar ordem (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

export const getLcOrdens = async (req: EmpresaRequest, res: Response) => {
  try {
    const { status, page = 1, limit = 50 } = req.query as { status?: string; page?: string; limit?: string };
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = { empresaId: req.empresaId };
    if (status && status !== 'TODOS') where.status = status;

    const [ordens, total] = await Promise.all([
      prisma.lcOrdemServico.findMany({
        where,
        include: {
          cliente: { select: { nome: true, telefone: true } },
          veiculo: { select: { modelo: true, placa: true } },
          funcionario: { select: { id: true, nome: true } },
          items: { include: { servico: { select: { nome: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.lcOrdemServico.count({ where }),
    ]);

    res.json({
      ordens,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    console.error('Erro ao listar ordens (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

export const getLcOrdemById = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const ordem = await prisma.lcOrdemServico.findFirst({
      where: { id, empresaId: req.empresaId },
      include: {
        cliente: true,
        veiculo: true,
        funcionario: { select: { id: true, nome: true } },
        items: { include: { servico: { select: { nome: true } } } },
        pagamentos: true,
      },
    });
    if (!ordem) {
      return res.status(404).json({ error: 'Ordem não encontrada.' });
    }
    res.json(ordem);
  } catch (error) {
    console.error('Erro ao buscar ordem (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Move a ordem entre os status abertos (PENDENTE / EM_ANDAMENTO / AGUARDANDO_PAGAMENTO).
 * Para concluir com pagamento use /finalizar; para desistir use /cancel.
 */
export const updateLcOrdemStatus = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { status } = req.body as { status: string };

    if (!ORDEM_STATUS_ABERTOS.includes(status)) {
      return res.status(400).json({ error: `Status inválido. Use um de: ${ORDEM_STATUS_ABERTOS.join(', ')}.` });
    }

    const ordem = await prisma.lcOrdemServico.findFirst({ where: { id, empresaId: req.empresaId } });
    if (!ordem) {
      return res.status(404).json({ error: 'Ordem não encontrada.' });
    }
    if (ordem.status === 'FINALIZADO' || ordem.status === 'CANCELADO') {
      return res.status(400).json({ error: 'Não é possível alterar uma ordem finalizada ou cancelada.' });
    }

    const atualizado = await prisma.lcOrdemServico.update({
      where: { id },
      data: {
        status: status as any,
        ...(status === 'AGUARDANDO_PAGAMENTO' && { dataFim: new Date() }),
      },
    });

    res.json({ message: 'Status atualizado com sucesso', ordem: atualizado });
  } catch (error) {
    console.error('Erro ao atualizar status da ordem (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Finaliza a ordem registrando o(s) pagamento(s) — a soma precisa bater com o valor da ordem
 */
export const finalizarLcOrdem = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { pagamentos } = req.body as { pagamentos: { metodo: string; valor: number }[] };

    if (!pagamentos || !Array.isArray(pagamentos) || pagamentos.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um pagamento.' });
    }

    const ordem = await prisma.lcOrdemServico.findFirst({ where: { id, empresaId: req.empresaId } });
    if (!ordem) {
      return res.status(404).json({ error: 'Ordem não encontrada.' });
    }
    if (ordem.status === 'FINALIZADO' || ordem.status === 'CANCELADO') {
      return res.status(400).json({ error: 'Ordem já finalizada ou cancelada.' });
    }

    const somaPagamentos = pagamentos.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    if (Math.abs(somaPagamentos - ordem.valorTotal) > 0.01) {
      return res.status(400).json({
        error: `Soma dos pagamentos (R$ ${somaPagamentos.toFixed(2)}) não bate com o valor da ordem (R$ ${ordem.valorTotal.toFixed(2)}).`,
      });
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      await tx.lcPagamento.createMany({
        data: pagamentos.map((p) => ({
          ordemId: id,
          empresaId: req.empresaId!,
          metodo: p.metodo as any,
          valor: Number(p.valor),
          status: 'PAGO',
          pagoEm: new Date(),
        })),
      });

      return tx.lcOrdemServico.update({
        where: { id },
        data: { status: 'FINALIZADO', pago: true, dataFim: new Date() },
      });
    });

    res.json({ message: 'Ordem finalizada com sucesso', ordem: atualizado });
  } catch (error) {
    console.error('Erro ao finalizar ordem (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Cancela a ordem — não é possível cancelar uma ordem já finalizada
 */
export const cancelLcOrdem = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const ordem = await prisma.lcOrdemServico.findFirst({ where: { id, empresaId: req.empresaId } });
    if (!ordem) {
      return res.status(404).json({ error: 'Ordem não encontrada.' });
    }
    if (ordem.status === 'FINALIZADO') {
      return res.status(400).json({ error: 'Não é possível cancelar uma ordem já finalizada.' });
    }
    if (ordem.status === 'CANCELADO') {
      return res.status(400).json({ error: 'Ordem já está cancelada.' });
    }

    const atualizado = await prisma.lcOrdemServico.update({ where: { id }, data: { status: 'CANCELADO' } });
    res.json({ message: 'Ordem cancelada com sucesso', ordem: atualizado });
  } catch (error) {
    console.error('Erro ao cancelar ordem (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

// ─── DASHBOARD / FINANCEIRO ──────────────────────────────────────────────────

/**
 * KPIs do dashboard: faturamento hoje/mês, ordens em andamento, ticket médio (30d)
 */
export const getLcDashboardResumo = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId!;
    const hoje = getTodayRangeBRT();
    const [ano, mes] = getTodayStrBRT().split('-').map(Number);
    const mesAtual = getMonthRangeBRT(ano, mes);
    const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [faturamentoHoje, faturamentoMes, ordensEmAndamento, ordensFinalizadas30d, comissaoMes] = await Promise.all([
      prisma.lcPagamento.aggregate({
        where: { empresaId, status: 'PAGO', pagoEm: { gte: hoje.start, lte: hoje.end } },
        _sum: { valor: true },
      }),
      prisma.lcPagamento.aggregate({
        where: { empresaId, status: 'PAGO', pagoEm: { gte: mesAtual.start, lte: mesAtual.end } },
        _sum: { valor: true },
        _count: true,
      }),
      prisma.lcOrdemServico.count({
        where: { empresaId, status: { in: ORDEM_STATUS_ABERTOS as any } },
      }),
      prisma.lcOrdemServico.aggregate({
        where: { empresaId, status: 'FINALIZADO', dataFim: { gte: trintaDiasAtras } },
        _avg: { valorTotal: true },
      }),
      prisma.lcOrdemServico.aggregate({
        where: { empresaId, status: 'FINALIZADO', dataFim: { gte: mesAtual.start, lte: mesAtual.end } },
        _sum: { comissao: true },
      }),
    ]);

    res.json({
      faturamentoHoje: faturamentoHoje._sum.valor || 0,
      faturamentoMes: faturamentoMes._sum.valor || 0,
      ordensNoMes: faturamentoMes._count || 0,
      ordensEmAndamento,
      ticketMedio: ordensFinalizadas30d._avg.valorTotal || 0,
      comissaoMes: comissaoMes._sum.comissao || 0,
    });
  } catch (error) {
    console.error('Erro ao buscar resumo do dashboard (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Faturamento por método de pagamento — mês informado (?mes=YYYY-MM) ou o atual
 */
export const getLcFaturamentoPorMetodo = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId!;
    const { mes } = req.query as { mes?: string };
    const [ano, mesNum] = (mes || getTodayStrBRT().slice(0, 7)).split('-').map(Number);
    const range = getMonthRangeBRT(ano, mesNum);

    const grupos = await prisma.lcPagamento.groupBy({
      by: ['metodo'],
      where: { empresaId, status: 'PAGO', pagoEm: { gte: range.start, lte: range.end } },
      _sum: { valor: true },
    });

    res.json({ metodos: grupos.map((g) => ({ metodo: g.metodo, valor: g._sum.valor || 0 })) });
  } catch (error) {
    console.error('Erro ao buscar faturamento por método (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Ranking de comissão por funcionário no mês (?mes=YYYY-MM ou o atual) — ordens finalizadas
 */
export const getLcComissoesPorFuncionario = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId!;
    const { mes } = req.query as { mes?: string };
    const [ano, mesNum] = (mes || getTodayStrBRT().slice(0, 7)).split('-').map(Number);
    const range = getMonthRangeBRT(ano, mesNum);

    const [funcionarios, grupos] = await Promise.all([
      prisma.lcFuncionario.findMany({
        where: { empresaId, ativo: true },
        select: { id: true, nome: true, comissao: true },
      }),
      prisma.lcOrdemServico.groupBy({
        by: ['funcionarioId'],
        where: { empresaId, status: 'FINALIZADO', dataFim: { gte: range.start, lte: range.end }, funcionarioId: { not: null } },
        _sum: { comissao: true },
        _count: true,
      }),
    ]);

    const mapa = new Map(grupos.map((g) => [g.funcionarioId, g]));
    const ranking = funcionarios
      .map((f) => ({
        id: f.id,
        nome: f.nome,
        pct: f.comissao || 0,
        ordens: mapa.get(f.id)?._count || 0,
        comissao: mapa.get(f.id)?._sum.comissao || 0,
      }))
      .sort((a, b) => b.comissao - a.comissao);

    res.json({ ranking });
  } catch (error) {
    console.error('Erro ao buscar comissões por funcionário (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Faturamento dos últimos 7 dias (soma de pagamentos PAGO por dia) — para o gráfico do dashboard
 */
export const getLcFaturamentoUltimos7Dias = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId!;
    const hojeStr = getTodayStrBRT(); // 'YYYY-MM-DD' em BRT
    const [anoHoje, mesHoje, diaHoje] = hojeStr.split('-').map(Number);
    const anchor = new Date(Date.UTC(anoHoje, mesHoje - 1, diaHoje, 12)); // meio-dia UTC evita virar de dia com o offset

    const dias: { dia: string; valor: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(anchor);
      d.setUTCDate(d.getUTCDate() - i);
      const dataStr = d.toISOString().slice(0, 10);
      const { start, end } = getDateRangeBRT(dataStr);

      const agg = await prisma.lcPagamento.aggregate({
        where: { empresaId, status: 'PAGO', pagoEm: { gte: start, lte: end } },
        _sum: { valor: true },
      });

      dias.push({
        dia: d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', ''),
        valor: agg._sum.valor || 0,
      });
    }

    res.json({ dias });
  } catch (error) {
    console.error('Erro ao buscar faturamento dos últimos 7 dias (Lina Center):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};
