import 'dotenv/config';
import { tmpdir } from 'os';

/**
 * Pasta-mãe das sessões do Baileys (baileys-global, baileys-empresa-*).
 * BAILEYS_AUTH_DIR no .env tira as sessões do TEMP do Windows, que a limpeza
 * automática pode apagar; sem ela, continua no TEMP como antes.
 * O dotenv é carregado aqui porque os serviços leem isto na importação.
 */
export const AUTH_BASE = process.env.BAILEYS_AUTH_DIR || tmpdir();
