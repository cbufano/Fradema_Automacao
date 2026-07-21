// Ponto de entrada: sobe o servidor web e conecta o WhatsApp.
import { createServer } from './server.js';
import { startWhatsApp, wa } from './whatsapp.js';
import { handleIncoming } from './bot.js';

const PORT = process.env.PORT || 5100;

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[aviso] ANTHROPIC_API_KEY não definida — a qualificação com IA não vai funcionar. Defina a variável de ambiente.');
}

const app = createServer();
const server = app.listen(PORT, () => {
  console.log(`\n  Fradema MVP no ar → http://localhost:${PORT}\n  Abra o painel para escanear o QR e conectar o WhatsApp.\n`);
});

startWhatsApp({ onMessage: handleIncoming }).catch((err) => {
  console.error('[whatsapp] falha ao iniciar:', err?.message || err);
});

// Desligamento gracioso: fecha o servidor e a conexão do WhatsApp em SIGTERM/SIGINT.
let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] ${sig} recebido — encerrando…`);
  server.close(() => console.log('[shutdown] servidor HTTP fechado'));
  try { wa.sock?.end?.(); } catch { /* noop */ }
  setTimeout(() => process.exit(0), 800);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
