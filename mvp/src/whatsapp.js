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

// Desembrulha mensagens efêmeras/viewOnce que encapsulam o conteúdo real.
function unwrap(m) {
  if (!m) return null;
  if (m.ephemeralMessage) return unwrap(m.ephemeralMessage.message);
  if (m.viewOnceMessage) return unwrap(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2) return unwrap(m.viewOnceMessageV2.message);
  if (m.viewOnceMessageV2Extension) return unwrap(m.viewOnceMessageV2Extension.message);
  if (m.documentWithCaptionMessage) return unwrap(m.documentWithCaptionMessage.message);
  return m;
}

function textFromMessage(msg) {
  const m = unwrap(msg.message);
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.title ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    null
  );
}

let reconnecting = false;
let attempts = 0;

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
      attempts = 0;
      console.log('[whatsapp] conectado ✓');
    }
    if (connection === 'close') {
      wa.connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      try { sock.ev.removeAllListeners('connection.update'); } catch { /* noop */ }
      try { sock.end?.(); } catch { /* noop */ }

      if (loggedOut) {
        wa.qr = null;
        console.log('[whatsapp] deslogado — apague a pasta AUTH_DIR e reescaneie o QR.');
        return;
      }
      if (reconnecting) return;
      reconnecting = true;
      attempts = Math.min(attempts + 1, 6);
      const delay = Math.min(30000, 1000 * 2 ** attempts); // backoff exponencial (máx 30s)
      console.log(`[whatsapp] conexão fechada. reconectando em ${Math.round(delay / 1000)}s`);
      setTimeout(() => {
        reconnecting = false;
        startWhatsApp({ onMessage }).catch((e) => console.error('[whatsapp] reconexão falhou:', e?.message || e));
      }, delay);
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
