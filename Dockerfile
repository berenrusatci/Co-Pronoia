FROM node:22-alpine AS build
WORKDIR /app

# `prisma generate` prisma.config.ts üzerinden DATABASE_URL'i derleme anında çözmek ister
# (env('DATABASE_URL') eager'dır) — client üretimi için değere bakılmaz, bu yüzden yer
# tutucu veriyoruz. Çalışma zamanı URL'i compose'dan gelir ve bu katmana sızmaz.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY web/package.json web/package.json
# server'ın `prepare` script'i npm ci sırasında `prisma generate` çalıştırır — şema ve
# prisma.config.ts bu yüzden bağımlılıklardan ÖNCE kopyalanmalı.
COPY server/prisma server/prisma
COPY server/prisma.config.ts server/prisma.config.ts
RUN npm ci

COPY . .
RUN npm run build -w web
RUN npm exec -w server -- prisma generate

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
# İmaj yerel dağıtım içindir: kayıt/giriş/admin uçları hiç oluşmaz, kimlik bir kerelik
# bulut aktivasyonuyla gelir. Barındırılan kurulumlar (Render) APP_MODE=cloud verir.
ENV APP_MODE=local

COPY --from=build --chown=node:node /app /app

USER node

EXPOSE 3001
# Compose `depends_on: service_healthy` ve yeniden başlatma politikası bunu kullanır.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
