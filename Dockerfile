# Yerel dağıtım imajı: tek kullanıcılık kurulum, giriş ekranı yok, kimlik bir kerelik
# bulut aktivasyonuyla gelir.
#
# İmaj bilinçli olarak "sade uygulama"dır: kayıt/giriş, Google OAuth, site yönetim paneli,
# davet/üyelik yönetimi ve Gemini ajanı yerelde hiç kullanılmadığı için çalışma anında
# kapatılmakla kalmaz — `server/build.mjs --local` bunları derleme anında eleyip bundle'a
# hiç almaz (bkz. `server/src/mode.ts`, ölçen test: `server/src/localBundle.test.ts`).
# Çalışma katmanında kaynak dosya, test ve geliştirme bağımlılığı da bulunmaz.
#
# Aynı Dockerfile bulut imajını da üretir. Hangi bundle'ın derleneceğini `APP_MODE` build
# argümanı seçer (öntanımlı `local`) — `cloud` verildiğinde eleme yapılmaz ve kimlik/yönetim
# kodu bundle'da kalır. Render bir Docker servisinin env değişkenlerini derleme anında build
# argümanı olarak da geçtiği için `render.yaml`'daki `APP_MODE=cloud` buraya kendiliğinden
# düşer. Bu kapı ŞART: `bundle:local` ile derlenmiş bir imajda `APP_MODE=cloud` vermek işe
# yaramaz — `isLocal()` (mode.ts) `LOCAL_BUILD || appMode()==='local'` olduğu için derleme
# anındaki eleme çalışma anındaki env'i daima yener, elenen kod da geri gelmez.
ARG APP_MODE=local

FROM node:22-alpine AS build
ARG APP_MODE
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
# Yerel bundle: mod kapıları derleme anında katlanır, elenen dallar bundle'a girmez.
# Bulut bundle'ında (`APP_MODE=cloud`) eleme yapılmaz, her şey içeride kalır.
RUN if [ "$APP_MODE" = "cloud" ]; then npm run bundle -w server; else npm run bundle:local -w server; fi

# Çalışma katmanının node_modules'ü: yalnız üretim bağımlılıkları. Ayrı bir dizinde
# kurulur ki derleme katmanındaki devDependency'ler (vite, vitest, esbuild, typescript)
# imaja sızmasın.
FROM node:22-alpine AS deps
WORKDIR /app
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY web/package.json web/package.json
COPY server/prisma server/prisma
COPY server/prisma.config.ts server/prisma.config.ts
RUN npm ci --omit=dev --workspace @co-pronoia/server --include-workspace-root

FROM node:22-alpine
ARG APP_MODE
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
# Öntanımlı imaj yerel dağıtım içindir: kayıt/giriş/admin/davet kodu bundle'da yoktur, kimlik
# bir kerelik bulut aktivasyonuyla gelir. Barındırılan kurulumlar (Render) build argümanı
# olarak APP_MODE=cloud verir; o zaman hem bundle elenmemiş olur hem de bu değer `cloud`a
# döner. İkisi tek argümandan geldiği için ayrışamazlar.
ENV APP_MODE=${APP_MODE}

# Yalnız çalışması gerekenler: üretim bağımlılıkları + üretilmiş Prisma client,
# sunucu bundle'ı, derlenmiş web ve `prisma db push` için şema/konfig.
COPY --from=deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/server/dist /app/server/dist
COPY --from=build --chown=node:node /app/server/prisma /app/server/prisma
COPY --from=build --chown=node:node /app/server/prisma.config.ts /app/server/prisma.config.ts
COPY --from=build --chown=node:node /app/server/package.json /app/server/package.json
COPY --from=build --chown=node:node /app/web/dist /app/web/dist
COPY --from=build --chown=node:node /app/package.json /app/package.json
# Çalıştırma biti git'te duruyor; `--chmod` kullanılmıyor ki eski (BuildKit'siz) derleyicilerde de çalışsın.
COPY deploy/entrypoint.sh /app/entrypoint.sh

USER node

EXPOSE 3001
# Compose `depends_on: service_healthy` ve yeniden başlatma politikası bunu kullanır.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# npm workspace çözümlemesine girmeden doğrudan çalıştır: çalışma katmanında `shared/` ve
# `web/` kaynakları yok, `npm run -w server` onları arayıp şikâyet edebilir. `prisma db push`
# şemayı ve prisma.config.ts'i bulmak için server dizininde çalışmalı — betik `cd` ediyor,
# ayrıca duraklamış/henüz uyanmamış bir veritabanı için yeniden deniyor (gerekçe betiğin içinde).
CMD ["/app/entrypoint.sh"]
