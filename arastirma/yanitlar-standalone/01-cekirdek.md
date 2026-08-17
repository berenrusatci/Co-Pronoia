# https://chatgpt.com/c/6a7effce-fb2c-83eb-bda0-3ea9b614b37c

Co-Pronoia — Event-Sourced Graf ve Commit/Dal Tabanlı Eşzamanlılık Araştırması
Yönetici özeti

Çekirdek mimari yön olarak sağlam. Özellikle baseSeq → authoritative main → deterministic replay → materialized view yaklaşımı; Figma'nın merkezi authoritative multiplayer modeli, transaction log + per-file sequence number yaklaşımı ve event-sourcing literatürüyle oldukça iyi örtüşüyor. 
Figma
+1

En büyük yakın dönem risk replay değil, branch üretme davranışı. Staging nedeniyle tek commit geniş bir hedef kümesine dokunuyor; tek bir gerçek çatışma bütün staged paketi dala atarsa branch sayısı ve kullanıcı şaşkınlığı hızla artabilir. Figma büyük görsel merge'lerde intent çözmenin zor olduğunu açıkça söylüyor. 
Figma
+1

CRDT'ye geçmek zorunda değilsin. Figma bile gerçek CRDT kullanmıyor; merkezi otorite sayesinde CRDT prensiplerinden seçerek yararlanıyor. Senin denetlenebilir commit, supervisor approval, rollback ve branch ihtiyaçların commit modelini güçlü biçimde gerekçelendiriyor. 
Figma

CRDT ancak uzun metin/rich-text veya güçlü offline eşzamanlı düzenleme ürün vaadine dönüşürse anlamlı bir ek katman olur.

10k commit hedefi tek başına problem değil. Normal istek yolunda genesis replay yapmıyorsan snapshot acil ihtiyaç değildir. 100k–1M seviyesinde ise recovery, time-travel, branch-base ve projection rebuild süreleri nedeniyle checkpoint gerekli hale gelir. 
docs.eventsourcingdb.io
+1

Şimdi yapılması gereken en önemli teknik yatırım snapshot'tan önce explicit event-versioning + idempotency + conflict/preflight instrumentation.

1. Bulgular
1 — Commit log + materialized graph yaklaşımının gerçek dünyada güçlü bir karşılığı var

Figma'nın multiplayer sunucusu authoritative durumda; gelen değişiklikleri doğruluyor, sıralıyor ve çatışmaları çözüyor. 2022'de Figma yalnız checkpoint'e dayanan modeline ayrıca durable transaction log ekledi. Her değişikliğe dosya kapsamında artan bir sequence number veriliyor ve checkpoint de hangi sequence'i içerdiğini kaydediyor. 
Figma

Kaynak: Figma Engineering, Making multiplayer more reliable, 20 Ekim 2022.
2024 öncesi ama hâlâ geçerli mi? Evet. Figma'nın 2025 mühendislik yazıları hâlâ merkezi collaborative model ve özel conflict-resolution altyapısından bahsediyor. 
Figma

Co-Pronoia etkisi

Senin:

Commit(seq=N) → reducer → Node/Edge materialization

modelin olağandışı değil. Hatta Figma'nın:

transaction log sequence → authoritative in-memory file → checkpoint

modeliyle yapısal benzerlik taşıyor.

Bence burada mimariyi değiştirmekten çok mevcut modeli daha resmi hâle getirmek gerekiyor.

2 — Snapshot oracle olmamalı; oracle yine genesis log olmalı

Axon Framework'ün snapshot modelinde snapshot önceki event'leri özetliyor ve yalnız snapshot sonrasındaki event'ler replay ediliyor. Eski snapshot formatlarının ayrıca filtrelenebilmesi gerektiği de dokümante edilmiş. 
AxonIQ Docs

Figma da checkpoint'i seq ile ilişkilendiriyor; transaction log checkpoint'ten sonraki eksik aralığı tamamlıyor. 
Figma

Senin rebuildCheck() için doğru model

Snapshot eklediğinde üç şeyi ayır:

Commit log           = canonical truth
Snapshot             = disposable derived acceleration
Node / Edge tables   = disposable derived projection

Snapshot kaydında en az:

canvasId
throughSeq
snapshotSchemaVersion
reducerVersion
stateHash
state
createdAt

tut.

Sonra iki oracle seviyesi kullan:

Hızlı kontrol

snapshot@50000
+ commits 50001..head
→ state
→ Node/Edge ile karşılaştır

Güçlü kontrol

commit 1..head
→ state
→ snapshot+tail sonucu ile karşılaştır
→ Node/Edge ile karşılaştır

Güçlü kontrol CI, nightly job veya production sampling olabilir.

Böylece snapshot'ın kendisi hiçbir zaman gerçeğin kaynağı olmaz.

Snapshot reducer sürümüyle uyumsuzsa migrate etmeye çalışmak yerine atıp yeniden üretmek, mümkün olduğunda daha güvenli modeldir.

3 — Snapshot aralığını “her 1000 commit” diye sabitlemek doğru desen değil

Event-sourcing pratiğinde genel görüş threshold'un event sayısına göre değil, ölçülen replay maliyetine göre belirlenmesi yönünde. Gerçek bir practitioner's case'de birkaç bin event taşıyan stream'lerde command latency fark edilir hale gelince snapshot uygulanmış. 
Domain Centric

EventSourcingDB'nin Mart 2026 değerlendirmesi de birkaç bin küçük event'in modern sistemlerde çok hızlı replay edilebildiğini ve arbitrary “her 100 event” snapshot yaklaşımının çoğu zaman premature optimization olduğunu savunuyor. Kendi örneklerinde 8.610 event yaklaşık 5 MB tarih oluşturmuş. 
docs.eventsourcingdb.io
+1

Co-Pronoia'da daha iyi tetikleyici

Commit sayısından çok:

snapshot'tan sonraki op sayısı

serialized event byte miktarı

full replay süresi

branch-base üretme süresi

time-travel latency

projection rebuild süresi

ölçülmeli.

Özellikle Gemini'nin tek commit içinde yüzlerce op üretebilmesi nedeniyle:

1 commit ≠ 1 birim replay maliyeti.

Bu senin sisteminde özellikle önemli.

4 — 10k / 100k / 1M için gerçekçi kırılma noktası

Kesin bir event-count sınırı yok. Event boyutu ve reducer işi sayıdan daha önemli. Sahada birkaç bin event'te snapshot ihtiyacı gören sistem olduğu gibi, EventStoreDB/Kurrent kullanan bir practitioner's case'de 160 milyon event'lik tek stream'in veritabanında çalıştığı, fakat bunun özellikle yapılmaması gereken bir tasarım olduğu aktarılıyor. 
Domain Centric
+1

Canvas geçmişi	Co-Pronoia için değerlendirmem
10k commit	Node/Edge normal read model ise rahatlıkla makul. Full replay sadece test/recovery ise sorun beklemem.
100k	Full replay'i interaktif request path'e sokmamak gerekir. Snapshot/checkpoint pratik olarak anlamlı hale gelir.
1M	Genesis replay yalnız offline rebuild/audit aracı olmalı. Interactive time-travel/branch restore snapshot + tail kullanmalı.
10M+	Tek canvas logunun event granularity'si ve retention modeli tekrar sorgulanmalı.

KurrentDB'nin Temmuz 2026 time-travel dokümanı da uzun geçmişlerde ve sık tarihsel sorgularda periodic state snapshot'ları öneriyor. 
Kurrent Docs

Önemli: senin mimarinde 100k commit olması, normal canvas açılışında 100k event okuyacağın anlamına gelmiyor. Node/Edge zaten projection olduğu için bu avantajı korumalısın.

5 — Event schema evolution şu anda snapshot'tan daha kritik

2021'de 19 event-sourced sistem ve 25 mühendisin incelendiği endüstri çalışmasında schema evolution için beş gerçek kullanım paterni bulunmuş:

versioned events, weak schema, upcasting, in-place transformation, copy-and-transform. Projection rebuild ve data privacy de en önemli pratik sorunlar arasında. 
arXiv
+1

2021 kaynağı eski olsa da bulgular hâlâ güncel: EventSourcingDB'nin 2026 dokümanı event tiplerini .v1, .v2, .v3 olarak açıkça versionlamayı öneriyor; Axon 5.x de payload conversion/upcasting ayrımını hâlâ aynı problem için kullanıyor. 
docs.eventsourcingdb.io
+1

Desenlerin karşılaştırması
Yöntem	İyi olduğu durum	Sorunu
Tolerant reader	Yeni optional alan, açık default	Semantic değişikliklerde hızla dağılır
Weak schema	Erken ürün geliştirme	Hataları runtime'a iter
Explicit v1/v2	Audit ve uzun yaşam	Reducer sayısı büyür
Upcasting	Eski log immutable kalsın	Zincir uzadıkça karmaşık
In-place rewrite	Runtime çok sade olsun	Immutable/audit garantisini bozar
Copy-transform	Büyük migration	Operasyonel olarak ağır
6 — Senin “eski event'te alan yoksa replay sırasında normalize et” çözümünün sınırı

Şu durumda gayet kabul edilebilir:

TypeScript
if (event.foo === undefined)
  event.foo = deterministicDefault

ama yalnızca default:

bağlamdan bağımsız,

deterministik,

zamanla anlam değiştirmeyen,

undefined ile explicit değer arasında semantic fark yaratmayan

bir şeyse.

Şunlardan biri başladığında bunun yerine gerçek event decoder/upcaster gerekir:

Örnek

Bugün:

old node.aiAllowed undefined
→ true kabul et

İki yıl sonra politika:

undefined
→ region.aiAllowed değerini miras al

olursa eski event artık kendi başına yorumlanamaz.

Daha tehlikelisi:

replay(v1 reducer) != replay(v3 reducer)

haline gelmesidir.

tldraw'ın güncel sync katmanı bu sebeple shape schema migration'larını client ve server'ın ortak bilmesini şart koşuyor; migrations yoksa farklı client sürümlerinin birlikte çalışmasında hata oluşabileceğini açıkça belirtiyor. 
tldraw

Co-Pronoia için önerim

Şimdi:

TypeScript
type StoredOp = {
  schemaVersion: number
  ...
}

ve tek giriş noktası:

TypeScript
decodeStoredOp(raw) -> CurrentOp

oluştur.

Reducer raw historical JSON görmemeli.

7 — before + after modeli audit için çok iyi, fakat schema evolution maliyetini artırıyor

Burada literatürdeki standart event'lerden biraz daha pahalı bir seçim yapıyorsun.

Örneğin:

JSON
{
  "type": "update_node",
  "before": { "...": "full node" },
  "after":  { "...": "full node" }
}

her schema değişikliğinde hem before hem after eski formatlarla yaşayacak.

Bu ayrıca:

log boyutunu,

PII tekrarını,

upcast yüzeyini,

serialization maliyetini

artırır.

Ama karşılığında aldığın:

güçlü undo,

human-readable diff,

audit,

deterministic invert

özellikleri Co-Pronoia açısından gerçekten değerli.

Bunu kaldırmazdım. Event versioning'i erken eklerdim.

8 — Graf editörlerinde tek bir standart conflict-resolution algoritması yok
Figma

Figma 2019'da açıkça:

gerçek CRDT kullanmadığını,

merkezi authoritative server sayesinde CRDT'nin decentralization overhead'ini atabildiğini anlatıyor. Dokümanı kavramsal olarak:

Map<ObjectId, Map<Property, Value>>

olarak ele alıyor ve aynı object'in farklı property'leri eşzamanlı değiştiğinde conflict çıkarmıyor; aynı property değişirse server sırasındaki son değer kazanıyor. 
Figma

Bu senin field-level conflict detection modeline çok yakın bir düşünce tarzı.

Excalidraw

Excalidraw'ın 2020 multiplayer tasarımında:

element ID union,

deletion tombstone,

per-element version,

concurrent same-version update için random versionNonce ile deterministic winner

kullanılıyordu. Aynı elementin eşzamanlı değiştirilmesini nadir kabul edip “birisinin kazanmasına” razı olmuşlardı. 
Excalidraw+
+1

2020 kaynağı: Bugünkü Excalidraw internallerinin aynısı olduğunu varsaymıyorum; ama diagram-specific conflict tasarımının gerçek tarihsel örneği olarak hâlâ değerli.

tldraw

Güncel tldraw sync:

confirmed server state,

pending client edits,

automatic conflict resolution,

reconnect/replay,

schema migrations

sağlıyor ve referans Cloudflare mimarisinde canvas başına bir Durable Object kullanıyor. Kamu dokümanında tek canvas için 50 eşzamanlı kullanıcı hedefi veriliyor. 
tldraw
+1

Ancak kamu dokümanlarından exact merge algoritmasını güvenle “CRDT” veya “OT” diye sınıflandıramıyorum.

Miro

Miro kamuya açık ürün dokümanlarında realtime collaborative board davranışını anlatıyor, fakat araştırmada merge/conflict algoritmasını yeterli teknik ayrıntıyla açıklayan authoritative bir engineering kaynağı bulamadım. Bu nedenle Miro'yu CRDT/OT/LWW diye etiketlemek doğru olmaz. 
Miro

Linear

Linear'ın CTO'su Haziran 2023'te şirketin özel realtime sync engine'inin ölçeklenmesini anlatan resmi bir sunum yayımladı. Ancak kamu sayfası diagram-level conflict semantiği açıklamadığından bunu Co-Pronoia'nın merge algoritmasına birebir emsal saymam. 
Linear

9 — Commit tabanlı vs CRDT vs OT vs melez
Özellik	Co-Pronoia tipi commit	CRDT	OT	Melez
Conflict kalitesi – graf	Yüksek, semantic kuralları sen belirlersin	Convergence yüksek, semantic sonuç değişken	Custom transform gerekir	Çok yüksek doğru bölünürse
Denetlenebilirlik	Çok yüksek	Orta; ayrıca tasarlanmalı	Orta-yüksek	Çok yüksek
Yazar/approval	Doğal	Uygulama katmanı gerekir	Uygulama katmanı gerekir	Doğal yapılabilir
Numaralı global sıra	Doğal	Doğası gereği gerekmez; server katmanıyla eklenebilir	Server genelde sıra verir	Eklenebilir
Branch/review	Doğal	CRDT değişiklik DAG'ı mümkün ama product workflow ayrıca gerekir	Zor	Güçlü
Online realtime	İyi	Çok iyi	Çok iyi	Çok iyi
Offline	Orta	Çok iyi	Orta	Çok iyi
Uzun divergence	Explicit merge	Güçlü	Zayıflayabilir	Güçlü
Metadata maliyeti	Düşük/orta	Orta/yüksek	Düşük/orta	Yüksek
Implementation complexity	Orta/yüksek	Library ile orta	Custom ise çok yüksek	En yüksek
Ekosistem	Custom	Yjs/Automerge güçlü	Text editor alanında olgun	Parçalı

OT/CRDT tradeoff'larının hâlâ aktif araştırma konusu olduğunu 2024 Eg-walker çalışması da gösteriyor: araştırmacılar uzun offline divergence'da OT'nin merge maliyetini, CRDT tarafında ise loading/memory maliyetini hedefliyor. Çalışma EuroSys 2025'e kabul edildi. 
arXiv
+1

10 — “CRDT kullanırsam audit kaybolur” tam olarak doğru değil

Bu önemli bir düzeltme.

CRDT ile audit birbirine zıt değil.

Automerge'in güncel binary formatında bir “change” zaten Git commit'ine benzer biçimde tanımlanıyor:

actor ID,

per-actor sequence,

predecessor changes,

optional time,

optional message,

SHA-256 change hash

taşıyabiliyor. 
Automerge

Dolayısıyla üstüne:

userId
serverAcceptedSeq
proposalId
approvedBy
regionPolicyVersion

gibi uygulama metadata'sı koyabilirsin.

Ama bu CRDT'nin kendisinin sana business audit verdiği anlamına gelmiyor.

Örneğin Yjs'in güncel internals dokümanında deletion için kimin veya ne zaman sildiğinin kaydedilmediği açıkça belirtiliyor. 
GitHub

Automerge tarafında da 2026 Temmuz güncellemesinde “author provenance”ın hâlâ geliştirilmekte olduğu yazıyor. 
Automerge

Sonuç

CRDT kullanırsan Co-Pronoia'nın:

author
approval
server seq
business intent
branch
region authorization

katmanını yine kendin yazacaksın.

Bu nedenle “CRDT'ye geçelim ve commit altyapısını atalım” senin ürün için pek mantıklı görünmüyor.

11 — En mantıklı hybrid sınırı: graf değil, uzun metin

Melez kullanacaksan en doğal sınır:

Graph topology / positions / parentId / edges
            ↓
     Commit sistemi


Node description / rich text
            ↓
        Yjs/Automerge

olur.

Kısa label'lar için yapmazdım.

Çünkü iki consistency sistemini bağlayınca:

iki undo modeli,

iki history modeli,

cross-system atomicity,

branch diff,

snapshot,

permission,

region enforcement,

supervisor approval

problemleri doğuyor.

Örneğin “node oluştur + açıklamasına CRDT text yaz” tek logical action iken iki persistence protocol'üne dönüşüyor.

Araştırmada tam olarak “commit-sourced graph + CRDT node text” biçiminde kamuya açık, production-proven bir diagram ürünü bulamadım. Figma birden fazla CRDT-inspired yapıyı birleştiriyor, ama senin tarif ettiğin commit/CRDT boundary ile aynı model değil. 
Figma

Dolayısıyla hybrid'i şimdiden eklemeyi önermiyorum.

12 — Otomatik branch bence tasarımın en deneysel kısmı

İncelediğim ürünler içinde:

Figma realtime conflict'leri sessizce resolve ediyor,

tldraw conflict resolution'ı gizliyor,

Excalidraw historical modelde deterministic winner kullanıyordu,

Figma'nın gerçek branching özelliği ise explicit kullanıcı workflow'u.

Figma branch conflict ekranında main ve branch değişikliklerini yan yana gösterip kullanıcının her conflict için hangisini alacağını seçmesine izin veriyor. 
Figma Help Center

Sen ise:

Push
↓
conflict
↓
otomatik branch oluştur

diyorsun.

Bu tamamen geçersiz değil, fakat bir product UX innovation; established norm değil.

Figma'nın 2020 deneyimi özellikle önemli: küçük realtime conflict'lerin kolay olduğunu, fakat büyük difflərdə sistemin user intent'i anlayamadığını ve 2D documents için anlaşılır visual merge UI tasarlamanın zor olduğunu söylüyor. 
Figma

Bu nedenle

Branch'e düşme gizli gerçekleşmemeli.

Push sonucu şu kadar açık olmalı:

Commit ana dala uygulanmadı.
12 değişiklikten 1'i Ayşe'nin son değişikliğiyle çakışıyor. Değişikliklerin Plan A dalına kaydedildi.

Hatta Push'tan önce preflight:

✓ 11 değişiklik temiz
⚠ 1 değişiklik çakışıyor
→ Push edilirse branch oluşacak

çok değerli olur.

13 — Staging otomatik branching ihtimalini geometrik değil ama sistematik biçimde artırıyor

Figma offline autosave'de pending edits'i diskte saklayıp yeniden bağlanınca latest server state üzerine tekrar uyguluyor. Bu mekanizmada stale pending data, acknowledgment ve reconnect kaynaklı hatalar yaşadıklarını açıkça anlatıyorlar. 
Figma

Senin staging daha da ilginç:

commit target set =
intent1 targets
∪ intent2 targets
∪ ...
∪ intent20 targets

Dolayısıyla 20 staged değişiklikten yalnız biri conflict olursa tüm commit branch'e düşüyor.

En tehlikeli senaryo

Ali:

A'nın rengini değiştirir

B'yi taşır

C ekler

D'yi siler

15 başka bağımsız işlem yapar

Ayşe sadece B'yi taşır.

Ali Push:

19 temiz
1 conflict

ama sonuç:

20 değişikliğin tamamı branch

olursa kullanıcı “neden C ana canvasta yok?” diyecek.

Bu muhtemelen ilk ciddi UX duvarın olacak.

14 — Per-canvas serialization ölçek açısından şu an gayet savunulabilir

Cloudflare'ın Temmuz 2026 Durable Objects rehberi tam olarak collaborative document gibi coordination atomları için bir globally unique single-threaded writer per entity modelini öneriyor. 
Cloudflare Docs

tldraw da production starter mimarisinde bir canvas/room'u bir Durable Object üzerinde koordine ediyor. 
tldraw

Cloudflare bir individual Durable Object için yaklaşık 1.000 request/s soft limit veriyor; gerçek throughput yapılan serialization, storage ve iş miktarına bağlı. 
Cloudflare Docs

Senin PostgreSQL FOR UPDATE davranışın da beklediğin gibi: aynı canvas satırına yazan diğer transactions lock bırakılana kadar bekler. PostgreSQL 18 bunu açıkça tanımlıyor. 
PostgreSQL

Co-Pronoia için sonuç

“Her canvas tek serialization lane” şu hedef için sorun değil:

onlarca kullanıcı + birkaç agent/canvas.

Sorun canvas'ta 10k commit olması değil.

Sorun:

lock ne kadar süre tutuluyor?

Eğer lock içindeyken:

büyük intent expansion,

full rebuildCheck,

pahalı permission calculation,

büyük JSON parse,

network request

yapılıyorsa doygunluk çok daha erken gelir.

15 — Mutex + DB lock doğru ama gerçek correctness mekanizması DB lock

Process mutex:

process A içindeki requestleri

serileştirir.

Ama process B'yi görmez.

FOR UPDATE ise bütün application replicas için gerçek consistency primitive olur. 
PostgreSQL

Dolayısıyla horizontal scale'de mutex:

queue noise azaltmak,

aynı process'te gereksiz DB contention'ı önlemek

için yararlı olabilir;

ama correctness hiçbir zaman ona bağlı olmamalı.

Alternatifler

1. Mevcut row lock

En basit. Şimdilik benim tercihim.

2. Optimistic append

KurrentDB aynı stream'e append için lock-free optimistic concurrency sunuyor. 
Kurrent Docs

Avantaj:

try append(expectedVersion)
↓
fail
↓
reload/rebase/retry

Dezavantaj: zaten rebase/conflict analysis yaptığın için retry complexity artar.

3. Per-canvas actor / writer

tldraw/Cloudflare modeline yakın.

4. Queue

Çok yoğun AI yazımlarında yararlı olabilir ama interactive latency ve operational complexity ekler.

Bugünkü ölçek hedefinde mevcut PostgreSQL modelini değiştirmezdim.

16 — HTTP mutasyonlarında idempotency mutlaka olmalı

EventSourcingDB'nin güncel common-issues rehberinde duplicate delivery/reconnection karşısında idempotency açıkça öneriliyor. 
docs.eventsourcingdb.io

Örneğin:

POST /push
commit server'da başarılı
↓
response network'te kayboldu
↓
client retry

Eğer client-generated:

clientCommitId

yoksa iki identical commit yazabilirsin.

Önerim:

UNIQUE(canvasId, actorId, clientCommitId)

ve duplicate request'e önceki commit sonucunu dönmek.

AI/proposal yollarında da aynı kural uygulanmalı.

17 — History pruning, mevcut “Commit log tek gerçek” garantisini kaçınılmaz olarak değiştirir

Üç model var.

A. Cold archive
Postgres:
seq 900001..head


Immutable archive:
seq 1..900000

Audit korunur fakat full replay archive erişimi gerektirir.

B. Canonical baseline / squash
BaselineCreated(seq=900000, fullState)
+
900001..head

Sonra eski log silinir.

Bu durumda artık:

genesis commit log tek gerçek

değil,

baseline + tail tek gerçek

olur.

Kaybedilenler:

baseline öncesi undo,

exact historical diff,

author granularity,

forensic replay.

Axon da snapshot öncesindeki event'leri atarsan snapshot öncesi state'i reconstruct edemeyeceğini açıkça belirtiyor. 
AxonIQ Docs

C. Immutable full archive + online summary

Bence Co-Pronoia için eventual optimum bu.

18 — GDPR/KVKK, append-only log için gerçek bir mimari zorunluluk yaratıyor

KVKK'nın güncel açıklamasına göre işleme sebebi ortadan kalktığında kişisel verilerin silinmesi, yok edilmesi veya anonim hale getirilmesi gerekiyor. “Yok etme”, veriyi hiç kimsenin erişemeyeceği ve geri getiremeyeceği hale getirme olarak açıklanıyor. 
KVKK
+1

Dolayısıyla:

append-only olduğu için silemiyoruz

hukuki bir çözüm değil.

EventSourcingDB örneğinde individual event deletion desteklenmediğinden GDPR-style removal için bütün store'u export → filter/anonymize → fresh instance restore yoluyla yeniden oluşturma anlatılıyor. 
docs.eventsourcingdb.io

Event-driven sistemlerde kullanılan diğer yöntemler:

PII'yi ayrı depoda tutup event'e opaque ID yazmak,

retention,

summary + truncation,

crypto-shredding,

cold archive

olarak uygulanıyor. 
event-driven.io

Co-Pronoia için özellikle önemli

before + after nedeniyle:

bir kullanıcı node'a e-posta/ad/telefon yazarsa aynı PII tarih boyunca birçok commit'e çoğalabilir.

Bu yüzden PII minimization event tasarımının bir parçası olmalı.

Crypto-shredding teknik olarak yararlı olabilir ama “anahtarı sildik = kesin hukuken silindi” şeklinde otomatik bir hukuki sonuç varsayılmamalı; bunu KVKK/GDPR bağlamında ayrıca hukuk değerlendirmesiyle doğrulamak gerekir.

En önemli riskler

Sıralamam şöyle.

1. Staged commit → branch amplification

Senaryo: 30 op'tan biri conflict olur; 29 bağımsız değişiklik de main'e gitmez.

Sonuç: kullanıcı “Push başarılı oldu ama değişikliklerim kayboldu” algısına kapılır.

2. Whole-branch merge'in gerçek 3-way merge olmaması

Branch:

base = seq 100

Main 160'a ilerlemiş.

“Branch'i bütünüyle al” işlemi eğer yalnız branch state'ini main'e uyguluyorsa seq 101–160 arasında main'e eklenen bağımsız işleri ezebilir.

Merge mutlaka:

base
main-head
branch-head

üçlüsünü dikkate almalı.

3. Event normalization'ın semantik schema migration'a dönüşmesi

Yeni default eski event'in anlamını değiştirir.

Sonuç: aynı event log farklı uygulama sürümlerinde farklı graph üretir.

Bu, event sourcing için en ağır correctness hatalarından biridir.

4. Snapshot'ın yanlışlıkla ikinci source of truth olması

Bozuk snapshot + tail replay doğru görünürken genesis replay farklı olabilir.

rebuildCheck yalnız snapshot sonrası event'leri kontrol ederse kendi oracle özelliğini kaybeder.

5. before+after event payload growth

Uzun açıklamalı bir node yüzlerce kez update edilirse her update full before+after taşıyabilir.

Commit sayısından önce event byte size problem olur.

6. Permission semantiğinin history ile uyuşmaması

Örnek:

node region A'dan region B'ye taşınıyor

Kimin yetkisi gerekir?

source region?

target region?

ikisi?

Branch aylar sonra merge edilirse historical region membership mi yoksa current membership mi?

Yanlış cevap güvenlik açığına dönüşebilir.

7. Per-canvas lock içinde pahalı çalışma

Bir AI commit'i 500 op getirir ve permission/conflict/reducer işi transaction lock içinde uzun sürerse aynı canvas'ın tüm yazarları kuyruğa girer.

8. Duplicate HTTP commit

Server commit'i kaydeder, response kaybolur, client retry yapar.

Idempotency yoksa duplicate historical action.

9. Replay'in side effect üretmesi

Reducer replay sırasında WebSocket notification, webhook, e-mail vb. tetiklememeli.

Event sourcing'de replay ile side-effect execution'ın ayrılması klasik bir gereklilik. Figma'nın journal/checkpoint ayrımı da state reconstruction ile live processing'i ayırıyor. 
Figma

10. Privacy history explosion

Node içeriğindeki PII bir kez değil her before/after event'te kalır.

Retention süreci sonradan eklenirse temizlemek çok maliyetli olabilir. 
docs.eventsourcingdb.io
+1

Öneriler
Öncelik	İş	Boyut	Yapılmazsa
P0	eventSchemaVersion + merkezi decoder/upcaster registry	S	Eski history giderek kırılganlaşır
P0	clientCommitId / idempotent Push	S	Retry duplicate commit üretebilir
P0	Replay'in tamamen side-effect-free olduğunu test et	S	rebuild sırasında gerçek aksiyon çıkabilir
P0	Branch merge'i explicit 3-way semantics olarak tanımla	M	Yeni main işleri ezilebilir
P1	Push preflight: clean/conflicting staged ops göster	M	Auto-branch UX ciddi sürpriz üretir
P1	Metrics: replay ms, op/commit, bytes/commit, lock wait, branch rate	S	Snapshot/scale kararlarını kör verirsin
P1	Snapshot formatı: throughSeq + reducerVersion + hash	M	100k+ history recovery/time-travel pahalılaşır
P1	Genesis rebuildCheck CI/nightly + snapshot-tail fast check	M	Snapshot corruption gizlenebilir
P1	Synthetic 10k/100k/1M history benchmark	M	Gerçek kırılma noktanı bilemezsin
P1	Staged batch'in conflict-connected parçalarını analiz et	M	Tek conflict dev commit'i bloke eder
P2	PII classification + retention/squash/archive policy	M/L	Sonradan KVKK temizliği çok zorlaşır
P2	Per-canvas actor/queue modelini yalnız lock wait kötüleşirse değerlendir	L	Şimdi yapılmazsa sorun beklemiyorum
P3	Long rich-text için CRDT spike	L	Şu an yapılmazsa belirgin kayıp yok
P3	Graf çekirdeğini tamamen CRDT'ye taşıma	L/kaçın	Şu an buna gerek görmüyorum

S/M/L burada geliştirme karmaşıklığı sınıfıdır; takvim tahmini değildir.

Özellikle ölçmeni önerdiğim metrikler

Bence production telemetry'de bunlar olmalı:

canvas.commit.lock_wait_ms
canvas.commit.critical_section_ms


canvas.commit.ops
canvas.commit.serialized_bytes


canvas.replay.events
canvas.replay.ops
canvas.replay.ms


canvas.snapshot.age_seq
canvas.snapshot.tail_ops


canvas.merge.auto_success_rate
canvas.merge.branch_rate
canvas.merge.conflict_fields


canvas.staging.age
canvas.staging.ops


canvas.branch.lifetime
canvas.branch.merge_success_rate

Özellikle:

branch_rate staged op count arttıkça nasıl değişiyor?

Co-Pronoia'nın conflict modelinin sağlığını gösterecek en değerli metriklerden biri olur.

Kod okumadan cevaplanamayacak açık sorular

rebuildCheck() nerede çalışıyor? Yalnız testte mi, production mutation path'te mi? Full replay production write path'teyse ölçek değerlendirmesi ciddi biçimde değişir.

before/after full entity snapshot mı, yoksa yalnız değişen alanlar mı? Event log büyümesi buna çok bağlı.

Branch'in state modeli nedir? Branch kendi commit stream'ini baseSeq üzerinden mi replay ediyor, yoksa ayrı materialized state'i mi var?

“Branch'i bütünüyle al” tam olarak nasıl uygulanıyor? Three-way merge mi, branch ops replay mi, snapshot replacement mı?

Authorization move işlemlerinde before ve after koordinatlarına ayrı ayrı bakıyor mu? Region crossing burada kritik.

Undo authorization hangi zamanda değerlendiriliyor? Original commit authorisation mı, undo yapan kullanıcının current authorization'ı mı?

Region definition değişikliği Commit logunun parçası mı? Değilse geçmişteki authorization kararını birebir reconstruct etmek mümkün olmayabilir.

Intent re-expansion tamamen deterministic mi? Aynı (intent,currentState) her server version'da birebir aynı ops'u üretmek zorunda mı?

Conflict target extraction parentId, edge endpoints ve cascade-delete gibi implicit dependencies'i kapsıyor mu?

Push idempotency şu an var mı?

Branch merge sırasında permission choke point tekrar çalışıyor mu ve current policy mi kullanıyor?

Bir commit'in maksimum op/payload boyutu sınırlandırılmış mı? Bir agent'ın tek commit'te binlerce op üretmesi lock latency ve transaction boyutunu değiştirebilir.

WebSocket sequence gap recovery nasıl yapılıyor? Client seq=500, sonra broadcast 502 alırsa 501'i HTTP ile fetch ediyor mu?

Materialized Node/Edge update ile Commit insert aynı PostgreSQL transaction'ında mı? Değilse crash recovery davranışını ayrıca incelemek gerekir.

Sonuç

Co-Pronoia için ben commit/event-sourced graph çekirdeğini korurdum.

Senin ürünün saf “herkes aynı anda şekilleri sürüklesin” whiteboard'undan farklı olarak:

kim yaptı,

hangi intent'ten geldi,

hangi sırada kabul edildi,

AI mı insan mı,

supervisor onayladı mı,

hangi değişiklik geri alınabilir,

hangi branch'te,

hangi region policy'sinden geçti

sorularına birinci sınıf cevap vermek istiyor.

Bu nedenle CRDT'ye tamamen geçiş bazı collaboration problemlerini kolaylaştırırken ürünün esas güçlü tarafını tekrar uygulama katmanında yeniden inşa etmeni gerektirir. Automerge bile değişiklikleri actor/sequence/dependency taşıyan commit-benzeri bir DAG olarak saklıyor; yani modern CRDT tasarımı ile commit mantığı birbirinin zıttı değil. 
Automerge

Mimariyi değiştirmeden önce düzelteceğim sıra (1) versioned event decoder, (2) idempotency, (3) staged-push preflight/branch UX, (4) gerçek 3-way branch merge, (5) replay/lock telemetry, (6) ölçüm gerektirince snapshot olurdu. Snapshot ve CRDT bunun arkasından geliyor.
