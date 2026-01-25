import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import prisma from '../db';

/**
 * THEME CONTROLLER
 * Manages company theming and customization
 */

/**
 * Validate HEX color code
 */
function isValidHexColor(color: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(color);
}

/**
 * Get Theme Configuration for Current Company
 * Returns theme settings like colors and logo
 */
export const getThemeConfig = async (req: Request, res: Response) => {
  try {
    const { empresaId } = req as AuthenticatedRequest;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa ID não encontrado no token' });
    }

    // Fetch theme from database
    const theme = await prisma.theme.findUnique({
      where: { empresaId }
    });

    // If no theme exists, return defaults without creating one yet
    if (!theme) {
      return res.json({
        corPrimaria: '#F59E0B',
        corSecundaria: '#1F2937',
        logoUrl: null,
        empresaId
      });
    }

    res.json(theme);
  } catch (error) {
    console.error('Error fetching theme config:', error);
    res.status(500).json({ error: 'Erro ao buscar configuração do tema' });
  }
};

/**
 * Update Theme Configuration
 * Allows admin to update company theme colors
 */
export const updateThemeConfig = async (req: Request, res: Response) => {
  try {
    const { empresaId } = req as AuthenticatedRequest;
    const { corPrimaria, corSecundaria, logoUrl } = req.body;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa ID não encontrado no token' });
    }

    // Validation: Ensure valid HEX color codes
    if (corPrimaria && !isValidHexColor(corPrimaria)) {
      return res.status(400).json({
        error: 'Cor primária inválida. Use formato HEX (ex: #FF5733)',
        code: 'INVALID_COLOR_FORMAT'
      });
    }

    if (corSecundaria && !isValidHexColor(corSecundaria)) {
      return res.status(400).json({
        error: 'Cor secundária inválida. Use formato HEX (ex: #FF5733)',
        code: 'INVALID_COLOR_FORMAT'
      });
    }

    // Build update data object
    const updateData: any = {};
    if (corPrimaria) updateData.corPrimaria = corPrimaria.toUpperCase();
    if (corSecundaria) updateData.corSecundaria = corSecundaria.toUpperCase();
    if (logoUrl !== undefined) updateData.logoUrl = logoUrl;

    // Upsert theme (create if not exists, update if exists)
    const theme = await prisma.theme.upsert({
      where: { empresaId },
      create: {
        empresaId,
        corPrimaria: corPrimaria?.toUpperCase() || '#F59E0B',
        corSecundaria: corSecundaria?.toUpperCase() || '#1F2937',
        logoUrl: logoUrl || null
      },
      update: updateData
    });

    res.json({
      message: 'Tema atualizado com sucesso',
      theme
    });
  } catch (error) {
    console.error('Error updating theme config:', error);
    res.status(500).json({ error: 'Erro ao atualizar configuração do tema' });
  }
};
