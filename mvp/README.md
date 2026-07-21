# Fradema — MVP de Captação de Leads

Demo funcional para apresentar ao cliente. Dois modos de rodar:

- **Só o app (um contêiner)** — WhatsApp + IA + CRM. Use o `Dockerfile` direto (seção "Como rodar").
- **App + n8n (docker-compose)** — acrescenta a orquestração de nutrição/follow-up (seção "Com n8n").

O app em si concentra:

- **WhatsApp real** via [Baileys](https://github.com/WhiskeySockets/Baileys) (login por QR code, sem aprovação da Meta).
- **Qualificação com IA** ao vivo pela **API do Claude**.
- **Mini-CRM** web (funil de leads) + **disparo outbound** — servidos pelo mesmo app.
- **Armazenamento em arquivo** (JSON + sessão do WhatsApp) — sem banco separado.

> ⚠️ **Escopo de demonstração.** Baileys usa o protocolo não-oficial do WhatsApp Web — use um **número de teste**. O envio ativo em massa pode levar a bloqueio (ver a spec de produção). O **agendamento** aqui apenas registra o horário combinado e mostra no CRM; a integração real com o Google Calendar é um passo seguinte.

## Como rodar (Docker)

Pré-requisito: Docker instalado e uma **API key do Claude**.

```bash
# 1. Construir a imagem
docker build -t fradema-mvp .

# 2. Rodar (persistindo sessão do WhatsApp e leads em ./data e ./auth)
docker run -d --name fradema-mvp \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY="sua-chave-aqui" \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/auth:/app/auth" \
  fradema-mvp

# 3. Ver logs (opcional)
docker logs -f fradema-mvp
```

No Windows (PowerShell), troque `$(pwd)` por `${PWD}`.

## Como usar

1. Abra **http://localhost:3000**.
2. No cartão **Conexão WhatsApp**, escaneie o **QR code** com o celular
   (WhatsApp → *Aparelhos conectados* → *Conectar aparelho*).
3. Quando ficar **conectado ✓**:
   - **Inbound:** mande uma mensagem para esse número de qualquer outro WhatsApp — a IA atende, qualifica e o lead aparece no funil.
   - **Outbound:** use o cartão **Prospecção** para disparar a 1ª abordagem para um número (com DDI+DDD, ex.: `5521999998888`).
4. Acompanhe os leads no **funil** (Novo → Qualificando → Quente/Morno/Frio), com dados coletados, pontuação e horário agendado.

## Com n8n (orquestração: nutrição / follow-up)

O n8n entra ao lado do app (via `docker-compose`) para o que ele faz de melhor: **cadências de follow-up e disparos em lote**. O bot/qualificação continua no código; o n8n só chama os endpoints do app.

```bash
# sobe app + n8n juntos
ANTHROPIC_API_KEY="sua-chave" docker compose up -d --build
```

- App (painel): **http://localhost:3000**
- n8n (editor): **http://localhost:5678**

Na rede do compose, o n8n fala com o app em **`http://app:3000`**.

### Importar o workflow de nutrição

1. Abra o n8n (`http://localhost:5678`) e crie a conta local.
2. **Workflows → Import from File →** selecione `n8n/workflow-nutricao.json`.
3. Abra o workflow e clique em **Execute Workflow**. Ele:
   - busca os leads `morno`/`frio` em `GET http://app:3000/api/leads?stage=morno,frio`;
   - monta uma mensagem de follow-up;
   - envia por `POST http://app:3000/api/send`.
4. Para automatizar, troque o nó **Disparar** (manual) por um **Schedule Trigger** (ex.: a cada 1 dia).

> Se a importação falhar por versão do n8n, monte os 4 nós manualmente na mesma ordem (Manual/Schedule → HTTP GET leads → Code → HTTP POST send) usando as URLs acima.

### Evento "lead quente" → n8n (opcional)

Defina `N8N_WEBHOOK_URL` apontando para um **Webhook** do n8n. Quando um lead vira `quente`, o app faz `POST` com `{ evento, numero, data, meeting }` — útil para notificar o consultor, criar tarefa, etc.

## Endpoints da API (usados pelo n8n)

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/status` | Conexão WhatsApp (QR) + estatísticas |
| GET | `/api/leads?stage=morno,frio` | Lista leads (filtro opcional por estágio) |
| POST | `/api/send` | `{ numero, mensagem }` — envia WhatsApp (nutrição/lote) |
| POST | `/api/outbound` | `{ numero, nome, empresa }` — 1ª abordagem gerada pela IA |

## Rodar sem Docker (dev local)

```bash
npm install
ANTHROPIC_API_KEY="sua-chave" npm start
# abra http://localhost:3000
```

## Estrutura

```
src/
  index.js       # entrypoint (sobe web + WhatsApp)
  server.js      # rotas: /api/status, /api/leads, /api/outbound + estáticos
  whatsapp.js    # conexão Baileys (QR, enviar/receber)
  claude.js      # qualificação e abordagem via API do Claude
  bot.js         # orquestra a conversa e atualiza a ficha do lead
  store.js       # persistência em JSON
  public/index.html  # painel do mini-CRM
Dockerfile            # imagem do app (modo 1 contêiner)
docker-compose.yml    # app + n8n (modo com orquestração)
n8n/
  workflow-nutricao.json  # workflow de follow-up pronto para importar
```

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | sim | — | Chave da API do Claude |
| `CLAUDE_MODEL` | não | `claude-sonnet-5` | Modelo usado na qualificação |
| `PORT` | não | `3000` | Porta do painel |
