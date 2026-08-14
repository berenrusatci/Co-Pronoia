# Docker / dağıtım denetimi

Tarih: 2026-08-11 · Yöntem: Codex CLI ile salt-okunur tarama + elle doğrulama
Kapsam: `Dockerfile`, `docker-compose.yml`, `deploy/docker-compose.yml`, `deploy/.env.example`,
`.dockerignore`, `.github/workflows/docker.yml`, `render.yaml`, `server/build.mjs`,
`server/src/mode.ts`, `server/package.json`

---

## 🔴 Kritik — Render (bulut) dağıtımı yerel bundle çalıştırıyor

**Nerede:** `render.yaml:4`, `Dockerfile:31`, `server/src/mode.ts:53,60`

`render.yaml:4` → `runtime: docker`. Yani Render, bu repodaki `Dockerfile`'ı build ediyor.
Ama `Dockerfile:31` her koşulda `npm run bundle:local -w server` çalıştırıyor.

Zincir:

1. `server/build.mjs --local` → `define: { 'globalThis.__LOCAL_BUILD__': 'true' }`
2. `server/src/mode.ts:53` → `LOCAL_BUILD = true`
3. `server/src/mode.ts:60` → `isLocal() = LOCAL_BUILD || appMode() === 'local'` → **`true`**

`render.yaml:9-10`'daki `APP_MODE=cloud` bunu geri alamaz: ifade `OR`, `AND` değil. Ve zaten
alamazdı — elenen dallar bundle'a hiç girmediği için çalışma anında "geri açılacak" bir kod yok.

**Sonuç:** Render'daki kurulumda `authRoutes`, `googleAuth`, `adminRoutes`/`adminService`,
`email`, `agent.ts` (Gemini) ve davet/üyelik route'ları **bundle'da bile yok**. Kimlik
`activatedUser()`'a düşer; aktive edilmiş kullanıcı olmadığı için her `/api` isteği 401 döner,
giriş ekranı da register edilmemiştir. Bulut kurulumu fiilen çalışmaz.

**Not:** `Dockerfile:52-54` ve `mode.ts:25` yorumları "barındırılan kurulumlar (Render) …
kaynaktan çalışır" / "bulut imajı" diyor. Yani niyet buydu; `render.yaml` ise `runtime: docker`
olduğu için Dockerfile'a bakıyor. İki dosya birbiriyle çelişiyordu.

**Düzeltme (uygulandı):** `Dockerfile`'a `ARG APP_MODE=local` eklendi; bundle adımı buna göre
`bundle` (bulut) ya da `bundle:local` (yerel) seçiyor, son katmandaki `ENV APP_MODE` de aynı
argümandan geliyor. Render bir Docker servisinin env değişkenlerini derleme anında build
argümanı olarak da geçtiği için `render.yaml`'daki `APP_MODE=cloud` kendiliğinden bulut
bundle'ını seçiyor; elle `docker build` yerel imajı (öntanımlı) üretmeye devam ediyor.

---

## 🟡 Orta — `.dockerignore` `dist` dizinlerini kaçırıyor

**Nerede:** `.dockerignore:5`, `Dockerfile:27`

Yalnız `web/dist` dışlanmış. `server/dist` ve `shared/dist` `COPY . .` ile build katmanına
giriyor. Bugün patlamıyor çünkü `bundle` adımı `server/dist/server.mjs`'in üzerine yazıyor;
ama geliştirici makinesindeki bayat çıktının imaja sızma riski ve gereksiz cache
invalidation var.

**Öneri:** `.dockerignore`'a `**/dist` ekle (`web/dist` satırı yerine).

---

## 🟢 Düşük

### `env_file: .env` zorunlu
**Nerede:** `deploy/docker-compose.yml:20-21`

Dosya yoksa `docker compose config` bile "env file … not found" hatası veriyor (fiilen
doğrulandı). `deploy/.env.example` mevcut ve compose başlığındaki 1. adım kopyalamayı
söylüyor, dolayısıyla belgelenmiş akış çalışıyor. Yine de tüm değişkenlerin
`${VAR:-default}` karşılığı olduğu için `required: false` yapmak kurulumdan bir adım
düşürürdü.

### `@co-pronoia/shared` symlink'i runtime katmanında kırık
**Nerede:** `Dockerfile:59`, `server/build.mjs:33`

`node_modules/@co-pronoia/shared -> ../../shared` symlink'i kopyalanıyor ama `/app/shared`
kopyalanmıyor. Bugün sorun değil: `build.mjs:33` `shared`i external listesinden çıkarıp
bundle'a gömüyor. İleride dinamik/runtime import eklenirse sessizce kırılır — varsayımı
koruyan bir test iyi olur.

### `adminBootstrap` yerel bundle'da kalıyor
**Nerede:** `server/src/index.ts`, `server/dist/server.mjs` (yerel derleme)

`adminRoutes`/`adminService` eleniyor ama `bootstrapAdmin` fonksiyonunun gövdesi yerel
bundle'da duruyor: çağrı `isLocal() || await bootstrapAdmin(prisma)` biçiminde **runtime**
kontrolü, `globalThis.__LOCAL_BUILD__` kapısı değil. Çağrılmadığı için davranışsal sorun yok
(CLAUDE.md tablosu da "çağrılmaz" diyor, "elenir" demiyor) ve `localBundle.test.ts` bunu
zaten iddia etmiyor. Yine de "imaj taşımaz, eler" ilkesinden küçük bir sapma —
`if (!globalThis.__LOCAL_BUILD__ && !localMode)` kapısına çevrilirse tümüyle elenir.

### `render.yaml` env listesi eksik
**Nerede:** `render.yaml:7-22`

`GEMINI_API_KEY`, `SMTP_*` ve `CLOUD_URL` listede yok. Dashboard'dan elle verilebilir, ama
SMTP yoksa üretimde kayıt 503 döner (`isProd()` dalı) ve yerel kurulumların aktivasyon için
konuştuğu adres `CLOUD_URL`'dir.

---

## ✅ Denetlenip temiz çıkanlar

| Kontrol | Sonuç |
|---|---|
| `Dockerfile:45` workspace adı | `@co-pronoia/server` — `server/package.json:2` ile birebir |
| `--omit=dev` altında `prepare` (`prisma generate`) | Çalışır; `prisma` **prod** dependency (`server/package.json:32`) |
| `CMD`'deki `/app/node_modules/.bin/prisma` | Var — kök `node_modules`'e hoist ediliyor, deps katmanından kopyalanıyor |
| Prisma client'ın kaynağı | Runtime'a **deps** katmanının `node_modules`'ü gidiyor; aynı şema/config ile üretilmiş. (`Dockerfile:29`'daki ikinci `prisma generate` gereksiz tekrar, tutarsızlık değil) |
| HEALTHCHECK yolu | `/api/health` — `server/src/app.ts:186` ile uyumlu |
| GHCR imaj adı | `ghcr.io/${repository_owner}/co-pronoia` ↔ `ghcr.io/berenrusatci/co-pronoia:latest` eşleşiyor |
| Postgres kimlik bilgileri | `DATABASE_URL`, `POSTGRES_*` ve healthcheck üçünde de `treemapper` / `${POSTGRES_PASSWORD:-treemapper}` |

---

## Kritik düzeltmenin doğrulanması

Tam `docker build` bu ortamda alınamadı: konteyner içinden npm registry'ye erişilemiyor
(`npm ci` → `ECONNRESET` / `ETIMEDOUT`). Bunun yerine parçalar ayrı ayrı doğrulandı:

| Doğrulama | Sonuç |
|---|---|
| `ARG APP_MODE` → koşullu `RUN` → son katmandaki `ENV APP_MODE` zinciri (aynı desenle izole bir mini Dockerfile ile iki kez build + run) | Öntanımlı → `BUNDLE=local` / `ENV_APP_MODE=local`; `--build-arg APP_MODE=cloud` → `BUNDLE=cloud` / `ENV_APP_MODE=cloud` ✅ |
| `npm run bundle -w server` (bulut) | 249.5 kB, 39 kaynak dosya ✅ |
| `npm run bundle:local -w server` (yerel) | 157.5 kB, 34 kaynak dosya ✅ |
| `server/src/localBundle.test.ts` (elemeyi ölçen test) | 4/4 geçti ✅ |

**Kalan doğrulama:** gerçek imaj build'i ağ erişimi olan bir ortamda (ya da GHCR workflow'unda)
bir kez alınmalı.
