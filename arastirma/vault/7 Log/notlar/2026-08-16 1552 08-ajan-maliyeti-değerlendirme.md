---
tags:
  - log/not
  - rol/duzenleyici-1
rol: duzenleyici-1
model: gpt-5.6-sol
konu: 08-ajan-maliyeti değerlendirme
tur: not
zaman: 2026-08-16T15:52:13
karakter: 6220
ham: false
---

# 08 — Ajan maliyeti değerlendirmesi

Hüküm: **8/10 — Kod analizi ve maliyet aritmetiği güçlü; iki yanlış yol ile dört URL'siz BYOK iddiası karar-kaydı kalitesini düşürüyor.**

## Kapsam ve yöntem

Ham kayıt 1.312 satırdır ve değiştirilmemiştir.
D1, ham kayıttaki `dosya:satır` atıflarını tek tek envanterledi.
Atıfların hedef yolu `/home/beren/Projects/treemapper` altında arandı.
56 kod-konum atfının 56'sı gerçek dosya ve mevcut satır aralığına çözüldü.
54 atıf baştan doğru yolu taşıyordu.
2 atıf yanlış kökteydi: `db/prisma/schema.prisma`.
İkisinin gerçek yolu `server/prisma/schema.prisma` olarak düzeltildi.
Bulunamayan atıf sayısı 0'dır.
Yanlış-yol oranı 2/56, yaklaşık %3,6'dır.
İçerik doğrulaması ana çağrı grafiği, parser limitleri, retry/fallback, prompt serialization, rate-limit, schema ilişkileri ve local bundle üzerinde yapıldı.

URL: 35/39, 8 tanesi açılarak sınandı, 8 tanesi iddiayı destekliyor.
Dış iddialar yinelenen anlatımlar tekilleştirilerek doğrulanabilir önerme kümeleri olarak sayıldı.
URL'siz dört iddia Notion, Linear, Figma ve v0 için BYOK durumudur.
Bu dört iddia düzenli sürümde `[URL YOK — karar kaydına giremez]` diye işaretlendi.
Kaynakların tümü erişim tarihi taşıyor.
Canva sayfaları sayısal kanıt vermediği için rakam üretilmemesi doğru ihtiyattır.
16 Ağustos durum notundaki kapanmış bulgu 2/12/14 ve login rate-limit bu ham yanıtta yeniden “açık” diye raporlanmıyor; düzeltme gerektirmedi.
Açık parola/CAS/CI/`update_brief`/AuditLog maddeleri de bu maliyet başlığının iddiası değildir; değerlendirmeye yapay olarak eklenmedi.

## Kod-dayalılık

Model routing iddiası doğrudur: proto Lite→Flash, detailed Flash→Lite sırasını kullanır (`server/src/agent.ts:49-57`).
Retry iddiası doğrudur: model başına iki attempt vardır; 429/503 retry, 404 fallback yoludur (`server/src/agent.ts:68-96`).
Telemetry kaybı iddiası doğrudur: başarılı response tipi yalnız candidate metnini okur (`server/src/agent.ts:66-100`).
Tam-state iddiası doğrudur: tüm node/edge/region JSON'u gönderilir, selection ayrıca eklenir (`server/src/agent.ts:206-277`).
Rate-limit iddiası doğrudur: top-level route'ta süreç-local `Map` ile 8/dk ve 20/dk sayılır (`server/src/routes.ts:33-58,225-269`).
Local Docker ayrımı doğrudur: `agent.ts` local bundle'dan elenir, MCP ayrı kalır (`CLAUDE.md:78-110`).
Schema ilişkisi doğrudur, ancak ham kayıttaki dizin kökü yanlıştır (`server/prisma/schema.prisma:54-104`).

## Altı sorunun durumu

1. Ölçüm sözleşmesi: **yanıtlanmış**.
REST alanları, attempt/call graph, privacy-safe scope, latency, sonuç ve maliyet alanları ayrıntılı verilmiş.
Ham prompt/cevap ve ham kimliklerin toplanmaması açıkça seçilmiş.

2. Tur maliyeti ve alias/fiyat: **yanıtlanmış**.
Düşük/orta/yüksek varsayımlar ile main/subcall çarpanları ayrılmış.
Aritmetik yeniden hesaplandı ve doğru bulundu.
Alias target belirsizliği uygun biçimde kesin hükümden ayrılmış.

3. 2024–2026 ürün emsalleri: **yüzeysel**.
Yedi ürünün tamamı anılmış ve sayısal emsaller verilmiş.
Ancak dört BYOK hücresi URL'siz; Canva sayısal olarak doğrulanamamış.
Her ürün için yayın/sürüm tarihi de erişim tarihi kadar düzenli verilmemiş.

4. MVP modeli: **yanıtlanmış**.
Managed, BYOK ve hibrit karşılaştırılmış; hibrit tek seçim olarak verilmiş.
$2/$5/$25/$1 eşikleri maliyet senaryosuna bağlanmış.
Bu rakamların retail fiyat değil allowance hipotezi olduğu belirtilmiş.

5. Hard budget enforcement: **yanıtlanmış**.
Reservation, per-call recheck, settlement, concurrency ve unknown usage davranışı kapsanmış.
User/workspace/turn limitleri seçilmiş; canvas/month ekonomik limit reddedilmiş.

6. Ucuzlatma sırası ve eval: **yanıtlanmış**.
Fan-out cap, part azaltma, subgraph, delta, routing, summary ve caching sıralanmış.
Her adımda sayısal maliyet/kalite eşiği bulunuyor.

## En değerli 5 bulgu

1. `geminiGenerate()` usage ve modelVersion bilgisini atıyor; bu nedenle mevcut sistem gerçek COGS'u ölçemiyor.
2. Üçlük new/fill limitleri turn-global değil, her parser çağrısında yeniden başlıyor.
3. Altı parçalı azami fan-out'ta erişilebilir teorik logical-call tavanı 42, transport-attempt tavanı 168'dir.
4. Top-level in-memory rate-limit iç fan-out'u veya çoklu process bütçesini kapsamaz.
5. Full-state her stepwise parçada yeniden gönderildiği için büyük kanvas maliyetinin ana ekseni state boyutu × parça sayısıdır.

## Yanlış veya şüpheli 3 iddia

1. `db/prisma/schema.prisma` yolu yanlıştır; gerçek yol `server/prisma/schema.prisma`dır.
İddianın Canvas→Group ve Group→canvases ilişkisi doğru, yalnız yol hatalıdır.
2. “Beklenen 12 yerine 42 call” ifadesi şiddetçe fazla kesindir.
42 yalnız altı parçanın her birinde uygulanabilir 3+3 fan-out üretildiği teorik tavan; olağan çağrı sayısı ölçülmemiştir.
3. “Fan-out bug'ı maliyeti 2.45× yapıyor” genellenebilir üretim bulgusu değildir.
2.45× yalnız tanımlanan sentetik yüksek 3.5 Flash senaryosunun oranıdır; gerçek dağılım telemetri olmadan bilinmez.

## Şiddet kalibrasyonu

Fan-out bulgusu P0 kalabilir; sebep normal her turn'ın pahalı olması değil, hard-cap olmadan erişilebilir kuyruğun genişliğidir.
Telemetry eksikliği P0'dır; doğrudan fatura artışı yaratmaz fakat ölçme, fiyatlama ve uzlaştırmayı engeller.
Hard-cap eksikliği P0'dır; rate-limit altında bile yüksek state ve eşzamanlı istekler parasal sınırı aşabilir.
Alias riski P1'dir; model mutlaka pahalanır demek değildir, model/fiyatın deploy dışı değişebilmesidir.
Full-state riski P1'dir; yaklaşık lineer serialize büyümesi vardır, gerçek token/dolar eğimi ölçülmemiştir.
Caching P2 fırsat/riskidir; hit ve storage ölçülmeden tasarruf iddiası kurulamaz.
Viewer kontrolünün modelden sonra olması maliyet doğurabilir; bu bir yetki bypass'ı değil gereksiz provider harcamasıdır.

## Tamamlanma kararı

Başlık araştırma kararı için büyük ölçüde tamamlanmıştır.
Kod-dayalı çağrı grafiği, ölçüm şeması, maliyet formülü, bütçe noktaları ve MVP yönü yeterlidir.
Nihai retail kota/fiyat kararı ise telemetri gelmeden tamamlanmış sayılamaz.
Emsal bölümünün karar kaydına alınması için dört BYOK boşluğuna resmî URL veya açık “kanıt yok” kararı gerekir.
Bir tur daha gerekli: **30 günlük/1.000 turn telemetri ve dört ürünün resmî BYOK kanıtı geldiğinde $5 user ve $25 workspace allowance eşikleri korunmalı mı?**
