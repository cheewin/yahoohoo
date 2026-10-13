# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

RUN --mount=type=secret,id=build_ca,mode=0444 \
  sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
  && if [ -f /run/secrets/build_ca ]; then export SSL_CERT_FILE=/run/secrets/build_ca; fi \
  && apt-get -o APT::Update::Error-Mode=any -o Acquire::https::CaInfo="${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}" update \
  && apt-get -o Acquire::https::CaInfo="${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}" install -y --no-install-recommends python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca,mode=0444 \
  if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi \
  && npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node README.md LICENSE ./

ENV NODE_ENV=production
ENV YAHOOHOO_TRANSPORT=http
ENV YAHOOHOO_HOST=0.0.0.0
ENV YAHOOHOO_PORT=3434
ENV YAHOOHOO_ENABLE_SAMPLING=false
ENV YAHOOHOO_LLM_QUERY=false
ENV YAHOOHOO_MAX_DEPTH=1

EXPOSE 3434

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3434/health').then((res)=>process.exit(res.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "src/index.js", "--transport", "http"]
