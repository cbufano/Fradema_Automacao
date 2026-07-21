// Qualificação do lead com a IA do Claude.
// Recebe o histórico da conversa e devolve: resposta ao lead + dados estruturados + estágio/score.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `Você é o assistente virtual da Fradema Consultores Tributários, uma consultoria tributária tradicional (desde 1988).
Seu trabalho é atender empresas pelo WhatsApp, de forma cordial, objetiva e humana (mensagens curtas, como se fosse um consultor de verdade).

Os dois carros-chefe da Fradema são:
1. Recuperação de créditos tributários (PIS, COFINS, ICMS, IPI pagos a mais);
2. Regularização / renegociação de dívidas fiscais (parcelamentos, execuções, débitos em aberto).

Objetivo da conversa: QUALIFICAR o lead coletando, ao longo do papo (uma pergunta de cada vez):
- nome do contato e nome da empresa;
- segmento/atividade;
- regime tributário (Simples, Presumido ou Real);
- faturamento anual aproximado;
- situação de dívidas fiscais (tem débito em aberto? parcelamento? execução?);
- qual eixo interessa: recuperação de créditos, regularização de dívidas, ou ambos.

Regras:
- Faça UMA pergunta por mensagem. Seja breve e natural. Use no máximo 1 emoji ocasional.
- Classifique o lead: "quente" (Lucro Real e/ou dívida relevante e/ou faturamento alto — bom potencial), "morno" (interesse mas sem urgência), "frio" (fora do perfil).
- Quando o lead estiver QUENTE e você já tiver os dados principais, ofereça 2 opções de horário de reunião (ex.: "quinta às 14h ou sexta às 10h"). Quando o lead escolher, confirme e preencha o campo meeting.

FORMATO DE SAÍDA — responda SEMPRE e SOMENTE com um JSON válido, sem nenhum texto fora do JSON, exatamente assim:
{
  "reply": "sua mensagem curta para enviar ao lead",
  "lead": { "nome": "", "empresa": "", "segmento": "", "regime": "", "faturamento": "", "dividas": "", "eixo": "" },
  "stage": "novo|qualificando|quente|morno|frio",
  "score": "quente|morno|frio",
  "meeting": ""
}
Em "lead", preencha apenas os campos que você já descobriu (deixe "" nos desconhecidos). Em "meeting", coloque o horário combinado só quando houver agendamento, senão "".`;

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const MAX_TURNS = 24;

// A API exige que a 1ª mensagem seja 'user'. O opener outbound é 'assistant',
// então normalizamos (descartamos turnos 'assistant' iniciais) e limitamos o tamanho.
function normalizeHistory(history) {
  let msgs = history.map((h) => ({ role: h.role, content: h.text }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (msgs.length > MAX_TURNS) msgs = msgs.slice(-MAX_TURNS);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

export async function qualify(history) {
  try {
    const messages = normalizeHistory(history);
    if (!messages.length) {
      return { reply: 'Olá! Como posso ajudar a sua empresa hoje?', lead: {}, stage: 'novo', score: null, meeting: '' };
    }
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: SYSTEM,
      messages,
    });
    const raw = msg.content?.[0]?.text || '';
    const parsed = extractJson(raw);
    if (!parsed || !parsed.reply) {
      // Nunca enviar o texto/JSON cru ao lead — mensagem genérica segura.
      return { reply: 'Certo! Pode me contar um pouco mais sobre a sua empresa e o que você procura?', lead: {}, stage: 'qualificando', score: null, meeting: '' };
    }
    return parsed;
  } catch (err) {
    console.error('[claude] erro:', err?.message || err);
    return {
      reply: 'Tivemos uma instabilidade rápida aqui. Um consultor da Fradema já vai te responder. 🙏',
      lead: {},
      stage: 'qualificando',
      score: null,
      meeting: '',
      _error: true,
    };
  }
}

// Gera uma abordagem inicial (outbound) personalizada para um nome/empresa.
export async function opener({ nome, empresa }) {
  const alvo = [nome, empresa].filter(Boolean).join(' / ') || 'a empresa';
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Gere APENAS o campo "reply" (dentro do JSON no formato pedido) com uma primeira mensagem de abordagem para ${alvo}, apresentando a Fradema e despertando interesse em recuperação de créditos e regularização de dívidas fiscais. Curta e cordial.`,
        },
      ],
    });
    const raw = msg.content?.[0]?.text || '';
    const parsed = extractJson(raw);
    return parsed?.reply || `Olá! Aqui é a Fradema Consultores Tributários. Ajudamos empresas a recuperar créditos e regularizar dívidas fiscais. Posso te fazer algumas perguntas rápidas? 👋`;
  } catch {
    return `Olá! Aqui é a Fradema Consultores Tributários. Ajudamos empresas a recuperar créditos e regularizar dívidas fiscais. Posso te fazer algumas perguntas rápidas? 👋`;
  }
}
