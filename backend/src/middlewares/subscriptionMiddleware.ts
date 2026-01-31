import { Request, Response, NextFunction } from 'express';
import { subscriptionService } from '../services/subscriptionService';

/**
 * SUBSCRIPTION MIDDLEWARE
 * Middlewares para validação de assinaturas e features
 */

interface AuthenticatedRequest extends Request {
  usuarioId?: string;
  empresaId?: string;
  subscription?: any;
}

/**
 * Middleware para validar acesso a features específicas
 * Uso: router.get('/vitrine', requireFeature('painel_vitrine'), handler)
 */
export const requireFeature = (featureKey: string) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void | Response> => {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.usuarioId) {
      return res.status(401).json({
        error: 'Usuário não autenticado',
        code: 'UNAUTHORIZED'
      });
    }

    try {
      const access = await subscriptionService.hasFeatureAccess(
        authReq.usuarioId,
        featureKey
      );

      if (!access.hasAccess) {
        return res.status(403).json({
          error: 'Acesso negado',
          message: access.reason || 'Você não tem acesso a esta funcionalidade',
          feature: featureKey,
          code: 'FEATURE_NOT_AVAILABLE'
        });
      }

      next();
    } catch (error) {
      console.error('Erro ao validar feature:', error);
      return res.status(500).json({
        error: 'Erro ao validar acesso',
        code: 'SUBSCRIPTION_CHECK_ERROR'
      });
    }
  };
};

/**
 * Middleware para validar se usuário tem assinatura ativa
 */
export const requireActiveSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  const authReq = req as AuthenticatedRequest;

  if (!authReq.usuarioId) {
    return res.status(401).json({
      error: 'Usuário não autenticado',
      code: 'UNAUTHORIZED'
    });
  }

  try {
    const subscription = await subscriptionService.getActiveSubscription(
      authReq.usuarioId
    );

    if (!subscription) {
      return res.status(403).json({
        error: 'Assinatura necessária',
        message: 'Você precisa de uma assinatura ativa para acessar este recurso',
        code: 'NO_ACTIVE_SUBSCRIPTION',
        requiresSubscription: true
      });
    }

    // Anexar dados da assinatura ao request para uso posterior
    authReq.subscription = subscription;

    next();
  } catch (error) {
    console.error('Erro ao validar assinatura:', error);
    return res.status(500).json({
      error: 'Erro ao validar assinatura',
      code: 'SUBSCRIPTION_CHECK_ERROR'
    });
  }
};

/**
 * Middleware para validar limite de empresas antes de criar
 */
export const checkCompanyLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  const authReq = req as AuthenticatedRequest;

  if (!authReq.usuarioId) {
    return res.status(401).json({
      error: 'Usuário não autenticado',
      code: 'UNAUTHORIZED'
    });
  }

  try {
    const canCreate = await subscriptionService.canCreateMoreCompanies(
      authReq.usuarioId
    );

    if (!canCreate.allowed) {
      return res.status(403).json({
        error: 'Limite de empresas atingido',
        message: canCreate.reason,
        limit: canCreate.limit,
        current: canCreate.current,
        code: 'COMPANY_LIMIT_REACHED'
      });
    }

    next();
  } catch (error) {
    console.error('Erro ao validar limite de empresas:', error);
    return res.status(500).json({
      error: 'Erro ao validar limite',
      code: 'LIMIT_CHECK_ERROR'
    });
  }
};

export default {
  requireFeature,
  requireActiveSubscription,
  checkCompanyLimit
};
