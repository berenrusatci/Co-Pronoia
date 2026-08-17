---
tags:
  - arastirma/soru
  - baslik/01
baslik: Çekirdek ve Eşzamanlılık
tur: soru
kaynak: 01-cekirdek-esazamanlilik.md
---
> [!question] Bu başlığın araştırma şeması
> Yanıtlar: [[01 Çekirdek ve Eşzamanlılık - web]] · [[01 Çekirdek ve Eşzamanlılık - kod]]

# 1 — Olay kaynaklı çekirdek ve eşzamanlılık

Yukarıdaki mimarinin **çekirdeğini** araştırmanı istiyorum: olay kaynaklı (event-sourced) graf modeli
ve commit/dal tabanlı çatışma çözümü. Kodumu göremediğin için senden kod denetimi değil, **alan
araştırması ve karşılaştırma** istiyorum: bu tasarım kararlarının literatürde ve gerçek ürünlerde
karşılığı ne, bilinen tuzakları neler, hangi noktada duvara toslar.

## Araştırma soruları

**Replay maliyeti ve anlık görüntü (snapshot) stratejisi**
1. Append-only olay günlüğünden durum türeten sistemlerde snapshot/checkpoint tasarımının yerleşik
   desenleri neler? Hangi aralıkta alınır, nerede saklanır, sürüm uyumsuzluğu nasıl yönetilir?
2. Benim `rebuildCheck()` gibi "materyalize tablo ile replay sonucu asla ayrışmaz" değişmezini
   koruyan sistemler snapshot eklerken bu oracle'ı nasıl bozmadan tutuyor?
3. 10k / 100k / 1M olay ölçeğinde gerçek dünyada gözlenen kırılma noktaları neler? Somut vaka
   incelemeleri (blog yazısı, konferans konuşması, post-mortem) ver.

**Olay şeması evrimi**
4. Olay şemasının zamanla değişmesi (yeni alan, alan kaldırma, anlam değişikliği) nasıl yönetiliyor?
   "Upcasting", olay sürümleme, tolerant reader gibi desenlerin karşılaştırması ve hangisinin hangi
   ölçekte tercih edildiği.
5. Benim yaşadığım somut olay: sonradan eklenen bir alan eski olaylarda yok, replay sırasında
   normalize ediliyor. Bu geçici çözümün ölçeklenmediği noktalar nerede başlar?

**Çatışma çözümü: commit tabanlı vs CRDT/OT**
6. İşbirlikçi **graf/diyagram** editörlerinde (metin değil) çatışma çözümü nasıl yapılıyor?
   Figma, Miro, tldraw, Excalidraw, Linear gibi ürünlerin kamuya açıkladığı mimariler nedir?
7. Yjs/Automerge gibi CRDT kütüphaneleri ile benim "alan bazlı çatışma tespiti + otomatik dallanma"
   modelim yan yana: hangisi hangi ürün vaadini korur? CRDT'nin **kaybettiği** şey (denetlenebilir
   yazar, numaralı sıra, inceleme/onay akışı) benim için kritik — bunu koruyan CRDT kullanımı var mı?
8. Melez model (metin alanları CRDT, graf yapısı commit tabanlı) uygulayan gerçek örnek var mı?
   Karmaşıklık maliyeti neye değiyor?
9. Otomatik dallanmanın kullanıcı deneyimi maliyeti üzerine ne biliniyor? Kullanıcılar "senin
   değişikliğin bir dala düştü" mesajını nasıl karşılıyor? Bu deseni kullanan ürün örnekleri.

**Yazma yolu ve ölçek**
10. Kanvas başına serileştirilmiş yazma (mutex + satır kilidi ile artan sıra numarası) deseni
    nerelerde kullanılıyor? Çok kopyalı dağıtımda gecikme profili ve doygunluk noktası hakkında
    ölçüm içeren kaynak var mı? Alternatifler (kuyruk, tek yazar süreç, optimistic concurrency).
11. İstemci tarafında biriktirip tek commit olarak gönderme ("staging/push") deseninin bilinen
    başarısızlık kipleri neler — özellikle bekleyen değişiklik başka birinin commit'iyle
    geçersizleştiğinde kullanıcıya ne gösteriliyor?

**Geçmişin budanması**
12. Append-only günlük asla küçülmüyor. Sıkıştırma, arşivleme, "geçmişi düzleştir" özellikleri
    olay kaynaklı sistemlerde nasıl uygulanıyor ve hangi garantileri bozuyor? KVKK/GDPR silme
    talebinin append-only günlükle çatışması nasıl çözülüyor?

## Çıktı formatı
- **Yönetici özeti** (≤15 satır): en kritik 3 bulgu.
- **Bulgular**: her biri iddia + kaynak (bağlantı, tarih/sürüm) + benim mimarime somut etkisi.
- **Karşılaştırma tablosu**: commit tabanlı / CRDT / OT / melez — eksenler: çatışma kalitesi,
  denetlenebilirlik, uygulama karmaşıklığı, ölçek, çevrimdışı desteği, ekosistem olgunluğu.
- **Riskler**: sıralı, her biri için somut bozulma senaryosu.
- **Öneriler**: S/M/L iş büyüklüğü + "yapılmazsa ne olur".
- **Açık sorular**: kod okumadan cevaplanamayacak olanlar ayrı listede.

Kaynak verirken tarih ve sürüm belirt; 2024 öncesi kaynakların hâlâ geçerli olup olmadığını not et.
