import { Request, Response } from 'express';
import { Prisma, OrdemServico, PrismaClient } from '@prisma/client';
import prisma from '../db';
import { createNotification } from '../services/notificationService';
import { validateCreateOrder, validateFinalizarOrdem, validateUpdateOrder } from '../utils/validate';

// ✅ CACHE SIMPLES EM MEMÓRIA
interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

const queryCache = new Map<string, CacheEntry>();

function getCacheKey(empresaId: string, params: Record<string, any>): string {
  // Cria chave de cache baseada em empresaId e parametros
  const paramStr = JSON.stringify({
    page: params.page,
    limit: params.limit,
    status: params.status,
    clienteId: params.clienteId,
    lavadorId: params.lavadorId,
    dataInicio: params.dataInicio,
    dataFim: params.dataFim
  });
  return `ordens:${empresaId}:${Buffer.from(paramStr).toString('base64')}`;
}

function getCachedData(key: string): any | null {
  const entry = queryCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > entry.ttl) {
    queryCache.delete(key);
    return null;
  }

  return entry.data;
}

function setCachedData(key: string, data: any, ttlMs: number = 60000): void {
  queryCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl: ttlMs
  });
}

function invalidateCache(empresaId: string): void {
  // Remove todas as entradas de cache dessa empresa
  for (const [key] of queryCache) {
    if (key.includes(`ordens:${empresaId}:`)) {
      queryCache.delete(key);
    }
  }
}

interface EmpresaRequest extends Request {
  empresaId?: string;
}

interface OrdemItemInput {
  tipo: 'SERVICO' | 'ADICIONAL';
  itemId: string;
  quantidade: number;
}

function formatOrderWithLavadores(order: any) {
  if (!order) return order;
  const ordemLavadores = order.ordemLavadores || [];
  const lavadores = ordemLavadores.map((relation: any) => ({
    id: relation.lavadorId,
    nome: relation.lavador?.nome || null
  }));
  const lavadorIds = lavadores.map((l: any) => l.id);
  const formatted = {
    ...order,
    lavadores,
    lavadorIds
  };
  delete formatted.ordemLavadores;
  return formatted;
}

/**
 * Criar nova ordem de serviço
 * Agora, esta função também pode criar um cliente e/ou veículo se eles não existirem.
 */
export const createOrdem = async (req: EmpresaRequest, res: Response) => {
  const empresaId = req.empresaId!;
  if (!empresaId) {
    return res.status(401).json({ error: 'Empresa não autenticada' });
  }

  // SECURITY: Validate and sanitize input data
  const validation = validateCreateOrder(req.body);
  if (!validation.isValid) {
    return res.status(400).json({
      error: 'Dados inválidos para criar ordem',
      details: validation.errors,
      code: 'VALIDATION_ERROR'
    });
  }

  // Use sanitized data instead of raw req.body
  const {
    clienteId, novoCliente, veiculoId, novoVeiculo,
    lavadorId, lavadorIds, itens, forcarCriacao, observacoes
  } = validation.sanitizedData!;

    const extraLavadores = Array.from(new Set(
      (lavadorIds || []).filter((id: string | null | undefined): id is string => !!id && id !== lavadorId)
    ));
  const normalizedLavadorIds = lavadorId ? [lavadorId, ...extraLavadores] : extraLavadores;
  const primaryLavadorId = normalizedLavadorIds[0] || null;

  try {
    // Utiliza uma transação para garantir a atomicidade da operação
    const ordem = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let finalClienteId: string | undefined = clienteId;
      let finalVeiculoId: string | undefined = veiculoId;

      // 1. Determina o ID do cliente: usa o existente ou cria um novo.
      if (!finalClienteId && novoCliente && novoCliente.nome) {
        // Primeiro, tenta encontrar um cliente existente com o mesmo nome e telefone
        let clienteExistente = await tx.cliente.findFirst({
          where: {
            nome: novoCliente.nome,
            telefone: novoCliente.telefone || null,
            empresaId: empresaId,
          },
        });

        if (clienteExistente) {
          finalClienteId = clienteExistente.id;
        } else {
          // Se não encontrar, cria um novo cliente
          const clienteCriado = await tx.cliente.create({
            data: {
              nome: novoCliente.nome,
              telefone: novoCliente.telefone,
              empresaId,
            },
          });
          finalClienteId = clienteCriado.id;
        }
      }

      // 2. Cria o veículo se for novo
      if (novoVeiculo && novoVeiculo.placa) {
        // Primeiro, tenta encontrar um veículo com a mesma placa
        let veiculoExistente = await tx.veiculo.findUnique({
          where: { placa: novoVeiculo.placa },
        });

        if (veiculoExistente) {
          finalVeiculoId = veiculoExistente.id;
        } else {
          // Se não encontrar, cria um novo veículo
          const veiculoCriado = await tx.veiculo.create({
            data: {
              placa: novoVeiculo.placa,
              modelo: novoVeiculo.modelo,
              cor: novoVeiculo.cor,
              clienteId: finalClienteId!,
            },
            include: {
              // Inclui o cliente para garantir que os dados retornados estejam completos
              cliente: true
            }
          });
          finalVeiculoId = veiculoCriado.id;
        }
      }

      // 3. Verifica se já existe uma ordem ativa para o veículo
      if (!forcarCriacao) {
        const ordemAtiva = await tx.ordemServico.findFirst({
          where: {
            veiculoId: finalVeiculoId,
            empresaId,
                        status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] as any },
          },
        });

        if (ordemAtiva) {
          // Lança um erro para abortar a transação
          throw { code: 'ACTIVE_ORDER_EXISTS' };
        }
      }

      // 4. Calcula o valor total e prepara os itens da ordem
      let calculatedValorTotal = 0;
      const ordemItemsData = await Promise.all(
        itens.map(async (item: OrdemItemInput) => {
          let precoUnit = 0;
          let itemData;

                if (item.tipo === 'SERVICO') {
            const servico = await tx.servico.findUnique({ where: { id: item.itemId } });
            if (servico) {
              precoUnit = servico.preco;
            } else {
              // Lançar um erro se o serviço não for encontrado pode ajudar a debugar
              throw new Error(`Serviço com ID ${item.itemId} não encontrado.`);
            }
            const subtotal = precoUnit * item.quantidade;
            calculatedValorTotal += subtotal;
            itemData = {
                        tipo: 'SERVICO',
              quantidade: item.quantidade,
              precoUnit,
              subtotal,
              servicoId: item.itemId
            };
                } else if (item.tipo === 'ADICIONAL') {
            const adicional = await tx.adicional.findUnique({ where: { id: item.itemId } });
            if (adicional) {
              precoUnit = adicional.preco;
            } else {
               // Lançar um erro se o adicional não for encontrado
              throw new Error(`Adicional com ID ${item.itemId} não encontrado.`);
            }
            const subtotal = precoUnit * item.quantidade;
            calculatedValorTotal += subtotal;
            itemData = {
                        tipo: 'ADICIONAL',
              quantidade: item.quantidade,
              precoUnit,
              subtotal,
              adicionalId: item.itemId
            };
          } else {
            // Se o tipo não for nem SERVICO nem ADICIONAL, lança um erro.
            throw new Error(`Tipo de item desconhecido: ${item.tipo}`);
          }
          
          return itemData;
        })
      );

      // Add a final validation check before creating the order
      if (!finalClienteId || !finalVeiculoId) {
        throw new Error("ID do cliente ou do veículo não pôde ser determinado.");
      }

      // 5. Calcular comissão
      let comissaoCalculada = 0;
      if (lavadorId) {
        const lavador = await tx.lavador.findUnique({ where: { id: lavadorId } });
        if (lavador && lavador.comissao > 0) {
          // A comissão é uma porcentagem do valor total da ordem
          comissaoCalculada = calculatedValorTotal * (lavador.comissao / 100);
        }
      }

      // 6. Gerar o número da ordem
      const ultimaOrdem = await tx.ordemServico.findFirst({
        where: { empresaId },
        orderBy: { numeroOrdem: 'desc' },
        select: { numeroOrdem: true },
      });
      const proximoNumeroOrdem = (ultimaOrdem?.numeroOrdem || 0) + 1;

      // 7. Cria a ordem de serviço
      const novaOrdem = await tx.ordemServico.create({
        data: {
          numeroOrdem: proximoNumeroOrdem,
          empresaId,
          clienteId: finalClienteId,
          veiculoId: finalVeiculoId,
          lavadorId: primaryLavadorId,
          valorTotal: calculatedValorTotal,
          comissao: comissaoCalculada, // A comissão é calculada, mas só é "devida" ao finalizar
          status: primaryLavadorId ? 'EM_ANDAMENTO' : 'PENDENTE' as any,
          observacoes: observacoes,
          items: { create: ordemItemsData.filter(Boolean) as any },
        },
      });

      if (normalizedLavadorIds.length > 0) {
        await tx.ordemServicoLavador.createMany({
          data: normalizedLavadorIds.map(lavadorIdValue => ({
            ordemId: novaOrdem.id,
            lavadorId: lavadorIdValue
          }))
        });
      }

      const ordemComLavadores = await tx.ordemServico.findUnique({
        where: { id: novaOrdem.id },
        include: {
          cliente: true,
          veiculo: true,
          lavador: true,
          items: { include: { servico: true, adicional: true } },
          ordemLavadores: { include: { lavador: true } }
        }
      });

      return ordemComLavadores!;
    });
    const ordemFinal = formatOrderWithLavadores(ordem);

    // Enviar notificação APÓS a transação para garantir que os dados estão corretos
    await createNotification({
      empresaId: empresaId,
      mensagem: `Nova ordem #${ordem.numeroOrdem} (${ordemFinal.cliente.nome}) foi criada.`,
      link: `ordens.html?id=${ordem.id}`,
      type: 'ordemCriada'
    });

    // ✅ CACHE: Invalida cache desta empresa quando ordem é criada
    invalidateCache(empresaId);

    res.status(201).json({ message: 'Ordem de serviço criada com sucesso!', ordem: ordemFinal });
  } catch (error: any) {
    if (error.code === 'ACTIVE_ORDER_EXISTS') {
      return res.status(409).json({
        error: 'Já existe uma ordem de serviço ativa para este veículo.',
        code: 'ACTIVE_ORDER_EXISTS',
      });
    }
    console.error('Erro detalhado ao criar ordem de serviço:', error);
    res.status(500).json({
        error: 'Erro interno do servidor ao criar ordem.',
        details: error.message || 'Nenhuma mensagem de erro específica.'
    });
  }
};

/**
 * Listar ordens de serviço da empresa
 * ✅ OTIMIZADO: Usa select ao invés de include, Promise.all() para queries independentes
 */
export const getOrdens = async (req: EmpresaRequest, res: Response) => {
  try {
    const {
      page: pageQuery,
      limit: limitQuery,
      search,
      status,
      clienteId,
      lavadorId,
      dataInicio,
      dataFim,
      metodoPagamento,
    } = req.query;

    const page = Number(pageQuery) || 1;
    const limit = Number(limitQuery) || 10;
    const skip = (page - 1) * limit;

    // ✅ CACHE: Se não há search ou filtros complexos, tenta usar cache
    // Cache é valido apenas para queries simples sem search/filtros dinâmicos
    const shouldCache = !search && (!metodoPagamento || metodoPagamento === '');
    let cacheKey = '';
    if (shouldCache) {
      cacheKey = getCacheKey(req.empresaId!, {
        page,
        limit,
        status: status || '',
        clienteId: clienteId || '',
        lavadorId: lavadorId || '',
        dataInicio: dataInicio || '',
        dataFim: dataFim || ''
      });

      const cachedResult = getCachedData(cacheKey);
      if (cachedResult) {
        console.log(`[CACHE HIT] Ordens da empresa ${req.empresaId}`);
        return res.json(cachedResult);
      }
    }

    const where: Prisma.OrdemServicoWhereInput = {
      empresaId: req.empresaId,
    };

    // ✅ OTIMIZAÇÃO: Se há search, primeiro busca na tabela de clientes/veiculos
    // Isso evita JOINs complexos na query principal
    let clienteIds: string[] = [];
    let veiculoIds: string[] = [];

    if (search) {
      const searchString = search as string;

      // Busca paralela em clientes e veiculos
      const [clientesEncontrados, veiculosEncontrados] = await Promise.all([
        prisma.cliente.findMany({
          where: {
            empresaId: req.empresaId,
            nome: { contains: searchString, mode: 'insensitive' }
          },
          select: { id: true },
          take: 100
        }),
        prisma.veiculo.findMany({
          where: {
            placa: { contains: searchString, mode: 'insensitive' }
          },
          select: { id: true },
          take: 100
        })
      ]);

      clienteIds = clientesEncontrados.map(c => c.id);
      veiculoIds = veiculosEncontrados.map(v => v.id);

      // Se encontrou resultados, adiciona ao filtro
      if (clienteIds.length > 0 || veiculoIds.length > 0) {
        where.OR = [
          ...(clienteIds.length > 0 ? [{ clienteId: { in: clienteIds } }] : []),
          ...(veiculoIds.length > 0 ? [{ veiculoId: { in: veiculoIds } }] : [])
        ];
      } else {
        // Nenhum cliente ou veículo encontrado, retorna vazio
        return res.json({
          ordens: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0
          }
        });
      }
    }

    if (status) {
      const statusString = status as string;
      if (statusString === 'ACTIVE') {
        where.status = { in: ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] as any };
      } else if (statusString.includes(',')) {
        where.status = { in: statusString.split(',') as any };
      } else {
        where.status = statusString as any;
      }
    }

    if (clienteId) {
      where.clienteId = clienteId as string;
    }

    if (lavadorId) {
      const washerFilterId = lavadorId as string;
      const washerFilterCondition: Prisma.OrdemServicoWhereInput = {
        OR: [
          { lavadorId: washerFilterId },
          { ordemLavadores: { some: { lavadorId: washerFilterId } } }
        ]
      };
      const existingAnd = Array.isArray(where.AND)
        ? [...where.AND]
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [...existingAnd, washerFilterCondition];
    }

    if (dataInicio && dataFim && dataInicio !== 'null' && dataFim !== 'null') {
      // As datas já chegam no formato YYYY-MM-DD
      const start = new Date(dataInicio as string);
      start.setUTCHours(0, 0, 0, 0);

      const end = new Date(dataFim as string);
      end.setUTCHours(23, 59, 59, 999);
      end.setDate(end.getDate() + 1);

      where.createdAt = {
        gte: start,
        lte: end,
      };
    }

    // ✅ OTIMIZAÇÃO: Filtro de metodoPagamento também busca as IDs primeiro
    if (metodoPagamento) {
      const pagamentosEncontrados = await prisma.pagamento.findMany({
        where: {
          empresaId: req.empresaId,
          metodo: metodoPagamento as any
        },
        distinct: ['ordemId'],
        select: { ordemId: true },
        take: 10000
      });

      const ordemIds = pagamentosEncontrados.map(p => p.ordemId);

      if (ordemIds.length === 0) {
        return res.json({
          ordens: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0
          }
        });
      }

      // Adiciona ao filtro
      if (where.AND && Array.isArray(where.AND)) {
        where.AND.push({ id: { in: ordemIds } });
      } else if (where.AND) {
        where.AND = [where.AND, { id: { in: ordemIds } }];
      } else {
        where.id = { in: ordemIds };
      }
    }

    // ✅ OTIMIZAÇÃO: Usar select ao invés de include para melhor performance
    const [ordens, total] = await Promise.all([
      prisma.ordemServico.findMany({
        where,
        select: {
          id: true,
          numeroOrdem: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          dataFim: true,
          valorTotal: true,
          comissao: true,
          observacoes: true,
          // Cliente - apenas campos necessários
          cliente: {
            select: {
              id: true,
              nome: true,
              telefone: true
            }
          },
          // Veículo - apenas campos necessários
          veiculo: {
            select: {
              id: true,
              placa: true,
              modelo: true,
              cor: true
            }
          },
          // Lavador principal
          lavador: {
            select: {
              id: true,
              nome: true,
              comissao: true
            }
          },
          // Items - otimizado
          items: {
            select: {
              id: true,
              quantidade: true,
              precoUnit: true,
              servico: {
                select: {
                  id: true,
                  nome: true
                }
              },
              adicional: {
                select: {
                  id: true,
                  nome: true
                }
              }
            }
          },
          // OrdemLavadores - otimizado
          ordemLavadores: {
            select: {
              lavadorId: true,
              lavador: {
                select: {
                  id: true,
                  nome: true
                }
              }
            }
          },
          // Pagamentos - apenas o essencial
          pagamentos: {
            select: {
              id: true,
              status: true,
              valor: true,
              metodo: true,
              pagoEm: true,
              createdAt: true
            },
            orderBy: {
              createdAt: 'asc'
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: Number(limit)
      }),
      // ✅ Count rodando em paralelo (com índice otimizado)
      prisma.ordemServico.count({ where })
    ]);

    const enrichedOrders = ordens.map(order => formatOrderWithLavadores(order));
    const result = {
      ordens: enrichedOrders,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    };

    // ✅ CACHE: Salva resultado em cache (60 segundos) se for uma query simples
    if (shouldCache && cacheKey) {
      setCachedData(cacheKey, result, 60000); // Cache por 60 segundos
      console.log(`[CACHE SET] Ordens da empresa ${req.empresaId} (TTL: 60s)`);
    }

    res.json(result);
  } catch (error) {
    console.error('Erro ao listar ordens de serviço:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Buscar ordem de serviço por ID
 */
export const getOrdemById = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    // ✅ OTIMIZAÇÃO: Usar select ao invés de include para evitar N+1 queries
    const ordem = await prisma.ordemServico.findFirst({
      where: {
        id,
        empresaId: req.empresaId
      },
      select: {
        id: true,
        numeroOrdem: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        dataFim: true,
        valorTotal: true,
        comissao: true,
        observacoes: true,
        pago: true,
        // Cliente - apenas campos necessários
        cliente: {
          select: {
            id: true,
            nome: true,
            telefone: true,
            email: true
          }
        },
        // Veículo - apenas campos necessários
        veiculo: {
          select: {
            id: true,
            placa: true,
            modelo: true,
            cor: true,
            ano: true
          }
        },
        // Lavador principal
        lavador: {
          select: {
            id: true,
            nome: true,
            comissao: true
          }
        },
        // Items - otimizado com select
        items: {
          select: {
            id: true,
            tipo: true,
            quantidade: true,
            precoUnit: true,
            subtotal: true,
            servico: {
              select: {
                id: true,
                nome: true
              }
            },
            adicional: {
              select: {
                id: true,
                nome: true
              }
            }
          }
        },
        // OrdemLavadores - otimizado com select
        ordemLavadores: {
          select: {
            lavadorId: true,
            lavador: {
              select: {
                id: true,
                nome: true
              }
            }
          }
        },
        // Pagamentos - otimizado
        pagamentos: {
          select: {
            id: true,
            status: true,
            valor: true,
            metodo: true,
            pagoEm: true,
            createdAt: true
          },
          orderBy: {
            createdAt: 'asc'
          }
        }
      }
    });
    if (!ordem) {
      return res.status(404).json({ error: 'Ordem de serviço não encontrada' });
    }

    res.json(formatOrderWithLavadores(ordem));
  } catch (error) {
    console.error('Erro ao buscar ordem de serviço:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Atualizar ordem de serviço
 */
export const updateOrdem = async (req: EmpresaRequest, res: Response) => {
  const validation = validateUpdateOrder(req.body);
  if (!validation.isValid) {
    return res.status(400).json({
      error: 'Dados inválidos para atualizar ordem',
      details: validation.errors,
      code: 'VALIDATION_ERROR'
    });
  }

  try {
    const updatedOrdemResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const { id } = req.params as { id: string };
      const { status, lavadorId, lavadorIds, observacoes, itens } = validation.sanitizedData!;

      const existingOrdem = await tx.ordemServico.findFirst({
        where: { id, empresaId: req.empresaId },
      });

      if (!existingOrdem) {
        throw new Error('Ordem de serviço não encontrada'); // Lança um erro para ser pego pelo catch
      }

      const extraLavadores = Array.from(new Set(
        (lavadorIds || []).filter((id: string | null | undefined): id is string => !!id && id !== lavadorId)
      ));
      const normalizedLavadorIds = lavadorId ? [lavadorId, ...extraLavadores] : extraLavadores;
      const primaryLavadorId = normalizedLavadorIds[0] || null;

      let valorTotal = existingOrdem.valorTotal;
      const dataToUpdate: Prisma.OrdemServicoUpdateInput = {
        observacoes,
        status,
        lavador: primaryLavadorId ? { connect: { id: primaryLavadorId } } : undefined,
      };

      if (itens && Array.isArray(itens)) {
        await tx.ordemServicoItem.deleteMany({ where: { ordemId: id } });

        valorTotal = 0;
        const itensData = [];

        for (const item of itens) {
          const { tipo, itemId, quantidade } = item;
          if (!tipo || !itemId || !quantidade || quantidade <= 0) {
            throw new Error('Cada item deve ter tipo, ID e quantidade válida');
          }

          let itemData;
                    let precoUnitario = 0;

                    if (tipo === 'SERVICO') {
            const servico = await tx.servico.findUnique({ where: { id: itemId, empresaId: req.empresaId! } });
            if (!servico) throw new Error(`Serviço com ID ${itemId} não encontrado`);
            precoUnitario = servico.preco;
                        itemData = { tipo: 'SERVICO' as any, servico: { connect: { id: itemId } }, quantidade, precoUnit: precoUnitario, subtotal: precoUnitario * quantidade };
                    } else if (tipo === 'ADICIONAL') {
            const adicional = await tx.adicional.findUnique({ where: { id: itemId, empresaId: req.empresaId! } });
            if (!adicional) throw new Error(`Adicional com ID ${itemId} não encontrado`);
            precoUnitario = adicional.preco;
            itemData = { tipo: 'ADICIONAL' as any, adicional: { connect: { id: itemId } }, quantidade, precoUnit: precoUnitario, subtotal: precoUnitario * quantidade };
          } else {
            throw new Error('Tipo de item inválido. Use SERVICO ou ADICIONAL');
          }

          itensData.push(itemData);
          valorTotal += itemData.subtotal;
        }
        dataToUpdate.items = { create: itensData };
        dataToUpdate.valorTotal = valorTotal;
      }
      
      // Recalcular comissão se o lavador ou o valor total mudou
      if (itens || lavadorId !== existingOrdem.lavadorId) {
        let comissaoCalculada = 0;
        const valorParaCalculo = Number(dataToUpdate.valorTotal?.toString() || existingOrdem.valorTotal.toString());
        if (lavadorId) {
          const lavador = await tx.lavador.findUnique({ where: { id: lavadorId } });
          if (lavador && lavador.comissao > 0) {
            comissaoCalculada = valorParaCalculo * (lavador.comissao / 100);
          }
        }
        dataToUpdate.comissao = comissaoCalculada;
      }

      // Se o status está sendo mudado para FINALIZADO, recalcula a comissão final
      // para garantir que está correta, mesmo que o lavador não tenha sido alterado.
      if (status === 'FINALIZADO' && existingOrdem.status !== 'FINALIZADO') {
        const valorFinal = Number(dataToUpdate.valorTotal?.toString() || existingOrdem.valorTotal.toString());
        const lavadorFinalId = lavadorId || existingOrdem.lavadorId;
        if (lavadorFinalId) {
          const lavador = await tx.lavador.findUnique({ where: { id: lavadorFinalId } });
          if (lavador && lavador.comissao > 0) {
            dataToUpdate.comissao = valorFinal * (lavador.comissao / 100);
          }
        }
      }

      if (status && status === 'FINALIZADO' && !existingOrdem.dataFim) {
        dataToUpdate.dataFim = new Date();
      }

      const ordemAtualizada = await tx.ordemServico.update({
        where: { id },
        data: dataToUpdate,
        include: {
          cliente: { select: { id: true, nome: true, telefone: true } },
          veiculo: { select: { id: true, placa: true, modelo: true, cor: true } },
          lavador: { select: { id: true, nome: true, comissao: true } },
          items: { include: { servico: { select: { id: true, nome: true } }, adicional: { select: { id: true, nome: true } } } }
        },
      });

      await tx.ordemServicoLavador.deleteMany({ where: { ordemId: id } });
      if (normalizedLavadorIds.length > 0) {
        await tx.ordemServicoLavador.createMany({
          data: normalizedLavadorIds.map(lavadorIdValue => ({
            ordemId: id,
            lavadorId: lavadorIdValue
          }))
        });
      }

      const ordemComLavadores = await tx.ordemServico.findUnique({
        where: { id },
        include: {
          cliente: { select: { id: true, nome: true, telefone: true } },
          veiculo: { select: { id: true, placa: true, modelo: true, cor: true } },
          lavador: { select: { id: true, nome: true, comissao: true } },
          items: { include: { servico: { select: { id: true, nome: true } }, adicional: { select: { id: true, nome: true } } } },
          ordemLavadores: { include: { lavador: true } }
        }
      });

      return ordemComLavadores!;
    });

    // Enviar notificação após a transação ser bem-sucedida
    const ordemFinal = formatOrderWithLavadores(updatedOrdemResult);
    await createNotification({
      empresaId: req.empresaId!,
      mensagem: `A ordem #${ordemFinal.numeroOrdem} (${ordemFinal.cliente.nome}) foi atualizada.`,
      link: `ordens.html?id=${ordemFinal.id}`,
      type: 'ordemEditada'
    });

    // ✅ CACHE: Invalida cache desta empresa quando ordem é atualizada
    invalidateCache(req.empresaId!);

    res.json({ message: 'Ordem de serviço atualizada com sucesso', ordem: ordemFinal });
  } catch (error: any) {
    console.error('Erro ao atualizar ordem de serviço:', error);
    res.status(error.message === 'Ordem de serviço não encontrada' ? 404 : 500).json({ error: error.message || 'Erro interno do servidor' });
  }
};

/**
 * Cancelar ordem de serviço
 */
export const cancelOrdem = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    // Verificar se ordem existe e pertence à empresa
    const ordem = await prisma.ordemServico.findFirst({
      where: {
        id,
        empresaId: req.empresaId
      }
    });

    if (!ordem) {
      return res.status(404).json({ error: 'Ordem de serviço não encontrada' });
    }

    // Não permitir cancelar ordem já finalizada ou cancelada
    if (ordem.status === 'FINALIZADO' || ordem.status === 'CANCELADO') {
      return res.status(400).json({ 
        error: 'Não é possível cancelar ordem já finalizada ou cancelada' 
      });
    }

    const updatedOrdem = await prisma.ordemServico.update({
      where: { id },
      data: {
        status: 'CANCELADO'
      },
      include: {
        cliente: {
          select: {
            id: true,
            nome: true,
            telefone: true
          }
        },
        veiculo: {
          select: {
            id: true,
            placa: true,
            modelo: true,
            cor: true
          }
        },
        lavador: {
          select: {
            id: true,
            nome: true,
            comissao: true
          }
        },
        items: {
          include: {
            servico: {
              select: {
                id: true,
                nome: true
              }
            },
            adicional: {
              select: {
                id: true,
                nome: true
              }
            }
          }
        }
      }
    });

    res.json({
      message: 'Ordem de serviço cancelada com sucesso',
      ordem: updatedOrdem
    });
  } catch (error) {
    console.error('Erro ao cancelar ordem de serviço:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Obter estatísticas de ordens de serviço
 */
export const getOrdensStats = async (req: EmpresaRequest, res: Response) => {
  try {
    const { dataInicio, dataFim, lavadorId, servicoId } = req.query;

    const where: Prisma.OrdemServicoWhereInput = {
      empresaId: req.empresaId,
      status: 'FINALIZADO' // Garante que todas as estatísticas sejam baseadas apenas em ordens finalizadas
    };

    if (dataInicio || dataFim) {
      where.dataFim = {};
      if (dataInicio && dataInicio !== '') {
        const start = new Date(dataInicio as string);
        start.setUTCHours(0, 0, 0, 0);
        if (where.dataFim) where.dataFim.gte = start;
      }
      if (dataFim && dataFim !== '') {
        const end = new Date(dataFim as string);
        end.setUTCHours(23, 59, 59, 999);
        if (where.dataFim) where.dataFim.lte = end;
      }
    }

    if (lavadorId) {
      const washerFilterId = lavadorId as string;
      const washerFilterCondition: Prisma.OrdemServicoWhereInput = {
        OR: [
          { lavadorId: washerFilterId },
          { ordemLavadores: { some: { lavadorId: washerFilterId } } }
        ]
      };
      const existingAnd: Prisma.OrdemServicoWhereInput[] = Array.isArray(where.AND)
        ? [...where.AND]
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [...existingAnd, washerFilterCondition];
    }

    if (servicoId) {
      where.items = {
        some: {
          servicoId: servicoId as string,
          tipo: 'SERVICO'
        }
      };
    }

    // Primeiro, obter os IDs das ordens que atendem aos critérios
    const ordensIds = await prisma.ordemServico.findMany({
      where,
      select: { id: true }
    });

    const ordensIdsList = ordensIds.map((o: { id: string }) => o.id);

    const [
      ordensPorStatus,
      valorTotal,
      ordensFinalizadas,
      topServicos,
      topLavadores
    ] = await Promise.all([
      prisma.ordemServico.groupBy({
        by: ['status'],
        where,
        _count: {
          status: true
        }
      }),
      prisma.ordemServico.aggregate({
        where,
        _sum: {
          valorTotal: true
        }
      }),
      prisma.ordemServico.count({
        where: where // O status já está no 'where' principal
      }),
      
      // Corrigido: usar ordemId em vez de relação aninhada
      prisma.ordemServicoItem.groupBy({
        by: ['servicoId'],
        where: {
          ordemId: { in: ordensIdsList },
          servicoId: { not: null },
          tipo: 'SERVICO'
        },
        _sum: {
          quantidade: true
        },
        _count: {
          id: true
        },
        orderBy: {
          _sum: {
            quantidade: 'desc'
          }
        },
        take: 5
      }),
      prisma.ordemServico.groupBy({
        by: ['lavadorId'],
        where: {
          ...where,
          lavadorId: { not: null } // Correção definitiva aqui
        },
        _count: {
          id: true
        },
        _sum: {
          valorTotal: true
        },
        orderBy: {
          _count: {
            id: 'desc'
          }
        },
        take: 5
      })
    ]);

    // Buscar detalhes dos serviços e lavadores
    const [servicosDetalhes, lavadoresDetalhes] = await Promise.all([
      prisma.servico.findMany({
        where: {
          id: { in: (topServicos as any[]).map((s: { servicoId: string | null }) => s.servicoId!).filter(Boolean) as string[] }
        },
        select: {
          id: true,
          nome: true
        }
      }),
      
      prisma.lavador.findMany({
        where: {
          id: { in: (topLavadores as any[]).map((l: { lavadorId: string | null }) => l.lavadorId!).filter(Boolean) as string[] }
        },
        select: {
          id: true,
          nome: true,
          comissao: true
        }
      })
    ]);

    // Calcular estatísticas adicionais
    const valorTotalFormatado = valorTotal._sum.valorTotal || 0;
    const totalOrdensCount = ordensIdsList.length;
    const taxaConclusao = totalOrdensCount > 0 ? (ordensFinalizadas / totalOrdensCount) * 100 : 0;
    const ticketMedio = ordensFinalizadas > 0 ? valorTotalFormatado / ordensFinalizadas : 0;

    // Estatísticas de pagamentos
    const pagamentosStats = await prisma.pagamento.groupBy({
      by: ['metodo'],
      where: {
        empresaId: req.empresaId,
        status: 'PAGO',
        ordemId: { in: ordensIdsList }
      },
      _sum: {
        valor: true
      },
      _count: {
        _all: true
      }
    });

    const pagamentosPendentes = await prisma.pagamento.aggregate({
        where: {
            empresaId: req.empresaId!,
            status: 'PENDENTE',
            ordemId: { in: ordensIdsList }
        },
        _sum: {
            valor: true
        }
    });

    type TopServico = { servicoId: string | null; _sum: { quantidade: number | null; }; _count: { id: number; }; };
    type TopLavador = { lavadorId: string | null; _sum: { valorTotal: number | null; }; _count: { id: number; }; };

    res.json({
      // Estatísticas gerais (compatibilidade com frontend)
      totalOrdens: totalOrdensCount,
      ordensPorStatus,
      valorTotal: valorTotalFormatado,
      ordensFinalizadas,
      taxaConclusao: Math.round(taxaConclusao * 100) / 100,
      ticketMedio: Math.round(ticketMedio * 100) / 100,
      
      // Top serviços (formato compatível com frontend)
      topServicos: (topServicos as TopServico[]).map((ts: TopServico) => ({
        ...ts,
        _sum: {
          quantidade: ts._sum.quantidade || 0
        },
        _count: {
          id: ts._count.id
        },
        servico: servicosDetalhes.find(s => s.id === ts.servicoId)
      })),
      
      // Top lavadores (formato compatível com frontend)
      topLavadores: (topLavadores as TopLavador[]).map((tl: TopLavador) => ({
        ...tl,
        _sum: {
          valorTotal: tl._sum.valorTotal || 0
        },
        _count: {
          id: tl._count.id
        },
        lavador: lavadoresDetalhes.find(l => l.id === tl.lavadorId)
      })),
      
      // Estatísticas de pagamentos
      pagamentosPorMetodo: pagamentosStats,
      valorPendente: pagamentosPendentes._sum.valor || 0,
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Deletar ordem de serviço permanentemente
 */
export const deleteOrdem = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    // Verificar se ordem existe e pertence à empresa, incluindo dados para a notificação
    const ordem = await prisma.ordemServico.findFirst({
      where: {
        id,
        empresaId: req.empresaId
      },
      include: {
        cliente: { select: { nome: true } }
      }
    });

    if (!ordem) {
      return res.status(404).json({ error: 'Ordem de serviço não encontrada' });
    }

    // Deletar pagamentos associados
    await prisma.pagamento.deleteMany({
      where: {
        ordemId: id
      }
    });

    // Deletar os itens da ordem primeiro (devido à restrição de chave estrangeira)
    await prisma.ordemServicoItem.deleteMany({
      where: {
        ordemId: id
      }
    });

    // Deletar a ordem
    await prisma.ordemServico.delete({
      where: {
        id
      }
    });

    // Enviar notificação após a exclusão
    await createNotification({
      empresaId: req.empresaId!,
      mensagem: `A ordem #${ordem.numeroOrdem} (${ordem.cliente.nome}) foi excluída.`,
            type: 'ordemDeletada' // O link é opcional aqui
    });

    res.json({
      message: 'Ordem de serviço deletada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao deletar ordem de serviço:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Finalizar ordem de serviço manualmente
 * Processa pagamento, atualiza status e calcula comissão
 */
export const finalizarOrdem = async (req: EmpresaRequest, res: Response) => {
  const empresaId = req.empresaId!;
  const { id } = req.params as { id: string };

  // Validação de entrada
  if (!empresaId) {
    return res.status(401).json({ error: 'Empresa não autenticada' });
  }

  // SECURITY: Validate and sanitize payment data
  const validation = validateFinalizarOrdem(req.body);
  if (!validation.isValid) {
    return res.status(400).json({
      error: 'Dados de pagamento inválidos',
      details: validation.errors,
      code: 'VALIDATION_ERROR'
    });
  }

  // Use sanitized data
  const { pagamentos, lavadorDebitoId } = validation.sanitizedData!;

  try {
    // Buscar a ordem e verificar se existe e pertence à empresa
    const ordem = await prisma.ordemServico.findFirst({
      where: {
        id,
        empresaId
      },
      include: {
        lavador: true,
        cliente: true,
        veiculo: true
      }
    });

    if (!ordem) {
      return res.status(404).json({
        error: 'Ordem de serviço não encontrada',
        code: 'ORDER_NOT_FOUND'
      });
    }

    // Verificar se a ordem já foi finalizada
    if (ordem.status === 'FINALIZADO') {
      return res.status(409).json({
        error: 'Esta ordem já foi finalizada',
        code: 'ORDER_ALREADY_FINALIZED'
      });
    }

    // Verificar se a ordem foi cancelada
    if (ordem.status === 'CANCELADO') {
      return res.status(409).json({
        error: 'Não é possível finalizar uma ordem cancelada',
        code: 'ORDER_CANCELLED'
      });
    }

    // Calcular valor total dos pagamentos
    const valorTotalPagamentos = pagamentos.reduce((sum: number, pag: any) => sum + pag.valor, 0);

    // Verificar se o valor total dos pagamentos corresponde ao valor da ordem
    if (Math.abs(valorTotalPagamentos - ordem.valorTotal) > 0.01) { // Tolerância de 1 centavo para erros de arredondamento
      return res.status(400).json({
        error: `Valor total dos pagamentos (R$ ${valorTotalPagamentos.toFixed(2)}) não corresponde ao valor da ordem (R$ ${ordem.valorTotal.toFixed(2)})`,
        code: 'PAYMENT_VALUE_MISMATCH'
      });
    }

    // Calcular comissão se houver lavador
    let comissaoCalculada = 0;
    if (ordem.lavador) {
      // Comissão é uma porcentagem do valor total (ex: 15.5% = 15.5)
      comissaoCalculada = (ordem.valorTotal * ordem.lavador.comissao) / 100;
    }

    // Executar tudo em uma transação atômica
    const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Atualizar status da ordem para FINALIZADO
      const ordemAtualizada = await tx.ordemServico.update({
        where: { id },
        data: {
          status: 'FINALIZADO',
          dataFim: new Date(),
          comissao: comissaoCalculada,
          comissaoPaga: false, // Será paga no fechamento de comissão
          pago: true
        },
        include: {
          cliente: true,
          veiculo: true,
          lavador: true,
          items: {
            include: {
              servico: true,
              adicional: true
            }
          }
        }
      });

      // 2. Criar registros de pagamento
      const pagamentosCriados = await Promise.all(
        pagamentos.map((pag: any) =>
          tx.pagamento.create({
            data: {
              empresaId,
              ordemId: id,
              metodo: pag.metodo,
              valor: pag.valor,
              status: 'PAGO',
              pagoEm: new Date(),
              observacoes: pag.observacoes || null
            }
          })
        )
      );

      // 3. Se houver débito de lavador, criar registro de adiantamento
      if (lavadorDebitoId && ordem.lavador) {
        await tx.adiantamento.create({
          data: {
            empresaId,
            lavadorId: lavadorDebitoId,
            valor: comissaoCalculada,
            status: 'QUITADO'
          }
        });
      }

      return {
        ordem: ordemAtualizada,
        pagamentos: pagamentosCriados
      };
    });

    // 4. Enviar notificação após a transação
    await createNotification({
      empresaId,
      mensagem: `Ordem #${ordem.numeroOrdem} (${ordem.cliente.nome} - ${ordem.veiculo.placa}) foi finalizada. Valor: R$ ${ordem.valorTotal.toFixed(2)}`,
      link: `ordens.html?id=${ordem.id}`,
      type: 'ordemEditada'
    });

    // ✅ CACHE: Invalida cache desta empresa quando ordem é finalizada
    invalidateCache(empresaId);

    // Resposta de sucesso
    res.status(200).json({
      message: 'Ordem finalizada com sucesso',
      ordem: resultado.ordem,
      pagamentos: resultado.pagamentos,
      comissao: comissaoCalculada > 0 ? {
        valor: comissaoCalculada,
        porcentagem: ordem.lavador?.comissao,
        lavador: ordem.lavador?.nome
      } : null
    });

  } catch (error: any) {
    console.error('Erro ao finalizar ordem de serviço:', error);
    res.status(500).json({
      error: 'Erro interno do servidor ao finalizar ordem',
      details: error.message || 'Erro desconhecido'
    });
  }
};

/**
 * Itera sobre as empresas para finalizar ordens do dia conforme o horário de fechamento.
 * Esta função é chamada pelo cron job a cada 15 minutos.
 */
export const processarFinalizacoesAutomaticas = async () => {
  const agora = new Date();
  
  try {
    const empresas = await prisma.empresa.findMany({
      where: { finalizacaoAutomatica: true, ativo: true },
    });

    if (empresas.length === 0) {
      return; // Nenhuma empresa para processar
    }

    console.log(`[${agora.toISOString()}] Verificando ${empresas.length} empresa(s) para finalização automática.`);

    for (const empresa of empresas) {
      const horarioFechamento = empresa.horarioFechamento || '19:00';
      const [horas, minutos] = horarioFechamento.split(':').map(Number);
      
      const dataFechamento = new Date();
      dataFechamento.setHours(horas, minutos, 0, 0);

      // Se a hora atual for posterior à hora de fechamento da empresa, processa.
      if (agora >= dataFechamento) {
        try {
          const horarioAbertura = empresa.horarioAbertura || '07:00';
          const [hAbertura, mAbertura] = horarioAbertura.split(':').map(Number);

          const inicioDoDia = new Date();
          inicioDoDia.setHours(hAbertura, mAbertura, 0, 0);

          const ordensParaFinalizar = await prisma.ordemServico.findMany({
            where: {
              empresaId: empresa.id,
              status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] as any },
            },
          });

          if (ordensParaFinalizar.length > 0) {
            console.log(`[${agora.toISOString()}] Finalizando ${ordensParaFinalizar.length} ordens para a empresa: ${empresa.nome}`);

            const transacoes = ordensParaFinalizar.map((ordem: OrdemServico) => 
              prisma.ordemServico.update({
                where: { id: ordem.id },
                data: {
                  status: 'FINALIZADO',
                  dataFim: new Date(),
                                pagamentos: {
                    create: {
                      empresaId: empresa.id,
                                        valor: ordem.valorTotal,
                                        metodo: 'PENDENTE' as any,
                      status: 'PENDENTE',
                    },
                  },
                },
              })
            );

            await prisma.$transaction(transacoes);
            console.log(`[${agora.toISOString()}] Ordens da empresa ${empresa.nome} finalizadas com sucesso.`);

            // Criar notificação para o usuário
            const totalFinalizadas = ordensParaFinalizar.length;
            const mensagem = totalFinalizadas === 1
              ? '1 ordem de serviço foi finalizada automaticamente.'
              : `${totalFinalizadas} ordens de serviço foram finalizadas automaticamente.`;

            await createNotification({
              empresaId: empresa.id,
              mensagem: mensagem,
                            link: 'ordens.html?status=FINALIZADO', // Link para a página de ordens filtrada
              type: 'finalizacaoAutomatica'
            });
          }
        } catch (error) {
          console.error(`[${agora.toISOString()}] Erro ao processar finalização para a empresa ${empresa.nome}:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`[${agora.toISOString()}] Erro geral no processo de finalização automática:`, error);
  }
};
