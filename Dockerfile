FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node README.md LICENSE .env.example ./

ENV NODE_ENV=production
ENV YAHOOHOO_TRANSPORT=http
ENV YAHOOHOO_HOST=0.0.0.0
ENV YAHOOHOO_PORT=3434

EXPOSE 3434

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3434/health').then((res)=>process.exit(res.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "src/index.js", "--transport", "http"]
