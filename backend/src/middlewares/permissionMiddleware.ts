import { Request, Response, NextFunction } from 'express';
import prisma from '../db';

/**
 * RBAC — imposição de permissões por rota (complementa o authMiddleware).
 *
 * O authMiddleware garante autenticação + isolamento de empresa (tenant). ESTE
 * middleware garante que o cargo do funcionário tem a permissão exigida para a
 * rota — resolvido para o `empresaId` ATIVO (multi-empresa: o cargo varia por
 * empresa, então usamos o mesmo par (subaccountId, empresaId) do token).
 *
 * Owner (token sem subaccountId) = dono da empresa → acesso total.
 *
 * Extensão futura (override por funcionário, bloqueios/liberdades extras): basta
 * evoluir `resolvePermissoes` — o resto (guards nas rotas) não muda.
 */

const PERM_CACHE_TTL = 5 * 60 * 1000; // 5 min — espelha o authCache

interface PermCacheEntry {
  perms: Set<string>;
  expiresAt: number;
}

const permCache = new Map<string, PermCacheEntry>();

/** Invalida o cache de permissões de uma empresa (ou tudo). Chamar ao editar cargos/acessos. */
export function clearPermCache(empresaId?: string): number {
  if (!empresaId) {
    const total = permCache.size;
    permCache.clear();
    return total;
  }
  let removed = 0;
  for (const key of permCache.keys()) {
    if (key.endsWith(`:${empresaId}`)) {
      permCache.delete(key);
      removed++;
    }
  }
  return removed;
}

/**
 * Resolve o conjunto de permissões do chamador para a empresa ativa.
 * Retorna `null` quando é OWNER (acesso total).
 */
async function resolvePermissoes(req: Request): Promise<Set<string> | null> {
  const subaccountId = (req as any).subaccountId as string | undefined;
  const empresaId = (req as any).empresaId as string;

  // Owner (Usuario dono da empresa) → sem subaccountId → todas as permissões
  if (!subaccountId) return null;

  const key = `${subaccountId}:${empresaId}`;
  const cached = permCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.perms;

  let names: string[] = [];

  const sub = await prisma.subaccount.findUnique({
    where: { id: subaccountId },
    select: {
      empresaId: true,
      roleInt: { select: { permissoes: { select: { name: true } } } },
    },
  });

  if (sub) {
    if (sub.empresaId === empresaId) {
      // Empresa primária → cargo primário
      names = sub.roleInt?.permissoes.map(p => p.name) ?? [];
    } else {
      // Acesso adicional (multi-empresa) → cargo daquele acesso
      const acesso = await prisma.subaccountEmpresaAcesso.findUnique({
        where: { subaccountId_empresaId: { subaccountId, empresaId } },
        select: { role: { select: { permissoes: { select: { name: true } } } } },
      });
      names = acesso?.role?.permissoes.map(p => p.name) ?? [];
    }
  }

  const perms = new Set(names);
  permCache.set(key, { perms, expiresAt: Date.now() + PERM_CACHE_TTL });
  return perms;
}

/** true se owner (null), se nada é exigido, ou se tem ao menos uma das exigidas. */
function autorizado(perms: Set<string> | null, exigidas: string[]): boolean {
  if (perms === null) return true;          // owner
  if (exigidas.length === 0) return true;    // qualquer autenticado
  return exigidas.some(p => perms.has(p));
}

function negar(res: Response) {
  return res.status(403).json({
    error: 'Você não tem permissão para esta ação.',
    code: 'FORBIDDEN',
  });
}

/**
 * Exige QUALQUER uma das permissões informadas (OR). Sem argumentos = só autenticado.
 * Aplica a todos os métodos da rota/roteador.
 */
export function requirePermission(...exigidas: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const perms = await resolvePermissoes(req);
      if (autorizado(perms, exigidas)) return next();
      return negar(res);
    } catch (err) {
      console.error('[requirePermission] erro ao resolver permissões:', err);
      return res.status(500).json({ error: 'Erro ao validar permissão' });
    }
  };
}

/**
 * Regras distintas para leitura (GET/HEAD) e escrita (demais métodos).
 * Ex.: ler serviços libera pra quem cria ordem; editar exige config_ver_servicos.
 */
export function requirePermissionByMethod(opts: { read: string[]; write: string[] }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    const exigidas = isRead ? opts.read : opts.write;
    try {
      const perms = await resolvePermissoes(req);
      if (autorizado(perms, exigidas)) return next();
      return negar(res);
    } catch (err) {
      console.error('[requirePermissionByMethod] erro ao resolver permissões:', err);
      return res.status(500).json({ error: 'Erro ao validar permissão' });
    }
  };
}
