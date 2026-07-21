# Spec — Plataforma de Captação de Leads (Fradema)

- **Data:** 2026-07-20
- **Cliente:** Fradema Consultores Tributários (ver `docs/contexto-fradema.md`)
- **Executor:** Agência (MKT Digital)
- **Status:** Aprovação pendente do desenho

## 1. Objetivo

Entregar à Fradema uma **plataforma própria e auto-hospedada de captação de leads**, com a marca da agência, composta por dois subsistemas que compartilham o mesmo CRM e o mesmo bot de qualificação:

- **Inbound** — recebe leads que chegam no WhatsApp, qualifica com IA, agenda reunião e nutre quem ainda não está pronto.
- **Outbound (prospecção ativa)** — encontra empresas-alvo na web, chega ao contato do proprietário/decisor e dispara ofertas por WhatsApp e e-mail; quem responde entra no mesmo funil de qualificação.

**Eixos de valor da oferta (o que a IA propõe ao lead):** os dois carros-chefe da Fradema —
1. **Recuperação de créditos tributários** (PIS, COFINS, ICMS, IPI pagos a mais);
2. **Regularização / negociação de dívidas fiscais** (parcelamentos, execuções, débitos em aberto — renegociar com melhores condições).

A qualificação e as abordagens devem cobrir os dois eixos, pois muitos leads têm interesse em um, no outro, ou em ambos.

## 2. Escopo

**Dentro do escopo:**
- Canal central: **WhatsApp** (mais e-mail no outbound).
- Bot com **IA (Claude)** que conversa em linguagem natural e qualifica o lead.
- **Agendamento** de reunião consultando o **Google Calendar** do consultor.
- **CRM de leads** (Chatwoot): ficha do contato, histórico, funil por etiquetas.
- **Handoff** do lead quente para o consultor no próprio WhatsApp.
- **Nutrição / follow-up** automático de leads mornos/frios (cadências temporizadas, reengajamento).
- **Prospecção ativa (outbound):** descoberta de empresas na web → enriquecimento do contato do dono → disparo multicanal (WhatsApp + e-mail) → resposta cai no funil de qualificação.

**Fora do escopo (fases futuras):**
- Integração com anúncios pagos (Meta/Google Ads) e landing pages.
- Tratamento de áudio/imagem recebidos (transcrição).
- Funil de vendas avançado / CRM de pipeline dedicado (evolução para híbrido com Twenty).

## 3. Arquitetura geral

Abordagem: **Chatwoot no centro** (open-source, auto-hospedado). Código sob medida no **Serviço-Bot** e no **Motor de Prospecção**.

```
  ┌──────────────── OUTBOUND (prospecção ativa) ─────────────────┐
  │  Motor de Prospecção                                         │
  │   ├─ Descoberta de empresas (web research, multi-fonte)      │
  │   ├─ Enriquecimento (contato do proprietário/decisor)        │
  │   └─ Disparo multicanal ──► WhatsApp + E-mail                │
  └───────────────────────────────┬──────────────────────────────┘
                                   │ (resposta do prospect)
                                   ▼
  ┌──────────────── INBOUND ───────────────────────────────────┐
  │ Lead ► WhatsApp ► [Adaptador WhatsApp] ► CHATWOOT ◄─ consultor│
  │                                            │  ▲              │
  │                                   webhook  │  │ API          │
  │                                            ▼  │              │
  │                                     SERVIÇO-BOT (Node/TS)    │
  │                                      ├─ Claude → qualifica   │
  │                                      ├─ Google Calendar      │
  │                                      └─ Nutrição/cadências   │
  └─────────────────────────────────────────────────────────────┘
        Tudo em Docker Compose, num VPS próprio da agência
```

### Camada de WhatsApp (adaptador)
O bot não fala direto com uma via específica de WhatsApp. Um **adaptador** isola o provedor:
- **Evolution API** (não-oficial) — desenvolvimento/testes de baixo custo.
- **WhatsApp Cloud API oficial (Meta)** — produção (estável e dentro das regras).

O Serviço-Bot permanece agnóstico (fala com o Chatwoot, não com o WhatsApp).

## 4. Componentes

| Componente | Papel | Tecnologia |
|---|---|---|
| **Chatwoot** | Inbox WhatsApp, CRM de contatos/leads, funil por etiquetas, handoff | Open-source, Docker |
| **Serviço-Bot** | Orquestra conversa, estado por lead, qualifica/agenda/transfere/nutre | Node.js + TypeScript |
| **Motor de Prospecção** | Descobre empresas, enriquece contato do dono, dispara outbound | Node.js + TypeScript (workers) |
| **Claude API** | Conversa natural, extrai dados, pontua lead, personaliza abordagem | `claude-opus-4-8` / `claude-sonnet-5` |
| **Google Calendar API** | Disponibilidade do consultor + criação do evento | OAuth 2.0 Google |
| **Provedor de e-mail (ESP)** | Envio de e-mail outbound com boa entregabilidade | SMTP/ESP (SPF/DKIM/DMARC) |
| **PostgreSQL** | Estado das conversas, fila de prospecção, dedupe | Instância do Chatwoot |
| **Fila/agendador** | Cadências de nutrição e jobs de prospecção | Redis + worker |

## 5. Subsistema INBOUND

### 5.1 Fluxo do lead
1. Lead envia mensagem no WhatsApp → Chatwoot → webhook aciona o Serviço-Bot.
2. Bot (Claude) se apresenta, entende a necessidade e qualifica: **segmento, faturamento aprox., regime tributário, impostos pagos, principal dor** (ex.: recuperação de créditos PIS/COFINS/ICMS).
3. Bot **pontua** o lead e grava os dados na ficha + aplica etiqueta (`novo`, `qualificando`, `quente`, `morno`, `frio`).
4. **Quente** → consulta o Google Calendar, oferece horários e **agenda** (evento + confirmação no WhatsApp).
5. Bot **desliga** no contato, **atribui** ao consultor e o **notifica** — consultor assume no mesmo WhatsApp.
6. **Morno/frio** → entra em **nutrição**.

### 5.2 Nutrição / follow-up
- Cadências temporizadas (ex.: lead pediu "me chame em 30 dias" → disparo automático no dia).
- Reengajamento de quem sumiu no meio da conversa.
- Sequência de conteúdo de valor (casos de recuperação de créditos, mudanças na legislação, prazos fiscais).
- Envio ativo fora da janela de 24h do WhatsApp usa **templates aprovados** pela Meta.

## 6. Subsistema OUTBOUND (prospecção ativa)

### 6.1 Pipeline
1. **Descoberta de empresas (web research):** coleta **multi-fonte** e **multi-segmento/multi-escopo** de empresas-alvo. A plataforma deve permitir rodar **vários escopos em paralelo** (segmentos, portes e regiões diferentes) e combinar várias fontes. Filtro por **segmento, porte, região e sinais de dívida**.
2. **Enriquecimento — contato do proprietário/decisor:** resolver sócio/dono e seus contatos (telefone/WhatsApp, e-mail) a partir de site da empresa, quadro societário público (QSA), Google e provedores de enriquecimento.
3. **Fila de prospecção:** cada empresa+contato vira um lead outbound no Chatwoot com status próprio e dedupe.
4. **Disparo multicanal:** mensagem **personalizada pela IA** por WhatsApp (template aprovado) e e-mail, oferecendo os carros-chefe da Fradema — **recuperação de créditos tributários** e **regularização de dívidas fiscais** — com o gancho mais provável para o perfil da empresa.
5. **Resposta → funil inbound:** quem responde entra no **mesmo bot de qualificação** (Claude) e segue o fluxo inbound (qualifica → agenda → consultor).

### 6.2 Personalização
O Claude gera a abordagem por empresa (segmento, porte, gancho tributário provável) para elevar a taxa de resposta e evitar mensagens genéricas.

### 6.3 Alvo prioritário: empresas endividadas
O sinal de **dívida** é o melhor gatilho para o eixo de **regularização de dívidas fiscais**. A descoberta deve priorizar empresas com débitos identificáveis (dívida ativa, execuções, protestos) e cruzar com os filtros de segmento/porte/região.

### 6.4 Fontes de dados — gratuito vs pago (há custo recorrente)
A arquitetura de fontes deve ser **modular** (adaptadores plugáveis), pois as fontes têm qualidade e custo diferentes:

**Âncoras gratuitas / públicas**
- **Dívida Ativa da União — lista de devedores da PGFN** (pública, gratuita): mapa nacional de empresas com débito federal. Principal âncora para o eixo de dívidas.
- **Dados públicos de CNPJ / QSA** (Receita Federal): identificação da empresa e do quadro societário (sócios).
- Alguns estados/municípios publicam sua própria dívida ativa.

**Camadas pagas (é aqui que está o custo)**
- **Enriquecimento de contato do decisor** (WhatsApp/telefone/e-mail): majoritariamente pago (ex.: BigDataCorp, Cortex, Speedio, Econodata).
- **Débitos estaduais/municipais consolidados, protestos, score/negativação:** bureaus (Serasa, Boa Vista) e provedores B2B — pagos.
- APIs de busca/mapas em escala também podem ter custo.

> **Premissa aceita pelo cliente:** a maioria das fontes de qualidade (sobretudo enriquecimento e cruzamento de dívidas) é **paga** → haverá **custo de dados recorrente** (por consulta/lote/assinatura) a ser orçado e repassado. A âncora gratuita da PGFN reduz, mas não elimina, esse custo. Recomenda-se **teto de gasto por escopo** e priorização das fontes por custo-benefício.

## 7. Dados de qualificação (ficha do lead)
- Nome / empresa / segmento / CNPJ
- Faturamento aproximado
- Regime tributário (Simples, Presumido, Real)
- Impostos de interesse (PIS, COFINS, ICMS, IPI, ISS…)
- **Situação de dívidas fiscais** (tem débito em aberto? parcelamento? execução fiscal?)
- Eixo de interesse: recuperação de créditos, regularização de dívidas, ou ambos
- Principal dor / serviço de interesse
- Pontuação (quente/morno/frio) + justificativa
- Origem (inbound / outbound + fonte)
- Contato do decisor (telefone/WhatsApp, e-mail)

## 8. Riscos e conformidade (crítico)
- **Banimento de WhatsApp no envio ativo:** disparo para quem não iniciou contato é a maior causa de bloqueio de número, mesmo na API oficial. **Mitigações:** templates aprovados, aquecimento gradual do número, volumes diários baixos e crescentes, número(s) dedicado(s), segmentação de qualidade, monitorar o *quality rating* da Meta.
- **Entregabilidade de e-mail:** cold email exige **domínio/subdomínio dedicado**, aquecimento, **SPF/DKIM/DMARC**, link de descadastro e listas limpas para não cair em spam/blacklist.
- **LGPD:** uso de dados de contato de terceiros para oferta comercial B2B apoia-se em **legítimo interesse**, mas exige finalidade clara, **opt-out** simples e registro. Dados de sócios via Receita/QSA são públicos, porém o uso para marketing tem limites.
- **Termos das fontes / scraping:** respeitar robots.txt e ToS de cada fonte; algumas proíbem coleta automatizada (ex.: LinkedIn). Preferir APIs oficiais e fontes públicas.
- **Rate limiting e opt-out** aplicados em todo o outbound (WhatsApp e e-mail).

## 9. Segurança e dados
- Segredos (Claude, Google, WhatsApp, ESP) em variáveis de ambiente / cofre, nunca no código.
- Retenção mínima de dados pessoais e rotina de exclusão (LGPD).
- Painel Chatwoot com autenticação e papéis.

## 10. Infraestrutura
- **VPS próprio da agência** (Hetzner/DigitalOcean/Contabo).
- **Docker Compose:** Chatwoot (app + Postgres + Redis), Serviço-Bot, Motor de Prospecção (workers), e (em dev) Evolution API.
- Backups do Postgres, HTTPS via reverse proxy.

## 11. Faseamento (entrega incremental)

Ordem definida pelo cliente: **outbound primeiro** (é o que gera volume de leads).

1. **Fase 1 — Prospecção outbound:** descoberta de empresas → enriquecimento do contato do decisor → disparo multicanal (WhatsApp + e-mail) → resposta cai no funil. **Requer, já no início, a base de CRM (Chatwoot), o bot de qualificação (Claude) e a camada de compliance/entregabilidade** (templates aprovados, aquecimento, SPF/DKIM/DMARC, opt-out) — ver seção 8.
2. **Fase 2 — Núcleo inbound completo:** atendimento a leads que chegam espontaneamente no WhatsApp + agendamento no Google Calendar.
3. **Fase 3 — Nutrição:** cadências e reengajamento automáticos.

> ⚠️ **Nota:** começar pelo outbound antecipa o maior risco do projeto (banimento de WhatsApp e entregabilidade de e-mail). A Fase 1 deve incluir aquecimento gradual e volumes baixos antes de escalar.

Cada fase é entregável e validável de forma independente.

## 12. Decisões em aberto (resolver na implementação)
- Modelo Claude definitivo (Opus 4.8 vs Sonnet 5) por custo/qualidade.
- Provedor de VPS, domínio/subdomínio (inbound e de e-mail).
- OAuth Google: conta de serviço vs OAuth por consultor; quantos calendários.
- ESP de e-mail (ex.: Amazon SES, Postmark, Resend) e número(s) dedicado(s) de WhatsApp para outbound.
- Fontes de descoberta priorizadas e critérios de segmento/porte/região dos alvos.
- **Provedores pagos de dados a contratar** (enriquecimento de contato + débitos/protestos) e **teto de gasto de dados por escopo/mês**.
- Escopos iniciais a rodar em paralelo (quais segmentos/regiões atacar primeiro).
- Roteiro fino das perguntas de qualificação e dos templates de disparo (validar com o comercial da Fradema).

## 13. Critérios de sucesso
- **Inbound:** um lead consegue, ponta a ponta pelo WhatsApp, ser atendido pela IA, qualificado, ter ficha no CRM e — se quente — sair com reunião agendada; consultor recebe o lead atribuído.
- **Nutrição:** leads mornos/frios recebem follow-up automático no tempo certo.
- **Outbound:** o motor descobre empresas de um segmento-alvo, encontra o contato do decisor, dispara oferta por WhatsApp/e-mail respeitando limites, e as respostas entram no funil de qualificação.

## 14. Observações
- Repositório ainda **não é um projeto Git**. Recomenda-se `git init` antes da implementação.
