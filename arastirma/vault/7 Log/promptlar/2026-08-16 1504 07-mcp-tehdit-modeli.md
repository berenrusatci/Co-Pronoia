---
tags:
  - log/prompt
  - rol/duzenleyici-2
rol: duzenleyici-2
model: gpt-5.6-sol
konu: 07-mcp-tehdit-modeli
tur: prompt
zaman: 2026-08-16T15:04:48
karakter: 7786
ham: false
---

# 07 — MCP dış ajan tehdit modeli

Bu, Co-Pronoia araştırmasının 2. tur Project incelemesidir. Önceki AI/MCP turu protokol ve kod
bulguları üretti, fakat dış ajanlar için kimin düşman olduğunu tanımlamadı. Bu yanıtın merkezi,
aynı kod üzerinde iki ayrı tehdit modelini birbirine karıştırmadan kurmaktır.

Bu Project'in Sources bölümüne projenin gerçek kaynak kodu zip bundle olarak yüklendi
(copronoia-shared/server/web/db/docs). Yanıtında gerçek dosyalara `dosya:satır` düzeyinde atıf yap.
Bundle'lar dizin yapısını düzleştirebilir; yolu emin olamadığında yolu tahmin etme, dosya adını ve
satırı ver. Sources içindeki gerçek dosyaları aç; yalnız mimari özete dayanma.

## 16 Ağustos 2026 durumu

MCP ajanları kanvas kapsamlı anahtarlarla bağlanır, commit atamaz, proposal sunar; supervisor
onaylayınca normal commit yolu çalışır. `aiAllowed:false` provenance kaçağı 16 Ağustos'ta kapandı:
proposal onayı artık AI aktörü taşır ve merkezi region guard uygular. Bu kapanmış bulguyu yeniden
açıkmış gibi raporlama.

Üç açık uç duruyor: `update_brief` tüm ajanlara açık ve brief her ajanın prompt'una giriyor;
`submit_proposal` içindeki intents için açık bir boyut sınırı yok; claim adaleti ve starvation
politikası tanımlı değil. Süpervizör de tek onay noktası.

Önce `server/src/mcp/mcpServer.ts`, `server/src/mcp/schemas.ts`,
`server/src/proposalService.ts`, `server/src/claimService.ts`,
`server/src/agentRoleService.ts` ve `shared/src/regionGuard.ts` dosyalarını birlikte incele.
Araç kayıtlarını, Zod şemalarını, auth/scope çözümünü, proposal onayını ve lease yaşam döngüsünü izle.

## Kritik ayrım — iki modeli ayrı tablolarla kur

**Model A — ajanlar kullanıcının kendi araçları:** Kullanıcı kendi makinesindeki Claude/Codex
bağlantısına kendi anahtarını verir. Düşman; kanvas içeriğiyle prompt injection yapan kişi/veri,
ele geçirilmiş yerel ajan veya sızmış anahtardır. Kullanıcı ile ajanı baştan karşı taraf sayma.

**Model B — ajanlar üçüncü taraf:** Başka kişi/kurumun ajanı aynı kanvasta çalışır. Ajanın kendisi
bilinçli saldırgan olabilir; diğer ajanları aç bırakmak, ortak bağlamı zehirlemek, veri çıkarmak
ve supervisor kararını manipüle etmek hedeflenebilir.

Her model için ayrı ayrı: varlıklar, güven sınırları, saldırgan yetenekleri, giriş noktaları,
saldırı ağacı, en kötü sonuç ve artık risk yaz. Her kontrolün A'da gerekli/gereksiz, B'de
gerekli/gereksiz oluşunu tek bir karşılaştırma matrisinde hükme bağla.

## Belirli takip istekleri — altısını da yanıtla

1. **Önceki AI/MCP turunda güncel MCP'nin stateless `_meta` ve notification stream özelliklerini
   anlattın ama güvenlik rehberini bu koda eşlemedin.** 2025+ MCP specification/security best
   practices içinden tool poisoning, confused deputy, token passthrough, session/auth scope ve
   kullanıcı onayıyla ilgili normatif hükümleri çıkar. Her birini “bu projedeki kod karşılığı,
   kontrol var/yok, Model A etkisi, Model B etkisi” satırıyla eşleştir. Protokol sürümünü ve tam
   resmî URL'yi yaz; blog veya ikincil güvenlik listesiyle yetinme.

2. **16 Ağustos sentezinin 5. bulgusunda “`update_brief` kalıcı bağlam zehirleme kanalı” dedin ama
   yazma yetkisi politikasını seçmedin.** Yalnız supervisor yazar, append-only+atıflı öneri,
   ajan-başına bölüm ve insan onaylı değişiklik desenlerini iki tehdit modelinde karşılaştır.
   2024+ çok-ajan bağlam/hafıza zehirleme araştırmasını birincil makale veya OWASP resmî kaynağıyla
   doğrula. Bu repo için tek varsayılan politika, brief revision şeması ve rollback/audit davranışı
   öner; “editor+ ve tüm MCP ajanları yazar” mevcut tip yorumunu da kodla doğrula.

3. **Önceki tur proposal akışını güçlü buldu ama `submit_proposal` için kaynak tüketim sınırı
   vermedi.** Mevcut Zod/servis çağrı zincirinden bugünkü fiilî sınırları çıkar. Intents sayısı,
   ham JSON baytı, eklenen düğüm/kenar ve açıklama uzunluğu için somut eşikler öner; gerekçeyi
   projedeki 8.000 karakter prompt, tur başına 4 `newRegions`, 3 `newSubCanvases` ve 6 stepwise
   parçası emsalleriyle kıyasla. Parse öncesi body limit, şema doğrulama ve iş mantığı kotasını
   ayır; sınır aşımında HTTP/MCP hata biçimini ve atomik reddi tanımla.

## KAYNAK ŞARTI (pazarlık konusu değil)

Depo dışı her iddia için tam URL (https://...) + erişim tarihi ver. Kaynağı adıyla anıp bağlantı
vermek yeterli DEĞİLDİR ve o iddia geçersiz sayılır. URL veremiyorsan iddiayı yazma, ya da açıkça
"[URL YOK — doğrulanamaz]" diye işaretle. Yanıtın sonunda "Kaynaklar" başlığı altında bütün
URL'leri tarihleriyle listele. Bu şartı karşılamayan iddialar karar kaydına giremez ve yanıtın
puanını düşürür.

Kaynak önceliği ve güncellik: 2024+ sürüm/tarihli resmî MCP spesifikasyonu, OWASP LLM Top 10 veya
Agentic AI dokümantasyonu, NIST AI RMF/GenAI Profile ve hakemli/birincil çok-ajan güvenlik
çalışmaları. Her standardın tam madde/başlık kimliğini ve sürümünü belirt. Genel OWASP/NIST özeti
yazma; yalnız bu mimaride somut karşılığı olan maddeleri kullan.

4. **Önceki AI/MCP değerlendirmesi fairness algoritmasının tamamlanmadığını söyledi ama claim
   açlığını ölçülebilir bir politikaya çevirmedi.** `claim_region`/node claim kodunda TTL, yarış,
   yenileme ve release davranışını doğrula. Ajan başına eşzamanlı claim üst sınırı, kanvasın toplam
   claim'lenmiş düğüm oranı ve aging/fair queue seçeneklerini Model A/B için değerlendir. Tek bir
   MVP algoritması seç; max claim, TTL/renewal, bekleme/aging ve starvation SLO'su için sayılar ver.
   Soft lease'in kilit olmadığını koru; çakışmayı güvenlik ihlali diye abartma.

5. **Önceki tur OWASP ve NIST adlarını andı ama gerçek URL ve kod karşılığı vermedi.** İlgili her
   OWASP LLM/Agentic AI ve NIST AI RMF/GenAI Profile maddesini “tehdit → mevcut kod → eksik kontrol
   → A/B gerekliliği → test” formatında sınırla. Prompt injection, excessive agency, unbounded
   consumption, sensitive-information disclosure ve supply-chain/tool riskinden yalnız gerçekten
   uygulanabilenleri dahil et; ilgisiz maddeleri “uygulanmaz” gerekçesiyle ayır.

6. **Önceki sentez supervisor onayını güven sınırı kabul etti ama supervisor ele geçirilirse ne
   olacağını ve insan eşiğini söylemedi.** Supervisor anahtar/rol yetkilerini koddan çıkar; ele
   geçirilmiş supervisor için saldırı ağacı kur. İnsan onayını intents sayısı, etkilenen düğüm
   oranı, silme işlemi, `aiAllowed`, bölgeler arası değişiklik ve brief güncellemesi gibi sinyallerle
   somutlaştır. Tek/çift onay, step-up insan onayı ve acil revoke alternatiflerinden MVP kararını
   seç; false-positive maliyetini de belirt.

## Beklenen saldırı ağacı biçimi

Kök hedefleri en az şu dördünü kapsasın: (1) ortak bağlamı zehirle, (2) kaynakları tüket/diğer ajanı
aç bırak, (3) yetkili supervisor üzerinden zararlı graph değişikliği geçir, (4) kanvas verisini
sızdır. Her yaprakta önkoşul, Model A/B uygulanabilirliği, mevcut kontrol, önerilen kontrol,
tespit sinyali ve artık risk olsun. Olasılığı kanıtsız yüzdeyle ifade etme.

## Zorunlu karar ve ölçüt biçimi

Her öneride **S/M/L efor**, **yapılmazsa ne olur** ve **ölçülebilir kabul kriteri** bulunmalı.
Kabul kriteri sayı veya otomatik sınanabilir koşul olmalı. Ayrıca kontrolün A/B modelinden
hangisinde zorunlu olduğu, uygulanacağı katman/dosya, sürüm veya eşik ve reddedilen alternatif yazılsın.

## Çıktı formatı

1. **Yönetici özeti** — 10–15 satır; A ve B için ayrı güven hükmü, yap/yapma kararları.
2. **Bulgular** — iddia + kanıt; kod için `dosya:satır`, dış kaynak için URL + erişim tarihi.
3. **Risk sıralaması** — gerçekte ne olur, kimin başına gelir, hangi model/varsayım altında.
4. **Öneriler** — S/M/L + yapılmazsa sonuç + ölçülebilir kabul kriteri + A/B kapsamı.
5. **Açık sorular** — yalnız kod okuyarak cevaplanamayan güven/ürün kararları.
6. **Kaynaklar** — kullanılan bütün tam URL'ler, sürüm/yayın ve erişim tarihleri.
