# 01 — Çekirdek mimari ve eşzamanlılık, ikinci tur değerlendirmesi

## Hüküm

**Puan: 9/10.** Birinci turdaki doğru teşhisleri uygulanabilir veri modeli, yarış matrisi, dağıtım protokolü, yük testi ve sayısal kabul kapılarına dönüştürüyor; küçük kaynak-atıf nüansları dışında takip görevi güçlü biçimde kapanmış.

## Takip isteklerinin karşılanma durumu

### 1. Snapshot ve kapasite planı — Karşılandı

- `CanvasSnapshot` için epoch, snapshot şeması, projection ve event sürümünü ayıran somut Prisma modeli verildi.
- Snapshot üretiminin pahalı kısmını write transaction dışında tutan akış ile seçim, quarantine, fallback ve iki modlu `rebuildCheck` tarif edildi.
- `stateAt`, `stateDelta`, `branchState` ve `rebuildCheck` değişiklikleri gerçek kod satırlarına bağlandı; 10k/100k/1M benchmarkları, p50/p95/p99 SLO'ları, tetikleyiciler ve 50k hot-history GC politikası sağlandı.

### 2. Event sürümleme ve mixed deploy — Karşılandı

- Top-level array'i bozmayan op-level `v` ve row-level `eventVersion` geçişi; beş mevcut `JSON.parse` noktasıyla gerekçelendirildi.
- v0→v1 decoder/upcaster hattı, fail-closed kuralları ve unknown-future-version davranışı açıklandı.
- Read-new/write-new blue/green protokolü, rollback readiness gate'i ve snapshot invalidation matrisi; hatalı reader/writer için ayrı rebuild prosedürleri, on iki CI vakası ve kabul kriterleri verildi.

### 3. pendingBaseSeq ve three-way merge — Karşılandı

- İstemci base'ini dondurmanın yanında stale server yolunun B/M/U state karşılaştırmasına geçmesi gerektiği gösterildi.
- Update/delete, convergent edit, ayrık alan, data anahtarı, move, edge ve branch-main yarışları için karar matrisi verildi.
- `pendingBaseSeq` yaşam döngüsü ve wholesale merge'in three-way merge'e dönüşümü gerçek dosya:satırlara bağlandı.
- Yeni çift-merge penceresi saptandı: merge commit'i ile branch kapanışı ayrı transaction'larda.
- Atomic/idempotent merge, expected heads, merge token, HTTP sözleşmesi, preview UI ve test listesi tamamlandı.

### 4. Auto-branch UX telemetry ve deney — Karşılandı

- İçerik taşımayan event/attribute şeması ile branch oranı, yaş, resolution, abandonment, overwrite ve return ölçümleri tanımlandı.
- Web ve server enstrümantasyon noktaları gerçek dosya:satırlarla eşleştirildi.
- Auto-branch, reject+rebase ve field-resolution için canvas-bazlı üç kollu deney verildi.
- Karar eşikleri sayısallaştırıldı ve bunların evrensel standart değil başlangıç gate'i olduğu açıkça belirtildi.

### 5. Yazma yolu doygunluğu — Karşılandı

- Tek-op commit için yaklaşık 13 sorguluk yol, lock süresi formülü ve teorik canvas throughput tablosu çıkarıldı.
- 1k/10k/100k node × 1/10/50 writer yük matrisi; karışım, süre, burst ve ölçümler tanımlandı.
- p95/p99, retry, queue depth ve sustained ihlal süresine dayalı migration eşikleri verildi.
- `lastSeqGlobal`/`mainHeadSeq` ayrımı ile lock, OCC, queue ve single-writer seçenekleri karşılaştırıldı.

### 6. Retention, PII ve audit — Karşılandı

- PII taşıyabilecek Node, Edge, Commit ve Branch alanları ile before/after çoğaltması koddan envanterlendi; mevcut garantinin hash-chain değil replay/materialization consistency olduğu doğru ayrıştırıldı.
- Redaction, hard delete, rewrite, key destruction, archive ve full delete garanti matrisi verildi.
- Rewrite + `historyEpoch` + `ErasureManifest`, backup `ErasureLedger` gate'i ve ölçülebilir SLA'lar somutlaştırıldı.
- 2025–2026 KVKK, EDPB, NIST ve KurrentDB birincil/resmî kaynakları kullanıldı.

## Birinci tura göre gerçekten yeni bilgi

- Event, snapshot şeması, projection ve history epoch olmak üzere dört ayrı sürüm ekseni.
- Epoch re-check'li snapshot transaction'ı, quarantine/fallback zinciri ve route bazlı kapasite planı.
- Array biçimini koruyan mixed-fleet event geçişi; READ_MAX ile WRITE_EVENT_VERSION'ın ayrılması.
- Değer-duyarlı B/M/U classifier; convergent editler, `data.<key>` granülerliği ve position gesture kararı.
- Merge commit ile branch status update arasındaki crash/çift-merge penceresi.
- Atomic/idempotent merge sözleşmesi; expected head, mergeToken ve preview fingerprint yaklaşımı.
- PII'siz auto-branch telemetry sözlüğü, üç kollu deney ve sayısal karar eşikleri.
- Write path'in N+12 sorgu modeli, iki counter düzeltmesi ve mimari geçiş tetikleyicileri.
- `historyEpoch`/`ErasureManifest` ile yeniden kökleme ve backup restore için ErasureLedger gate'i.

## Birinci turdan tekrar edilenler

- Snapshot'ın authority değil cache olduğu ve full replay oracle'ının korunması ilk turda vardı.
- `pendingBaseSeq`, wholesale merge, event version ihtiyacı ve lock altında full graph load ana teşhisleri ilk turdan tekrarlandı.
- Redaction event'in fiziksel silme olmadığı ve CRDT dönüşümünün bugün öncelik olmadığı sonuçları yeni değil.
- Tekrarlar gerekli bağlam olarak tutulmuş ve bu turda uygulama ayrıntılarıyla ileri taşınmış.

## Kod atıflarının doğruluğu hakkında izlenim

- Kontrol edilen `commitService.ts`, `graphStore.ts`, `applyIntents.ts`, `types.ts`, `ops.ts`, test ve Prisma satırları iddiaları destekliyor.
- Sources zip'indeki `db/prisma/schema.prisma` gerçek bundle yoludur; çalışma reposunda karşılığının `server/prisma/schema.prisma` olması uydurma atıf değildir.
- Wholesale merge, ayrı branch update transaction'ı, beş JSON parse noktası, lock altında ikinci graph load ve güncel `headSeq` ile push doğru saptanmış.
- Şüpheli nüans: EDPB encryption/key erişimini ve erasure zorluğunu destekliyor; “key deletion ciphertext'i unreadable yapar” ifadesi doğrudan EDPB yerine NIST crypto-erase desteğiyle kurulmalıydı.
- URL ve sürümler sonda verilmiş; her dış iddianın hemen yanında doğrudan URL şartı birebir uygulanmamış, bazı yerlerde UI citation etiketi kalmış.
- SLO/eşiklerin Co-Pronoia başlangıç önerisi diye etiketlenmesi, kaynak sonucu gibi sunulmaması olumlu.

## Tamamlanma kararı

**Bu başlık tamamlandı sayılabilir.** Üçüncü tur zorunlu değil; kalan belirsizlikler araştırma eksiği değil, benchmark ve production telemetry çalıştırılınca elde edilecek ölçümlerdir.
