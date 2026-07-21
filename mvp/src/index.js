// Ponto de entrada: sobe o servidor web e conecta o WhatsApp.
import { createServer } from './server.js';
import { startWhatsApp } from './whatsapp.js';
import { handleIncoming } from './bot.js';

const PORT = process.env.PORT || 3000;

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[aviso] ANTHROPIC_API_KEY não definida — a qualificação com IA não vai funcionar. Defina a variável de ambiente.');
}

const app = createServer();
app.listen(PORT, () => {
  console.log(`\n  Fradema MVP no ar → http://localhost:${PORT}\n  Abra o painel para escanear o QR e conectar o WhatsApp.\n`);
});

startWhatsApp({ onMessage: handleIncoming }).catch((err) => {
  console.error('[whatsapp] falha ao iniciar:', err?.message || err);
});
