/**
 * Roda localmente para fazer o scan inicial do QR e salvar o auth state no Neon.
 * Uso: npx ts-node scripts/scan-local.ts
 */
import * as qrcode from 'qrcode-terminal';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const AUTH_DIR = join(tmpdir(), 'baileys-scan-local');
const INSTANCE_NAME = 'lina-global';

let savedSuccessfully = false;

async function main() {
  mkdirSync(AUTH_DIR, { recursive: true });

  const dynamicImport = new Function('module', 'return import(module)');
  const baileysMod = await dynamicImport('@whiskeysockets/baileys') as any;

  const {
    default: _def,
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    DisconnectReason,
  } = baileysMod;

  const _makeWASocket = makeWASocket ?? _def?.makeWASocket ?? _def;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  let version = [2, 3000, 1023000166];
  try {
    const v = await fetchLatestBaileysVersion();
    if (v?.version?.length === 3) version = v.version;
  } catch {}

  console.log('🤖 Iniciando conexão local para scan do QR...');
  console.log('📱 Abra o WhatsApp → Aparelhos conectados → Conectar aparelho → escaneie o QR abaixo:\n');

  const sock = _makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Safari'),
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update: any) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('\n⏳ Escaneie o QR acima com seu WhatsApp...');
    }

    if (connection === 'open') {
      console.log('\n✅ Conectado! Salvando auth state no banco...');

      const { readdirSync, readFileSync } = await import('fs');
      const files = readdirSync(AUTH_DIR);
      const authFiles: Record<string, string> = {};
      for (const f of files) {
        authFiles[f] = readFileSync(join(AUTH_DIR, f), 'utf-8');
      }

      await prisma.whatsappInstance.upsert({
        where: { instanceName: INSTANCE_NAME } as any,
        update: { authState: JSON.stringify(authFiles), status: 'connected' },
        create: {
          instanceName: INSTANCE_NAME,
          authState: JSON.stringify(authFiles),
          status: 'connected',
        } as any,
      });

      savedSuccessfully = true;
      console.log(`✅ Auth state salvo (${files.length} arquivos). O bot no Railway vai reconectar automaticamente!`);
      console.log('🔌 Fechando script local...');
      await prisma.$disconnect();
      sock.end(undefined);
      setTimeout(() => process.exit(0), 2000);
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode;
      console.log(`Conexão fechada — código: ${code}`);

      // Se já salvou com sucesso, ignora qualquer close
      if (savedSuccessfully) return;

      // Sessão inválida (logout ou falha de conexão com creds existentes) — limpar e reiniciar
      const isInvalid = code === (DisconnectReason?.loggedOut ?? 401) || code === 500;
      if (isInvalid) {
        console.log('🧹 Limpando sessão inválida do banco e reiniciando com QR fresco...');
        await prisma.whatsappInstance.updateMany({
          where: { instanceName: INSTANCE_NAME } as any,
          data: { authState: null, status: 'disconnected' },
        });
        const { rmSync } = await import('fs');
        rmSync(AUTH_DIR, { recursive: true, force: true });
        mkdirSync(AUTH_DIR, { recursive: true });
        setTimeout(() => main().catch(console.error), 2000);
        return;
      }

      console.log('Reconectando...');
      setTimeout(() => main().catch(console.error), 2000);
    }
  });
}

main().catch(e => {
  console.error('Erro:', e);
  process.exit(1);
});
