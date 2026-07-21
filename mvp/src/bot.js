// Orquestração da conversa: junta histórico, chama o Claude e atualiza a ficha do lead.
import { qualify } from './claude.js';
import { getLead, upsertLead } from './store.js';

const STAGES = ['novo', 'qualificando', 'quente', 'morno', 'frio'];
const SCORES = ['quente', 'morno', 'frio'];

function numberFromJid(jid) {
  return (jid || '').split('@')[0];
}

// ── Serialização por número: garante que só um processamento por jid rode por vez,
// evitando corrida (histórico malformado / lost update) com mensagens simultâneas.
const queues = new Map();
function enqueue(jid, task) {
  const prev = queues.get(jid) || Promise.resolve();
  const next = prev.then(task, task);
  queues.set(jid, next);
  next.finally(() => { if (queues.get(jid) === next) queues.delete(jid); });
  return next;
}

export function handleIncoming(jid, text, sendText) {
  return enqueue(jid, () => _handleIncoming(jid, text, sendText));
}

export function startOutbound(jid, openerText, sendText) {
  return enqueue(jid, () => _startOutbound(jid, openerText, sendText));
}

async function _handleIncoming(jid, text, sendText) {
  const now = Date.now();
  const lead = getLead(jid) || newLead(jid, 'inbound', now);

  const wasHot = lead.stage === 'quente';
  lead.history.push({ role: 'user', text });

  const res = await qualify(lead.history);

  lead.data = { ...lead.data, ...cleanObj(res.lead) };
  if (res.stage && STAGES.includes(res.stage)) lead.stage = res.stage;
  if (res.score && SCORES.includes(res.score)) lead.score = res.score;
  if (res.meeting) lead.meeting = res.meeting;

  if (!wasHot && lead.stage === 'quente') notifyN8n(lead);

  const reply = res.reply || 'Certo!';
  lead.history.push({ role: 'assistant', text: reply });
  lead.updatedAt = now;

  upsertLead(jid, lead);
  await sendText(jid, reply);
  return lead;
}

// Dispara a abordagem inicial (outbound) e registra o lead.
async function _startOutbound(jid, openerText, sendText) {
  const now = Date.now();
  const lead = getLead(jid) || newLead(jid, 'outbound', now);
  lead.history.push({ role: 'assistant', text: openerText });
  lead.updatedAt = now;
  upsertLead(jid, lead);
  await sendText(jid, openerText);
  return lead;
}

function newLead(jid, origem, now) {
  return {
    jid,
    numero: numberFromJid(jid),
    history: [],
    data: {},
    stage: 'novo',
    score: null,
    meeting: null,
    origem,
    createdAt: now,
  };
}

// Notifica um webhook do n8n (se configurado) quando um lead esquenta.
async function notifyN8n(lead) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        evento: 'lead_quente',
        numero: lead.numero,
        data: lead.data,
        meeting: lead.meeting,
      }),
    });
  } catch (err) {
    console.error('[n8n] falha ao notificar:', err?.message || err);
  }
}

function cleanObj(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = v;
  }
  return out;
}
