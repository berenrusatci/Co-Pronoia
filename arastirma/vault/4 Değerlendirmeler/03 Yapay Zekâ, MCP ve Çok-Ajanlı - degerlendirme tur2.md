---
tags:
  - arastirma/degerlendirme
  - baslik/03
baslik: Yapay Zekâ, MCP ve Çok-Ajanlı
tur: degerlendirme
tur_no: 2
kaynak: 03-ai-mcp-tur2-DEGERLENDIRME.md
---
> [!check] Lane'in kendi hükmü (2. tur)
> Yanıt: [[03 Yapay Zekâ, MCP ve Çok-Ajanlı - kod tur2]]

# 03 — Yapay zekâ, MCP ve çok ajanlı planlama — Tur 2 değerlendirmesi

## Hüküm

**Puan: 7,5/10.** İlk turun yanlış lane'e kaymasını büyük ölçüde telafi eden ve iki kritik kod açığı bulan güçlü bir inceleme; ancak istenen ölçülebilir kabul kriterleri, sürüm pinleri ve somut eval paketi eksik kaldı.

Not: Sohbet otomasyonu 1500 saniyede “zaman aşımı (kısmi)” bildirdi, fakat 34.342 karakter kaydettiği için kısa-yanıt tekrar koşulu oluşmadı.

## Takip isteklerinin karşılanma durumu

1. **Kısmen karşılandı.** Stateless/fresh-server modeli, 2025 test protokolü, 2026-07-28 geçişi, `wait_for_changes`, cursor kaybı ve Bearer/OAuth ayrımı açıklandı.
   Eksik: repodaki gerçek MCP SDK paket sürümü çıkarılmadı; uygulama–proxy–istemci timeout zinciri konfigürasyon dosyalarıyla kanıtlanmadı.
   15/25/30 saniye arasında 25 saniye seçildi, fakat yük/SLO ölçümü ve deney planı verilmedi.
2. **Kısmen karşılandı.** AutoGen/CrewAI/LangGraph/Swarm tablosu ve Co-Pronoia claim akışı verildi; acquisition race doğru saptandı.
   Eksik: AutoGen/LangGraph/OpenAI Agents için kesin paket sürümleri çoğunlukla yok; idempotency anahtarı ve fairness algoritması tamamlanmadı.
   `maxContinuousHold`, `renewCount`, cooldown ve backoff önerildi ama sayısal eşikleri/başarı kriterleri belirtilmedi.
3. **Karşılandı.** Proposal → approval → creator kimliğiyle commit zinciri kod satırlarıyla gösterildi; supervisor yetki yükseltmesinin olmadığı doğrulandı.
   TOCTOU'da creator üyeliği/rolü ve normal region/çatışma kontrollerinin tekrarlandığı açıklandı.
   Ayrıca MCP proposal provenance'ının commit'e taşınmaması nedeniyle `aiAllowed:false` kontrolünün atlandığı somutlaştırıldı.
4. **Kısmen karşılandı.** Node, region ve brief prompt akışları ile 8 saldırı senaryosu çıkarıldı; mevcut limitler ve process-local rate limiter gösterildi.
   Eksik: vakalar gerçek testlerle çalıştırılmadı; “mevcut sonuç” sütunu gözleme değil kod çıkarımına dayanıyor.
   Response byte/token/expanded-op limitleri önerildi fakat sayısal eşik ve kabul testi verilmedi.
5. **Kısmen karşılandı.** `Llm` arayüzü, Gemini JSON mode, kırılgan repair zinciri ve önerilen `StructuredLlm<T>` adaptörü incelendi.
   Gemini/OpenAI/Claude structured-output farkı iyi açıklandı; cross-provider fallback yalnız operasyonel hatalarla sınırlandı.
   Eksik: model/package sürüm pinleri, yerel model grammar seçeneği, net fallback sırası ve ölçülebilir şema uyum hedefi yok.
6. **Karşılanmadı.** Eval katmanları ve olası metrikler listelendi fakat istenen en az 20 örneklik başlangıç seti hazırlanmadı.
   Formüller, eşikler, judge agreement hedefi, CI build-stop kuralı ve insan örnekleme oranı verilmedi.
   Yanıt 100–300 vaka önererek talebi büyüttü, fakat uygulanabilir ilk sürümü tanımlamadı.

## Birinci tura göre gerçekten yeni bilgi

- Birinci tur AI/MCP şemasını değil yetki/kimlik/gizlilik lane'ini yanıtlamıştı; bu nedenle tur 2'nin ana gövdesi gerçekten yenidir.
- MCP 2026-07-28'in handshake/session yerine request başına `_meta` ve `server/discover` kullanan stateless dönemi tanımladığı bilgisi yenidir.
- Güncel MCP'de `subscriptions/listen` ile client-açılmış SSE notification stream'i bulunduğu; “push yok” öncülünün artık tam doğru olmadığı bilgisi yenidir.
- Fresh server + fresh transport deseninin 2026 cross-client response leakage advisory'sine karşı güvenli olduğu tespiti yenidir.
- `wait_for_changes` içinde commit için `sinceSeq` varken brief/proposal için durable cursor bulunmaması ve response kaybında sinyalin görünmez kalabilmesi yenidir.
- Statik Bearer'ın custom/internal MCP auth için mümkün, OAuth 2.1'in ise standart discovery/interoperability hedefinde gerekli olduğu ayrımı yenidir.
- LangGraph'ın persisted interrupt/control-plane modelinin mevcut mimariye en yakın framework olduğu karşılaştırması yenidir.
- Claim acquisition'ın “oku → overlap kontrol et → insert” sırası nedeniyle yatay ölçeklemede yarışa açık olduğu kod bulgusu yenidir.
- TTL üst sınırının starvation'ı tek başına önlemediği; aynı ajanın sürekli renew ile fiilen sonsuz sahiplik kurabildiği yenidir.
- `update_brief` aracının bütün ajanlara açık olmasıyla kalıcı, ajanlar arası context poisoning zinciri kurulabildiği yenidir.
- Region açıklamasının prompt'ta açıkça “bağlam/yönerge” yapılmasının veri/talimat ayrımını bozduğu yenidir.
- En kritik yeni bulgu: MCP proposal'ı commit edilirken actor provenance “AI” olarak korunmadığından merkezi guard `aiAllowed` uygulamıyor.
- En kritik ikinci yeni bulgu: owner built-in AI, `updateRegions.aiAllowed` veya region geometrisini önce değiştirip sonra çalışan filtreyi aynı istekte aşabiliyor.
- JSON Schema yerine yalnız `responseMimeType: application/json` kullanılması ve kapanış karakteri ekleyen heuristic repair zinciri yenidir.
- Rate limiter'ların process-local Map olması nedeniyle replica sayısıyla limitin çoğalması yenidir.
- İki supervisor'ın aynı proposal'ı eşzamanlı onaylamasında CAS/conditional status transition bulunmaması olası yeni yarış olarak işaretlendi.

## Birinci turdan tekrar edilenler

- Supervisor'ın kendi yetkisini proposal'a ödünç vermeyip token creator'ın güncel rolüyle commit etmesi tekrarlandı.
- `tma_` token'ın SHA-256 saklanması, rotate/revoke yapısı ve expiry/scope eksikliği tekrarlandı.
- Commit katmanındaki normal region guard'ın merkezi choke point olması tekrarlandı.
- Built-in AI tarafında server-side `aiAllowed` filtresi bulunması tekrarlandı; tur 2 bunun aşılabildiğini ekleyerek anlamlı biçimde ilerletti.

## Kod atıflarının doğruluğu hakkında izlenim

- Örneklem kontrolünde `mcpRoutes.ts:34-45`, `mcpServer.ts:417-495`, `proposalService.ts:243-265` ve `claimService.ts:138-176` atıfları doğru ve iddiaları destekliyor.
- `agent.ts:206-227`, `262-264`, `328-364`, `625-643` ve `823-830` birlikte okunduğunda prompt-injection ve aynı-tur region bypass çıkarımı güçlüdür.
- `commitService.ts:431-455` ile `shared/src/regionGuard.ts:22-28`, merkezi kontrolde AI provenance/`aiAllowed` bulunmadığı iddiasını doğruluyor.
- Şüpheli yol: yanıt `db/prisma/schema.prisma` diyor; yerel repoda gerçek dosya `server/prisma/schema.prisma`. Sources bundle kökü farklı değilse bu atıf yolu hatalıdır.
- “Raw token yalnız create/rotate cevabında” iddiası schema satırlarıyla tek başına kanıtlanamaz; route/service response satırı da verilmeliydi.
- Dış kaynaklar scraper çıktısında çoğunlukla yalnız “Model Context Protocol”, “GitHub”, “OWASP” etiketi olarak kaldı; URL ve bazı sürümler görünmediği için bağımsız denetlenebilirlik zayıf.
- MCP 2026-07-28 stateless ve `subscriptions/listen` iddiaları resmî MCP blogu/SDK dokümanıyla ayrıca doğrulanabilir görünüyor; bunlar şüpheli değil.

## Tamamlanma kararı

**Başlık henüz tamamlandı sayılamaz; üçüncü tur gerekli.** Güvenlik/mimari teşhis yeterince güçlü, fakat uygulanabilir eval kapısı ve bütün öneriler için ölçülebilir karar çıktısı eksik.

Üçüncü tur sorusu: **“Yalnız eksik kalan karar çıktısını ver: 20 vakalık başlangıç eval manifesti, her metriğin formülü/eşiği, CI durdurma ve insan kalibrasyon oranı ile tüm P0–P2 önerilerinin sürüm/alternatif/kabul kriteri nedir?”**
