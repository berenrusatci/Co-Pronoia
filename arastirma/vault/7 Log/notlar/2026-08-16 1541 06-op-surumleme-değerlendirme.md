---
tags:
  - log/not
  - rol/duzenleyici-1
rol: duzenleyici-1
model: gpt-5.6-sol
konu: 06-op-surumleme değerlendirme
tur: not
zaman: 2026-08-16T15:41:36
karakter: 6364
ham: false
---

# 06-op-surumleme değerlendirmesi

Hüküm: 8/10 — Karar, migration sırası ve URL disiplini güçlü; fakat 43 atıf eksik/yanlış yollu ve null-konum inverse semantiği kodun gerçek UI davranışına aykırı yorumlanmış.

## Kod-dayalılık

Ham yanıtta 49 açık `dosya:satır` atfı sayıldı.
49 atfın tamamındaki dosya ve satır aralığı gerçek depoda bulundu.
6 atıf baştan doğru tam yol taşıyordu.
43 atıf yanlış ya da eksik yol taşıyordu; bunların tümü gerçek yola çözüldü.
En sık düzeltme `commitService.ts` → `server/src/commitService.ts` oldu.
`db/prisma/schema.prisma` yolu yanlıştı; doğrusu `server/prisma/schema.prisma`.
Bare `ops.ts`, `ops.test.ts`, `regionGuard.ts` ve `commitService.test.ts` atıfları gerçek dizinleriyle tamamlandı.
Atıfların içerik desteği 48/49'dur.
Bir atıf, `shared/src/ops.ts:115-121` içindeki yorumu doğru aktarsa da daha geniş iddiayı desteklemez.
`web/src/views/FlowView.tsx:21-23,51-57`, null konum ile 0,0'ın görsel olarak eşdeğer olmadığını gösterir.
Kod örneklemesi yalnız satır varlığıyla sınırlı tutulmadı; ilişkili çağrı ve UI tüketicileri de okundu.
`shared/src/ops.ts:34-53` eski add_node alanlarını gerçekten canonical defaultlara çeviriyor: doğru.
`server/src/commitService.ts:118,131,170,176,267` beş ayrı ham ops parse noktasıdır: doğru.
`server/src/commitService.ts:658-665` mutable alanları elle sayıyor: doğru ve koşullu gelecek riski.
`server/src/commitService.ts:542-550` yalnız replay/cache eşitliği sınar: doğru; tarihsel immutability kanıtı değildir.
`server/prisma/schema.prisma:263-277` Commit.ops alanının String olduğunu gösterir: doğru.
`shared/src/ops.test.ts:10-33` metadata'yı karşılaştırmadan çıkarır: doğru.
İlgili testler çalıştırıldı: shared ops 10/10, server commitService 36/36 geçti.

URL: 30/30, 7 tanesi açılarak sınandı, 7 tanesi iddiayı destekliyor.
URL sayımında atomik ürün/taksonomi önermeleri esas alındı; kaynak listesinin tekrarı yeni iddia sayılmadı.
Ham yanıtta URL'siz dış iddia bulunmadı.
Tüm dış iddialar için 16.08.2026 erişim tarihi ya doğrudan yanında ya da toplu kaynak tarihi olarak verildi.
Açılan Axon 4.12 sayfası revision, chain ve zero-or-more upcast iddiasını destekledi.
Açılan Marten versioning sayfası nullable yeni property ve read-time upcast iddiasını destekledi.
Açılan Marten copy-and-transform sayfası yeni stream, moved işareti ve expected-version korumasını destekledi.
Açılan Marten compacting ve protection sayfaları özel lifecycle/rewrite ile backup bağlamını destekledi.
Açılan Avro 1.12 specification defaults ve aliases iddiasını destekledi.
Açılan Protobuf best-practices sayfası reserve/type/default önerilerini destekledi.

## Şemadaki altı soru

Soru 1 — Yanıtlanmış: beş desen karşılaştırılmış, Young taksonomisi altı op türüne ve değişiklik sınıflarına eşlenmiş.
Soru 2 — Yanıtlanmış ama bir kritik düzeltmeyle: canonical-current inverse kararı iyi; null→0,0 için semantic identity hükmü yanlış.
Soru 3 — Yanıtlanmış: rewrite sınırı, major epoch hükmü, Marten emsalleri, backup/export/dry-run ve rollback verilmiş.
Soru 4 — Yanıtlanmış: (a)/(b)/(c), S/M efor, eşik, projeksiyon, tercih ve vazgeçilen alternatif açık.
Soru 5 — Yanıtlanmış: exhaustive switch/descriptor, frozen v0 fixture ve server integration kapısı ölçülebilir biçimde tasarlanmış.
Soru 6 — Yanıtlanmış: üç aşama, rollback, en eski v0, fail-closed ve sayısal release kriterleri verilmiş; rewrite açıkça önerilmemiş.
Çıktı biçimi büyük ölçüde karşılanmış; yönetici özeti hedef uzunluğa yakın ve zorunlu altı başlık mevcut.
Önerilerde S/M/L, yapılmazsa sonuç ve otomatik kabul ölçütü genel olarak bulunuyor.

## En değerli 5 bulgu

1. Persisted ops beş ayrı yerde ham parse ediliyor; decoder yalnız replay'e eklenirse summary ve conflict hâlâ legacy semantik görür.
2. `diffStates` ayrı bir schema-evolution yüzeyidir; yeni mutable alan descriptor/list güncellenmeden restore ve branch merge'e taşınmaz.
3. `rebuildCheck` consistency oracle'dır, tarihsel immutability veya audit oracle'ı değildir.
4. Melez eşik uygulanabilirdir: sabit-default additif alan aynı v, rename/tür/anlam/split-merge sürüm artışı.
5. Düzenleme turundaki yeni bulgu: null başlangıçlı move revert'i fallback grid yerine 0,0 üretir ve UI'da görünür biçimde farklıdır.

## Yanlış ya da şüpheli 3 iddia

1. “Null ile 0,0 FlowView'da indistinguishable” yanlıştır; FlowView null için index tabanlı fallback grid, 0,0 için gerçek orijin kullanır.
2. “SemanticGraph inverse identity korunuyor” genellemesi yanlıştır; test null başlangıçlı move'u kapsamaz ve bu vaka konumsal state'i geri getirmez.
3. “In-place rewrite yüksek bugünkü risk” şiddetçe abartılıdır; etkisi yüksek olsa da depoda normal Commit.ops rewrite yolu bulunmadı, dolayısıyla bugünkü olasılık düşüktür.
Ek şüphe: additive v1'in eski binary tarafından tolere edilmesi makul repo çıkarımıdır, entegrasyon testi olmadan garanti değildir.
Ek kalibrasyon: rename/conflict ve unknown-v bulguları aktif hata değil, breaking değişiklik/rolling rollback koşuluna bağlı risklerdir.

## 16 Ağustos durumuyla çapraz kontrol

Ham yanıt bu turun konusu dışındaki aiAllowed, login, parola, CAS, CI, update_brief ve AuditLog bulgularını yeniden raporlamıyor.
Bu nedenle kapalı bulgu 2/12/14 ve login oran sınırı hakkında eski hüküm taşımıyor; düzeltilecek tekrar yok.
İlgili mevcut kodda aiAllowed kalkanı `shared/src/regionGuard.ts:77-127` ve `server/src/commitService.ts:460-465` içinde görülüyor.
Atomik branch kapanışı `server/src/commitService.ts:469-494` içinde görülüyor.
Chrome etiketleri `web/src/components/Chrome.tsx:10-15` içinde görülüyor.
Login oran sınırı `server/src/authRoutes.ts:20-36,68-85,242-243` içinde görülüyor.
Commit edilmiş 16 Ağustos tabanında parola alt sınırı hâlâ 4'tür (`authRoutes.ts:81,209`); dirty worktree'de bunu 8'e çıkaran kullanıcı değişiklikleri vardır, fakat commit edilmediği için bulgu kapanmış sayılmadı.
Depoda `.github/workflows/docker.yml` var; bu imaj build/push otomasyonudur fakat test kapısı değildir, “CI yok” ifadesi bu dar anlamda hâlâ savunulabilir.
CAS, update_brief ve AuditLog bu op-sürümleme yanıtının kapsamına girmediği için puana dahil edilmedi.

## Tamamlanma kararı

Bu başlık araştırma/ADR kararı için tamamlandı.
Bir tur daha dış kaynak araştırması gerekmiyor; URL kapısı bu turda geçti.
Uygulamaya geçilecekse ayrı iş olarak önce null-move ürün kararı ve frozen v0 fixture hazırlanmalı.
TAMAMLANDI: evet.
