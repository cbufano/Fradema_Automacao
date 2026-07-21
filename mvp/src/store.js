// Armazenamento simples em arquivo JSON — sem banco separado (MVP).
import fs from 'node:fs';
import path from 'node:path';

const FILE = process.env.DATA_FILE || './data/leads.json';

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {
    return {};
  }
}

let db = load();

function persist() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

export function getLead(jid) {
  return db[jid];
}

export function upsertLead(jid, lead) {
  db[jid] = lead;
  persist();
}

export function allLeads() {
  return Object.values(db).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function stats() {
  const leads = allLeads();
  const by = (s) => leads.filter((l) => l.stage === s).length;
  return {
    total: leads.length,
    novo: by('novo'),
    qualificando: by('qualificando'),
    quente: by('quente'),
    morno: by('morno'),
    frio: by('frio'),
    agendados: leads.filter((l) => l.meeting).length,
  };
}
