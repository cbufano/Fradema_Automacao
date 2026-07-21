# MVP em um único contêiner: WhatsApp (Baileys) + Claude + mini-CRM.
FROM node:22-bookworm-slim

WORKDIR /app
ENV TZ=America/Sao_Paulo

# git é necessário em build: uma dependência do Baileys (libsignal) vem do GitHub.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Dependências primeiro (cache de build). npm ci = build reprodutível (usa o lockfile).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Código
COPY src ./src

ENV PORT=5100
ENV DATA_FILE=/app/data/leads.json
ENV AUTH_DIR=/app/auth

# Diretórios de dados/sessão com dono não-root
RUN mkdir -p /app/data /app/auth && chown -R node:node /app

# Persistência da sessão do WhatsApp e dos leads
VOLUME ["/app/data", "/app/auth"]

# Roda como usuário não-privilegiado
USER node

EXPOSE 5100

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5100)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
