// Servidor web: mini-CRM (dashboard) + status do WhatsApp (QR) + disparo outbound.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { allLeads, stats } from './store.js';
import { wa, sendText } from './whatsapp.js';
import { opener } from './claude.js';
import { startOutbound } from './bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // Auth opcional para endpoints de escrita: se API_TOKEN estiver definido,
  // exige Authorization: Bearer <token> (o n8n envia o mesmo token).
  const API_TOKEN = process.env.API_TOKEN || '';
  function requireToken(req, res, next) {
    if (!API_TOKEN) return next();
    if ((req.headers.authorization || '') === `Bearer ${API_TOKEN}`) return next();
    return res.status(401).json({ error: 'não autorizado' });
  }

  app.get('/api/status', async (req, res) => {
    let qrDataUrl = null;
    if (wa.qr) {
      try {
        qrDataUrl = await QRCode.toDataURL(wa.qr, { margin: 1, width: 260 });
      } catch {
        qrDataUrl = null;
      }
    }
    res.json({
      connected: wa.connected,
      qr: qrDataUrl,
      stats: stats(),
    });
  });

  app.get('/api/leads', (req, res) => {
    // devolve versão enxuta (sem histórico gigante) + últimas mensagens
    const stageFilter = req.query.stage ? String(req.query.stage).split(',') : null;
    const source = stageFilter ? allLeads().filter((l) => stageFilter.includes(l.stage)) : allLeads();
    const leads = source.map((l) => ({
      numero: l.numero,
      origem: l.origem,
      stage: l.stage,
      score: l.score,
      meeting: l.meeting,
      data: l.data,
      lastMessages: (l.history || []).slice(-4),
      updatedAt: l.updatedAt,
    }));
    res.json(leads);
  });

  // Envio direto de mensagem — usado pelo n8n (nutrição/follow-up, disparos em lote).
  app.post('/api/send', requireToken, async (req, res) => {
    try {
      if (!wa.connected) return res.status(400).json({ error: 'WhatsApp não conectado.' });
      const numero = String(req.body?.numero || '').replace(/\D/g, '');
      const mensagem = String(req.body?.mensagem || '').trim();
      if (numero.length < 10 || !mensagem) return res.status(400).json({ error: 'Informe numero (DDI+DDD) e mensagem.' });
      await sendText(`${numero}@s.whatsapp.net`, mensagem);
      res.json({ ok: true, numero });
    } catch (err) {
      res.status(500).json({ error: err?.message || 'Falha no envio' });
    }
  });

  app.post('/api/outbound', requireToken, async (req, res) => {
    try {
      if (!wa.connected) return res.status(400).json({ error: 'WhatsApp não conectado. Escaneie o QR primeiro.' });
      const numero = String(req.body?.numero || '').replace(/\D/g, '');
      if (numero.length < 10) return res.status(400).json({ error: 'Informe um número válido com DDD (ex.: 5521999998888).' });
      const jid = `${numero}@s.whatsapp.net`;
      const text = await opener({ nome: req.body?.nome, empresa: req.body?.empresa });
      await startOutbound(jid, text, sendText);
      res.json({ ok: true, numero, mensagem: text });
    } catch (err) {
      res.status(500).json({ error: err?.message || 'Falha no disparo' });
    }
  });

  return app;
}
