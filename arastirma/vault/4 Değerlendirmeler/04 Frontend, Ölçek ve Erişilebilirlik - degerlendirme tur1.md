---
tags:
  - arastirma/degerlendirme
  - baslik/04
baslik: Frontend, Ölçek ve Erişilebilirlik
tur: degerlendirme
tur_no: 1
kaynak: 04-frontend-DEGERLENDIRME.md
---
> [!check] Lane'in kendi hükmü (1. tur)
> Yanıt: [[04 Frontend, Ölçek ve Erişilebilirlik - kod]]

# 04 — Frontend / Ölçek / Erişilebilirlik Yanıtı Değerlendirmesi

## Hüküm

**Puan: 9/10.** Yanıt, hemen bütün araştırma sorularını gerçek kod yolları ve isabetli satır aralıklarıyla bağlayıp uygulanabilir önceliklere dönüştürüyor; puan kaybı dış kaynak bağlantılarının metinde korunmaması ve birkaç önerinin ölçümden önce kesinleştirilmesinden kaynaklanıyor.

## Kod-dayalılık

- Yanıt genel-geçer bir frontend özeti değildir; çok sayıda `dosya:satır` atfı içerir.
- Atıfların örneklemle kontrol edilen bölümü gerçek kaynak kodla örtüşmektedir.
- `web/src/store/graphStore.ts:25-78` gerçekten kanonik graf, preview, pending, presence, görünüm, seçim, ajan ve WS durumunu aynı store arayüzünde toplar.
- `web/src/store/graphStore.ts:152-165` gerçekten her server/pending değişiminde `applyIntents` üzerinden preview üretir.
- `web/src/store/applyIntents.ts:6-30` gerçekten array'leri Map'e çevirir, intent'leri uygular ve bütün Map değerlerini yeniden array'e çıkarır.
- `web/src/components/NodeEditorPanel.tsx:182-224,241-259` gerçekten metni yerel state'te tutar ve `onBlur` ile stage eder; “her tuşta preview” varsayımını kodla doğru biçimde düzeltir.
- `server/src/commitService.ts:520-590` gerçekten node alanı bazında conflict hedefleri üretir; aynı alan çakışırken farklı alanlar çakışmaz.
- `server/src/commitService.ts:258-273,554-574` gerçekten eşzamanlı konum değişikliklerinde kullanıcının `move_node` işlemini düşürür.
- `web/src/store/graphStore.ts:310-388` sabit 2 saniyelik reconnect'i ve catch-up çağrısı bulunmadığını gösterir.
- `web/src/App.tsx:104-113` yüklemenin canvas mount/değişiminde yapıldığını doğrular; reconnect sonrası otomatik reload görünmez.
- `web/src/components/Chrome.tsx:10-13` ile `web/src/App.tsx:160-164` karşılaştırması görünüm etiketlerinin ters olduğunu gerçekten ortaya çıkarır.
- `web/src/views/FlowView.tsx:151` ve `MindMapView.tsx:56` export suffix'lerinin de ters olduğunu doğrular.
- `web/src/views/MindMapView.tsx:17-38` seçimin layout memo bağımlılığı olduğunu doğrular.
- Kod atıfları yalnız süs değildir; çıkarılan performans, correctness ve UX sonuçları çoğunlukla atıf yapılan davranıştan doğrudan türetilmiştir.
- Buna karşılık React Flow, W3C, Figma, Unicode ve GitHub kaynakları kopyalanan Markdown'da gerçek URL yerine yalnız kaynak adı/balon metni olarak kalmıştır.
- Bu nedenle harici iddiaların izlenebilirliği, kod atıflarının izlenebilirliğinden belirgin biçimde daha zayıftır.

## Araştırma sorularının kapsanması

1. **Tek store ve bölme ekseni — yanıtlanmış.** Volatility sınırları, slice'lar, seçici abonelik, normalizasyon, Jotai ve Recoil kararı ele alınmış.
2. **React Flow 1000+ ölçeği — yanıtlanmış.** Memoization, stabil referanslar, görünür eleman render'ı, 12.11.x notları ve 100/1k/10k tablo verilmiş.
3. **Staging preview maliyeti — yanıtlanmış.** Gerçek kod yolu, yaklaşık karmaşıklık, artımlı overlay ve worker sınırı açıklanmış.
4. **Aynı düğümde eşzamanlı düzenleme — yanıtlanmış.** Alan düzeyi conflict, presence ve yalnız uzun metinde CRDT/OT yaklaşımı güçlü; Miro örneği bu alt başlıkta eksik.
5. **HTTP mutasyon + WS broadcast — yüzeysel.** Yerel mimari ve artı/eksiler iyi; fakat bu desenin sektörde ne kadar yaygın olduğu birkaç karşılaştırmalı ürün veya kaynakla temellendirilmemiş.
6. **Zihin haritası yerleşimi — yanıtlanmış.** d3 maliyeti, gereksiz recompute, sabit boyut sorunu, Dagre/ELK ve worker ayrımı ele alınmış.
7. **Graf editörü erişilebilirliği — yanıtlanmış.** Generic APG eksikliği dürüstçe söylenmiş; tree/treegrid ve outline/list alternatifleri somutlaştırılmış.
8. **Renk, desen, kontrast, hareket — yanıtlanmış.** WCAG 1.4.1, 3:1 non-text contrast, ikon/etiket ve reduced-motion önerileri koda bağlanmış.
9. **Mobil/dokunmatik — yanıtlanmış.** Telefon için view-first/edit-mode, tablet için daha tam deneyim ve React Flow touch etkileşimi ele alınmış; cihaz bazlı ölçüm yok.
10. **Dayanıklılık/çevrimdışı — yanıtlanmış.** IndexedDB taslak şeması, debounce, reconnect catch-up, backoff+jitter ve dürüst UI durumları verilmiş.
11. **Yerelleştirme — yanıtlanmış.** Zamanlama, react-i18next/FormatJS ayrımı ve Türkçe tarih/sayı/sıralama/çoğul konuları kapsanmış.

## En değerli 5 bulgu

- Reconnect sonrasında kaçırılan commit'ler için replay veya yeniden yükleme yok; istemci socket yeniden açılsa bile sessizce eski durumda kalabilir.
- `pending` yalnız bellekte olduğu için sekme kapanması ya da yenileme gönderilmemiş kullanıcı emeğini kaybettirir; IndexedDB draft önceliklidir.
- Preview yolu her değişimde kanonik grafı yeniden Map ve array yapılarına dönüştürür; 1k+ ölçekte React Flow'dan önce uygulama katmanı darboğaz olabilir.
- Zihin haritası layout'u seçim değişiminde gereksiz tekrar hesaplanır; layout ve selection projeksiyonunun ayrı memo sınırlarına alınması düşük maliyetli kazançtır.
- Görünüm adları ve export suffix'leri ters bağlanmıştır; araştırma doğrudan kullanıcıya görünen iki correctness hatası bulmuştur.

## Yanlış ya da şüpheli 3 iddia

- “Dinamik boyut nedeniyle overlap başlarsa Dagre” önerisi fazla kestirmedir; Dagre de gerçek ölçülmüş node boyutları ve yeniden layout entegrasyonu ister, tek başına dinamik boyut sorununu çözmez.
- “Figma'nın klasik modeline epey yakın” benzetmesi conflict granülaritesi için yararlı olsa da fazla güçlüdür; Co-Pronoia'nın push/branch semantiği ile Figma'nın sürekli senkronizasyon ve ordering modeli kullanıcı deneyimi açısından aynı değildir.
- “10k mantıksal eleman desteklenebilir” sonucu bir tasarım hipotezidir; gerçek NodeCard, edge, MiniMap, preview ve layout benchmark'ı olmadan ürün kapasitesi olarak kabul edilmemelidir.
- Güncel upstream sürüm/tarih iddiaları verilmiştir, ancak yanıt dosyasında doğrudan URL'ler kaybolduğu için bu iddialar bağımsız olarak tekrar doğrulanabilir durumda değildir.

## Eksikler ve önerilen somut takip soruları

- **Eksik:** 100/1k/10k tablosu ölçüm değil hedef/tahmindir. **Takip:** “Mevcut NodeCard karışımıyla 100, 1.000 ve 10.000 node için ilk render, pan/zoom FPS, seçim gecikmesi, preview süresi ve heap değerlerini otomatik benchmark ile ölç; p50/p95 sonuçlarını ver.”
- **Eksik:** Miro'nun eşzamanlı alan düzenleme davranışı ve HTTP+WS ayrımının yaygınlığı yeterince kaynaklanmamıştır. **Takip:** “Figma, Miro ve tldraw için belge/presence/mutation taşıma modelini resmi mühendislik kaynaklarıyla karşılaştır; Co-Pronoia kararına doğrudan etkisini tabloya dök.”
- **Eksik:** A11y önerileri güçlü olsa da mevcut arayüz üzerinde gerçek klavye ve ekran okuyucu deneyi yoktur. **Takip:** “Flow, mindmap ve timeline için yalnız klavye, NVDA+Firefox/Chrome ve VoiceOver+Safari görev senaryolarını çalıştır; başarısız adımı, WCAG kriterini ve kod düzeltme noktasını kaydet.”
- **Eksik:** Gerçek bağımlılık sürümleri kaynak bundle'ından doğrulanamamıştır. **Takip:** “Lockfile/package manifestlerini Sources'a ekleyip kullanılan kesin React Flow, Zustand ve d3-hierarchy sürümlerini çıkar; önerileri bu sürümlere göre yeniden sınıflandır.”

## Sonuç

- Yanıtın temel gücü, mimari önerileri doğrudan mevcut uygulamanın davranışına bağlamasıdır.
- Öncelik sırası da isabetlidir: önce reconnect correctness ve taslak kalıcılığı, sonra ölçüm, ardından render/store optimizasyonu.
- Harici kaynak URL'leri ve tekrarlanabilir benchmark eklendiğinde çalışma karar belgesi olarak doğrudan kullanılabilecek düzeye gelir.
