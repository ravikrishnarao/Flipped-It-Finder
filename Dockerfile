# Flipit Finder — Public Beta Production Container (Node.js 22)

# Stage 1: Build the React/Vite frontend bundle
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# Stage 2: Minimal production runtime image
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV NODE_OPTIONS=--max-old-space-size=768
ENV TRUST_PROXY=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Application server & solver modules
COPY server.ts ./
COPY src/solver ./src/solver

# Built frontend assets
COPY --from=builder /app/dist ./dist

# Required offline lexical datasets (WordNet 3.0, Moby Thesaurus/Compounds, Contextual Associations)
# Note: Google Books pilot corpus (data/v3/compiled/corpus_pilot/) and data/v3/raw/ are excluded.
COPY data/*.json ./data/
COPY data/v3/compiled/checksums.json ./data/v3/compiled/checksums.json
COPY data/v3/compiled/wordnet ./data/v3/compiled/wordnet
COPY data/v3/compiled/moby ./data/v3/compiled/moby

RUN chown -R node:node /app
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.ts"]
