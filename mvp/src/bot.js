// Orquestração da conversa: junta histórico, chama o Claude e atualiza a ficha do lead.
import { qualify } from './claude.js';
import { getLead, upsertLead } from './store.js';

function numberFromJid(jid) {
  return (jid || '').split('@')[0];
}

export async function handleIncoming(jid, text, sendText) {
  const now = Date.now();
  const lead = getLead(jid) || {
    jid,
    numero: numberFromJid(jid),
    history: [],
    data: {},
    stage: 'novo',
    score: null,
    meeting: null,
    origem: 'inbound',
    createdAt: now,
  };

  const wasHot = lead.stage === 'quente';
  lead.history.push({ role: 'user', text });

  const res = await qualify(lead.history);

  lead.data = { ...lead.data, ...cleanObj(res.lead) };
  if (res.stage) lead.stage = res.stage;
  if (res.score) lead.score = res.score;
  if (res.meeting) lead.meeting = res.meeting;

  // Evento para o n8n: lead acabou de virar "quente" (orquestração/notificação).
  if (!wasHot && lead.stage === 'quente') notifyN8n(lead);

  const reply = res.reply || 'Certo!';
  lead.history.push({ role: 'assistant', text: reply });
  lead.updatedAt = now;

  upsertLead(jid, lead);
  await sendText(jid, reply);
  return lead;
}

// Dispara a abordagem inicial (outbound) e registra o lead.
export async function startOutbound(jid, openerText, sendText) {
  const now = Date.now();
  const lead = getLead(jid) || {
    jid,
    numero: numberFromJid(jid),
    history: [],
    data: {},
    stage: 'novo',
    score: null,
    meeting: null,
    origem: 'outbound',
    createdAt: now,
  };
  lead.history.push({ role: 'assistant', text: openerText });
  lead.updatedAt = now;
  upsertLead(jid, lead);
  await sendText(jid, openerText);
  return lead;
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
