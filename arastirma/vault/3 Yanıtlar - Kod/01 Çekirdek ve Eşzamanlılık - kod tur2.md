---
tags:
  - arastirma/yanit
  - kaynak/kod
  - baslik/01
baslik: Çekirdek ve Eşzamanlılık
tur: kod
tur_no: 2
kelime: 7467
kaynak: 01-cekirdek-tur2.md
---
> [!abstract] Aynı sohbette 2. tur derinleştirme
> 1. tur: [[01 Çekirdek ve Eşzamanlılık - kod]]

Aşağıdaki turda önceki sonucu tekrar etmiyorum; doğrudan eksik kalan uygulanabilirlik katmanını kapatıyorum. Sayısal latency/kapasite değerlerini ikiye ayırıyorum: dış kaynaklardan gelen davranış garantileri ile Co-Pronoia için önerdiğim mühendislik SLO/gate değerleri. İkinciler endüstri standardı değil; benchmark sonucunda revize edilmek üzere başlangıç kabul kriterleridir.

Ayrıca gerçek kodu tekrar kontrol ettim. Özellikle bir ek correctness problemi kesin: mevcut mergeBranch() merge commit’ini yazıyor, sonra ayrı transaction’da branch’i merged yapıyor. Process iki adım arasında düşerse veya iki instance aynı branch’i aynı anda merge ederse ikinci merge commit’i üretme penceresi var: server/src/commitService.ts:196-213.

1. Snapshot sistemi: kapasite planına dönüşmüş tasarım

Axon Framework 5.2 snapshot’ı açıkça bir performans cache’i olarak tanımlıyor: snapshot kullanılamıyorsa olaylardan reconstruction güvenli fallback olmaya devam ediyor; snapshot policy event-count veya sourcing-time gibi koşullara bağlanabiliyor. Bu model Co-Pronoia’nın “Commit asıl kaynak, materialization/snapshot türev” ilkesine doğrudan uyuyor. Kaynak: Axon Framework 5.2, güncel 2025+ dokümantasyon, erişim 15.08.2026: Snapshotting
 ve Snapshot tuning
. 
docs.axoniq.io
+1

1.1 Önerilen snapshot veri modeli

Mevcut Canvas modelinde snapshot/counter/epoch yok: db/prisma/schema.prisma:54-76. Commit yalnız seq, message, ops String, author ve branch metadata tutuyor: db/prisma/schema.prisma:263-277.

İlk sürümde snapshot’ı ayrı tabloda tutardım:

prisma
model CanvasSnapshot {
  id                    String   @id @default(cuid())
  canvasId              String
  canvas                Canvas   @relation(fields: [canvasId], references: [id], onDelete: Cascade)


  // Bu snapshot'ın temsil ettiği son MAIN commit seq'si.
  seq                   Int


  // Destructive history rewrite/retention sonrası nesil.
  historyEpoch          Int


  // Snapshot byte formatı.
  snapshotSchemaVersion Int


  // apply/upcast/projection semantiği.
  projectionVersion     Int


  // Tanısal: snapshot'a kadar görülen en yüksek event sürümü.
  maxEventVersion       Int


  codec                 String   // ör. "json+gzip"
  payload               Bytes


  // Canonical, uncompressed GraphState hash'i.
  stateHash             String


  nodeCount             Int
  edgeCount             Int
  rawBytes              Int
  storedBytes           Int


  verifiedAt            DateTime?
  createdAt             DateTime @default(now())


  @@unique([
    canvasId,
    seq,
    historyEpoch,
    snapshotSchemaVersion,
    projectionVersion
  ])
  @@index([canvasId, historyEpoch, seq])
}

Canvasa da en az:

prisma
historyEpoch Int @default(1)
snapshots    CanvasSnapshot[]

eklenmeli.

Buradaki önemli ayrım:

eventVersion: diskteki op formatı,

snapshotSchemaVersion: snapshot byte/layout formatı,

projectionVersion: aynı event’in hangi semantikle state’e çevrildiği,

historyEpoch: geçmiş destructive rewrite gördü mü?

Bunları tek version alanına sıkıştırmak rollback ve invalidation işini zorlaştırır.

stateHash bir corruption/equivalence checksum olur; mevcut sistemde Commit hash-chain olmadığı için bunu “tamper-proof audit hash” diye sunmamak gerekir.

Öneri — Snapshot metadata katmanı: M efor.
Yapılmazsa: snapshot formatı, event dönüşümü ve destructive history rewrite aynı “version” kavramına karışır; hatalı upcaster sonrası hangi snapshot’ın güvenli olduğu ayırt edilemez.
Kabul kriteri: aynı canvas için iki farklı projectionVersion snapshot’ı birlikte saklanabilmeli; reader yalnız uyumlu olanı seçmeli; yanlış epoch/projection snapshot’ı kullanan integration test sayısı 0 olmalı.

1.2 Snapshot oluşturma transaction’ı

Snapshot üretirken pahalı replay ve compression’ı Canvas write lock altında yapmamak gerekir.

Önerilen akış:

Canvas.historyEpoch = e ve o anki main head = h okunur.

seq <= h olan en yeni doğrulanmış uyumlu snapshot seçilir.

Snapshot + h'ye kadarki main tail replay edilir.

Node ve edge’ler ID’ye göre sıralanıp canonical JSON oluşturulur.

stateHash hesaplanır ve payload sıkıştırılır.

Bunların tamamı normal write transaction dışında yapılır.

Kısa transaction açılır.

historyEpoch tekrar okunur.

Epoch değişmişse oluşturulan snapshot atılır/retry edilir.

Epoch aynıysa (canvasId,h,e,versions...) unique anahtarıyla snapshot insert edilir.

Eşzamanlı normal commit’ler h+... üretmiş olabilir; bu snapshot’ı bozmaz. Snapshot yalnız h state’ini temsil eder.

Eğer h hâlâ current main head ise snapshot sonucu materialized Node/Edge ile ayrıca karşılaştırılıp verifiedAt set edilir.

Böylece snapshot oluşturmak normal edit transaction’ının lock süresine compression/replay eklemez.

Mevcut kodda bunun doğal yerleşim noktası replayGraph() çevresidir: server/src/commitService.ts:158-173. Bugün bu fonksiyon her seferinde emptyGraph() ile başlıyor (:159), bütün main commit’lerini çekiyor (:160-164) ve branch varsa ikinci stream’i oynatıyor (:165-170).

Öneri — Snapshot üretimini async/background yap: M efor.
Yapılmazsa: snapshot oluşturma performans çözümü olurken write-lock latency’sini yükselten yeni problem haline gelebilir.
Kabul kriteri: snapshot oluşturulurken commit p95 latency’sinde kontrol grubuna göre >10 ms veya >5%, hangisi büyükse, regresyon olmamalı; snapshot işi write transaction’ında CPU compression yapmamalı.

1.3 Snapshot seçim ve fallback algoritması

stateAt(target) için seçim:

target = istenen main seq


1. Canvas.historyEpoch oku.
2. snapshot WHERE
     canvasId = ?
     historyEpoch = current
     seq <= target
   ORDER BY seq DESC
3. Sırayla:
   a. snapshotSchemaVersion destekleniyor mu?
   b. projectionVersion == CURRENT_PROJECTION_VERSION mı?
   c. decompress başarılı mı?
   d. stateHash doğru mu?
   e. structural decode başarılı mı?
4. İlk geçerli snapshot'tan başla.
5. snap.seq < main.seq <= target event'lerini replay et.
6. Hiçbiri geçmezse emptyGraph() + full replay.
7. Tail'de bilinmeyen eventVersion varsa FAIL CLOSED.

Snapshot bozuksa request’i hemen bozmak yerine bir önceki snapshot’a düşmek doğru; event stream bozuk/gelecek sürüm ise farklıdır, orada sessiz fallback/skip yapılmamalıdır.

Uyumluluk matrisi:

Snapshot durumu	Event tail	Karar
epoch aynı, snapshot schema destekli, projection aynı	bilinen event sürümleri	Kullan
snapshot schema eski ama decoder destekli, projection aynı	bilinen	Kullan
snapshot schema bilinmiyor	bilinen	Önceki snapshot → yoksa full replay
projection farklı	bilinen	Snapshot’ı kullanma, eventlerden rebuild
history epoch farklı	herhangi	Snapshot kesinlikle kullanma
hash bozuk	bilinen	Snapshot quarantine + önceki snapshot
snapshot doğru	tail’de future event version	Fail closed, olay atlama yok
hiçbir snapshot yok	bilinen	Full replay

Axon 5.2’nin “snapshot kullanılamıyorsa events’den güvenli fallback” yaklaşımı bu ayrımı destekliyor. 
docs.axoniq.io

1.4 Mevcut dört replay yoluna kesin kod değişikliği
stateAt

Bugün:

server/src/commitService.ts:129-133

stateAt → replayGraph(seq) → empty + bütün geçmiş

Yeni:

stateAt
  → replayMainAt(seq)
      → loadBestSnapshot(seq)
      → decode snapshot
      → replayMainTail(snapshot.seq, seq)

replayGraph() iki ayrı primitive’e ayrılmalı:

replayMainAt(targetSeq)
replayBranchAt(branchId, branchBase, targetBranchSeq)
stateDelta

Bugün:

server/src/commitService.ts:141-155

current=getState() ile materialized state alınırken previous=stateAt(sinceSeq) full replay olabiliyor.

Değişiklik yalnız stateAt() snapshot-aware olduğunda otomatik kazanılır. Ayrıca telemetry için:

replay_events
replay_bytes
snapshot_seq
snapshot_hit

dönüş zincirine eklenmeli.

branchState

Bugün:

server/src/commitService.ts:189-193

şunu yapıyor:

main empty → branch.baseSeq
+
branch'in bütün commitleri

Yeni:

best main snapshot <= branch.baseSeq
+
main tail → baseSeq
+
branch commits

İlk aşamada branch snapshot tutmazdım. Branch başına commit sayısı da telemetry’de büyürse ayrıca değerlendirilir.

rebuildCheck

Bugün:

server/src/commitService.ts:506-514

full stateAt(head) ile materialized state kıyaslıyor.

İki moda ayrılmalı:

rebuildCheck("fast")
  latest verified snapshot + tail
  == materialized state


rebuildCheck("full")
  empty + bütün main commits
  == materialized state

Üçüncü background invariant:

snapshot(A)
  + events A..B
  == snapshot(B)

full oracle CI/test ve periyodik bakım işinde kalmaya devam etmeli. Snapshot yüzünden full replay testini kaldırmak yanlış olur.

Öneri — stateAt/stateDelta/branchState snapshot-aware, rebuildCheck çift mod: M efor.
Yapılmazsa: snapshot eklenir ama en pahalı yolların bazıları hâlâ full replay eder veya oracle snapshot’ın kendisini doğrulamayı bırakır.
Kabul kriteri: snapshot açık/kapalı aynı fixture üzerinde stateAt, stateDelta, branchState byte-equivalent canonical state üretmeli; CI’da en az bir test empty → bütün history == materialized == snapshot+tail eşitliğini doğrulamalı.

1.5 10k / 100k / 1M benchmark veri seti

Co-Pronoia’da bir Commit birden fazla Op taşıdığı için aşağıdaki “event sayısı”nı Commit row sayısı olarak tanımlıyorum. Ayrıca ops/commit ayrı kaydedilmeli.

Üç payload profili oluşturun:

Profil	Ortalama Commit.ops	Örnek
Small	0.75 KiB	tek move/scalar update
Normal	2 KiB	3–5 op
Heavy	8 KiB	subtree/delete veya staged batch

Yalnız ops logical payload boyutu:

Commit sayısı	0.75 KiB	2 KiB	8 KiB
10k	7.3 MiB	19.5 MiB	78.1 MiB
100k	73.2 MiB	195.3 MiB	781.3 MiB
1M	732 MiB	1.91 GiB	7.63 GiB

Buna PostgreSQL row overhead, indexes, TOAST, WAL, replica ve backup maliyeti dahil değil.

History benchmark’ında graph boyutunu ilk etapta 1.000 node / ~1.500 edge’de sabit tutarım; aksi halde event-history maliyeti ile graph-size maliyetini birbirinden ayıramazsınız. Graph-size testi bölüm 5’te ayrıca var.

Çalıştırılacak replay senaryoları
Senaryo	Açıklama
A	stateAt(head) — snapshot kapalı, cold DB cache
B	stateAt(head) — snapshot açık, cold cache
C	stateAt(head-2500) — historical target
D	stateDelta(head-2500)
E	branchState: base=head−5000, branch=100 commit
F	rebuildCheck("fast")
G	rebuildCheck("full")
H	Bozuk latest snapshot → previous snapshot fallback
I	Unsupported snapshot version → full replay
J	Unknown future event version → fail-closed latency

Her kombinasyon warm ve cold cache’de çalışmalı. Interactive path için en az 1000 örnek, full 1M replay gibi pahalı oracle testlerinde en az 50 tekrar + dağılım/raw samples saklanmalı; 50 örnekle gerçek p99 istatistiksel olarak zayıf olduğu için burada “p99” yerine ayrıca max değer raporlanmalıdır.

1.6 Route bazlı SLO ve mimari tetikleyiciler

Bunlar Co-Pronoia başlangıç SLO’larıdır, dış kaynak standardı değildir.

Yol	p50	p95	p99	İhlalde karar
stateAt interactive	≤75 ms	≤200 ms	≤500 ms	Snapshot interval küçült
stateDelta	≤100 ms	≤250 ms	≤750 ms	Snapshot + delta projection optimize
branchState	≤100 ms	≤300 ms	≤1 s	Main snapshot + branch cache
rebuildCheck(fast)	≤500 ms	≤2 s	≤5 s	Snapshot/tail IO incele
Normal current getState	≤75 ms	≤150 ms	≤400 ms	Event snapshot değil materialized graph sorgusu optimize

Full-oracle için interactive SLO değil recovery/maintenance bütçesi:

History	Full replay p50	p95	p99	Karar
10k	≤0.5 s	≤2 s	≤3 s	Aşılırsa event decoder/apply profil çıkar
100k	≤4 s	≤15 s	≤25 s	HTTP full replay yasak; snapshot zorunlu
1M	≤30 s	≤120 s	≤180 s	Full replay yalnız background/recovery

Ek karar eşikleri:

Snapshot tail replay p95 >100 ms veya snapshot sonrası ortalama tail >5.000 commit → interval düşür.

Snapshot decode+decompress p95 >50 ms → codec/payload formatını optimize et.

Tek snapshot storedBytes >64 MiB → whole-document snapshot yerine segmented snapshot/object storage deneyi başlat.

Snapshot toplam storage bir canvas’ın current-state serialized boyutunun 5×’ini geçiyorsa historical GC devreye girsin.

1M history’de full rebuild p95 >5 dakika ise recovery modelini “full history first” varsayımından çıkar; disaster recovery snapshot+tail bootstrap’i resmi RTO yolu yap.

1.7 Snapshot saklama ve GC

Snapshot event değildir; silinmesi audit kaybetmez.

Önerilen başlangıç politikası:

Son 50k main commit:
    adaptive interval ile bütün verified snapshot'ları tut


50k'dan eski:
    her 50k commit için 1 historical anchor


Her zaman:
    en yeni 3 current-version verified snapshot


Rollback:
    önceki projection/snapshot version'ın son 2 anchor'ı
    7 gün veya 2 release boyunca


Corrupt/suspect:
    query yolundan hemen çıkar
    72 saat forensic quarantine

Önemli trade-off: “herhangi bir 700.000 commit eski state’e daima <200 ms erişim” ürün gereksinimi olursa full-state snapshot GC ile depolama maliyeti çatışır. O noktada sadece snapshot aralığını küçültmek yerine persistent historical projection/segmented state gerekir.

Öneri — 50k hot-history + sparse old anchors GC: S/M efor.
Yapılmazsa: 1M history’de her 1k commit snapshot almak yüzlerce büyük full-state blob biriktirebilir.
Kabul kriteri: snapshot disk kullanımı current graph serialized boyutunun ≤5× hedefinde kalmalı; son 50k commit içindeki stateAt p95 ≤200 ms olmalı; GC sonrası rebuildCheck(full) değişmemeli.

2. Event schema evolution: mixed deploy + rollback dahil

Axon Framework 5.2 eski serialized event’in yerinde kalıp okuma/handling sırasında dönüştürülmesini destekliyor; basit uyumluluklarda payload conversion, yapısal değişikliklerde upcasting kullanılıyor. 5.2 migration dokümanı tek-event upcast dönüşümlerini de açıkça tanımlıyor. Kaynaklar: Event Versioning
 ve Upcaster Migration
, v5.2, erişim 15.08.2026. 
docs.axoniq.io
+1

2.1 Mevcut formatı kırmadan v0→v1

Şu an persisted biçim:

JSON
[
  {
    "op": "add_node",
    "node": {
      "id": "old",
      "title": "Eski"
    }
  }
]

Commit.ops String: db/prisma/schema.prisma:263-277.

Doğrudan şu envelope’a geçmek:

JSON
{"v":1,"ops":[...]}

blue/green sırasında eski sunucuyu kırar, çünkü mevcut kod JSON.parse(row.ops) sonucunu array bekliyor:

server/src/commitService.ts:112

server/src/commitService.ts:125

server/src/commitService.ts:164

server/src/commitService.ts:170

server/src/commitService.ts:257

Bu nedenle ilk geçişte formatı array tutup sürümü op üzerinde additive metadata olarak taşımak daha güvenli:

JSON
[
  {
    "v": 1,
    "op": "add_node",
    "node": { ... }
  }
]

Eski runtime switch’i yalnız op.op alanına bakıyor; ekstra v property’sini runtime’da önemsemiyor. Bu, yalnız v1’in semantiği eski reader ile uyumlu olduğu sürece güvenlidir.

DB’ye ayrıca:

prisma
eventVersion Int @default(0)

eklenmeli:

db/prisma/schema.prisma:263-277.

Bu row-level hızlı compatibility/readiness kontrolü sağlar.

2.2 v0→v1 gerçek dönüşümü

Bugünkü legacy normalization zaten burada:

shared/src/ops.ts:41-53.

Eski add_node için:

linkedCanvasId ?? null

notes ?? ''

url ?? ''

urlBy ?? null

normalizeData(data)

yapılıyor.

Bu işi applyOp()tan çıkarıp codec/upcaster katmanına toplamak gerekir:

raw String
   ↓
JSON parse
   ↓
StoredOp version detect
   ↓
validate v0
   ↓
upcastV0ToV1
   ↓
validate canonical v1
   ↓
Op
   ↓
applyOp

Örneğin:

TypeScript
type StoredOpV1 = Op & { v: 1 };


function upcastV0ToV1(raw: unknown): StoredOpV1 {
  // discriminator bazında
  // add/delete node snapshot'larında yeni alanları canonical default'a tamamla
  // data varsa normalize et
}

Mevcut regression fixture doğrudan bu test için kullanılabilir:

shared/src/ops.test.ts:54-67.

Şu an test legacy JSON’u as Op cast edip applyOp()un toleransına güveniyor. Yeni test bunun yerine:

decodeStoredOps(legacyJson, 0)
→ canonical v1
→ applyOp()

yapmalı.

shared/src/types.ts:57-63 içindeki runtime-domain Op tipine v eklemek zorunda değilsiniz. Daha temiz ayrım:

StoredOpV0 / StoredOpV1 = persistence boundary
Op                    = current canonical domain
2.3 Decoder doğrulaması

Shared katmanın “zero runtime dependency” özelliğini korumak istiyorsanız validation elle yapılabilir.

decodeStoredOps(raw,rowVersion) aşağıdakileri fail-closed kontrol etmeli:

JSON parse başarılı mı?

top-level array mi?

her element object mi?

v yoksa 0,

v integer mı?

v <= MAX_READ_EVENT_VERSION mı?

op tanınan altı discriminator’dan biri mi?

id/source/target alanları string mi?

enum alanları geçerli mi?

move x/y finite number mı?

before/after beklenen field tipleriyle uyuşuyor mu?

data canonical Record<string,string>e dönüştürülebiliyor mu?

row eventVersion, array içindeki maksimum sürümle uyumlu mu?

Aynı version içindeki bilinmeyen ekstra alanları tolerant reader yaklaşımıyla görmezden gelebilirsiniz; ancak bilinmeyen version atlanmamalı.

Future event:

DB max eventVersion = 2
server MAX_READ_EVENT_VERSION = 1

ise:

UnsupportedEventVersion

üretmeli.

Asla:

"tanımıyorum → skip → devam et"

yapılmamalı. Event atlamak state’i sessizce yanlış hale getirir.

Öneri — Tek decoder choke-point: M efor.
Yapılmazsa: bugün beş ayrı JSON.parse noktası zaman içinde farklı legacy davranışları geliştirir.
Kabul kriteri: server/src/commitService.ts içinde persisted ops için çıplak JSON.parse(row.ops) kullanımı 0; malformed/unknown version testleri yanlış state üretmek yerine deterministik hata vermeli.

2.4 Kodda kesin değişiklik noktaları
shared/src/types.ts

Mevcut domain tipleri:

shared/src/types.ts:42-63.

Yeni persistence tiplerini tercihen yeni shared/src/eventCodec.ts dosyasına koyun; Op burada canonical kalsın.

shared/src/ops.ts

Legacy persistence normalization:

shared/src/ops.ts:41-53

buradan zamanla kaldırılıp codec’e taşınmalı. Geçiş döneminde defense-in-depth olarak kalabilir; fakat yeni legacy case’ler artık buraya eklenmemeli.

server/src/commitService.ts

Decode değişecek satırlar:

104-113

116-126

158-170

254-257

Write değişecek satırlar:

branch write 319-323

main write 445-458

Yani:

JSON.stringify(branchOps)

ve

JSON.stringify(ops)

yerine:

encodeStoredOps(ops, WRITE_EVENT_VERSION)

kullanılmalı.

Prisma

db/prisma/schema.prisma:263-277:

prisma
eventVersion Int @default(0)
Testler

shared/src/ops.test.ts:54-99 mevcut legacy/data testlerinin yanına codec test paketi.

server/src/commitService.test.ts:45-114 replay/materialization testlerine mixed-version integration.

2.5 Blue/green rollout protokolü

En güvenli dağıtım sırası:

Faz	Reader	Writer	Kural
A	Eski v0 + yeni v0/v1 karışık	v0	Yeni binary önce yalnız reader yeteneği getirir
B	%100 yeni reader	v0	Full replay/mixed tests doğrulanır
C	%100 v0/v1 reader	v1	Writer feature flag açılır
D	Rollback window	v0/v1-capable eski release hazır	v1 yazımı sürer
E — gelecekte v2	Önce bütün reader’lar v2	hâlâ v1	Incompatible writer açılmaz
F	%100 v2 reader	v2	Sonra writer gate

Buradaki ana kural:

Read-new önce, write-new sonra.

Deployment readiness:

SELECT MAX("eventVersion") FROM "Commit";

Server startup/readiness:

dbMax <= MAX_READ_EVENT_VERSION

değilse instance traffic almamalı.

V1’in eski binary tarafından okunabiliyor olması ayrıca frozen compatibility test ile kanıtlanmalı. V2 için bunu varsaymayın.

Öneri — READ_MAX / WRITE_EVENT_VERSION ayrı gate: S/M efor.
Yapılmazsa: blue/green deployment sırasında yeni writer eski server’ın okuyamadığı event üretip rollback yolunu kapatabilir.
Kabul kriteri: incompatible writer version, fleet’in %100’ü reader desteği bildirmeden açılamamalı; CI mixed old/new writer simülasyonu rebuildCheck()==true üretmeli.

2.6 Snapshot invalidation

Bir schema değişikliğinin snapshot’a etkisi:

Değişiklik	eventVersion	snapshotSchema	projectionVersion	Eski snapshot
Yeni optional field, aynı default semantik	↑ olabilir	aynı	aynı	Kullanılabilir
Snapshot codec JSON→binary	aynı	↑	aynı	Decoder varsa kullanılabilir
Upcaster çıktı semantiği değişti	aynı	aynı	↑	Invalid
Hatalı projection düzeltildi	aynı	aynı	↑	Invalid
History destructive rewrite	olabilir	olabilir	olabilir	historyEpoch yüzünden invalid

Projection version özellikle önemli: event bytes değişmeden yalnız replay semantiği değişebilir.

2.7 Hatalı upcaster rollback/rebuild

İki farklı hata tipi var.

Reader/upcaster bug’ı, event bytes doğru

Problemli release writer’ını durdur.

Snapshot selection’ı problemli projectionVersion için kapat.

Corrected deterministic upcaster deploy et.

CURRENT_PROJECTION_VERSION++.

Her canvas için full events → shadow graph replay et.

Shadow hash/materialized state farkını raporla.

Gerekiyorsa materialized Node/Edge’i controlled rebuild et.

Yeni snapshot’ları üret.

rebuildCheck(full) geçmeden normal snapshot read’i açma.

Hatalı writer yanlış bytes persist etti

Ek olarak:

write freeze,

affected seq range belirle,

deterministic stream rewrite,

historyEpoch++,

bütün eski snapshots invalid,

audit/repair manifest oluştur,

full rebuild,

yeni snapshots,

sonra write reopen.

Mevcut kodda rebuildCheck checker, repair/rebuild writer değil: server/src/commitService.ts:506-514. Dolayısıyla gerçek rebuild prosedürü ayrıca yazılmalı.

2.8 Versioning test matrisi
Test	Beklenti
Mevcut legacy v0 fixture	v1 canonical state
Altı op türü v1 encode→decode	structural equality
v0 + v1 mixed stream	full replay == materialized
Unknown v2	fail closed
Invalid JSON	fail closed
Invalid enum/type/x=NaN	fail closed
v1 event’i legacy current applyOp ile okuyabilme	additive-v1 compatibility
Eski writer v0 + yeni writer v1 sırayla	rebuild true
Snapshot schema eski, projection aynı	fallback/decoder
Projection bump	eski snapshot seçilmemeli
Corrupt snapshot	prior snapshot’a fallback
Bad upcaster fixture	shadow hash mismatch yakalanmalı
Rollback binary readMax < DB max	readiness false

Öneri — Versioning + rollback test seti: M efor.
Yapılmazsa: event versioning teorik olarak bulunur ama deployment anında en tehlikeli durumlar test edilmemiş kalır.
Kabul kriteri: yukarıdaki 12 case CI’da deterministic geçmeli; future-version testinde hiçbir Node/Edge write gerçekleşmemeli.

3. pendingBaseSeq ve gerçek three-way merge

Buradaki en önemli refinement şu: yalnız istemcide pendingBaseSeq düzeltmek yetmez. Server stale commit yolunun da gerçek causal base üzerinde üç-yollu state karşılaştırmasına geçmesi daha doğru.

Bugünkü stale path:

güncel graph yükleniyor: server/src/commitService.ts:246

intent güncel graph’a yeniden expand ediliyor: :249

intervening commits alınıyor: :254-257

target overlap bakılıyor: :258-273

Bu, target-disjoint merge için kullanışlı fakat “iki taraf da aynı değere geldi”, “data farklı key”, “delete/delete convergence” gibi değer semantiğini ifade etmiyor.

3.1 Stale push için yeni model
B = stateAt(pendingBaseSeq)
M = current main state


authoredOps = expandAll(B, pendingIntents)
U = apply(B, authoredOps)


threeWay(B, M, U)
    ↓
mergedState + conflicts

Conflict yoksa:

opsToCommit = diffStates(M, mergedState)

ve normal applyCommit() choke-point’inden geçer.

Böylece kullanıcının niyeti “şimdi gördüğümüz state’ten yeniden uydurulmaz”; gerçekten edit’e başladığı state’e göre anlaşılır.

3.2 Tam çatışma matrisi

Aşağıdaki tablo önerilen yeni karar kurallarıdır.

B=base, M=main, U=user/branch.

Vaka	B→M	B→U	Sonuç
Farklı node	node A	node B	Auto merge
Aynı node, farklı scalar field	title	status	Auto merge
Aynı field, aynı final değer	A→X	A→X	Converged, tek değişiklik
Aynı field, farklı final	A→X	A→Y	Hard conflict
Main update, user delete	title değişir	node silinir	Hard conflict
Main delete, user update	node silinir	title değişir	Hard conflict
Main delete, user move	node silinir	position değişir	Hard conflict
İki taraf delete	node silinir	node silinir	Converged delete
Aynı ID node add, payload aynı	yok→N	yok→N	Converged add
Aynı ID node add, payload farklı	yok→N1	yok→N2	Hard conflict
data.a vs data.b	a değişir	b değişir	Auto merge — yeni davranış
aynı data.a, aynı değer	a→X	a→X	Converged
aynı data.a, farklı değer	a→X	a→Y	Hard conflict
data key delete vs aynı key update	sil	değiştir	Hard conflict
Move farklı node	pos A	pos B	Auto merge
Aynı node iki farklı move	pos→M	pos→U	Soft conflict: main position korunur
Aynı node iki aynı move	pos→P	pos→P	Converged
Edge farklı ID	e1	e2	Auto merge
Aynı edge ID add, aynı payload	add E	add E	Converged
Aynı edge ID add, farklı payload	add E1	add E2	Hard conflict
Aynı edge iki delete	delete	delete	Converged
Edge delete vs edit (delete+add)	delete	replace	Hard conflict
Reparent vs node title	parentId	title	Auto merge, sonra invariant validation
Reparent sonucunda cycle	başka structural change	reparent	Structural conflict / reject
Branch açıldıktan sonra main’de ilgisiz B field değişti	B field	A field	Her ikisi korunur
Branch açıldıktan sonra aynı field değişti	A→M	A→U	Resolution gerekir
data özel durumu

Bugün data tek field:

shared/src/types.ts:53-54.

Expansion da bütün object’i tek değer olarak yazıyor:

shared/src/expand.ts:72-76.

targetsOf() Object.keys(op.after) üzerinden datayı tek target yapıyor:

server/src/commitService.ts:526-552.

Yeni target isimleri:

node:<id>:data:<key>

olmalı.

data zaten Record<string,string> ve normalizeData() ile flat canonical map olduğu için bu değişiklik nested JSON CRDT gibi karmaşık değil.

Move x/y

Bugünkü intent API:

shared/src/types.ts:70

her zaman x ve y birlikte taşıyor ve expansion tek move_node içinde ikisini birlikte üretiyor:

shared/src/expand.ts:95-100.

Bu nedenle x ve y’yi bağımsız conflict field’ları gibi merge etmeyi önermiyorum. position=(x,y) tek gesture’dır. Aksi halde bir kullanıcının x’i ile diğerinin y’sinden “Frankenstein” koordinat çıkabilir.

Mevcut dropSoftConflicts() aynı node position çatışmasında main’i koruyor:

server/src/commitService.ts:554-575.

Bu politika korunabilir fakat artık sessiz değil, conflict diagnostic olarak raporlanmalı.

Öneri — Value-aware three-way classifier + key-granular data: M/L efor.
Yapılmazsa: aynı değere ulaşan değişiklikler gereksiz branch yaratır; data farklı anahtarları gereksiz conflict olur; branch merge main’in ilgisiz değişikliklerini geri alabilir.
Kabul kriteri: yukarıdaki matrisin her satırı integration test olmalı; disjoint/convergent case’lerin branch yaratma oranı 0, unresolved hard-conflict case’lerin silent main commit oranı 0 olmalı.

3.3 pendingBaseSeq exact client değişikliği

Store’da şu anda:

web/src/store/graphStore.ts:32-34

yalnız pending ve headSeq var.

Ek:

TypeScript
pendingBaseSeq: number | null

İlk stage anında:

web/src/store/graphStore.ts:218-222

pending boşsa:
    pendingBaseSeq = current headSeq

Pending yaşamı boyunca WS’nin head’i değiştirmesi bunu değiştirmemeli.

WS path bugün:

web/src/store/graphStore.ts:329-333

→ withServerState()

ve withServerState yeni headSeqyi store’a yazar:

web/src/store/graphStore.ts:158-165.

Bu kalabilir; yalnız pendingBaseSeq korunmalı.

Push bugün:

web/src/store/graphStore.ts:485-495

özellikle:

baseSeq: headSeq

gönderiyor.

Yeni:

baseSeq: pendingBaseSeq ?? headSeq

Successful push ve discardPending:

web/src/store/graphStore.ts:490, 498-499

base’i nulla döndürmeli.

load/reset:

web/src/store/graphStore.ts:292-304, 400-407

aynı şekilde temizlemeli.

Öneri — Frozen causal base: S efor.
Yapılmazsa: same-field remote edit, staging sırasında WS geldiğinde user edit’inin causal geçmişinden silinerek sessiz overwrite’a dönüşebilir.
Kabul kriteri: head=100’de stage edilen değişiklik sırasında WS head=101 olsa bile POST body baseSeq=100 göndermeli; same-field test sonucu branch/conflict olmalı, silent commit olmamalı.

3.4 Branch merge: gerçek three-way

Bugünkü:

server/src/commitService.ts:196-213

branch target state
current main
diff(current,target)
apply

yerine:

B = stateAt(branch.baseSeq)
U = branchState(branchId)
M = current main


result = threeWay(B,M,U)

Clean:

resolvedState
→ diffStates(M,resolvedState)
→ commit

Conflict:

merge preview + resolution required

Bu branch’in hiç dokunmadığı main değişikliklerini artık geri almaz.

3.5 Merge idempotency ve yarışlar

Burada mevcut kodda ayrı bir bug var.

Şu an:

applyCommit(...)          // transaction A
branch.update(merged)     // transaction B

server/src/commitService.ts:210-211.

Aynı process mutex’i (:68-83) tek server instance içinde korur, fakat iki instance için yetmez.

Yeni Branch metadata:

prisma
mergedCommitSeq Int?
mergeRequestId  String? @unique
resolvedAt      DateTime?

Merge API istemciden:

JSON
{
  "requestId": "uuid",
  "expectedMainHeadSeq": 431,
  "expectedBranchHeadSeq": 428,
  "mergeToken": "...",
  "resolutions": [...]
}

almalı.

Atomic merge transaction:

1. Canvas row lock
2. Branch row lock
3. branch.status kontrol
4. aynı requestId daha önce tamamlanmış mı?
5. current mainHead kontrol
6. current branchHead kontrol
7. preview token/fingerprint kontrol
8. resolutions uygula
9. region/invariant doğrula
10. seq ayır
11. Node/Edge materialization
12. Commit insert
13. Branch status=merged + mergedCommitSeq + requestId
14. COMMIT

Tek transaction.

İki retry senaryosu:

Durum	HTTP
Aynı requestId, merge daha önce tamamlandı	200, aynı mergedCommitSeq
Başka request, branch zaten merged/discarded	409 branch_already_resolved
Preview’dan sonra main head ilerledi	409 merge_stale
Preview’dan sonra branch head ilerledi	409 merge_stale
Conflict resolutions eksik	409 unresolved_conflicts
Resolution sonrası invariant bozuluyor	422 invalid_resolution

mergeToken server HMAC’ı şu alanlardan türetilebilir:

branchId
baseSeq
branchHeadSeq
mainHeadSeq
projectionVersion
conflictFingerprint

Böylece client eski comparison ekranından resolution göndermeye çalışırsa kabul edilmez.

Öneri — Merge commit + branch close tek transaction + idempotency key: M efor.
Yapılmazsa: crash veya multi-instance yarışında aynı branch iki main merge commit’i üretebilir.
Kabul kriteri: iki ayrı CommitService instance aynı branch’i aynı anda aynı/farklı requestId ile merge etmeye çalıştığında DB’de tam 1 main merge commit bulunmalı; aynı request retry aynı seq’yi döndürmeli.

3.6 API biçimi

Bugünkü branch merge endpoint’i body almayan basit POST:

server/src/routes.ts:317-327.

Web client da doğrudan:

web/src/api/client.ts:151-154.

Bunu iki endpoint’e ayırmak daha temiz:

GET  /api/canvases/:id/branches/:branchId/merge-preview
POST /api/canvases/:id/branches/:branchId/merge

Preview:

JSON
{
  "branchId": "...",
  "baseSeq": 400,
  "mainHeadSeq": 431,
  "branchHeadSeq": 428,
  "autoMergePossible": false,
  "cleanChanges": 7,
  "conflicts": [
    {
      "kind": "node_field",
      "nodeId": "n17",
      "field": "title",
      "base": "API",
      "main": "API v2",
      "branch": "Backend API"
    }
  ],
  "softResolutions": [
    {
      "kind": "position",
      "nodeId": "n5",
      "policy": "main_wins"
    }
  ],
  "mergeToken": "..."
}

Branch creation response’ına bütün field contents koymak zorunda değilsiniz; summary yeterli:

JSON
{
  "result": "branched",
  "branch": {...},
  "conflictSummary": {
    "hard": 2,
    "soft": 1,
    "targets": [
      {"kind":"node_field","nodeId":"n17","field":"title"}
    ]
  }
}

Bu aynı zamanda gereksiz PII duplication’ını azaltır.

CommitResult / BranchedResult şu anda oldukça ince:

web/src/api/client.ts:75-83.

Buraya summary tipleri eklenmeli.

3.7 Kullanıcının çözüm ekranı

Bugünkü BranchPanel doğrudan:

Ana hatta birleştir

butonu sunuyor:

web/src/components/BranchPanel.tsx:28-43.

Hatta tooltip wholesale semantiğini açıkça söylüyor.

Yeni flow:

Dal
 ↓
Karşılaştır
 ↓
[7 değişiklik otomatik uygulanabilir]
[2 alan karar bekliyor]


Düğüm "API"
Başlık:


Ortak taban     Ana hat      Dal
API             API v2       Backend API


(•) Ana hattı koru
( ) Dalı al
( ) Özel değer


[Çöz ve birleştir]

Conflict 0 ise kullanıcı resolution ekranına girmeden:

“7 değişiklik ana hatta uygulanacak; main’deki 4 yeni değişiklik korunacak.”

şeklinde tek tıklamalı merge yapılabilir.

Current wholesale davranış tamamen kaldırılmayacaksa yalnız owner’a ayrı ve açıkça destructive:

“Ana hattı dalın tam durumuyla değiştir”

diye adlandırılmalı.

Öneri — Merge preview UI: M efor.
Yapılmazsa: backend three-way olsa dahi kullanıcı hangi değişikliğin neden beklediğini göremez; “branch” kavramı teknik borç olarak kullanıcıya itilir.
Kabul kriteri: hard conflict olan branch direct merge edilememeli; kullanıcı her conflict için Main/Branch/Custom seçim görmeli; clean branch en fazla 2 etkileşimde merge olmalı.

3.8 Eklenecek testler

Mevcut çok iyi başlangıç testleri:

same-node position: server/src/commitService.test.ts:285-312

delete/update: :345-351

different-field auto merge: :353-363

wholesale merge: :365-379

multi-instance seq: :56-70

mutex: :392-402

365-379 testi artık kaldırılıp tersine çevrilmeli.

Yeni test adları:

staged base remains frozen across websocket head updates
same-field divergent edit branches
same-field same-value converges
different fields merge
delete-vs-update conflicts
delete-vs-delete converges
data different keys merge
data same key different value conflicts
concurrent move keeps main and reports soft conflict
same edge add converges
same edge id different payload conflicts
branch merge preserves unrelated main changes
branch merge overlapping field requires resolution
merge preview becomes stale when main advances
merge preview becomes stale when branch advances
same merge requestId is idempotent
two service instances cannot merge one branch twice
merge commit and branch closure rollback atomically
4. Auto-branch UX: telemetry + deney planı

OpenTelemetry’nin güncel specification sayfası 17 Ekim 2025 itibarıyla OpenTelemetry Specification 1.60.0, OTLP 1.11.0 ve Semantic Conventions 1.44.0 sürümlerini listeliyor. Telemetry’yi custom bir event DB’si icat etmek yerine trace/metric/log correlation’a oturtmak için güncel bir temel. Kaynak: OpenTelemetry Specifications
, 17.10.2025. 
OpenTelemetry
+1

4.1 Event şeması

Payload/başlık/not gibi kullanıcı içeriğini telemetry’ye koymayın.

Common attributes:

trace_id
session_id
canvas_hmac
actor_hmac
app_version


base_seq
observed_head_seq
head_gap


pending_count
pending_age_ms


graph_nodes
graph_edges


conflict_count
conflict_kinds[]


branch_hmac
branch_age_ms


outcome
latency_ms
retry_count

Canvas/user için metric label olarak raw ID veya benzersiz HMAC kullanmak yerine bunları trace/event tarafında tutun; aggregate metric’lerde cardinality düşük label’lar kullanın.

Event’ler:

Event	Nerede
collab.staging.started	İlk pending intent
collab.staging.rebased	Pending varken WS head ilerledi
collab.push.finished	committed/branched/rejected
collab.conflict.detected	server classifier
collab.branch.created	branch transaction
collab.branch.previewed	compare UI açıldı
collab.branch.resolved	merged/discarded/expired
collab.merge.retry	idempotency retry
collab.merge.stale	expected head değişti
collab.preview.intent_skipped	local preview stale intent
collab.overwrite_guard.violation	normalde hiçbir zaman oluşmamalı
4.2 Ölçümler
Auto-branch rate

İki denominator ayrı saklanmalı:

branch_created / all_pushes
branch_created / stale_pushes

İkincisi algoritma kalitesini daha iyi anlatır.

Unresolved branch age
now - Branch.createdAt

Histogram:

p50 / p95 / p99

ve açık branch sayısı:

per active canvas
per creator
Time to merge
resolvedAt - createdAt
Silent overwrite

Yeni frozen base + three-way classifier sayesinde kesin invariant tanımlanabilir:

hardConflict(B,M,U) == true
AND
result == main commit without explicit resolution

Bu metrik tam 0 olmalı.

Abandoned branch

İki metrik kullanırım:

stale_branch:
    open > 7 gün


abandoned_branch:
    open > 14 gün
    OR
    creator daha sonra canvas'a dönmüş ama branch 7 gün içinde hâlâ çözülmemiş

Bunlar hukuki retention değil, ürün metriği.

Kullanıcı geri dönüşü

Conflict exposure’dan sonra:

1 gün
7 gün
28 gün

canvas/session return rate.

Raw return oranını neden-sonuç diye yorumlamayın; conflict yaşayan kullanıcılar zaten daha ağır kullanıcı olabilir.

4.3 Mevcut instrumentation noktaları
Web

staging başlangıcı: web/src/store/graphStore.ts:218-222

WS rebase: web/src/store/graphStore.ts:329-333

outcome: web/src/store/graphStore.ts:176-190

push duration/outcome: web/src/store/graphStore.ts:485-495

merge/discard: web/src/store/graphStore.ts:531-545

stale intent bugün sessiz skip: web/src/store/applyIntents.ts:17-30, özellikle :26-28

UI branch action: web/src/components/BranchPanel.tsx:28-43

applyIntents() yalnız graph döndürmek yerine:

TypeScript
{
  graph,
  skippedIntents: [...]
}

döndürmeli. Böylece preview ile gerçek push arasında ne kadar invalidation olduğunu ölçebilirsiniz.

Server

in-process queue wait: server/src/commitService.ts:79-83

commit start/head gap: server/src/commitService.ts:228-243

stale classification: :245-274

branch creation: :276-329

transaction/lock: :445-460

replay count/bytes: :158-173

merge: mevcut :196-213, yeni preview/atomic merge path

Öneri — PII’siz collaboration telemetry: S/M efor.
Yapılmazsa: branch UX kararları anekdotla verilir; algorithm conflict rate ile UX abandon rate birbirinden ayrılmaz.
Kabul kriteri: production/staging dashboard’da branch rate, hard/soft conflict rate, median branch age, p95 time-to-resolution, abandoned rate ve silent-overwrite count tek release sonrasında görülebilmeli; telemetry payload’ında node title/description/notes/url/data değeri bulunmamalı.

4.4 Deney planı

Önce 2 hafta observational baseline veya en az 500 hard-conflict exposure toplanmalı. Daha sonra gerçek sample size baseline resolution oranına göre power analysis ile belirlenmeli.

Randomization user değil canvas bazında yapılmalı; aynı collaboration odasında iki kullanıcı farklı conflict davranışı görmemeli.

Üç arm:

A: current concept — automatic branch.

B: push reject + latest state üzerinde guided rebase.

C: field-level inline resolution.

Guardrail:

silent overwrite                 = 0
lost staged intents              = 0
5xx artışı                       < 0.2 yüzde puan
push p95 latency artışı          < 100 ms

Ana başarı:

resolved within same session
resolved within 24h
branch abandonment
time-to-resolution
7-day return
4.5 Hangi UX ne zaman?
Ölçüm	Tercih
Hard conflict <1% push, 24h çözüm ≥90%, abandonment <5%	Auto-branch yeterli
Hard conflict ≥1%, median conflict field ≤5, p95 ≤10	Field-resolution UI
Branch’lerin >70%i merge olmadan discard/abandon	Reject + rebase dene
Field UI aynı-session resolution’ı ≥10 yüzde puan artırıyor ve p95 push +UI maliyeti kabul edilebilir	Field UI kazanır
Rebase temiz staged ops’ların ≥99.9%unu koruyor ve branch’e göre 24h çözümü düşürmüyor	Reject/rebase kazanır
Hard conflict >5% tüm push’lar	UX değil, conflict granularity/algoritma problemi
Silent overwrite >0	Rollout blocker
Branch p95 age >7 gün	Auto-branch debt görünürlüğü yetersiz
7-day return treatment-control farkı < -2 yüzde puan	UX treatment başarısız/non-inferior değil

10pp, %5, 7 gün, -2pp değerleri Co-Pronoia için deney gate’leridir, araştırma literatüründen alınmış evrensel eşikler değildir.

Öneri — Üç kollu canvas-level deney: M efor.
Yapılmazsa: “branch kullanıcıyı rahatsız ediyor mu?” sorusu çözülmeden algoritmik karmaşıklık eklenir.
Kabul kriteri: karar vermeden önce her arm için precomputed power hedefi tamamlanmalı; silent overwrite her arm’da 0; seçilen UX kontrol grubuna karşı 24h resolution’da gerilememeli ve 7-day return için −2pp non-inferiority sınırını geçmeli.

5. Yazma yolunun doygunluk modeli

PostgreSQL 18 dokümantasyonunda row-level locks transaction sonuna kadar tutulur ve çatışan row writers birbirini bekler. Bu yüzden Co-Pronoia’da gerçek throughput sınırı seq üretmekten çok, Canvas row lock alındıktan transaction bitene kadar yapılan iş tarafından belirleniyor. Kaynak: PostgreSQL 18 current docs, erişim 15.08.2026: Explicit Locking
. 
PostgreSQL

5.1 Current-head normal commit’in sorgu hesabı

Owner, linked-canvas validation gerektirmeyen bir normal main commit ve N=op sayısı varsayalım.

Transaction öncesi

commit():

headSeq() → 1 query, server/src/commitService.ts:231

loadGraph() → 2 query, :235

Toplam: 3

Transaction içinde

applyCommit():

Canvas FOR UPDATE → 1, :387

MAX(seq) → 1, :388

loadGraph(tx) nodes + edges → 2, :454

N adet table mutation → N, :457, :465-495

Commit insert → 1, :458

Toplam: N + 5

Transaction sonrası

getCommit(seq) → 1, :461

getState() → nodes + edges + head aggregate → 3, :462, :87-102

Toplam: 4

Minimum toplam

N + 12 DB round trip

Tek-op commit için yaklaşık 13 query.

Non-owner region query’si, linked canvas check’leri (server/src/commitService.ts:412-428) veya stale/intervening commit query’leri buna eklenir.

En önemlisi: loadGraph() iki kez çağrılıyor; ikinci kez Canvas row lock altında.

5.2 Lock süresi modeli

Row lock:

server/src/commitService.ts:387

alındıktan transaction:

server/src/commitService.ts:460

bitene kadar tutulur.

Kabaca:

Tlock =
  T_for_update
+ T_max_seq
+ T_load_nodes_edges(V,E)
+ T_region_validation
+ T_apply_cpu(ops,V,E)
+ Σ T_table_write(op)
+ T_commit_insert
+ T_transaction_commit

Canvas başına teorik üst throughput:

μ ≈ 1000 / mean(Tlock_ms) commits/s

Örnek:

Ortalama lock hold	Teorik üst sınır
20 ms	~50 commit/s
50 ms	~20 commit/s
100 ms	~10 commit/s
250 ms	~4 commit/s
500 ms	~2 commit/s

Bu queueing etkisini içermeyen üst sınırdır. 10 writer ile arrival rate bu servis kapasitesine yaklaştıkça lock wait hızlı büyür.

PostgreSQL Serializable alternatifinde de uygulamanın serialization failures için transaction retry etmeye hazır olması gerekir; dolayısıyla “row lock’u kaldır, Serializable aç” ücretsiz bir çözüm değildir. PostgreSQL 18 transaction-isolation dokümantasyonu explicit locks ile Serializable arasında trade-off ve retry gereksinimini açıklıyor. Transaction Isolation
, PostgreSQL 18, erişim 15.08.2026. 
PostgreSQL

5.3 Graph-size yük testi

Event-history testinden ayrı yürütülmeli.

Normal synthetic profile:

average node JSON ≈ 1 KiB
average edge JSON ≈ 0.375 KiB
edge count ≈ 1.5 × node count

Logical current graph yaklaşık:

Nodes	Edges	Yaklaşık JSON
1k	1.5k	~1.5 MiB
10k	15k	~15 MiB
100k	150k	~153 MiB

Bunlar fixture hedefidir; gerçek production serialized size ayrıca ölçülmeli.

Test matrisi:

Graph	1 writer	10 writer	50 writer
1k node	✓	✓	✓
10k node	✓	✓	✓
100k node	✓	✓	✓

Her hücre:

5 dk warm-up
15 dk steady load
60 sn 2× burst
3 tekrar

Commit karışımı:

65% scalar/data update
20% move
10% edge add/delete
5% balanced node add/delete

Commit boyutları:

80% = 1 op
15% = 5 op
 5% = 20 op

İki contention profili:

Disjoint targets — raw write capacity.

20% hot target — gerçek conflict/branch davranışı.

Ölç:

queue_wait_ms
canvas_row_lock_wait_ms
lock_hold_ms
load_graph_ms
transaction_ms
http_commit_ms
db_roundtrips
db_bytes_read
pool_wait_ms
branch_rate
retry/error rate
CPU/RSS
5.4 Geçiş eşikleri

Mevcut model için “sağlıklı” başlangıç gate’i:

lock_wait p95        < 25 ms
in-process queue p95 < 25 ms
commit HTTP p95      < 200 ms
commit HTTP p99      < 500 ms
error/retry          < 0.1%
queue depth p95      <= 1

Bunlardan birinin kısa burst değil 5 dakika sürekli ihlali migration sinyali olsun.

5.5 Canvas.lastSeq: bir alan yetmez

İlk turdaki Canvas.lastSeq fikrini burada düzeltiyorum.

Çünkü:

server/src/commitService.ts:379-389

seq branch dahil canvas-global.

Ama:

headSeq()

yalnız main max:

server/src/commitService.ts:96-102.

Dolayısıyla tek counter yerine:

prisma
lastSeqGlobal Int @default(0)
mainHeadSeq   Int @default(0)

daha doğru.

Yeni commit:

UPDATE Canvas
SET lastSeqGlobal = lastSeqGlobal + 1
RETURNING lastSeqGlobal

main commit başarıyla aynı transaction’da yazılırsa mainHeadSeq de yeni seq olur; branch commit’te olmaz.

Bu _max(seq) sorgularını ortadan kaldırır ama full graph load lock altındayken tek başına ölçek problemini çözmez.

Öneri — iki Canvas counter: S/M efor.
Yapılmazsa: history büyüdükçe hem global seq hem main-head hesapları aggregate query’ye bağlı kalır; branch/global semantics tek lastSeq ile yanlış modellenebilir.
Kabul kriteri: 100 paralel main/branch commit testinde lastSeqGlobal == max(all seq), mainHeadSeq == max(main seq) ve duplicate seq 0; _max(seq) normal write/read path’inden kaldırılmış olmalı.

5.6 Dört write mimarisi karşılaştırması
Model	Tutarlılık	Failure recovery	Hot canvas	Ops maliyeti
Mevcut mutex + row lock	Çok güçlü	Basit DB transaction	Graph büyüdükçe zayıf	Düşük
Short-lock OCC/CAS	Güçlü	Retry/recompute	Orta–yüksek	Orta
Queue per canvas	Güçlü	Durable queue ise iyi	Burst smoothing; throughput yaratmaz	Orta
Stateful single-writer	Çok güçlü	Lease/fencing + snapshot recovery şart	En yüksek	Yüksek
A. Mevcut model

1k node / birkaç writer için muhtemelen doğru seçim.

Kal: p95 lock wait <25ms, p95 commit <200ms.

B. Short-lock optimistic concurrency

Asıl iyileştirme:

full graph read ve intent expansion’ı DB row lock dışına taşı.

Model:

1. observed mainHead = H
2. graph/materialized state oku
3. authored/resolved ops hesapla
4. transaction:
     CAS mainHead == H
     seq allocate
     row-version preconditions ile Node/Edge write
     commit insert
5. CAS fail → three-way recompute/retry

Node’da updatedCommit zaten var:

shared/src/types.ts:25-26.

Edge’de yalnız createdCommit var:

shared/src/types.ts:32-40.

Strict row-preconditions için Edge’e de version/updatedCommit eklemek daha temiz olur.

OCC’ye geç: graph load p95 >50ms veya lock hold p95 >100ms ve bunun >30%i graph-read/validation ise.

Retry >5% olursa OCC hotspot altında yanlış araç olmaya başlar.

Öneri — Short-lock OCC refactor: L efor.
Yapılmazsa: 10k/100k graph’ta full graph read Canvas serialization süresinin içine gömülü kalır.
Kabul kriteri: 10k node/10 writer testinde lock hold p95 mevcut baseline’ın ≤40%’ı; correctness testleri aynı; OCC retry <2% hedef, >5% ise rollout durdur.

C. Queue

Queue throughput’u sihirli şekilde artırmaz; burst’u emer ve backpressure sağlar.

Queue’ya geç: normal service time p95 <100ms olduğu halde burst sırasında queue wait p95 >200ms, sustained utilization ise <70%.

Öneri — Durable/bounded per-canvas queue yalnız burst problemi varsa: M efor.
Yapılmazsa: burst sırasında kullanıcılar DB lock üzerinde kontrolsüz bekler.
Kabul kriteri: burst sırasında 5xx/timeout <0.1%, queue depth bounded, steady-state median latency kontrol grubundan >20ms kötüleşmemeli.

D. Canvas başına single writer

State memory’de:

canvas actor
 ├─ current graph
 ├─ current mainHead
 ├─ next seq
 └─ serialized commands

Crash sonrası:

latest verified snapshot
+
event tail

ile yeniden kurulur.

Multi-instance ownership için lease + fencing token gerekir; yalnız “Redis lock aldım” seviyesinde bırakılmamalı.

Geçiş trigger’ı:

loadGraph p95 >100ms, veya

lock_wait p95 >250ms 5 dakika, veya

commit p95 >500ms, veya

hedef workload >5 sustained commits/s/canvas ve queue depth p95 >5,

özellikle 100k-node canvas.

Öneri — Single writer ancak telemetry trigger ederse: L efor.
Yapılmazsa: yukarıdaki eşikler gerçekten aşılırsa DB her küçük edit için 10–100MB graph tekrar okuyan serialization point’e dönüşür.
Kabul kriteri: 100k-node/10-writer benchmark’ında commit p95 ≤200ms hedef; writer crash sonrası snapshot+tail recovery ≤30s ve duplicate/lost seq 0.

6. Retention, PII ve audit garantileri

Burada önce önemli bir gerçek: Co-Pronoia bugün cryptographic hash-chain tutmuyor. Commit modelinde prevHash/contentHash yok: db/prisma/schema.prisma:263-277.

Dolayısıyla mevcut garanti:

replay/materialized consistency

ama:

cryptographically tamper-evident immutable history

değil.

Bunu retention tasarımında birbirine karıştırmamak gerekiyor.

6.1 Event payload içindeki kişisel-veri taşıyabilecek alanlar

“Bu alan kesin PII’dir” demiyorum; kişisel veri taşıma kapasitesi envanteri çıkarıyorum.

Alan	Neden	Kod
Node.title	kişi/proje adı yazılabilir	shared/src/types.ts:7
description	serbest metin	:8
notes	uzun Markdown serbest metin	:15-16
data	arbitrary key/value, ör. sahip	:23-24
url	kişi/account/internal resource bağlantısı olabilir	:17-18
urlBy	doğrudan User ID	:19-22
parentId/linkedCanvasId	bağlama göre dolaylı tanımlayıcı	:6,13-14
Edge.label	serbest metin	:38
Commit.authorId	User kaydına bağlanan pseudonymous identifier	db/prisma/schema.prisma:270-271
Branch.createdBy	User ID	:286-287
Commit.message	node title tekrarını taşıyabiliyor	shared/src/ops.ts:163-180

User tablosu bu identifier’ı doğrudan username/email/display name gibi alanlara bağlıyor:

db/prisma/schema.prisma:9-30.

Daha önemlisi event log içeriği çoğaltıyor:

update_node before + after tutuyor: shared/src/types.ts:59

delete_node tam node snapshot’ı tutuyor: :60

subtree delete expansion tam node’ları eventlere koyuyor: shared/src/expand.ts:83-93

edge delete tam edge snapshot’ını tutuyor: :112-115

Dolayısıyla materialized Node silmek geçmiş payload’ı silmez.

6.2 Güncel otorite çerçevesi

KVKK’nın Mart 2026 tarihli resmi yayını, silmeyi ilgili kullanıcılar açısından erişilemez/tekrar kullanılamaz hale getirme; yok etmeyi ise hiç kimse tarafından erişilemez, geri getirilemez ve kullanılamaz hale getirme şeklinde aktarıyor. Anonimleştirme için başka verilerle eşleştirilse bile gerçek kişiyle ilişkilendirilememesi gerekiyor. Kaynak: KVKK, Mart 2026, resmi yayın: PDF
. 
KVKK
+1

EDPB’nin Guidelines 02/2025 Version 2.0, 7 Temmuz 2026 belgesi blockchain için yazılmış olsa da, “güçlü immutable history ↔ erasure” mühendislik problemi Co-Pronoia append-only log’una analojik olarak çok ilgili. EDPB deletion/objection haklarının design aşamasında ele alınmasını, değiştirilemeyen yapıya doğrudan kişisel veri koymanın erasure’ı zorlaştırdığını söylüyor. Aynı rehber key deletion sonrası ciphertext’in okunamaz hale gelebileceğini, fakat şifreli verinin key silinmeden önce hâlâ kişisel veri olduğunu ve kriptografik ömrün hesaba katılması gerektiğini vurguluyor. Kaynak: EDPB Guidelines 02/2025 v2.0
, adopted 07.07.2026. 
European Data Protection Board
+3
European Data Protection Board
+3
European Data Protection Board
+3

NIST SP 800-88 Rev.2, final 26 Eylül 2025, media sanitization’ı hedef veriye erişimi uygulanabilir efor düzeyinde imkânsız hale getirmek olarak tanımlıyor ve crypto erase’i güncel sanitization araçlarından biri olarak ele alıyor. Bu hukuki yeterlilik standardı değil, depolama/key destruction için teknik otoritedir. Kaynak: NIST SP 800-88 Rev.2
. 
NIST Computer Security Resource Center
+1

6.3 Retention seçeneklerinin garanti matrisi
Yöntem	Audit	Replay	Fiziksel PII silme	Hash bütünlüğü	Backup	En uygun kullanım
Redaction event append	Çok iyi	Güncel projection mümkün	Hayır	Değişmez	Eski PII kalır	İş mantıksal düzeltmesi
Tek event hard-delete	Zayıf	Kırılabilir	Aktif DB’de evet	Chain varsa bozar	Ayrıca silinmeli	Genelde kaçın
Rewrite + sanitized history	Orta–iyi	Korunabilir	Evet, workflow tamamlanınca	Yeni epoch/root gerekir	Rewrite gerekir	Shared-canvas subject/content erasure
Per-canvas key destruction	Metadata kalabilir	Bilinçli olarak kaybedilir	Payload unreadable	Ciphertext hash kalır	Key backup’ları da yok edilmeli	Tüm canvas silme
Per-subject key	İyi	Placeholder ile mümkün	Potansiyel	Karmaşık	Key lifecycle karmaşık	Structured PII varsa
Cold archive	Çok iyi	Korunur	Hayır	Korunur	Ek kopya yaratır	Cost/operational retention
Full canvas hard delete	Audit gider	Gider	Aktif DB’de güçlü	Gider	Backup expiry gerekir	Canvas’ın tamamı kaldırılacaksa
6.4 Neden “redaction event” erasure değildir?

Örneğin:

seq 20: notes = "Ayşe'nin telefonu ..."
seq 40: redact notes

current state temiz görünür.

Ama seq20 hâlâ Commit.ops String içindedir.

Bu nedenle:

redaction event

= logical current-state correction,

ama:

old personal payload destruction

değildir.

KurrentDB 26.0 LTS dokümanı da aynı temel ayrımı üretim event store bağlamında gösteriyor: event logical read’den silindikten sonra fiziksel database’de kalabilir; GDPR gibi durumlarda ayrıca destructive scavenge gerekir. Kurrent ayrıca doğrudan event blanking’i son çare sayıyor ve önerilen yolu “stream’i hassas veri olmadan rewrite et → eski stream’i sil → diskten scavenge et” olarak veriyor. Kaynaklar: KurrentDB v26.0 LTS, erişim 15.08.2026: Scavenging
, Redaction
. 
Kurrent Docs
+1

Öneri — Redaction event’i hukuki/physical erasure mekanizması diye kullanma: S policy + M engineering efor.
Yapılmazsa: UI’da veri silinmiş görünürken Commit.ops, snapshot ve backup’larda aynı değer yaşamaya devam eder.
Kabul kriteri: erasure integration test’i eski literal test-string’i active Commit rows + snapshots + active archive üzerinde arayıp 0 sonuç bulmalı; redaction-only testinin erasure SLA’sını tamamladığı kabul edilmemeli.

6.5 Shared canvas için en uygulanabilir model: rewrite + history epoch

Kişi/content seviyesinde gerçek silme gerekiyorsa önerdiğim prosedür:

1. Erasure job oluştur
2. Canvas'ı maintenance write-fence'e al
3. Etkilenen field/event'leri deterministik belirle
4. Eski history'yi okuyup sanitized yeni history üret
5. Her before/after op'un replay invariant'ını yeniden kur
6. historyEpoch = old + 1
7. Materialized Node/Edge'leri yeni history'den rebuild et
8. Yeni snapshot'ları üret
9. rebuildCheck(full) çalıştır
10. Eski history payload'larını physical delete et
11. Cold archive kopyalarını delete/rewrite et
12. Backup deletion ledger'a ekle
13. Write fence'i kaldır
14. ErasureManifest tamamla

Aynı seqleri korumak mümkünse time references açısından iyi olur; fakat op semantiği bunu imkânsız kılıyorsa yeni epoch’un kendi internally consistent seq geçmişini üretmek daha güvenli.

Önemli olan eski ve yeni history’yi tek stream gibi karıştırmamak.

6.6 Kanıt zinciri

Bugün hash chain yok. Eğer gelecekte tamper-evidence isteniyorsa:

prisma
historyEpoch Int
prevHash     String?
contentHash  String?

gibi alanlar eklenebilir.

Hash input örneği:

historyEpoch
canvasId
seq
branchId
authorId/pseudonymous actor ref
createdAt
canonical eventVersion
canonical ops
prevHash

Destructive rewrite durumunda eski chain’i korumaya çalışmak silme hedefiyle çelişir. Bunun yerine ayrı bir ErasureManifest tutulur:

requestId
canvasId
oldEpoch
newEpoch
affectedSeqRange
oldRootHash
newRootHash
reasonCode
completedAt
backupExpiryAt

Manifest silinen literal kişisel veriyi veya data-subject email’ini taşımamalı.

Bu garanti şudur:

“Şu tarihte yetkili bir rewrite oldu ve yeni history’nin root’u budur.”

Garanti şu değildir:

“Silinen orijinal payload sonsuza dek hâlâ doğrulanabilir.”

İkisini aynı anda tam olarak elde edemezsiniz.

Öneri — historyEpoch + ErasureManifest; hash-chain gerekiyorsa bunu ayrıca tasarla: L efor.
Yapılmazsa: destructive rewrite sonrası snapshot/cache ve audit kanıtı hangi history nesline ait olduğunu ayırt edemez.
Kabul kriteri: erasure sonrası eski epoch snapshot’ı hiçbir read path’te seçilememeli; manifest eski/yeni root ve job durumunu doğrulamalı; manifest içinde silinen field value bulunmamalı.

6.7 Per-canvas ve per-subject crypto-shredding
Per-canvas key

Event payload ve snapshot:

DEK_canvas

ile envelope-encrypt edilir.

Canvas tamamen yok edilecekse:

destroy DEK

çok güçlü ve operasyonel olarak basit olabilir.

Ama:

materialized Node/Edge de aynı lifecycle’a dahil edilmeli,

key backup/replicası yok edilmeli,

Commit.message plaintext kalmamalı,

DB metadata (authorId, timestamps) ayrıca değerlendirilir,

replay artık bilerek mümkün değildir.

EDPB de key deletion’ın ciphertext’i unreadable hale getirebileceğini fakat encryption’ın kendisinin kişisel veri sorumluluğunu ortadan kaldırmadığını belirtiyor. 
European Data Protection Board

Per-subject key

Teoride:

subject-A fields → DEK_A
subject-B fields → DEK_B

olabilir.

Ama Co-Pronoia notes, title, description, data gibi serbest metinler içeriyor. Tek notes string içinde üç farklı kişiden bahsedilebilir. Sistem güvenilir biçimde “bu byte’lar yalnız subject A’ya aittir” diyemez.

Dolayısıyla mevcut veri modelinde per-subject encryption çok pahalı ve semantik olarak güvenilmez.

Yalnız ileride özel structured fields:

assigneeUserId
customerId
email

gibi açık subject-binding alanları varsa düşünülmeli.

Öneri — Crypto-shredding’i önce whole-canvas deletion için sınırla: L efor.
Yapılmazsa: zorunlu değil; rewrite pipeline ile devam edilebilir. Ancak tüm-canvas hızlı destruction gereksinimi çıkarsa backup dahil fiziksel purge daha uzun sürer.
Kabul kriteri: key-destruction testinde primary, replica ve restore edilmiş backup üzerinde encrypted payload decrypt edilememeli; key material inventory 0 canlı kopya göstermeli.

6.8 Cold archive ve backup

Cold archive silme değildir. KurrentDB 26.0 LTS archiving sistemi de cold copy’yi ayrı storage’a taşıyıp transparent read sağlıyor; yani archive daha az değil, ek bir veri kopyasıdır. Kaynak: KurrentDB v26.0 LTS Archiving
, erişim 15.08.2026. 
Kurrent Docs

Bu nedenle retention job şu inventory’yi tamamlamadan complete olamaz:

primary DB
read replica
snapshots
cold archive
search/index/export copies
backup sets
restored backup re-delete ledger

Önerilen ürün SLA’sı — bunun KVKK tarafından emredilen sabit süre olduğunu söylemiyorum:

Active DB + materialized state + snapshots: ≤24 saat
Cold archive:                           ≤72 saat
Backup fiziksel expiry:                 ≤30 gün

Backup için kritik mekanizma:

Eski backup restore edilirse servis traffic’e açılmadan ErasureLedger replay edilmelidir.

Aksi halde 20 gün önce silinen veri backup restore ile geri gelebilir.

KVKK’nın 2026 resmi anlatımında “yok etme” geri getirilemezliği de içerdiğinden backup lifecycle’ı operasyonel tasarımın dışında bırakılamaz. 
KVKK

Öneri — ErasureLedger restore gate: M/L efor.
Yapılmazsa: primary’den kaldırılmış veri disaster recovery sonrasında tekrar üretime dönebilir.
Kabul kriteri: 1 gün, 7 gün ve en eski desteklenen backup fixture’ı restore edildiğinde servis read-ready olmadan ilgili bütün tamamlanmış erasure job’ları yeniden uygulanmalı; test subject literal’i API’den ve active storage’dan 0 kez erişilebilir olmalı.

7. Uygulama sırası

Bu ikinci turdan sonra öncelik sırasını biraz daha keskinleştiriyorum:

Öncelik	Değişiklik	Efor	Measurable gate
P0	pendingBaseSeq	S	silent overwrite = 0
P0	Three-way stale push classifier	M/L	matrix tests %100
P0	Atomic/idempotent branch merge	M	double merge = 0
P1	Event codec + explicit versions	M	raw persisted JSON.parse = 0
P1	Read-new/write-new deploy gate	S/M	unsupported rollback deploy = 0
P1	Replay/lock/conflict telemetry	S/M	bütün SLO dashboard’ları mevcut
P1	Snapshot + fallback + oracle	M	stateAt p95 ≤200 ms
P1	lastSeqGlobal + mainHeadSeq	S/M	aggregate seq path kaldırılmış
P2	data.<key> conflict granularity	M	disjoint data false conflict = 0
P2	Merge comparison UI	M	24h branch resolution ≥90% hedef
P2	Retention epoch/rewrite pipeline	L	active purge SLA testleri geçiyor
P3	Short-lock OCC	L	yalnız lock SLO ihlalinde
P3	Stateful canvas writer	L	yalnız 10k/100k graph benchmark trigger ederse

Buradaki en büyük mimari sonuç şu: snapshot, branch merge ve event-versioning aslında ayrı işler değil. Aynı üç primitive etrafında toparlanmaları gerekiyor:

decodeStoredOps()
replayMainAt(seq)
threeWay(base, main, yours)

Bugünkü kodda event decoding beş ayrı JSON.parse noktasına, replay replayGraph() içine, conflict semantiği ise targetsOf()/opsConflict()/dropSoftConflicts() üçlüsüne dağılmış durumda. Bunları bu üç açık primitive’e toplarsanız 100k–1M history, mixed deploy, branch resolution ve retention rewrite için aynı çekirdeği tekrar kullanabilirsiniz.

Kullandığım güncel birincil kaynaklar

Axon Framework 5.2 — Snapshotting, güncel v5.2 dokümantasyonu, erişim 15.08.2026: https://docs.axoniq.io/axon-framework-reference/5.2/snapshotting/
 
docs.axoniq.io

Axon Framework 5.2 — Event Versioning / Upcasters, erişim 15.08.2026: https://docs.axoniq.io/axon-framework-reference/5.2/events/event-versioning/
 ve https://docs.axoniq.io/axon-framework-reference/5.2/migration/paths/upcasters/
 
docs.axoniq.io
+1

PostgreSQL 18 — Concurrency / Explicit Locking, current docs, erişim 15.08.2026: https://www.postgresql.org/docs/current/explicit-locking.html
 ve https://www.postgresql.org/docs/current/transaction-iso.html
 
PostgreSQL
+1

OpenTelemetry Specification 1.60.0 / OTLP 1.11.0 / SemConv 1.44.0, son güncelleme 17.10.2025: https://opentelemetry.io/docs/specs/
 
OpenTelemetry

KVKK, Mart 2026 resmi yayın, silme/yok etme/anonimleştirme hükümleri: https://www.kvkk.gov.tr/SharedFolderServer/CMSFiles/MTZhNjc1YWFhNmVjOGY.pdf
 
KVKK
+1

EDPB Guidelines 02/2025 v2.0, adopted 07.07.2026: https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202502_blockchain_v2_en.pdf
 
European Data Protection Board
+1

NIST SP 800-88 Rev.2, Final 26.09.2025: https://csrc.nist.gov/pubs/sp/800/88/r2/final
 
NIST Computer Security Resource Center
+1

KurrentDB v26.0 LTS, Scavenging/Redaction/Archiving, erişim 15.08.2026: https://docs.kurrent.io/server/v26.0/operations/scavenge
 , https://docs.kurrent.io/server/v26.0/operations/redaction
 , https://docs.kurrent.io/server/v26.0/features/archiving
 
Kurrent Docs
+2
Kurrent Docs
+2

Bu ölçütlerle bakınca ilk turdaki “CRDT’ye geçme, mevcut çekirdeği sertleştir” sonucu değişmiyor; fakat artık “sertleştir”in ne zaman başarılı sayılacağı ölçülebilir: silent overwrite=0, double merge=0, request-path replay p95 sınırları, explicit read/write version gates, lock saturation trigger’ları ve restore sonrası erasure invariant’ları var.
