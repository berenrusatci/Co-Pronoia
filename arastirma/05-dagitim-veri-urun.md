# 5 — Dağıtım ikiliği, veri katmanı, test ve ürün konumlandırma

Yukarıdaki uygulamanın **dağıtım, veri katmanı, kalite ve ürün** boyutlarını araştırmanı istiyorum.

## Araştırma soruları

**Tek kod tabanı, iki mod (bulut + yerel) ve derleme anında kod eleme**
1. Tek kod tabanından iki dağıtım kipi üretmek (bulut = tam özellik, yerel = tek kullanıcı, güvenlik
   yüzeyi küçültülmüş) için desenler. Benim yaklaşımım: **derleme anında** (esbuild `define` + ölü kod
   eleme) kimlik/yönetim kodunu yerel imajdan tamamen çıkarmak, böylece o kod imajda **hiç bulunmuyor**.
   Bu "compile-time feature flag ile saldırı yüzeyi eleme" deseninin gerçek örnekleri ve tuzakları
   (bundler sürüm yükseltmesinde sessizce kırılma, dead-code elimination'ın garanti olmaması) neler?
2. Böyle bir eleme kapısının kırılmadığını CI'da doğrulamanın yolu (bundle içeriği testi, sembol
   taraması). Bu deseni kullanan açık kaynak projeler var mı?

**Yerel ↔ bulut senkronizasyon**
3. Bugün senkron **tek yönlü** (buluttan yerele içe aktarma). İki yönlü senkron, çakışma çözümü,
   kısmi çekme, yerel değişikliğin buluta dönüşü — olay kaynaklı bir çekirdek üstünde bunu kuran
   desenler (ör. Git benzeri fetch/push, CRDT senkron, olay günlüğü replikasyonu). Local-first yazılım
   hareketinin (Ink & Switch, "local-first software" makalesi) bu konudaki önerileri.

**Migration ve şema evrimi**
4. `prisma db push` (migration dosyası yok) ile üretim yürütmenin riskleri; gerçek migration'a
   (Prisma Migrate) geçişin maliyeti ve doğru zamanı. Sıfır kesintili (zero-downtime) şema değişikliği
   desenleri (expand-contract), geri alınabilirlik.

**Veri katmanı ve ölçek**
5. Sınırsız büyüyen tablolar (append-only commit günlüğü, öneri geçmişi, oturumlar, brief revizyonları)
   için budama/arşivleme/bölümleme (partitioning) desenleri. PostgreSQL'de bu tablolar için indeks
   stratejisi ve bilinen anti-desenler.
6. Kanvas başına bellekte durum tutan bileşenler (WebSocket istemci kümesi, olay yayıcı, oran
   sınırlayıcılar, kanvas-başına servis örneği). Yatay ölçeklemede (çok kopya) hangisi bozulur,
   hangisi dışarı taşınmalı (Redis pub/sub, PostgreSQL LISTEN/NOTIFY)? Fastify + WebSocket çok kopyalı
   dağıtım desenleri.
7. Bağlantı havuzu yönetimi: kanvas başına açılıp hiç temizlenmeyen servis örnekleri bellek/bağlantı
   sızıntısı riski taşıyor. Uzun ömürlü Node servislerinde bu sınıf sızıntıyı yöneten desenler.

**Test ve gözlemlenebilirlik**
8. Olay kaynaklı bir çekirdeği test etmenin en iyi yolu: değişmez (invariant) testleri,
   property-based testing (fast-check) ile `apply/invert` ve replay tutarlılığı doğrulama. Bu alanda
   örnek test stratejileri.
9. Her test paketi için şablon veritabanı (template DB) + kopya deseni: PostgreSQL'de bu yaklaşımın
   hız/izolasyon dengesi, paralelleştirme sınırı, alternatifleri.
10. Üretim gözlemlenebilirliği (yapılandırılmış log, metrik, hata takibi, trace) için minimum
    uygulanabilir set — ve bunun radikal-minimal gizlilik duruşuyla (bkz. ayrı prompt) nasıl
    bağdaştırılacağı.

**Ürün konumlandırma ve özellik keşfi**
11. **Rakip haritası**: Miro/FigJam (serbest kanvas), Linear/Jira (iş takibi), Obsidian Canvas +
    zihin haritası araçları, Notion (belge), git tabanlı / diagram-as-code planlama araçları.
    Co-Pronoia'nın savunulabilir farkı **"numaralı commit + çok ajanlı LLM önerisi + supervisor
    onayı"** üçlüsü — bu kombinasyonu sunan başka ürün var mı? Kime, neden lazım? Pazar boşluğu gerçek mi?
12. **Özellik boşlukları** (her biri için: bu tür ürünlerde standart mı, farklılaştırıcı mı, S/M/L):
    yorum/tartışma, bildirim, arama, etiket/filtre, düğüm ekleri/dosyalar, tarih-takvim ve bağımlılık
    zamanlaması, ilerleme raporu, şablon kütüphanesi, komut paleti, herkese açık salt-okunur paylaşım
    linki, Markdown/Mermaid dışa aktarımı, GitHub Issues/Projects köprüsü, webhook.
13. **İlk değer anı (activation)**: yeni kullanıcının ilk 5 dakikada değer görmesi için boş-durum
    tasarımı, şablonlar, rehberli kurulum. Özellikle MCP kurulumunun (bugün elle `.mcp.json` yapıştırma)
    kolaylaştırılması — geliştirici araçlarında MCP onboarding en iyi örnekleri.
14. **Fiyatlandırma**: LLM maliyeti kullanıcı başına değişken, yerel mod ücretsiz dağıtılıyor.
    Kullanım-bazlı + koltuk-bazlı hibrit modeller, kota tasarımı, açık kaynak + bulut ("open core")
    stratejisi örnekleri.

## Çıktı formatı
- **Yönetici özeti** (≤15 satır).
- **Bulgular**: iddia + kaynak (bağlantı, tarih/sürüm) + mimarime etkisi.
- **Rakip karşılaştırma tablosu**: ürün → güçlü yanı → Co-Pronoia'nın farkı → tehdit.
- **Özellik önceliklendirme tablosu**: özellik → değer × maliyet (S/M/L) → farklılaştırıcı mı.
- **Öneriler**: yol haritası taslağı, bağımlılık sırasına göre.
- **Açık sorular** ayrı.

Kaynaklarda tarih/sürüm belirt; ürün/pazar iddialarını mümkünse veriye dayandır.
