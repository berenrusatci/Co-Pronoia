---
tags:
  - arastirma/degerlendirme
  - baslik/01
baslik: Çekirdek ve Eşzamanlılık
tur: degerlendirme
tur_no: 1
kaynak: 01-cekirdek-DEGERLENDIRME.md
---
> [!check] Lane'in kendi hükmü (1. tur)
> Yanıt: [[01 Çekirdek ve Eşzamanlılık - kod]]

# `core.md` değerlendirmesi

## Sonuç

Genel hüküm: **iyi / güçlü içerik, fakat kaynak sunumu kusurlu**. Yanıt araştırma sorularının tamamına değiniyor, mimariye uygulanabilir ve önceliklendirilmiş öneriler çıkarıyor; ayrıca kodla desteklenen üç önemli correctness riski yakalıyor. En büyük teslim kusuru, dış kaynakların kaydedilen Markdown içinde gerçek bağlantı, tam başlık ve çoğu yerde açık tarih/sürüm yerine yalnız `Figma`, `Automerge`, `docs.axoniq.io` gibi etiketler halinde kalmasıdır. Bu yüzden kaynaklar bağımsız olarak denetlenebilir değildir ve prompttaki “bağlantı, tarih/sürüm” şartı tam karşılanmamıştır.

Karakter sayısı: otomasyonun raporladığı yanıt gövdesi **35.212 karakter**. Dosya, otomasyonun eklediği URL başlığıyla birlikte `wc -m` ölçümünde **35.335 karakter** ve 806 satırdır.

## Kapsam

Araştırmanın 12 sorusunun tamamı en azından ele alınmış:

- Snapshot/checkpoint deseni, saklama modeli, sürüm uyumsuzluğunda geriye düşme ve `rebuildCheck()` oracle'ının üç katmanlı korunması iyi açıklanmış.
- 10k/100k/1M ölçekleri ayrı tartışılmış; ancak bunlar gerçek, karşılaştırılabilir ölçümlerden çok heuristik, ürün mimarisi örneği ve tek bir saha anekdotuna dayanıyor.
- Olay evriminde tolerant reader, explicit version ve upcaster zinciri karşılaştırılmış; mevcut normalize çözümünün hangi semantik değişikliklerde çökeceği somutlaştırılmış.
- Commit/CRDT/OT/melez karşılaştırması istenen eksenlerin tamamını içeren tabloyla verilmiş.
- Figma, Excalidraw, tldraw, Miro ve Linear ele alınmış. Miro ve Linear için kamuya açık algoritma bulunamadığının açıkça belirtilmesi doğru epistemik tutum; fakat bu iki ürün özelinde sonuç doğal olarak yüzeysel kalıyor.
- CRDT'nin actor/history sağlayabildiği, fakat canonical acceptance order, business identity ve approval semantiğinin ayrıca kurulması gerektiği doğru biçimde ayrıştırılmış.
- Melez model için Figma Code Layers/Eg-walker ve ShareDB örnekleri verilmiş; graf + metin şeklindeki birebir ürün emsali yerine yakın analoglar sunulduğu açık olmalıydı.
- Otomatik branch UX'i için doğrudan araştırma bulunamadığı dürüstçe söylenmiş; Dropbox conflicted copy ve kullanıcı kontrollü Figma branching yalnız yakın analoglardır.
- Kanvas başına serialization, staging/push hata kipleri, archive/squash ayrımı ve KVKK/GDPR çatışması kapsanmış.

İstenen çıktı bölümleri mevcut: yönetici özeti, bulgular, karşılaştırma tablosu, sıralı riskler, S/M/L öneriler ve açık sorular. Yönetici özeti fiziksel olarak 15 satırı aşıyor ve üç bulguyla sınırlı değil; içerik iyi olsa da biçim şartına tam uymuyor. 2024 öncesi kaynakların güncellik notu ayrıca verilmiş.

## Gerçek dosya ve satır atıfları

Yerel repo depo kökü üzerinden örneklem değil, yanıtın kullandığı benzersiz kod atıflarının tamamı kontrol edildi.

Doğrulanan başlıca atıflar:

- `server/src/commitService.ts:129-173,189-193,506-514`: `stateAt`, main/branch replay ve `rebuildCheck()` gerçekten tam geçmiş replay ediyor.
- `web/src/store/graphStore.ts:158-165,329-333,485-490`: WS state'i `headSeq`'i ilerletiyor, pending preview yeniden uygulanıyor ve push güncel `headSeq` ile gidiyor. Yanıtın `pendingBaseSeq` kaybı ve sessiz çatışma atlama senaryosu koddan geçerli biçimde çıkarılıyor.
- `server/src/commitService.ts:196-213` ve `server/src/commitService.test.ts:365-379`: merge gerçekten branch state'ini hedef alıp current main'den ona diff üretiyor; “wholesale” davranışı yorum ve test adıyla doğrulanıyor. İlgisiz yeni main değişikliklerini geri alma riski gerçek.
- `shared/src/ops.ts:41-53` ve `shared/src/ops.test.ts:54-67`: eski olaylar için default normalization/tolerant reader tespiti doğru.
- `shared/src/types.ts:57-72`: altı op türü ve `update_edge` bulunmaması doğru.
- `shared/src/types.ts:42-54`: `data` gerçekten tek çatışma alanı olarak belgelenmiş.
- `server/src/commitService.ts:379-390`, `445-458`, `498-503` ve test `56-70`: kanvas satır kilidi, global seq ataması, transaction içinde full graph load ve iki servis örnekli yarış testi doğru atfedilmiş.
- `shared/src/ops.ts:105-122`, test `10-33` ve `server/src/commitService.ts:628-629`: null koordinatın invert/restore ile aynen geri getirilemediği tespiti doğru. Kod bunu flow görünümünde `0,0` ile eşdeğer kabul ediyor; dolayısıyla bulgu özellikle iddia edilen katı state identity invariant'ına karşı geçerli.
- `web/src/store/applyIntents.ts:10-30` ve `graphStore.ts:492-495`: stale intent'in preview'da atlanması ve push hatasında pending'in korunması doğru.

Atıf kusuru:

- Yanıttaki `db/prisma/schema.prisma:230-242,263-277` yolu yerel repoda yok. Gerçek dosya `server/prisma/schema.prisma`; aynı satırlar ve iddialar orada birebir mevcut. İçerik doğru, dosya yolu yanlış ya da yüklenen bundle'ın sanal adı açıklanmamış.
- Kod atıfları düz metin ve göreli yol biçiminde; yine de satırlar denetlenebilir. Dış kaynaklarda ise kaydedilen dosyada URL yoktur. Yalnız ilk satırdaki ChatGPT konuşma URL'si gerçek bağlantıdır.

## En önemli eksikler

1. **Kaynak denetlenebilirliği:** Figma/Axon/Automerge/tldraw/Kurrent/KVKK vb. iddiaların doğrudan URL'leri, yayın başlıkları, tarihleri ve sürümleri kaydedilen yanıtta yok. `Figma`, `+1` gibi UI kaynak rozetleri bibliyografik atıf değildir.
2. **Ölçümlü kırılma noktaları:** 10k/100k/1M için aynı workload altında replay süresi, payload boyutu, donanım ve p50/p95 veren somut vakalar sunulmuyor. Figma'nın journal hacmi ve Kurrent forum anekdotu bu soruyu ancak kısmen karşılıyor.
3. **Yazma yolu ölçümleri:** Tek-yazar/row-lock mimarileri için gerçek latency profili ve doygunluk noktası kaynakları yok; yanıt daha çok mimari benzerlik ve önerilen telemetry veriyor.
4. **Branch UX kanıtı:** Otomatik çatışma dalı kullanan doğrudan ürün ve kullanıcı araştırması bulunmamış. Yanıt bunu açıkça kabul ediyor ama talebin bu kısmı sonuçsuz kalıyor.
5. **Melez emsalin birebirliği:** Figma'nın design properties + code text ayrımı güçlü bir yakın örnek, fakat “graf yapısı commit tabanlı, metin CRDT” şeklinde birebir doğrulanmış bir vaka olarak sunulmamalı.

## Kalite hükmü

**8/10 — güçlü ve eyleme dönük.** Kapsam, mimariye bağlama, risk önceliklendirmesi ve gerçek kod satırı kullanımı çok iyi. Kaynak URL'lerinin kaybolması ve ölçek/doygunluk sorularında ölçümlü vaka eksikliği, bunu tam anlamıyla yeniden üretilebilir bir alan araştırması olmaktan çıkarıyor. Revizyonda ilk iş, her dış iddiayı tam başlık + yayıncı + tarih/sürüm + doğrudan URL ile kaynaklandırmak; ikinci iş ise 10k/100k/1M replay ve hot-canvas write saturation için ölçüm tablolu vakalar eklemek olmalı.
