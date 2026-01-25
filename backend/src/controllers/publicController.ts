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

        const ordens = await prisma.ordemServico.findMany({
            where: {
                lavadorId: lavador.id,
                createdAt: { gte: trintaDiasAtras },
                status: { in: ['EM_ANDAMENTO', 'FINALIZADO', 'PENDENTE', 'AGUARDANDO_PAGAMENTO'] } // Inclui pendente, andamento e aguardando pagamento para o lavador ver o que tem pra fazer
            },
            include: {
                veiculo: { select: { modelo: true, placa: true } },
                items: { include: { servico: { select: { nome: true } }, adicional: { select: { nome: true } } } }
            },
            orderBy: { createdAt: 'desc' },
            take: 100 // Limita a 100 ordens para performance
        });

        res.json({
            nome: lavador.nome,
            comissao: lavador.comissao,
            ordens: ordens
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
