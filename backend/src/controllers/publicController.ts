import { Request, Response } from 'express';
import prisma from '../db';
import jwt from 'jsonwebtoken';

/**
 * Retorna os dados públicos de um lavador com base em um token JWT.
 * Esta rota não requer autenticação de empresa.
 * A validação agora checa se o token existe e está ativo no banco de dados.
 */
export const getLavadorPublicData = async (req: Request, res: Response) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Token não fornecido' });
    }

    try {
        // 1. Verificar se o token existe e está ativo no banco de dados
        const tokenData = await prisma.lavadorToken.findUnique({
            where: { token: token, ativo: true },
            include: { lavador: true } // Inclui os dados do lavador associado
        });

        if (!tokenData) {
            return res.status(401).json({ error: 'Token inválido ou inativo' });
        }

        // Verificar se o token expirou (se não for permanente)
        if (tokenData.expiresAt && new Date(tokenData.expiresAt) < new Date()) {
            return res.status(401).json({ error: 'Token expirado' });
        }

        // 2. Verificar a validade do JWT (para checar expiração)
        const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'seu_segredo_jwt_aqui');
        
        const lavador = tokenData.lavador;
        if (!lavador) {
            return res.status(404).json({ error: 'Lavador associado ao token não encontrado' });
        }

        // 3. Buscar as ordens do lavador nos últimos 30 dias para os cálculos
        const trintaDiasAtras = new Date();
        trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
        trintaDiasAtras.setHours(0, 0, 0, 0);

        // Buscar ordens onde o lavador é o principal OU está em multi-wash
        const ordens = await prisma.ordemServico.findMany({
            where: {
                OR: [
                    { lavadorId: lavador.id }, // Lavador principal
                    { ordemLavadores: { some: { lavadorId: lavador.id } } } // Multi-wash
                ],
                createdAt: { gte: trintaDiasAtras },
                status: { in: ['EM_ANDAMENTO', 'FINALIZADO', 'PENDENTE', 'AGUARDANDO_PAGAMENTO'] }
            },
            include: {
                veiculo: { select: { modelo: true, placa: true } },
                items: {
                    include: {
                        servico: { select: { nome: true } },
                        adicional: { select: { nome: true } }
                    }
                },
                lavador: { select: { nome: true, comissao: true } },
                ordemLavadores: {
                    include: {
                        lavador: { select: { id: true, nome: true, comissao: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 100
        });

        // 4. Buscar fechamentos de comissão do lavador (pagamentos recebidos)
        const fechamentosComissao = await prisma.fechamentoComissao.findMany({
            where: {
                lavadorId: lavador.id,
                data: { gte: trintaDiasAtras }
            },
            include: {
                ordensPagas: {
                    include: {
                        veiculo: { select: { placa: true, modelo: true } },
                        items: {
                            include: {
                                servico: { select: { nome: true } },
                                adicional: { select: { nome: true } }
                            }
                        },
                        lavador: { select: { nome: true, comissao: true } },
                        ordemLavadores: {
                            include: {
                                lavador: { select: { id: true, nome: true, comissao: true } }
                            }
                        }
                    }
                },
                ordemLavadoresPagos: {
                    include: {
                        lavador: { select: { id: true, nome: true, comissao: true } },
                        ordem: {
                            include: {
                                veiculo: { select: { placa: true, modelo: true } },
                                items: {
                                    include: {
                                        servico: { select: { nome: true } },
                                        adicional: { select: { nome: true } }
                                    }
                                },
                                lavador: { select: { nome: true, comissao: true } },
                                ordemLavadores: {
                                    include: {
                                        lavador: { select: { id: true, nome: true, comissao: true } }
                                    }
                                }
                            }
                        }
                    }
                },
                adiantamentosQuitados: true
            },
            orderBy: { data: 'desc' }
        });

        // 5. Buscar adiantamentos não quitados (dívida atual)
        const adiantamentosNaoQuitados = await prisma.adiantamento.findMany({
            where: {
                lavadorId: lavador.id,
                status: { not: 'QUITADO' }
            },
            orderBy: { data: 'desc' }
        });

        res.json({
            lavadorId: lavador.id,
            nome: lavador.nome,
            comissao: lavador.comissao,
            ordens: ordens,
            fechamentos: fechamentosComissao,
            adiantamentosNaoQuitados: adiantamentosNaoQuitados,
            tokenExpiresAt: tokenData.expiresAt // null = permanente
        });

    } catch (error) {
        console.error('Erro ao validar token público:', error);
        res.status(401).json({ error: 'Token inválido ou expirado' });
    }
};


export const getOrdensByLavadorPublic = async (req: Request, res: Response) => {
    // Esta função pode ser removida ou adaptada, pois getLavadorPublicData já retorna as ordens.
    // Mantendo a estrutura caso seja usada em outro lugar.
    res.status(501).json({ message: 'Not implemented' });
};
