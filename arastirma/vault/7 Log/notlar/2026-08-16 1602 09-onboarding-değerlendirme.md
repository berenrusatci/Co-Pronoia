---
tags:
  - log/not
  - rol/duzenleyici-1
rol: duzenleyici-1
model: gpt-5.6-sol
konu: 09-onboarding değerlendirme
tur: not
zaman: 2026-08-16T16:02:47
karakter: 6512
ham: false
---

# 09-onboarding değerlendirmesi — DÜZENLEYİCİ-1

Hüküm: **8/10** — Altı soruyu da güçlü kod kanıtıyla yanıtlıyor; bütün kod yolları eksik ve bir dış metadata iddiası URL’siz olduğu için karar kaydı kalitesinden puan kırıldı.

## Kod-dayalılık

- Ham yanıtta 85 kod-atıf geçişi sayıldı.
- Bunlar 66 benzersiz `dosya[:satır]` biçimine karşılık geliyor.
- 17 benzersiz kaynak dosyanın tamamı gerçek depoda bulundu.
- Atıfların 85/85’i gerçek dosya ve ilgili kod davranışıyla doğrulandı.
- Ham atıfların 85/85’i yalnız basename kullandığı için depo köküne göre eksik/yanlış yolluydu.
- Düzenli sürümde 17 basename tam repo yoluna görünür D1 düzeltmesiyle genişletildi.
- Bulunamayan veya `DOĞRULANAMADI` kalan kod dosyası: 0.
- Doğrulama, 16.08.2026 tarihli HEAD `e3f006a30c5398264f8e36431bfc7b37685bf318` üzerinden yapıldı.
- Çalışma ağacındaki daha yeni, commit edilmemiş satır kaymaları araştırma snapshot’ının satır numarası hükmüne katılmadı.

## URL kalite kapısı

URL: 21/22, 6 tanesi açılarak sınandı, 6 tanesi iddiayı destekliyor.
- Ham metinde 20 benzersiz resmî dış URL vardır.
- Dış iddia birimi cümle/tablo satırı düzeyinde 22 olarak sayıldı.
- 21 iddianın yanında gerçek `https://` URL ve erişim tarihi vardır.
- Whimsical “arama metadata’sı 2024+” cümlesinde iddianın yanında metadata URL’si yoktur.
- Bu cümle düzenli sürümde `[URL YOK — karar kaydına giremez]` olarak işaretlendi ve gerekçeden çıkarıldı.
- Gamma URL’si açıldı; Generate/Paste/Import ve structured draft iddiasını destekliyor.
- v0 URL’si açıldı; doğal dil tanımından working application iddiasını destekliyor.
- Lovable Dashboard URL’si açıldı; prompt kutusunun merkezde, templates yolunun Resources altında olduğunu destekliyor.
- Lovable Getting Started URL’si açıldı; personal workspace ve prompt-before-signup iddialarını destekliyor.
- Claude MCP Quickstart URL’si açıldı; add/status/use, Bearer header ve HTTP hata ayrımlarını destekliyor.
- MCP 2026-07-28 URL’si açıldı; tek POST endpoint ve protocol-level session kaldırılmasını destekliyor.
- Miro URL’si bu tur `curl -L` ile 403 döndürdü; URL gerçek olsa da içeriği bu tur açılarak doğrulanamadı.

## Şemadaki sorular

1. Emsal empty state karşılaştırması: **yanıtlanmış**.
- Altı ürünün hepsi ele alınmış, zorunlu picker gibi kanıtlanamayan ayrıntılar temkinli yazılmış.
- Co-Pronoia için bir primary ve tam iki secondary eylem seçilmiş.
2. Prompt-first/template-first kararı: **yanıtlanmış**.
- Dört prompt-to-artifact ürünü karşılaştırılmış ve tek prompt-first hükmü verilmiş.
- No-key, timeout, malformed/no-op ve kayıt maliyeti fallback’leri ayrılmış.
3. `groupId` için 0/1/N davranışı: **yanıtlanmış**.
- API, Dashboard, store sırası, veri modeli ve provisioning noktaları birlikte incelenmiş.
- Otomatik workspace + koşullu selector kararı somutlaştırılmış.
4. Normal/MCP onboarding ayrımı: **yanıtlanmış**.
- Koddan gerçek config/secret/tool zinciri çıkarılmış, beş adımlı wizard ve typed diagnosis verilmiş.
5. Aktivasyon metrikleri: **yanıtlanmış**.
- MAIN_A10 ve MCP_A15 ayrı primary, üçer guardrail, event şeması ve retention verilmiş.
- Hedefler dış benchmark değil başlangıç hipotezi olarak etiketlenmiş.
6. Türkçe tek dil etkisi: **yanıtlanmış**.
- İnsan metni ile executable identifier ayrılmış, mikrocopy ve MVP scope verilmiş.

## En değerli 5 bulgu

1. Direct email verify ve yeni Google kayıt yolları Group yaratmıyor; `POST /api/canvases` ise `groupId` olmadan 400 veriyor.
2. Yeni grubun store başına eklenmesi ile backend’in eski üyeliği başa getirmesi, 2+ grupta varsayılan hedefi reload sonrası değiştirebilir.
3. Built-in AgentPanel aktif kanvas olmadan render edilmediği için prompt-to-plan değeri ilk kanvas öncesinde görünmüyor.
4. Gemini network/Abort hatası retry döngüsüne dönmüyor; HTTP 429/503 ise retry ediliyor, bu ayrım ürün fallback’i için önemlidir.
5. MCP `lastUsedAt` herhangi authenticated çağrıyı gösterir; `get_state` veya proposal başarısını kanıtlamaz.

## Yanlış ya da şüpheli 3 iddia

1. “Canvas yanlış workspace’e açılabilir” özünde mümkün, fakat kesin sonuç gibi ağır yazılmıştı.
- Kod, yalnız kullanıcı selector’ı değiştirmeden submit ederse varsayılanın farklılaşabileceğini kanıtlıyor.
- Sonuç yetkisiz yazma veya veri kaybı değil, amaçlanmayan fakat yetkili grupta yeni kanvas yaratılmasıdır.
2. Workspace bootstrap “davetle gelmemiş her yeni cloud kullanıcı” için P0 diye genellenmişti.
- Kod direct-signup 0-group cohort’unu doğruluyor; davet yoluyla grup/kanvas erişimi kazanan kullanıcı aynı anda bloke olmayabilir.
- P0 kapsamı “grupsuz direct-signup” olarak daraltıldı.
3. Miro’nun otomatik “My First Board” ve team seçimi iddiası gerçek URL taşıyor fakat bu tur içerikten doğrulanamadı.
- `curl` sonucu 403 olduğundan kaynak adı ve URL tek başına destek kanıtı sayılmadı.
- İddia silinmedi, “erişildiği doğrulanamadı” niteliğiyle karar ağırlığı düşürüldü.

## Şiddet kalibrasyonu

- Workspace bootstrap: işlevsel activation engeli; güvenlik olayı veya veri kaybı değildir.
- Çok-grup default: P0’dan P1’e indirildi; yanlış yetki değil, koşullu hedef seçimi problemidir.
- Prompt’un geç görünmesi: işlev bozukluğu değil, henüz ölçülmemiş activation/churn hipotezidir.
- First-prompt failure: mevcut grafı bozmaz; commit oluşmadan 503/502/metin yanıtı döner.
- MCP coarse presence: protokolü bozmaz; wizard başarısını yanlış ölçer ve tanıyı zayıflatır.
- Secret one-shot: geri döndürülemez veri kaybı değil; rotate + config update ile kurtarılır.
- Türkçe terim karışması: literal komut kopyalanırsa sınırlı; esas risk kullanıcı açıklamasında identifier’ın çevrilmesidir.

## 16 Ağustos gerçekliği kontrolü

- Ham onboarding yanıtı kapanmış bulgu 2’yi yeniden açık risk diye yazmıyor.
- `aiAllowed` kalkanı `shared/src/regionGuard.ts:77` ve `server/src/commitService.ts:460` ile kapalıdır.
- Kapanmış bulgu 12 atomik `alsoInTx` ile `server/src/commitService.ts:469-494` içinde mevcuttur.
- Kapanmış bulgu 14 için görünüm etiketleri `web/src/components/Chrome.tsx:10-14` ile düzeltilmiştir.
- Login oran sınırı committed snapshot’ta `server/src/authRoutes.ts:30-51,177` çevresinde vardır.
- Bu kapanmış maddeler onboarding risk puanını şişirmek için kullanılmadı.
- Parola/CAS/CI/update_brief/AuditLog açıkları onboarding sorularının kapsamına taşınmadı.

## Tamamlanma kararı

Bu başlık **tamamlandı**.
Bir tur daha gerekmiyor; kalan kararlar kod sorusu değil, cohort ve ürün hipotezi ölçümüdür.
Yeni tur açılacaksa tek soru: “Direct-signup ile davet cohort’unda ilk 10 dakikalık MAIN_A10 oranı nasıl ayrışıyor?”
