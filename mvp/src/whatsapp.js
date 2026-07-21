// Conexão real com o WhatsApp via Baileys (WhatsApp Web multi-device, login por QR code).
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';

const AUTH_DIR = process.env.AUTH_DIR || './auth';
const logger = pino({ level: 'silent' });

// state exposto para o servidor/dashboard
export const wa = {
  connected: false,
  qr: null, // string do QR enquanto aguarda pareamento
  sock: null,
};

function textFromMessage(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    null
  );
}

export async function startWhatsApp({ onMessage }) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
  });
  wa.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      wa.qr = qr;
      wa.connected = false;
      console.log('[whatsapp] QR gerado — abra o painel (/) e escaneie.');
    }
    if (connection === 'open') {
      wa.connected = true;
      wa.qr = null;
      console.log('[whatsapp] conectado ✓');
    }
    if (connection === 'close') {
      wa.connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log('[whatsapp] conexão fechada. reconectar:', shouldReconnect);
      if (shouldReconnect) startWhatsApp({ onMessage });
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue; // ignora grupos/status
      const text = textFromMessage(msg);
      if (!text) continue;
      try {
        await onMessage(jid, text.trim(), (to, body) => sendText(to, body));
      } catch (err) {
        console.error('[whatsapp] erro ao processar mensagem:', err?.message || err);
      }
    }
  });

  return sock;
}

export async function sendText(jid, text) {
  if (!wa.sock) throw new Error('WhatsApp não conectado');
  const to = jid.includes('@') ? jid : `${jid.replace(/\D/g, '')}@s.whatsapp.net`;
  await wa.sock.sendMessage(to, { text });
}
