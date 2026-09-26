# Gateway WhatsApp (whatsapp-web.js) — butuh Chromium untuk Puppeteer
FROM node:20-slim

# Chromium + pustaka yang dibutuhkan headless browser
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation ca-certificates \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libasound2 \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    WA_PORT=3011 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .

# Sesi login WhatsApp (LocalAuth) — jadikan volume persisten agar tak scan QR ulang
RUN mkdir -p /app/.wwebjs_auth
EXPOSE 3011

CMD ["node", "server.js"]
