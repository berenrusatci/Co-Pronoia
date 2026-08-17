---
tags:
  - arastirma/soru
  - baslik/04
baslik: Frontend, Ölçek ve Erişilebilirlik
tur: soru
kaynak: 04-frontend-olcek-erisilebilirlik.md
---
> [!question] Bu başlığın araştırma şeması
> Yanıtlar: [[04 Frontend, Ölçek ve Erişilebilirlik - web]] · [[04 Frontend, Ölçek ve Erişilebilirlik - kod]]

# 4 — Frontend mimarisi, ölçek, etkileşim ve erişilebilirlik

Yukarıdaki uygulamanın **web arayüzü** katmanını araştırmanı istiyorum: React + React Flow + zustand
ile kurulu, üç görünümlü (akış / zihin haritası / zaman çizelgesi) işbirlikçi graf editörü.

## Araştırma soruları

**Store mimarisi ve yeniden çizim (re-render)**
1. Tek büyük zustand store'da (kanonik durum + WebSocket bağlantısı + istemci-tarafı staging + panel
   durumu bir arada) tutmanın ölçek sınırı nedir? Büyük React uygulamalarında store'u hangi eksende
   bölmek doğru (özellik/alan bazlı slicing, seçici abonelik, atom tabanlı Jotai/Recoil'e geçiş)?
2. React Flow ile büyük graf: 1000+ düğüm/kenarda bilinen performans sorunları ve çözümleri
   (sanallaştırma, viewport bazlı render, memoization, `onlyRenderVisibleElements`). React Flow'un
   resmi ölçek rehberi ne diyor (sürüm belirt)?
3. Her tuş vuruşunda çalışan istemci-tarafı önizleme (staging niyetlerini kanonik duruma uygulayıp
   türetilen graf) — bu hesaplamayı büyük grafta ucuz tutma desenleri (memoization, artımlı hesap,
   web worker).

**Çok kullanıcılı düzenleme deneyimi**
4. İki kişi aynı düğümün metnini aynı anda yazınca ne olmalı? Diyagram/graf editörlerinde alan-düzeyi
   eşzamanlı düzenleme, imleç/seçim paylaşımı ("presence"), "şu an X düzenliyor" göstergesi desenleri.
   Figma/Miro/tldraw nasıl yapıyor?
5. WebSocket'i yalnız yayın (broadcast) için kullanıp mutasyonları HTTP'de tutmak — bu ayrımın
   avantaj/dezavantajı, gerçek zamanlı işbirliği ürünlerinde ne kadar yaygın?

**Zihin haritası yerleşimi**
6. d3-hierarchy ile istemci-tarafı zihin haritası yerleşiminin (kalıcı olmayan, her render'da
   hesaplanan) maliyeti ve alternatifleri (ELK, dagre, worker'da hesap). Büyük ağaçta düğüm çakışması
   ve okunabilirlik için düzen algoritması karşılaştırması.

**Erişilebilirlik (a11y)**
7. Graf/diyagram editörlerinde erişilebilirlik: klavye ile düğümler arası gezinme, ekran okuyucu için
   graf yapısının semantik sunumu, odak yönetimi. Bu alanda ARIA desenleri ve gerçek örnekler
   (var mı, yok mu — dürüst değerlendirme).
8. Kenar türlerini bugün büyük ölçüde **renk + çizgi deseni** ile ayırıyorum (akış mavi düz, döngü
   turuncu, bağımlılık mor kesik, ilişki gri noktalı). Renk körü güvenli ayrım için WCAG önerileri,
   desen/etiket/ikon ile pekiştirme, kontrast gereksinimleri. Hareket azaltma (`prefers-reduced-motion`).

**Mobil ve dokunmatik**
9. Karmaşık graf editörlerinin mobil/dokunmatik stratejisi: salt-okunur mobil görünüm mü, tam
   düzenleme mi? React Flow'un dokunmatik desteği ve bilinen sınırları. Örnek ürünlerin mobil kararı.

**Dayanıklılık ve çevrimdışı**
10. Sekme kapanınca kaybolan bekleyen (henüz push edilmemiş) değişiklikler için yerel kalıcılık
    desenleri (IndexedDB, localStorage taslak, otomatik kaydetme). WebSocket kopukluğunda yeniden
    bağlanma stratejisi ve kullanıcıya dürüst durum geri bildirimi (bağlantı göstergesi, çakışma uyarısı).

**Yerelleştirme**
11. Arayüz bugün tümüyle Türkçe (sabit kodlanmış metinler). i18n altyapısına (react-i18next / FormatJS)
    geçmenin gerçek maliyeti ve doğru zamanı. Türkçe'nin özel zorlukları (çoğul, tarih, sıralama).

## Çıktı formatı
- **Yönetici özeti** (≤15 satır).
- **Bulgular**: iddia + kaynak (bağlantı, tarih/sürüm) + mimarime etkisi.
- **Performans tablosu**: düğüm sayısı ölçeğinde (100 / 1k / 10k) React Flow davranışı ve önerilen teknik.
- **Erişilebilirlik denetim listesi**: graf editörü için somut, uygulanabilir maddeler (WCAG referanslı).
- **Öneriler**: S/M/L + "yapılmazsa ne olur".
- **Açık sorular** ayrı.

React Flow, zustand, d3 sürümlerini belirt; öneriler güncel (2025-2026) sürümlere göre olsun.
