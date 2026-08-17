# https://chatgpt.com/g/g-p-6a7f040339d481918c9b17531913072f-co-pronoia-arastirma/c/6a7f074e-3728-83ed-abf1-6319d857d60a

İncelemeyi Project’e yüklenen gerçek shared/server/web/db/docs bundle’ları üzerinden yaptım. Aşağıdaki değerlendirmede dış kaynak araştırmasını doğrudan mevcut implementasyonla eşleştiriyorum.

Yönetici özeti

Temel mimari sağlam ve ürün vaadine uygun. Co-Pronoia’nın modeli klasik CRDT’den çok, merkezi sıralı event log + optimistic concurrency + semantik alan bazlı merge + version-control tarzı branch modelidir. Figma’nın tasarım nesneleri için kullandığı merkezi, property-granular yaklaşım buna CRDT’den daha yakın bir emsaldir. 
Figma

10k commit bugün mimari kriz değil; fakat mevcut kodda replay kullanan yollar doğrudan O(history). stateAt, stateDelta, branch state ve rebuildCheck snapshot olmadan sıfırdan oynatıyor. 100k+ seviyesinde özellikle MCP/branch/time-travel istekleri pahalılaşacaktır. server/src/commitService.ts:129-173,189-203,506-514.

Snapshot eklemek rebuildCheck() garantisini zayıflatmak zorunda değil. Figma checkpoint A + journal → checkpoint B sonucunu byte-for-byte doğrulayıp yaklaşık 400 bin başarılı kontrol sonrası yayına çıkmıştı. 
Figma

En acil problem snapshot değil, staging nedenselliği. Pending değişiklik varken WS ile headSeq ilerliyor; push anında güncel headSeq gönderiliyor. Dolayısıyla kullanıcı değişikliğe başladığı head kayboluyor ve aslında çatışması gereken bir uzak değişiklik sessizce overwrite edilebilir. web/src/store/graphStore.ts:158-165,329-333,485-495.

İkinci kritik problem branch merge semantiği. Kod gerçekten branch durumunu “wholesale” main’e dönüştürüyor. Branch açıldıktan sonra main’de yapılmış ilgisiz değişiklikler de geri alınabilir. server/src/commitService.ts:196-213; test bunu açıkça sözleşme olarak yazıyor: server/src/commitService.test.ts:365-379.

Event schema evolution şu anda yalnız tolerant-reader/default normalization seviyesinde. Persist edilen explicit event/op version yok. Yeni birkaç semantik değişiklikten sonra applyOp() legacy uyumluluk katmanına dönüşmeye başlar. shared/src/ops.ts:41-53; shared/src/types.ts:57-63; db/prisma/schema.prisma:263-277.

CRDT’ye tüm grafı geçirmek için bugün güçlü bir neden görmüyorum. Audit, supervisor approval, canonical sequence ve branch review Co-Pronoia için birincil özellikler. CRDT yalnız uzun eşzamanlı metin alanlarında ileride anlamlı olabilir.

Kanvas başına serialization doğru bir başlangıç; Figma da tek dosya için tek authoritative writer sahipliği kullanıyor, tldraw da room/canvas başına Durable Object mimarisini öneriyor. 
Figma
+1

Buna karşılık Co-Pronoia lock’u aldıktan sonra tüm grafı tekrar DB’den yüklüyor; ileride darboğazı büyük olasılıkla seq sayacından önce bu transaction süresi yaratacaktır. server/src/commitService.ts:379-389,445-458,498-503.

Exact undo invariant kodda anlatıldığı kadar mutlak değil: ilk konumu null olan bir move_node revert edildiğinde (0,0) oluyor; restore da koordinatı tekrar null yapamıyor. shared/src/ops.ts:105-122; server/src/commitService.ts:628-629.

1. Önce: gerçek kod mimari özetinizi ne kadar doğruluyor?

Büyük ölçüde doğruluyor. Op sözlüğü gerçekten sadece altı işlemden oluşuyor ve update_edge yok: shared/src/types.ts:57-72. İstemci intent’lerini tam before/after op’larına genişleten kod saf ve ortak shared katmanda: shared/src/expand.ts:33-40,65-123. Web önizleme de aynı expansion/apply kodunu kullanıyor: web/src/store/applyIntents.ts:1-30.

Node/Edge gerçekten materialized current state rolünde ve commit ile aynı DB transaction’ında güncelleniyor: server/src/commitService.ts:445-462. rebuildCheck() main commit’lerini replay ederek materialized tablolarla karşılaştırıyor: server/src/commitService.ts:506-514. Hatta linkedCanvasId için DB FK koyulmamasının gerekçesi doğrudan “commit dışında Node değişirse rebuildCheck bozulur” şeklinde yazılmış: db/prisma/schema.prisma:230-242.

İki terminolojik düzeltme var. Birincisi, Commit.ops PostgreSQL açısından JSON/JSONB değil String içinde JSON: db/prisma/schema.prisma:263-276. İkincisi, seq main’e özel değil; branch commit’leri de aynı kanvas-global sayaçtan numara alıyor. Buna karşılık headSeq() yalnız main commit’lerinin max seq değeridir. server/src/commitService.ts:96-102,379-390. Dolayısıyla main tarihinde sayısal boşluklar bulunabilir.

2. Replay maliyeti ve snapshot stratejisi
2.1 Yerleşik snapshot deseni

Literatürde/pratikte en yaygın model:

snapshot Sₙ + Sₙ’den sonraki event tail → güncel durum.

Axon Framework 5.1 snapshot politikasını event sayısı, sourcing süresi veya belirli bir tetikleyici olaya göre çalıştırabiliyor ve özellikle “ölçmeden snapshot ekleme” yaklaşımından kaçınmayı öneriyor. 
docs.axoniq.io
 EventSourcingDB’nin 2026 dokümantasyonu da snapshot’ı bir correctness mekanizması değil performans optimizasyonu olarak görüyor; on binler/yüz binlerce event tek subject altında birikmişse aggregate modelinin de sorgulanmasını öneriyor. 
EventSourcingDB

Sabit bir endüstri standardı olan “her 100 event” veya “her 1000 event” sayısı yoktur. Replay latency bütçesi esas alınır. Co-Pronoia için başlangıç noktası olarak 250–1000 main commit arasında checkpoint, daha sonra p95 replay ölçümüne göre adaptif eşik mantıklı. Bu sayı benim başlangıç heuristiğimdir; kaynaklarda emredilen bir standart değildir.

Figma’nın durumunda checkpoint zaman bazlıydı: 2022 mimarisinde aktif dosyalar 30–60 saniyede bir tüm-state checkpoint alıyor ve aradaki küçük değişiklikleri journal tutuyordu. Bu Figma’nın in-memory writer mimarisine özgü bir seçimdir, doğrudan Co-Pronoia’ya kopyalanmamalı. 
Figma

Co-Pronoia’da bugün snapshot’tan yararlanacak yollar

Şu an hepsi sıfırdan replay ediyor:

stateAt(seq) → server/src/commitService.ts:129-133

main replay → server/src/commitService.ts:158-173

branch state → base main replay + branch replay, server/src/commitService.ts:189-193

stateDelta() → geçmiş state’i tekrar replay, server/src/commitService.ts:141-155

rebuildCheck() → yeniden tam replay, server/src/commitService.ts:506-514

Normal UI current-state okuması ise zaten materialized Node/Edge tablosundan geliyor, dolayısıyla her sıradan GET 10k eventi replay etmiyor. server/src/commitService.ts:87-94. Bu önemli: 10k commit’e ulaştığınız anda bütün uygulama yavaşlamaz; time-travel/delta/branch/oracle yolları yavaşlar.

2.2 rebuildCheck() snapshot sonrası nasıl korunmalı?

Burada Figma çok güçlü bir referans. Figma yeni journal’ını dark launch sırasında şu invariant ile doğrulamış:

checkpoint A + A→B journal kayıtları = checkpoint B

ve sonucu byte-for-byte karşılaştırmış. Yaklaşık 400 bin ardışık doğrulama sonrasında %100 rollout yapmış. Yayınlandığı 2022 tarihinde journal günde 2,2 milyardan fazla received change işliyordu. 
Figma

Co-Pronoia için üç katman öneririm:

Fast oracle: latestSnapshot + tail == materialized Node/Edge.

Snapshot oracle: previousSnapshot + segment == nextSnapshot, hash/state equality.

Full oracle: test/periodik background verification sırasında hâlâ empty + bütün main history == materialized.

Yani snapshot source of truth olmaz; disposable cache olarak kalır.

Örneğin:

CanvasSnapshot
  canvasId
  mainSeq
  snapshotSchemaVersion
  stateBlob
  stateHash
  createdAt

stateAt(9432):

latest snapshot <= 9432
          +
main commits snapshot.seq < seq <= 9432
          =
state

Snapshot decode edilemiyorsa veya version desteklenmiyorsa bir önceki snapshot’a, en kötü durumda full replay’e düşersiniz.

2.3 10k / 100k / 1M nerede kırılır?

Burada tek bir gerçek “event sayısı duvarı” yok. Aynı event sayısı farklı payload, storage ve reducer maliyetlerinde birkaç büyüklük mertebesi farklı sonuç verebilir. Axon’ın da event count yerine sourcing time ölçmesini özellikle desteklemesinin nedeni bu. 
docs.axoniq.io

10k: İyi indekslenmiş küçük olaylar için başlı başına korkutucu değil. Fakat Co-Pronoia’da branch/time-travel talebi bütün 10k JSON op listesini okuyup parse/apply ediyor. Dolayısıyla request-path full replay’i bu aşamada benchmarklamaya başlamak gerekir.

100k: Hot aggregate için full replay artık mimari olarak şüpheli hale gelir. EventSourcingDB doğrudan “tens or hundreds of thousands” seviyesinde aggregate sınırını yeniden düşünmeyi öneriyor. 
EventSourcingDB
 Kanvas doğal olarak uzun ömürlü tek aggregate olduğundan Co-Pronoia’da aggregate’i parçalamak her zaman doğru olmayacak; bu nedenle snapshot daha mantıklı çözüm.

1M: Kullanıcı isteği üzerinde sıfırdan JSON replay’i tasarım hedefi olmamalı. CRDT dünyasında Automerge özel sıkıştırılmış columnar storage ile tek dokümanda “millions of changes” desteklediğini belirtiyor, fakat bu sıradan PostgreSQL text JSON event replay benchmark’ı değildir. 
Automerge
 Figma da uzun ömürlü dosyayı başlangıçtan replay etmek yerine checkpoint + kısa journal tail kullanıyor. 
Figma

Gerçek vaka sonuçlarının ne kadar değişebildiğine iyi bir örnek: EventStore/Kurrent forumunda 2020’de bir kullanıcı yalnız binlerce aggregate event’inin yeniden kurulmasının onlarca saniyeye ulaştığını rapor ediyor. Bu kontrollü benchmark değil, saha anekdotudur; dolayısıyla eşik olarak alınmamalı ama “event count tek başına yeterli metrik değildir” sonucunu destekliyor. 
Kurrent Discuss Forum

3. Olay şeması evrimi
3.1 Mevcut çözümünüz nedir?

Şu anda pratikte tolerant reader uygulanıyor:

TypeScript
linkedCanvasId: op.node.linkedCanvasId ?? null,
notes: op.node.notes ?? '',
url: op.node.url ?? '',
...
data: normalizeData(op.node.data),

shared/src/ops.ts:41-53.

Ve bunun için doğrudan legacy-event regression testi var: shared/src/ops.test.ts:54-67.

Bu, “yeni optional alan geldi; geçmişte olmayan event için anlamı boş/default” durumunda gayet iyi çözümdür.

3.2 Nerede ölçeklenmez?

Aşağıdaki değişikliklerden itibaren:

foo alanı bar olarak rename olursa,

eski status="done" ile yeni done aynı anlamı taşımıyorsa,

bir eski op artık iki yeni op’a dönüşmek zorundaysa,

bir event type parçalanır/birleşirse,

default değer event’in tarihine veya başka event’lere bağlıysa,

yeni invariant eski eventlerin doğrudan applyOp edilmesini geçersiz kılıyorsa.

Axon 5.1 bu ayrımı açıkça yapıyor: basit payload conversion çoğu uyumluluk vakasında yeterliyken, event bölme/birleştirme, kimlik değiştirme veya yapısal dönüşümlerde upcaster chain gerekiyor. 
docs.axoniq.io

2021’de 25 mühendisin 19 gerçek event-sourced sistem üzerindeki deneyimlerini inceleyen akademik çalışma da üretimde beş temel yaklaşım bulmuştu: versioned events, weak schema, upcasting, in-place transformation ve copy-and-transform. 2021 kaynağı 2024 öncesi olsa da, Axon 5.1’in 2026 dokümantasyonunun hâlâ version/upcasting modelini kullanması nedeniyle teknik sonuç güncelliğini koruyor. 
arXiv
+1

Co-Pronoia için önerim

Persist edilen her op için explicit version ekleyin:

TypeScript
{
  v: 2,
  op: "update_node",
  ...
}

ve okuma yolu:

stored JSON
   ↓
decode
   ↓
upcast v1 → v2 → v3
   ↓
CurrentOp
   ↓
applyOp()

Legacy compatibility applyOp() içine yayılmamalı. applyOp() mümkün olduğunca yalnız mevcut canonical schema’yı anlamalı.

Şu anda explicit event version yok: shared/src/types.ts:57-63. Commit tablosunda da yalnız ops String var: db/prisma/schema.prisma:263-277.

Snapshot’ın version’ı event version’dan ayrı tutulmalı. Bir event-v3 stream’i snapshot-v5 formatına sahip olabilir.

4. Commit tabanlı çatışma vs CRDT / OT

Co-Pronoia’nın bugünkü algoritmasını en doğru şekilde şöyle sınıflandırırım:

Centralized optimistic concurrency + semantic/property-level conflict detection + automatic disjoint rebase + persistent conflict branch.

Bu standart Git değil, CRDT değil, OT değil.

Conflict target algoritmanız da gerçekten anlattığınız gibi: node add/delete wildcard, update field bazlı, move x/y, edge id bazlı. server/src/commitService.ts:520-590.

Bir nüans: data nesnesi anahtar bazlı değil, tek alan kabul ediliyor. Yani eşzamanlı data.owner ve data.estimate değişiklikleri aslında ayrık olmasına rağmen çatışır. Bu kasıtlı biçimde belgelenmiş: shared/src/types.ts:42-54.

Figma

Figma’nın 2019 açıklaması şaşırtıcı derecede benzer: document’ı kabaca ObjectID → Property → Value şeklinde düşünüyor; farklı object property’lerine yapılan değişiklikler çatışmıyor, aynı object + aynı property’ye yazılırsa server’ın gördüğü son değer kazanıyor. Merkezi server ordering olduğu için CRDT timestamp’ine ihtiyaç duymuyorlar. 
Figma

Figma özellikle “biz gerçek CRDT kullanmıyoruz; merkezi authority olduğu için CRDT’nin merkeziyetsizlik maliyetini kaldırabiliyoruz” diye açıklıyor. 
Figma

Bu, Co-Pronoia’nın graf katmanı için çok önemli bir doğrulama: diyagram editörü olmak otomatik olarak Yjs/Automerge kullanmanız gerektiği anlamına gelmiyor.

Excalidraw

Excalidraw’ın 2020 tarihli kamuya açık algoritması daha basit: element başına version, eşit versiyonda deterministic versionNonce; aynı elementi eşzamanlı düzenlemede bir taraf kazanıyor. Ekip o tarihte aynı-element concurrent edit’in nadir olduğunu açıkça kabul etmişti. 
Excalidraw+

Bu 2020 tarihli tarihsel kaynak; bugünkü iç implementasyonun eksiksiz tarifi olarak kullanılmamalı. Ancak diagram domain’inde “her şeyi character-level merge etmek zorunda değilsiniz” örneği olarak hâlâ yararlı.

tldraw

Güncel tldraw multiplayer dokümantasyonu built-in conflict resolution, connection recovery ve canvas başına 50 eşzamanlı kullanıcı hedefini ilan ediyor; self-host starter’ı Cloudflare Durable Objects üzerinde ve aynı mimarinin tldraw.com’da yüz binlerce collaboration session’ında kullanıldığını söylüyor. Ancak public belgeler, conflict algoritmasını CRDT/OT olarak sınıflandıracak yeterli teknik ayrıntı vermiyor. 
tldraw

Miro

Miro’nun güncel kaynakları real-time/async multiplayer canvas’ı doğruluyor fakat yaptığım taramada merge algoritmasını CRDT, OT veya başka belirli bir teknik olarak güvenilir biçimde açıklayan resmi teknik yayın bulamadım. Bu nedenle Miro’yu herhangi bir sütuna zorla koymak doğru olmaz. 
Miro
+1

Linear

Linear’ın 2026’daki kendi teknik işe alım sayfası “proprietary WebSocket data sync framework built for speed and offline support” diyor ve 2023 tarihli real-time sync talk’ına referans veriyor; fakat public metinden CRDT/OT sonucu çıkmıyor. 
Linear

5. CRDT denetlenebilirliği gerçekten kaybeder mi?

Tam olarak değil.

Automerge bugün:

tüm change history’yi tutabiliyor,

change başına actor identity içeriyor,

actor-local sequence numarası kullanıyor,

fork/heads/merge kavramlarına sahip. 
Automerge
+2
Automerge
+2

Dolayısıyla “CRDT’de yazar veya history olamaz” yanlış olur.

Ama Co-Pronoia için kritik kayıp şudur:

CRDT doğal olarak tek canonical global acceptance order ve ‘bu değişiklik supervisor tarafından seq=817 olarak kabul edildi’ semantiğini sağlamaz.

Actor ID, insan hesabı/authorization identity değildir. CRDT merge’i de “proposal kabul edildi” anlamına gelmez. Bunları ayrıca uygulama katmanında kurmanız gerekir.

Yani teorik olarak:

CRDT local changes
      ↓
authenticated actor
      ↓
server validation / approval
      ↓
canonical acceptance commit seq

yapabilirsiniz. Fakat bu durumda zaten mevcut commit sisteminin önemli bölümünü CRDT’nin üstüne tekrar inşa etmiş olursunuz.

Bu yüzden sizin audit/supervisor/AI-region modelinizde grafın tamamını CRDT’ye geçirmek net kazanç değil.

6. Melez model gerçekten uygulanıyor mu?

Burada Figma’nın 25 Haziran 2025 Code Layers yazısı son derece iyi bir örnek.

Figma kendi normal design node property senkronunun kısa text/property için LWW benzeri modelle iyi çalıştığını; fakat binlerce satırlık kaynak kod için çöktüğünü açıkça söylüyor. OT ve CRDT’yi değerlendirip kod katmanlarında Eg-walker kullanmışlar. Eg-walker divergent event graph’ı geçici CRDT yardımıyla reconcile edip sonucu tekrar lineerleştiriyor. 
Figma

Yani aynı üründe:

design graph/property fields → basit merkezi property sync
large source-code text       → özel concurrent text algorithm

var.

Bu sizin için çok iyi model:

Node title/status/position/edges → mevcut CommitService
Node notes/rich text             → gerekirse Yjs/Automerge/Eg-walker

Ancak bugün yapmazdım. Notes içinde iki kişinin aynı anda karakter seviyesinde yazmasının gerçekten ürün ihtiyacı olduğu kanıtlandıktan sonra.

OT tarafında ShareDB de arbitrary JSON document içinde özel OT subtype kullanmaya izin veriyor; JSON0 örneğin text editing subtype’ını yapı içine gömebiliyor. Fakat JSON0 dokümanı large-op transform complexity’sinin O(a*b) olduğunu ve implementation’ın zor olduğunu açıkça söylüyor. 
share.github.io
+1

7. Karşılaştırma tablosu
Eksen	Co-Pronoia tarzı commit	CRDT	OT	Melez
Ayrık graf değişiklikleri	Çok iyi	Çok iyi	İyi	Çok iyi
Aynı scalar field	Branch / explicit review	Deterministic resolution; bazı CRDT’ler kaybeden değeri de tutar	Transform kurallarına bağlı	Alana göre
Aynı uzun metin	Zayıf	Çok iyi	Çok iyi	Çok iyi
Graf invariant’ları	Kolay/merkezi	Ek repair/validation gerekebilir	Structural transform zor	Orta
Canonical global sıra	Doğal	Doğal değil	Server OT ile mümkün	Mümkün
İnsan audit trail’i	Çok güçlü	Actor/history var ama business identity ek katman	Server log ile güçlü	Çok güçlü kurulabilir
Approval/supervisor	Doğal	Ek katman gerekir	Ek katman gerekir	Doğal tutulabilir
Uygulama karmaşıklığı	Orta	Orta–yüksek	Graf için yüksek	En yüksek
Tek hot canvas ölçeği	Writer throughput ile sınırlı	Çok güçlü	Merkezi transform servisiyle sınırlı	Güçlü fakat karmaşık
Offline-first	Zayıf–orta	Mükemmel	İyi olabilir	İyi–mükemmel
Ecosystem	Custom	Yjs/Automerge çok olgun	ShareDB/CKEditor olgun fakat daha uzman	Parçalar olgun, entegrasyon custom
Co-Pronoia uyumu	Bugün en iyi	Tüm graf için gereksiz	Tüm graf için gereksiz	İleride notes/code için güçlü

Automerge farklı properties üzerindeki concurrent değişiklikleri doğrudan merge eder; aynı property conflicts’inde deterministic seçim yaparken conflict bilgisini de erişilebilir tutabilir. 
Automerge
+1
 ShareDB ise OT ile JSON collaboration, offline reconnection sync ve historic versions sunar. 
share.github.io

8. Otomatik branch ve kullanıcı deneyimi

Burada doğrudan “diagram editor automatic conflict branch UX” üzerine güçlü kullanıcı araştırması bulamadım. Dolayısıyla bunun ergonomisinin kanıtlandığını söylemem.

En yakın gerçek ürün analoğu Dropbox’ın “conflicted copy” davranışı: eşzamanlı/offline çakışmada iki versiyonu koruyor, otomatik merge etmiyor ve kullanıcıya manuel karşılaştırma görevi bırakıyor. Güncel yardım dokümanında bunun kullanıcıya veri kaybettirmediği ama iki dosyayı karşılaştırıp merge etme yükü yarattığı açık. 
Dropbox Help Center
+1

Figma’da branch ise başka amaçla tasarlanmış: çatışma olduğunda sürpriz biçimde oluşan branch değil, WIP/approved çalışma alanlarını bilinçli ayıran kullanıcı kontrollü bir workflow. Figma özellikle merge sırasında main’in değişmesi veya bağlantının kopması gibi durumları UX problemi olarak sayıyor. Bu 2021 kaynağı tarihsel olmakla beraber branching UX prensipleri açısından hâlâ geçerli. 
Figma

Co-Pronoia UI’si bugün branch’i gizlemiyor:

web/src/store/graphStore.ts:184-190

kullanıcıya:

değişiklikleriniz X dalına kaydedildi

bildirimi veriyor ve Branch panelini açıyor.

Bu doğru yönde. Fakat kullanıcıya “branch” kavramından önce değişiklik düzeyinde ne oldu gösterilmesi daha iyi olur:

3 değişikliğiniz ana hatla çakıştı.
• “API Tasarımı” başlığı
• “Auth” durumu
• e12 bağlantısı


[Karşılaştır] [Benim değişikliklerimi uygula] [Ana hattı koru]
9. Koddan çıkan kritik conflict sorunları
9.1 P0 — staging baseSeq kayboluyor

Bu bence araştırmada çıkan en önemli implementasyon riski.

Kullanıcı head=100 iken:

title=A → X stage ediyor.

Başka kullanıcı A → Y commit ediyor; head=101.

WS state geliyor.

Store pending intent’i Y’nin üzerine yeniden uygular ve kullanıcı hâlâ X görür.

Store aynı zamanda headSeq=101 yapar.

Push baseSeq=101 gönderir.

Sunucu bunun head=101’de başlamış yeni değişiklik olduğunu sanır.

A→Y ile A→X çatışması tespit edilmez.

Kod zinciri:

WS canonical state + pending preview rebase: web/src/store/graphStore.ts:158-165,329-333

preview stale intent davranışı: web/src/store/applyIntents.ts:10-30

push anındaki mevcut head: web/src/store/graphStore.ts:485-490

Mevcut server conflict algoritması bunun için aslında yeterli; sadece istemci doğru causal base’i göndermiyor.

Çözüm: ilk pending intent’te:

TypeScript
pendingBaseSeq = headSeq

set edin ve pending sıfırlanana kadar değiştirmeyin.

WS geldiğinde preview yine güncel state üstünde render edilebilir ama push:

TypeScript
baseSeq: pendingBaseSeq

göndermeli.

Bu S iş ve bence ilk yapılması gereken değişiklik.

Figma’nın optimistic client yaklaşımında da server update ile local unacknowledged edit arasındaki görünür flicker bastırılıyor; ancak bu local edit’in nedensel sırasını yeniden tanımlamak anlamına gelmiyor. 
Figma

10. Branch merge semantiği: şu haliyle tehlikeli

Kod yorumu zaten açık:

TypeScript
/** Merge = take the branch's state wholesale as one new main commit (diff-based). */

server/src/commitService.ts:196.

Algoritma:

target = branchState(base + branch changes)
current = current main
ops = diffStates(current, target)
apply ops to main

server/src/commitService.ts:196-213.

Örneğin:

base:
A = old
B = old


branch:
A = branch-version
B = old


bu sırada main:
A = main-version
B = important-new-version

“Merge branch” sonucu:

A = branch-version
B = old

olabilir.

Yani branch’in hiç dokunmadığı B değişikliği de geri alınır, çünkü target branch state, branch base’inden sonraki main tarihini içermiyor.

Testiniz bile bu davranışı bilinçli olarak:

merging a branch takes its state wholesale

diye tanımlıyor. server/src/commitService.test.ts:365-379.

Bu ancak UI eyleminin adı gerçekten:

“Ana hattı bu dalın tam durumuyla değiştir”

ise güvenli bir ürün sözleşmesi.

“Merge” kelimesi kullanıcıda büyük ihtimalle üç-yollu birleştirme beklentisi oluşturur.

Daha güvenli çözüm
base   = stateAt(branch.baseSeq)
branch = branchState(branch)
main   = getState()


branchDelta = diff(base, branch)
mainDelta   = diff(base, main)


disjoint branchDelta → main'e uygula
overlap              → merge review

Mevcut targetsOf()/opsConflict() altyapınız bunun büyük bölümünü zaten sağlıyor.

11. Yazma yolu ve ölçek

Kanvas başına serialize etmek başlı başına anti-pattern değil.

Figma’nın authoritative multiplayer servisi dosya durumunu memory’de tutuyor ve split-brain’i önlemek için belirli bir dosyanın journal’ına tek multiplayer instance’ın yazmasını DynamoDB ownership lock ile garanti ediyor. 
Figma

tldraw’ın güncel starter mimarisi de Cloudflare Durable Object tabanlı; room/canvas benzeri tek işbirliği birimini tek stateful koordinatöre bağlamak bu alanda gayet normal. 
tldraw

Co-Pronoia:

TypeScript
private queue: Promise<unknown>

ile process içi serialization yapıyor: server/src/commitService.ts:68-83.

Çok süreçte ise:

SQL
SELECT id FROM "Canvas" ... FOR UPDATE

ile seq atamasını transaction içinde lineerleştiriyor: server/src/commitService.ts:379-390.

Ve bunun için iki farklı service instance’ıyla gerçek test var: server/src/commitService.test.ts:56-70.

Sorun mutex değil, lock altında yapılan iş

Transaction:

Canvas row lock alıyor.

_max(seq) sorguluyor.

Tüm node’ları yüklüyor.

Tüm edge’leri yüklüyor.

tüm ops’ları trial graph’a uyguluyor.

DB tablolarını değiştiriyor.

Commit yazıyor.

transaction kapanıyor.

server/src/commitService.ts:445-458,498-503.

Yani graph 1k → 10k → 100k node büyürse lock hold time de büyüyor.

Ayrıca normal current-head commit daha transaction’a girmeden de loadGraph() çağırıyor: server/src/commitService.ts:234-239; ardından applyCommit() transaction içinde tekrar yüklüyor.

İlk ölçek optimizasyonları

1. Canvas.nextSeq / lastSeq alanı.
Row lock altında _max(seq) yerine:

SQL
UPDATE Canvas
SET lastSeq = lastSeq + 1
WHERE id = ?
RETURNING lastSeq;

daha temiz olur.

2. Ölçün:

commit_queue_wait_ms

canvas_lock_wait_ms

commit_tx_ms

load_graph_ms

nodes/edges per canvas

ops per commit

replay events

replay ms

branch replay ms

3. Eğer hot-canvas throughput gerçek problem olursa: single-writer/actor başına canvas modeli. State memory’de tutulur; DB persistence ardışık gider. Bu Figma/tldraw yönüne yaklaşır. 
Figma
+1

Ama bugün birkaç eşzamanlı insan + birkaç ajan hedefinde bunu baştan yapmak gereksiz.

12. Staging/push deseninin genel başarısızlık kipleri

Mevcut kodunuz iyi bir özelliğe sahip: push hata verirse pending silinmiyor. web/src/store/graphStore.ts:492-495.

Fakat dört failure mode var:

Remote same-field edit: yukarıdaki pendingBaseSeq problemi nedeniyle conflict kaçabilir.

Remote delete: pending intent preview’dan sessizce çıkarılabilir; comment bunu kasıtlı söylüyor. web/src/store/applyIntents.ts:13-28. Push sonunda gerçek hata çıkar.

Büyük staged batch: tek invalid intent bütün commit’i başarısız yapabilir.

Uzun staging süresi: branch olasılığı yükselir ve kullanıcı commit içinde hangi intent’in çatıştığını ayırmakta zorlanır.

İyi UX:

Push öncesi:
12 değişiklik
  9 temiz
  2 uzak değişiklikle örtüşüyor
  1 artık uygulanamıyor

gibi local diagnostic göstermek olabilir; authoritative karar yine server’da verilmelidir.

13. apply ∘ invert invariant’ında gerçek kod farkı

Özetinizde:

apply(invert(apply(g, op))) ≡ identity

deniyor.

Kodda bu tam anlamıyla doğru değil.

move_node inverse:

TypeScript
after: {
  x: op.before.x ?? 0,
  y: op.before.y ?? 0
}

yapıyor. shared/src/ops.ts:105-122.

Yani:

null,null
 → move(100,100)
 → revert
 = 0,0

oluyor; null,null değil.

Üstelik test helper createdCommit / updatedCommit alanlarını comparison’dan bilinçli çıkarıyor: shared/src/ops.test.ts:10-13. Round-trip testindeki move da null değil (5,5) başlangıçla yapılıyor: shared/src/ops.test.ts:15-33.

Aynı sorun restore/branch diff tarafında da var:

TypeScript
if (... && node.x !== null && node.y !== null)
    move_node(...)

server/src/commitService.ts:628-629.

Dolayısıyla geçmiş hedef state’te koordinat null ise mevcut konumu nulla restore edecek op üretilmiyor.

Bu event sourcing çekirdeğinde düzeltilmesi gereken küçük ama gerçek bir semantik delik.

14. Geçmişin budanması

Üç farklı işlem birbirinden ayrılmalı.

A. Snapshot — geçmişi silmez
events: 1 ... 100000
snapshot: 99000
hot replay: 99001 ... 100000

Audit/time travel aynen korunur.

B. Cold archive — operasyonel DB küçülür

Eski event segmentleri immutable object storage’a taşınabilir:

Postgres:
90k..100k


Archive:
1..89999

Tam geçmiş teorik olarak hâlâ vardır, fakat retrieval ve rebuild prosedürü daha karmaşıklaşır. Kurrent’ın temporal-modeling makalesi eski lifecycle segmentlerini kapatma/arşivleme yaklaşımını anlatır. Kaynak 2021 olsa da event-stream lifecycle prensibi hâlâ geçerlidir. 
Capacitor

C. Squash / flatten — garanti kaybeder
1..99999 → synthetic baseline at 100000

sonrasında:

eski time travel gider,

eski per-author audit gider,

eski revert gider,

“gerçek olay geçmişini replay ederim” garantisi cutoff öncesinde gider.

Dolayısıyla buna snapshot değil, history compaction with semantic loss denmeli ve kullanıcı/retention politikasının bilinçli özelliği olmalı.

15. KVKK/GDPR ve append-only log

Burada gerçek bir çatışma var.

Co-Pronoia event’leri node’ların title, description, notes, data gibi serbest içeriğini before/after snapshot olarak tarih boyunca tutabilir. shared/src/types.ts:42-63. Materialized Node’u silmek bu değerleri Commit.ops içinden silmiyor. db/prisma/schema.prisma:263-277.

KVKK’nın yürürlükteki silme/yok etme/anonimleştirme yönetmeliği, işleme şartları ortadan kalktığında kişisel verilerin silinmesi, yok edilmesi veya anonimleştirilmesine ilişkin prosedürü düzenliyor. 
KVKK
 Bu 2017 mevzuatı eski tarihli olsa da KVKK’nın güncel sitesinde hâlen yürürlükteki ilgili düzenleme olarak yayımlanıyor. 
KVKK

Event-store ürünlerinde de fiziksel silme ayrı operasyon: KurrentDB 26.0 dokümanı event’in stream’den görünmez hale gelmesinin dosyadan fiziksel olarak kalkması anlamına gelmediğini, GDPR gibi durumlarda destructive “scavenge” gerektiğini açıkça belirtiyor. 
Kurrent Docs

Co-Pronoia için güvenli prensip:

Event log’a gereksiz PII koymayın.

User identity ile audit identity’yi mümkün olduğunca pseudonymous/stable ID üzerinden tutun.

Serbest node içeriği PII içerebileceği için retention planı tasarlayın.

Silme gereksinimi varsa yalnız “delete_node event” yazmak yeterli kabul edilmemeli; eski payload’ın fiziksel yaşam döngüsü de ele alınmalı.

Daha ağır sistemlerde hassas payload’ı ayrı encryption key ile şifreleyip key destruction/crypto-shredding uygulanabilir; ancak bunun KVKK/GDPR açısından yeterliliği somut veri ve hukuki yükümlülüğe göre değerlendirilmelidir.

Tam append-only forensic history ile koşulsuz fiziksel silme aynı anda yüzde yüz korunamaz. Bir noktada hangi garantinin üstün olduğunu retention policy belirlemek zorunda.

Sıralı risk listesi
Sıra	Risk	Somut bozulma
1 — Kritik	Staging baseSeq drift	Kullanıcı head=100’de edit başlatır, remote same-field edit 101 olur, push 101 gönderir → conflict görülmeden overwrite
2 — Kritik	Wholesale branch merge	Branch’in dokunmadığı fakat branch açıldıktan sonra main’de değişen B alanı eski değerine geri döner
3 — Yüksek	Event version yok	Birkaç rename/semantic migration sonrası applyOp() legacy ?? default yığınına dönüşür; replay sürüm bağımlı hale gelir
4 — Yüksek, büyüyen	Full replay request-path’te	100k+ history’de stateAt/MCP delta/branch paneli saniyelik gecikmelere çıkabilir
5 — Orta/Yüksek	Lock altında full graph load	Hot canvas’ta kullanıcı/ajan push’ları birbirinin DB transaction’ını bekler
6 — Orta	Null-coordinate inverse/restore kaybı	Revert ilk yerleşim öncesindeki null durumunu geri getiremez
7 — Orta	data tek conflict alanı	İki agent farklı custom key düzenlese dahi gereksiz branch oluşur
8 — Orta	Çok uzun personal branch	Her yeni branch editinde eski base + branch geçmişi replay edilir; merge review gittikçe pahalılaşır
9 — Orta	Auto-branch cognitive load	Çatışma çözülür ama kullanıcının açık branch borcu birikir
10 — Uzun vadeli	History/privacy çatışması	Kişisel veri materialized state’ten silinse de event history içinde yaşamaya devam eder
Öneriler
Öncelik	İş	Boyut	Yapılmazsa
P0	İlk stage’de immutable pendingBaseSeq tut	S	Mevcut conflict algoritmasının üstünden sessiz overwrite geçebilir
P0	Branch merge’i gerçek 3-way merge yap; wholesale replace’i ayrı destructive action yap	M	İlgisiz main değişiklikleri merge sırasında geri alınabilir
P0/P1	Null position için exact invert/restore desteği	S	Claimed inversion invariant yanlış kalır
P1	v/event schema version + central upcaster chain	M	Her state-schema değişikliği replay kodunu giderek kırılganlaştırır
P1	Replay latency/lock/queue telemetry ekle	S	Snapshot ve scaling kararlarını event sayısına bakarak tahmin etmek zorunda kalırsınız
P1	Main snapshot/checkpoint cache	M	100k+ history’de time travel, branch ve MCP delta pahalılaşır
P1	Snapshot-to-snapshot + full sampled rebuildCheck	M	Snapshot performans kazandırırken yeni correctness kör noktası yaratabilir
P1	Canvas.lastSeq atomic counter	S/M	_max(seq) gereksiz şekilde serialized write path’in parçası kalır
P2	Branch base→branch delta temsili/cache	M	Uzun branch’lerde her işlem history replay eder
P2	data conflict granularity’yi key bazına indirme	S/M	Agent yoğun kullanımda gereksiz branch sayısı artar
P2	Archive/retention + PII strategy	M/L	KVKK/GDPR talebi geldiğinde event-source garantisini sonradan acil şekilde yeniden tasarlamak gerekir
P3	Canvas başına stateful single-writer actor	L	Yalnız telemetry gerçekten hot-canvas saturation gösterirse sorun; bugün erken optimizasyon
P3	Notes için CRDT/Eg-walker benzeri ayrı engine	L	Yalnız simultaneous rich-text gerçekten ürün gereksinimi olursa eksik kalır; bugün yapılmaması sorun değil
Ben olsam uygulanma sırasını şöyle yapardım

İlk paket: pendingBaseSeq + branch three-way merge + null-coordinate invariant düzeltmesi. Bunlar performans optimizasyonu değil correctness işi.

İkinci paket: Event v field + decoder/upcaster pipeline. Şu anda eski event sayısı hâlâ yönetilebilirken yapmak ileride çok daha ucuz.

Üçüncü paket: Replay ve transaction telemetry. Snapshot eşiğini buradan belirlemek.

Dördüncü paket: Snapshot sistemi:

full log = authority
snapshot = discardable acceleration
Node/Edge = materialized current cache

Bu, mevcut felsefenizi değiştirmez.

CRDT dönüşümü ise listeye koymazdım. Önce gerçekten “aynı notes alanını iki kişi/agent aynı anda character-level düzenlemek” ihtiyacı çıksın. Figma’nın 2019→2025 evrimi de tam olarak bunu gösteriyor: basit design-property sync’i çalışmaya devam ettirip, ancak yeni veri tipi bunu gerektirdiğinde daha ağır algoritmayı eklemişler. 
figma.com
+1

2024 öncesi kaynakların güncellik notu

Figma 2019 multiplayer: tarihsel kaynak, fakat Figma’nın 2025 Code Layers yazısı mevcut design-property sync mimarisine tekrar referans verip onu uzun kodla karşılaştırdığı için ana prensiplerinin hâlâ ilgili olduğu doğrulanıyor. 
figma.com
+1

Figma 2021 branching: bugünkü ürün UI’sinin birebir dokümantasyonu olarak değil, cloud multiplayer + branch UX tasarımının vaka incelemesi olarak kullandım. 
Figma

Figma 2022 journal: yayınlanan 600 ms / 2,2B değişiklik sayıları 2022 üretim verileridir, 2026 performans iddiası olarak yorumlanmamalı. Checkpoint/journal doğrulama deseni hâlâ geçerli. 
Figma

Excalidraw 2020: yalnız tarihsel architecture example; güncel iç algoritmayı doğruladığını iddia etmiyorum. 
Excalidraw+

Kurrent 2020 forum: saha anekdotu, benchmark değil. Eşik belirlemek için değil, stream uzunluğunun tek başına latency tahmini yapmaya yetmediğini göstermek için kullandım. 
Kurrent Discuss Forum

Event-sourcing schema evolution 2021 çalışması: eski ama güncel Axon 5.1 dokümantasyonundaki version/upcasting stratejileriyle uyumlu olduğundan hâlâ güçlü. 
arXiv
+1

Açık sorular

Kod bundle’ı sayesinde normalde kod okumadan cevaplanamayacak birçok nokta kapandı: branch gerçekten wholesale merge ediyor mu, lock transaction içinde mi, staging hangi baseSeqyi gönderiyor, data conflict granularity nedir, replay snapshot kullanıyor mu gibi sorular artık net.

Kalan sorular koddan değil, üretim telemetry’sinden/politikadan cevaplanabilir:

Tipik ve p95 ops/commit kaç?

En büyük kanvasta node/edge sayısı ve serialized state boyutu ne?

10k commit’te stateAt(), stateDelta(), branchState() p50/p95 kaç ms?

FOR UPDATE lock wait p95 kaç ms ve agent burst sırasında ne oluyor?

Staging ortalama kaç saniye/dakika açık kalıyor?

Gerçekte conflict’lerin yüzde kaçı aynı field, yüzde kaçı move?

Kullanıcı başına açık branch sayısının dağılımı ne?

notes üzerinde gerçek simultaneous typing görülüyor mu? Bu CRDT kararının ana metriği olmalı.

KVKK açısından canvas içeriklerinin ve audit history’nin resmi retention süresi ne?

“Merge branch” ürün semantiği gerçekten branch’i aynen main yap mı, yoksa kullanıcı zihninde normal merge mi?

Son kararım: Co-Pronoia’nın event-sourced commit çekirdeğini değiştirmezdim. CRDT’ye taşımak yerine mevcut modeli sertleştirirdim. Öncelik sırası staging causality → gerçek three-way branch merge → event versioning → ölçümlü snapshotting → ancak ihtiyaç kanıtlanırsa text-only hybrid collaboration olmalı. Bu sırayla giderse 10k+ commit / 1000+ node hedefiniz mevcut tasarımın doğal devamı; bugünkü kodda “duvara toslayacağınız” yer event sourcing fikrinin kendisi değil, yukarıdaki birkaç somut implementation ayrıntısıdır.
