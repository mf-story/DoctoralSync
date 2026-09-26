# DoctoralSync — hanya memakai modul bawaan Node.js (tanpa dependency npm)
FROM node:20-alpine

WORKDIR /app

# Salin sumber aplikasi. data/, uploads/, certs/ dikecualikan lewat .dockerignore
COPY . .

# Direktori data & unggahan — jadikan volume persisten di Coolify
# Berjalan sebagai root agar volume yang dimount (dimiliki root) tetap bisa ditulis
RUN mkdir -p /app/data /app/uploads

ENV NODE_ENV=production \
    PORT=5520 \
    HOST=0.0.0.0

EXPOSE 5520

# Healthcheck ke halaman utama
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5520)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
