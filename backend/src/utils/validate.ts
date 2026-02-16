/**
 * INPUT VALIDATION UTILITIES
 *
 * Provides reusable validation functions to prevent:
 * - SQL Injection (via type coercion)
 * - XSS attacks (via data sanitization)
 * - Business logic errors (negative prices, invalid enums)
 *
 * Usage:
 *   const { isValid, errors } = validateCreateOrder(req.body);
 *   if (!isValid) return res.status(400).json({ error: errors });
 */

import { MetodoPagamento, OrdemStatus, OrdemItemType } from '@prisma/client';

/**
 * Validation result structure
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedData?: any;
}

/**
 * Generic validation helpers
 */
export const validators = {
  /**
   * Validate string is not empty
   */
  isNonEmptyString(value: any, fieldName: string): string | null {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return `${fieldName} deve ser uma string não vazia`;
    }
    return null;
  },

  /**
   * Validate positive number
   */
  isPositiveNumber(value: any, fieldName: string): string | null {
    const num = Number(value);
    if (isNaN(num) || num <= 0) {
      return `${fieldName} deve ser um número positivo`;
    }
    return null;
  },

  /**
   * Validate non-negative number (0 allowed)
   */
  isNonNegativeNumber(value: any, fieldName: string): string | null {
    const num = Number(value);
    if (isNaN(num) || num < 0) {
      return `${fieldName} deve ser um número não negativo`;
    }
    return null;
  },

  /**
   * Validate integer
   */
  isInteger(value: any, fieldName: string): string | null {
    const num = Number(value);
    if (isNaN(num) || !Number.isInteger(num)) {
      return `${fieldName} deve ser um número inteiro`;
    }
    return null;
  },

  /**
   * Validate enum value
   */
  isValidEnum<T>(value: any, enumObj: T, fieldName: string): string | null {
    const validValues = Object.values(enumObj as any);
    if (!validValues.includes(value)) {
      return `${fieldName} deve ser um dos seguintes: ${validValues.join(', ')}`;
    }
    return null;
  },

  /**
   * Validate email format (basic)
   */
  isValidEmail(value: any, fieldName: string): string | null {
    if (typeof value !== 'string') return `${fieldName} deve ser uma string`;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return `${fieldName} deve ser um email válido`;
    }
    return null;
  },

  /**
   * Validate phone number (Brazilian format)
   */
  isValidPhone(value: any, fieldName: string): string | null {
    if (typeof value !== 'string') return `${fieldName} deve ser uma string`;

    // Remove formatting
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length < 10 || cleaned.length > 11) {
      return `${fieldName} deve ter 10 ou 11 dígitos`;
    }
    return null;
  },

  /**
   * Validate plate format (Brazilian)
   */
  isValidPlate(value: any, fieldName: string): string | null {
    if (typeof value !== 'string') return `${fieldName} deve ser uma string`;

    // ABC1234 or ABC1D23 (Mercosul)
    const plateRegex = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/i;
    const normalized = value.replace(/[-\s]/g, '').toUpperCase();

    if (!plateRegex.test(normalized)) {
      return `${fieldName} deve estar no formato ABC1234 ou ABC1D23`;
    }
    return null;
  },

  /**
   * Validate CUID format
   */
  isValidCuid(value: any, fieldName: string): string | null {
    if (typeof value !== 'string' || value.length < 20) {
      return `${fieldName} deve ser um ID válido`;
    }
    return null;
  },

  /**
   * Validate array
   */
  isNonEmptyArray(value: any, fieldName: string): string | null {
    if (!Array.isArray(value) || value.length === 0) {
      return `${fieldName} deve ser um array não vazio`;
    }
    return null;
  },

  /**
   * Sanitize string (prevent XSS)
   */
  sanitizeString(value: string): string {
    return value
      .trim()
      .replace(/[<>]/g, '') // Remove < and >
      .substring(0, 1000); // Limit length
  },
};

/**
 * Validate Order Creation
 */
export function validateCreateOrder(data: any): ValidationResult {
  const errors: string[] = [];

  // Validate cliente/novoCliente
  if (!data.clienteId && !data.novoCliente) {
    errors.push('clienteId ou novoCliente é obrigatório');
  } else if (data.novoCliente) {
    const nameError = validators.isNonEmptyString(data.novoCliente.nome, 'novoCliente.nome');
    if (nameError) errors.push(nameError);
  }

  // Validate veiculo/novoVeiculo
  if (!data.veiculoId && !data.novoVeiculo) {
    errors.push('veiculoId ou novoVeiculo é obrigatório');
  } else if (data.novoVeiculo) {
    const plateError = validators.isValidPlate(data.novoVeiculo.placa, 'novoVeiculo.placa');
    if (plateError) errors.push(plateError);

    const modelError = validators.isNonEmptyString(data.novoVeiculo.modelo, 'novoVeiculo.modelo');
    if (modelError) errors.push(modelError);
  }

  // Validate items array
  const itemsError = validators.isNonEmptyArray(data.itens, 'itens');
  if (itemsError) {
    errors.push(itemsError);
  } else {
    data.itens.forEach((item: any, index: number) => {
      // Validate item type
      const typeError = validators.isValidEnum(
        item.tipo,
        OrdemItemType,
        `itens[${index}].tipo`
      );
      if (typeError) errors.push(typeError);

      // Validate itemId
      const itemIdError = validators.isValidCuid(item.itemId, `itens[${index}].itemId`);
      if (itemIdError) errors.push(itemIdError);

      // Validate quantidade
      const qtyError = validators.isPositiveNumber(item.quantidade, `itens[${index}].quantidade`);
      if (qtyError) errors.push(qtyError);
    });
  }

  // Sanitize observacoes
  const sanitizedData = {
    ...data,
    observacoes: data.observacoes ? validators.sanitizeString(data.observacoes) : null,
    novoCliente: data.novoCliente ? {
      ...data.novoCliente,
      nome: validators.sanitizeString(data.novoCliente.nome),
    } : undefined,
    lavadorId: data.lavadorId ? data.lavadorId : undefined,
    lavadorIds: Array.isArray(data.lavadorIds) ? data.lavadorIds.filter(Boolean) : undefined,
  };

  return {
    isValid: errors.length === 0,
    errors,
    sanitizedData: errors.length === 0 ? sanitizedData : undefined,
  };
}

/**
 * Validate Order Finalization
 */
export function validateFinalizarOrdem(data: any): ValidationResult {
  const errors: string[] = [];

  // Validate pagamentos array
  const pagamentosError = validators.isNonEmptyArray(data.pagamentos, 'pagamentos');
  if (pagamentosError) {
    errors.push(pagamentosError);
    return { isValid: false, errors };
  }

  // Validate each payment
  const validMethods = ['DINHEIRO', 'CARTAO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX', 'NFE', 'OUTRO', 'PENDENTE', 'DEBITO_FUNCIONARIO'];

  data.pagamentos.forEach((pag: any, index: number) => {
    // ✅ Normalizar método: aceita tanto 'metodo' quanto 'method', converte para maiúsculas
    const metodo = (pag.metodo || pag.method || '').toUpperCase().trim();

    if (!metodo || !validMethods.includes(metodo)) {
      errors.push(
        `pagamentos[${index}].metodo inválido: "${pag.metodo || pag.method}". Valores válidos: ${validMethods.join(', ')}`
      );
    }

    // Validate payment value
    const valor = parseFloat(pag.valor || pag.amount);
    if (isNaN(valor) || valor <= 0) {
      errors.push(
        `pagamentos[${index}].valor inválido: "${pag.valor || pag.amount}". Deve ser um número maior que zero.`
      );
    }
  });

  // Sanitize observacoes in payments
  const sanitizedData = {
    ...data,
    pagamentos: data.pagamentos.map((pag: any) => ({
      metodo: (pag.metodo || pag.method || '').toUpperCase().trim(), // ✅ Normalizar
      valor: parseFloat(pag.valor || pag.amount),
      observacoes: pag.observacoes ? validators.sanitizeString(pag.observacoes) : null,
    })),
  };

  return {
    isValid: errors.length === 0,
    errors,
    sanitizedData: errors.length === 0 ? sanitizedData : undefined,
  };
}

/**
 * Validate Update Order
 */
export function validateUpdateOrder(data: any): ValidationResult {
  const errors: string[] = [];

  // Validate status if provided
  if (data.status) {
    const statusError = validators.isValidEnum(data.status, OrdemStatus, 'status');
    if (statusError) errors.push(statusError);
  }

  if (data.lavadorId) {
    const lavadorError = validators.isValidCuid(data.lavadorId, 'lavadorId');
    if (lavadorError) errors.push(lavadorError);
  }

  if (data.lavadorIds !== undefined) {
    if (!Array.isArray(data.lavadorIds)) {
      errors.push('lavadorIds deve ser um array de IDs');
    } else {
      data.lavadorIds.forEach((id: any, index: number) => {
        const idError = validators.isValidCuid(id, `lavadorIds[${index}]`);
        if (idError) errors.push(idError);
      });
    }
  }

  // Sanitize observacoes
  const sanitizedData = {
    ...data,
    observacoes: data.observacoes ? validators.sanitizeString(data.observacoes) : undefined,
    lavadorId: data.lavadorId ? data.lavadorId : undefined,
    lavadorIds: Array.isArray(data.lavadorIds) ? data.lavadorIds : undefined,
  };

  return {
    isValid: errors.length === 0,
    errors,
    sanitizedData: errors.length === 0 ? sanitizedData : undefined,
  };
}

/**
 * Validate Cliente Creation/Update
 */
export function validateCliente(data: any, isUpdate: boolean = false): ValidationResult {
  const errors: string[] = [];

  // Nome is required for creation
  if (!isUpdate || data.nome !== undefined) {
    const nameError = validators.isNonEmptyString(data.nome, 'nome');
    if (nameError) errors.push(nameError);
  }

  // Validate email if provided
  if (data.email) {
    const emailError = validators.isValidEmail(data.email, 'email');
    if (emailError) errors.push(emailError);
  }

  // Validate telefone if provided
  if (data.telefone) {
    const phoneError = validators.isValidPhone(data.telefone, 'telefone');
    if (phoneError) errors.push(phoneError);
  }

  // Sanitize strings
  const sanitizedData: any = {};
  if (data.nome) sanitizedData.nome = validators.sanitizeString(data.nome);
  if (data.email) sanitizedData.email = data.email.trim().toLowerCase();
  if (data.telefone) sanitizedData.telefone = data.telefone.replace(/\D/g, '');

  return {
    isValid: errors.length === 0,
    errors,
    sanitizedData: errors.length === 0 ? sanitizedData : undefined,
  };
}

/**
 * Validate Servico Creation/Update
 */
export function validateServico(data: any, isUpdate: boolean = false): ValidationResult {
  const errors: string[] = [];

  // Nome is required for creation
  if (!isUpdate || data.nome !== undefined) {
    const nameError = validators.isNonEmptyString(data.nome, 'nome');
    if (nameError) errors.push(nameError);
  }

  // Preco is required for creation
  if (!isUpdate || data.preco !== undefined) {
    const precoError = validators.isPositiveNumber(data.preco, 'preco');
    if (precoError) errors.push(precoError);
  }

  // Validate duracao if provided
  if (data.duracao !== undefined && data.duracao !== null) {
    const duracaoError = validators.isPositiveNumber(data.duracao, 'duracao');
    if (duracaoError) errors.push(duracaoError);
  }

  // Sanitize strings
  const sanitizedData: any = {};
  if (data.nome) sanitizedData.nome = validators.sanitizeString(data.nome);
  if (data.descricao) sanitizedData.descricao = validators.sanitizeString(data.descricao);
  if (data.preco !== undefined) sanitizedData.preco = Number(data.preco);
  if (data.duracao !== undefined) sanitizedData.duracao = data.duracao ? Number(data.duracao) : null;

  return {
    isValid: errors.length === 0,
    errors,
    sanitizedData: errors.length === 0 ? sanitizedData : undefined,
  };
}

/**
 * Validate Query Parameters (Pagination, Search, Filters)
 */
export function validateQueryParams(query: any): {
  page: number;
  limit: number;
  search: string;
  [key: string]: any;
} {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 15)); // Max 100 per page
  const search = query.search ? validators.sanitizeString(query.search) : '';

  return {
    page,
    limit,
    search,
    ...query,
  };
}
