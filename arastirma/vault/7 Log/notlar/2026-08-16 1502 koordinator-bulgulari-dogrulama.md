---
tags:
  - log/not
  - rol/yonetici
rol: yonetici
model: claude-opus-5
konu: koordinator-bulgulari-dogrulama
tur: not
zaman: 2026-08-16T15:02:42
karakter: 2847
ham: false
---

# Araştırma sonrası eklenen kodda bulunan (koordinatör tespiti, yönetici doğrulaması)

Bunlar bu araştırma turunun kapsamında DEĞİL. Ana oturumda koordinatör tarafından bulundu;
yönetici canlı kodda doğruladı. Kod bu turda DEĞİŞTİRİLMEDİ (koordinatör yamalayacak).
Ortak yanları: üçü de `e3f006a`/`5b6146b` ile **eklenen** sertleştirmenin içinde ya da kenarında.

## K1 — `trustProxy` yok, ama IP başına oran sınırı var (YÜKSEK)

`server/src/app.ts:82` → `Fastify({ logger: false })`. `trustProxy` verilmemiş, yani Fastify
`X-Forwarded-For` başlığını yok sayar ve `req.ip` daima **doğrudan bağlanan soketin** adresidir.
`server/src/authRoutes.ts:177` ve `:183` bu değerle IP başına oran sınırı uyguluyor
(`LOGIN_MAX_IP = 30`, 15 dk pencere).

Render gibi ters proxy arkasında doğrudan bağlanan daima proxy'dir → **bütün kullanıcılar tek bir
IP kovasını paylaşır**. Sonuç iki yönlü ve ikisi de kötü:
- 30 başarısız giriş bütün siteyi 15 dakika kilitler (self-DoS, tek saldırgan yeterli).
- IP başına sınır saldırgan için hiçbir maliyet üretmez; kalan tek gerçek kapı kullanıcı adı
  başına 10 denemedir.

Bu, bulgu 1'in düzeltmesinin (`e3f006a`) üretimde **beklendiği gibi çalışmadığı** anlamına gelir.
Yani "kapandı" hükmü kod düzeyinde doğru, dağıtım düzeyinde eksik.

Not: aynı ters-proxy sorunu bugün başka bir yerde yok — `req.ip` yalnız bu iki satırda kullanılıyor.

## K2 — Parola alt sınırı hâlâ 4 karakter (ORTA)

`server/src/authRoutes.ts:81` (kayıt) ve `:209` (değiştirme). Yöneticinin bağımsız "kısmen
kapandı" hükmüyle aynı; iki kaynak birbirini doğruluyor.

## K3 — `register` ve `resend-code` uçlarında oran sınırı yok (ORTA)

`server/src/authRoutes.ts:74` (`/api/auth/register`) ve `:152` (`/api/auth/resend-code`) hiçbir
sayaçtan geçmiyor; `loginFailCount` yalnız `:177`'de (login) çağrılıyor. İki ayrı maliyet:
- **E-posta bombardımanı**: `resend-code` kurbanın adresine sınırsız kod yollatır (üçüncü taraf
  taciz kanalı + SMTP itibar kaybı). Uç bilerek daima `{ ok: true }` döndüğü için (e-posta
  numaralandırmasını engellemek üzere) kötüye kullanım dışarıdan görünmez de.
- **scrypt CPU**: `register` uniqueness kontrolünden sonra parolayı hash'liyor; scrypt bilerek
  pahalı. Sınırsız kayıt isteği tek çekirdekli bir kutuyu doyurur.

Deseni proje zaten biliyor (ajan 8/dk, claim 30/dk, login 10/15dk) — bu iki uca uygulanmamış.

## Ortak çıkarım

Üçü birlikte bir desen gösteriyor: **oran sınırı bir uca eklendi, ama bir yüzey olarak
tasarlanmadı.** Uç bazlı yama yerine tek bir kapı (uç → anahtar → limit tablosu) ve
`trustProxy`'nin dağıtım moduna bağlanması (`APP_MODE=cloud` ⇒ `trustProxy: true`) daha az
satırla daha fazlasını kapatır. Bu, SENTEZ.md'deki 10 numaralı bulguyla (süreç-yerel sayaçlar)
aynı yerde birleşiyor: sayaç yüzeyi tek bir yerde toplanırsa hem `trustProxy` hem çok-kopya
sorunu tek noktadan çözülür.
