# MVP em um único contêiner: WhatsApp (Baileys) + Claude + mini-CRM.
FROM node:22-bookworm-slim

WORKDIR /app

# Dependências primeiro (cache de build)
COPY package.json ./
RUN npm install --omit=dev

# Código
COPY src ./src

ENV PORT=3000
ENV DATA_FILE=/app/data/leads.json
ENV AUTH_DIR=/app/auth

# Persistência da sessão do WhatsApp e dos leads
VOLUME ["/app/data", "/app/auth"]

EXPOSE 3000
CMD ["node", "src/index.js"]
