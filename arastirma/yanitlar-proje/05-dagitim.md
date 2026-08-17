# https://chatgpt.com/g/g-p-6a7f040339d481918c9b17531913072f-co-pronoia-arastirma/c/6a7f09f0-1cf0-83ed-a8c2-568654cc3200

Co-Pronoia — Dağıtım, Veri Katmanı, Kalite ve Ürün Araştırması
Yönetici özeti

Compile-time local build yaklaşımınız geçerli ve kodda gerçekten uygulanmış; ayrıca esbuild DCE’nin sessizce bozulmasına karşı bundle testi var. Ancak test şu an “seçilmiş semboller yok” garantisi veriyor, “yerel OCI imajında auth kodunun hiçbir izi yok” garantisi vermiyor. server/src/mode.ts:17-27,36-51; server/src/localBundle.test.ts:8-21,27-47,72-90.

En önemli teknik bulgu: seq ataması çok-process güvenli, fakat conflict/branch kararı aynı ölçüde güvenli görünmüyor. Head/conflict hesabı DB kilidinden önce yapılıyor; iki replica aynı head’i okuyup örtüşen değişiklikleri main’e indirebilir. server/src/commitService.ts:228-273,379-390,445-460; shared/src/ops.ts:56-70,84-88.

Kanvas başına ayrı DB havuzu yok; tek PrismaClient paylaşılıyor. Asıl yaşam-döngüsü riski, CommitService nesnelerinin sınırsız Map içinde tutulması. server/src/app.ts:58-80.

WebSocket broadcast, presence, CanvasEvents ve rate limit bugün process-local; ikinci replica açıldığı anda davranış parçalanır. server/src/app.ts:114-166; server/src/canvasEvents.ts:1-25; server/src/claimService.ts:21-34.

Mevcut cloud→local özellik teknik olarak “sync” değil, bir defalık import; daha önce import edilmiş canvas tekrar çekilmiyor. server/src/activationService.ts:250-318; db/prisma/schema.prisma:432-448.

prisma db push prototip aşamasında kabul edilebilir; değerli üretim verisi oluşmadan Prisma Migrate + baseline’a geçilmeli. 
Prisma
+2
Prisma
+2

10k commit/canvas henüz partitioning gerektiren bir hacim değil. Commit günlüğünü budamak ise mevcut “commit log truth source” tasarımını bozar; önce snapshot/checkpoint protokolü gerekir.

Mevcut rebuildCheck() ve fuzz testi çok iyi bir temel; fast-check ile özellikle iki bağımsız server instance yarışını property/integration testine çevirmek en değerli ekleme olur.

Rakipler 2026’da hızla yaklaşıyor: Miro ve FigJam ajanları doğrudan kanvasa aldı; Jira ve Linear ajan orkestrasyonuna ciddi yatırım yaptı. 
Linear
+3
Miro
+3
Figma
+3

Bu nedenle savunulabilir farkınız “AI canvas” değil: audit edilebilir graph commit geçmişi + proposal-only ajanlar + kontrollü approval protokolü.

İncelenen ana ürünlerin kamuya açık belgelerinde bu üç mekanizmanın tamamını tek native modelde birlikte görmedim; fakat boşluk gerçek olsa da hızla daralıyor.

En kritik ürün riski: UI bugün insan onayını bilinçli olarak dışlıyor. 2026 verileri insan-onaylı ajan kullanımının hâlâ baskın olduğunu gösteriyor; configurable approval policy daha güçlü olur. web/src/components/CoPronoiaPanel.tsx:371-386. 
Notion

İlk yol haritası sırası: distributed correctness → migrations/observability → activation/search/comments → MCP onboarding → gerçek local-first sync → zengin planlama/integrations.

Bulgular
1. Tek kod tabanı, iki dağıtım modu ve compile-time kod eleme

Kod, tarif ettiğiniz mimariyi doğruluyor. server/src/mode.ts:17-27 yerel Docker build’inde esbuild define ile __LOCAL_BUILD__=true verildiğini ve auth/admin/Google OAuth/Gemini gibi kodun bundle’dan tamamen düşürülmesinin amaçlandığını açıkça belgeliyor. Daha da önemlisi, server/src/mode.ts:36-51 neden kapının özellikle:

TypeScript
if (!globalThis.__LOCAL_BUILD__ && !localMode)

biçiminde yazılması gerektiğini açıklıyor; exported constant üzerinden yapılan daha doğal bir varyantın module sınırları arasında esbuild tarafından DCE edilemediği tecrübe edilmiş.

Bu gerçek bir compile-time capability stripping deseni. Vue da compile-time feature flag’lerini tree-shaking ile son bundle’dan özellik kodunu kaldırmak için kullanıyor; esbuild’in define ve tree-shaking mekanizmaları da bu modeli doğrudan destekliyor. Bununla birlikte esbuild, tree-shaking’i semantik bir “security boundary guarantee” olarak sunmuyor; kod şekli, side effect analizi ve bazı JavaScript yapıları sonucu etkileyebilir. 
Vue.js
+2
esbuild
+2

Co-Pronoia bu riski ortalamadan daha iyi ele almış. server/src/localBundle.test.ts:8-21 testin tam olarak gate yazımı veya minifySyntax davranışındaki değişikliğin DCE’yi sessizce bozmasını yakalamak için olduğunu söylüyor. server/src/localBundle.test.ts:27-47 sekiz “MUST_BE_GONE” sembol ve temel çekirdek sembollerini tanımlıyor; :72-90 ise local/cloud bundle’ları karşılaştırıyor ve local bundle’ın cloud’un %85’inden küçük olmasını da kontrol ediyor.

Eksik halka: bu test bundle seviyesinde. Güvenlik iddianız ise “yerel image’da bu kod hiç yok”.

Dolayısıyla CI kapısını şu seviyeye yükseltirdim:

Kontrol	Bugün	Önerilen
Bilinen auth/admin sembollerinin final JS’den yokluğu	✅	Koru
Core sembollerin local build’de varlığı	✅	Koru
Local/cloud boyut regresyonu	✅	Koru
Auth modüllerinin esbuild metafile dependency graph’ında olmaması	—	Ekle
Benzersiz canary string’in DCE sonrası olmaması	—	Ekle
.map / sourcesContent içinde yasaklı kaynak olmaması	—	Ekle
docker save ile final OCI layer taraması	—	Ekle
SBOM’da local’e yasak paket/modül kontrolü	—	Ekle

Böylece iddianız “esbuild bugün bunu kaldırıyor”dan “CI her üretilmiş dağıtım artifact’ında yokluğunu kanıtlıyor” seviyesine çıkar.

2. Çok-process concurrency konusunda kritik ayrım

Burada kod, mimari özetinizin yalnız yarısını tam olarak doğruluyor.

server/src/commitService.ts:379-390 nextSeq üretirken transaction içinde Canvas satırına FOR UPDATE alıyor. Dolayısıyla iki Node process aynı seq değerini üretemiyor. Bu doğru.

Ancak commit’in main’e mi yoksa branch’e mi gideceğine karar veren kod server/src/commitService.ts:228-273 içinde head’i okuyor, intent’i genişletiyor ve conflict analizi yapıyor. Bu hesap Canvas row lock alınmadan önce gerçekleşiyor. DB lock daha sonra server/src/commitService.ts:445-460 içindeki apply transaction’ında devreye giriyor.

Üstelik shared/src/ops.ts:56-70 içindeki update_node ve :84-88 içindeki move_node, before snapshot’ının halen mevcut state ile eşit olduğunu assertion olarak kullanmıyor; doğrudan after değerlerini uyguluyor.

Bu nedenle aşağıdaki yarış koddan yaptığım çıkarıma göre mümkün:

Replica A → head=100 görür.

Replica B → head=100 görür.

İkisi de aynı node.title alanını değiştirmek ister.

İkisi de kendi process-local mutex’i altında conflict yokmuş gibi ilerler.

A DB lock alır, seq=101 yazar.

B sonra lock alır, seq=102 alır.

B’nin conflict kararı artık eski head=100’e dayanıyordur.

before assertion olmadığı için B değişikliği main’e uygulanabilir.

Sonuç: DB/materialized-state tutarlılığı korunabilir ama ürünün beklenen branch/conflict semantiği bozulabilir.

Ayrıca mevcut yarış testi yalnız aynı service instance’ını test ediyor: server/src/commitService.test.ts:392-402.

Bu, yatay ölçeklemeden önceki P0 düzeltme olmalı. En temiz çözüm Redis distributed lock eklemek değil; conflict kararını da aynı PostgreSQL row-lock transaction’ının içine almak:

lock Canvas → current head’i tekrar oku → intent’i güncel graph’a expand et → intervening commits/conflict hesapla → main/branch kararını ver → seq ata → materialize et → commit insert et → commit.

Ardından iki ayrı PrismaClient + iki ayrı CommitService ile aynı canvas üzerinde aynı baseSeq kullanan concurrency testi yazın. Örtüşen alanlar branch oluşturmalı; ayrık alanlar main’de iki commit olarak birleşmeli.

3. Local → cloud için doğru model: CRDT’den önce Git-benzeri event replication

Bugünkü implementation bir sync motoru değil.

server/src/cloudClient.ts:40-53 cloud API’sinde yalnız token exchange/list/export yönünü gösteriyor; local değişiklikleri cloud’a gönderecek commit API’si yok. Daha önemlisi server/src/activationService.ts:250-318, CloudImport kaydı varsa canvas’ı tekrar indirmeden skipped sayıyor. Şema da bunu açıkça “bir defalık import mapping” şeklinde tanımlıyor: db/prisma/schema.prisma:432-448.

Ben UI/metinlerde şimdilik buna “Buluttan içe aktar” derdim; “sync” sözcüğü kullanıcının beklentisini yanlış belirler.

İki yönlü sync için Co-Pronoia’nın event-sourced yapısı CRDT’ye zorlanmamalı. Ink & Switch’in local-first ilkeleri offline çalışma, yerel veri sahipliği ve çok cihazlı senkronu savunuyor; CRDT önemli bir yöntem fakat local-first’in tek zorunlu implementation’ı değil. Makale 1 Nisan 2019 tarihli. 
inkandswitch.com

Sizde daha doğal model:

remote-tracking + fetch/push + explicit merge/branch.

Mevcut seq tek başına yeterli değil; offline local ve cloud aynı seq’leri üretebilir. Ekleyin:

global commitId — UUIDv7 veya content-addressed kimlik;

parentCommitId veya parent set;

replicaId;

remote-tracking head;

snapshot/checkpoint kimliği;

fetch edilen commit ID seti.

İlk sync:

remote snapshot @ H → local materialization → H sonrası commit fetch.

Sonrası:

fetch unknown commits → replay → local branch/head update.

Push:

push local commits + expected remote ancestor → cloud mevcut conflict motorunu çalıştırır → fast-forward / automatic merge / branch.

Bu şekilde ürünün görünür conflict ve audit semantiğini korursunuz. Graph state için CRDT’ye geçmek, bugün sahip olduğunuz “bu ajan bu değişikliği önerdi, şu supervisor kabul etti, bu commit çıktı” modelini bulanıklaştırabilir.

CRDT’yi daha sonra cursor, presence, canlı yorum/metin düzenleme gibi transient veya collaborative text alanlarında kullanmak daha mantıklı.

Ayrıca ilk etapta “region-level partial replication” yapmayın. parentId, edge ve cascade invariants nedeniyle region sınırının dışındaki nesnelerle referans ilişkileri oluşabilir. Canvas-level selective clone çok daha güvenli başlangıç.

4. prisma db push → Prisma Migrate

Gerçek bundle’da migration klasörü bulunmuyor ve kodun kendisi db push varsayımını taşıyor; örneğin db/prisma/schema.prisma:311-318 ilgili geliştirme yaklaşımını belgeliyor. Test DB kurulumu da server/src/testDb.ts:15-33 içinde şemayı db push ile oluşturuyor.

Prisma’nın güncel dokümantasyonu db pushın migration artifact’i üretmeden şemayı doğrudan DB’ye eşitlediğini ve özellikle prototipleme/rapid iteration için uygun olduğunu söylüyor. Prisma ayrıca mevcut production schema için resmi baselining akışı ve expand-contract yaklaşımı belgeliyor. 
Prisma
+3
Prisma
+3
Prisma
+3

Geçişi “1000 kullanıcı olduğunda” değil, şu olaylardan önce yapın:

geri döndürülemez gerçek kullanıcı verisi oluşması;

rename/drop;

data backfill;

zero-downtime gerektiren iki application version’ın aynı DB’de bir süre birlikte çalışması.

Doğru sıra:

current production schema → baseline migration → baseline applied olarak işaretle → CI fresh DB from migrations → prisma migrate deploy.

Sonrasında breaking change yerine expand-contract:

new nullable field/table → yeni+eski kod uyumlu deploy → backfill → reads switch → eski yazımı kapat → sonraki deploy’da old column drop.

DB rollback’i genellikle migration’ı ters çevirmekten çok forward-fix şeklinde yapılmalı; contract aşaması en az bir deployment geriden tutulmalı.

5. Append-only tablolar, retention ve indeksler

Mevcut önemli indeksler:

Tablo	Mevcut kod	Değerlendirme
Commit	PK (canvasId,seq) + (canvasId,branchId,seq)	İyi başlangıç. db/prisma/schema.prisma:263-277
Branch	(canvasId,status)	Uygun. :279-292
CanvasBriefRevision	(canvasId,id)	Revision traversal için yeterli. :78-90
NodeClaim	(canvasId,expiresAt)	Expiry cleanup/query için mantıklı. :357-373
PlanProposal	yalnız (canvasId,status)	Delta long-poll için eksik. :378-399
Session	expiresAt, indeks yok	Cleanup büyüdükçe problem. :33-39
Node	PK (canvasId,id)	Current full-graph replay/loading modelinde yeterli. :219-247
Edge	PK (canvasId,id)	Aynı. :249-260

server/src/proposalService.ts:53-68, proposal listelerini updatedAt ve createdAt davranışlarıyla sorguluyor. MCP long-poll tarafı da proposal state’lerini tekrar tarıyor: server/src/mcp/mcpServer.ts:439-495.

Öncelikle workload ölçerek şu indeksleri test ederdim:

PlanProposal(canvasId, updatedAt)
PlanProposal(canvasId, status, createdAt)
Session(expiresAt)

İkisini de körlemesine eklemek yerine EXPLAIN (ANALYZE, BUFFERS) ile doğrulayın; her indeks write amplification yaratır.

PostgreSQL 18 dokümantasyonu partial index’lerin boyutu ve update maliyetini azaltabileceğini açıkça belirtiyor. Örneğin yalnız aktif proposal’lar sürekli sorgulanıyorsa terminal proposal’ları kapsamayan partial index faydalı olabilir. 
PostgreSQL
+1

Ne budanmalı?

Session: expired → sil.

PlanProposal: accepted/rejected terminal history için örneğin sıcak 6–12 ay + archive düşünülebilir.

BriefRevision: hacim ölçülene kadar tut; sonra checkpoint + eski revision archive edilebilir.

Commit: şimdilik dokunma.

Çünkü server/src/commitService.ts:506-515 içindeki rebuildCheck() main state’i commit geçmişinden yeniden kurarak materialized Node/Edge ile karşılaştırıyor. Eski commit’leri silerseniz mevcut truth-source kontratını kırarsınız.

10.000 commit/canvas PostgreSQL açısından kendi başına partitioning sebebi değil. Partitioning kararını canvas başına değil toplam tablo hacmi, index size, vacuum süresi, backup/restore süresi ve query latency belirlemeli.

Günün birinde gerektiğinde binlerce canvas partition’ı yaratmak yerine sabit sayıda HASH(canvasId) partition daha makul olabilir.

6. Yatay ölçekleme: bugün ikinci replica’da ne bozulur?

server/src/app.ts:114-134 WebSocket bağlantılarını process-local Set içinde, değişiklik bildirimlerini process-local CanvasEvents üzerinde yayıyor. Presence de aynı socket set’inden hesaplanıyor: server/src/app.ts:136-166.

server/src/canvasEvents.ts:1-25 standart Node EventEmitter.

MCP long-poll listener’ı düzgün unsubscribe ediliyor (server/src/mcp/mcpServer.ts:453-495), dolayısıyla tek process’te listener leak görünmüyor. Fakat proposal replica A’da değiştiğinde replica B’de bekleyen EventEmitter doğal olarak uyanmaz.

Aynı sorun rate limiter’da var. server/src/claimService.ts:21-34 limit datasını module-level Map<string, number[]> içinde tutuyor. İki replica olursa bir token efektif olarak iki ayrı kota elde eder.

En düşük karmaşıklıklı çözüm

İlk aşamada PostgreSQL LISTEN/NOTIFY burada Redis’ten bile doğal olabilir.

PostgreSQL 18’de NOTIFY, transaction commit olduktan sonra listener’lara notification gönderiyor; durable state zaten tablolarda durduğu için notification sadece "canvas X değişti" şeklinde wake-up hint olabilir. 
PostgreSQL

Bu mevcut tasarımınıza çok uyuyor:

DB = truth → NOTIFY = invalidation/wakeup → receiver DB’den canonical state/head okur.

Redis Pub/Sub da kullanılabilir fakat Redis resmi dokümanı teslim semantiğini at-most-once olarak tanımlıyor. Wake-up hint için sorun değil; durable event bus gibi davranmasını beklemeyin. 
Redis

Ben şu sınırı koyardım:

Commit/proposal truth → PostgreSQL.

Replica invalidation/wakeup → PG LISTEN/NOTIFY.

Global rate limit / precise distributed presence gerekince → Redis.

Durable async job/event gerekiyorsa → outbox + worker veya Redis Streams; Pub/Sub değil.

7. “Canvas başına pool leak” yok; service registry leak riski var

Bu noktada mimari özetindeki riski düzeltmek gerekiyor.

server/src/app.ts:58-59 bir adet paylaşılan PrismaClient oluşturuyor. server/src/app.ts:71-80 ise her erişilen canvas için CommitService oluşturup:

Map<canvasId, CommitService>

içinde saklıyor.

Her CommitService, server/src/commitService.ts:68-83 itibarıyla aynı PrismaClient’i kullanıyor ve process-local Promise mutex taşıyor.

Dolayısıyla:

canvas başına DB connection pool yok.

Fakat bir process yıllar boyunca yüz bin farklı canvas görürse service Map’i hiçbir zaman küçülmüyor.

Bugün service nesnesi küçük olduğu için acil problem değil; ama pattern düzeltilmeli. Seçenekler:

TTL/LRU cache;

son kullanım zamanı;

mutex queue boşaldıktan sonra idle service eviction;

veya CommitService’i neredeyse stateless hale getirip lifecycle registry’ye ihtiyaç bırakmamak.

Ayrıca claimService.ts:21-34 içindeki token Map’i için de TTL sweeper/LRU gerekiyor.

8. Event-sourced test stratejisi

Mevcut test temeli güçlü.

shared/src/ops.test.ts:10-33 apply → invert round-trip’i doğrudan test ediyor.

server/src/commitService.test.ts:197-241 deterministic LCG ile yaklaşık 150 random operation üreten fuzz testi çalıştırıyor ve rebuildCheck() üzerinden materialized state tutarlılığını denetliyor.

server/src/commitService.ts:506-515 gerçekten commit replay sonucunu Node/Edge materialized tablolarıyla karşılaştırıyor.

Bu, fast-check’e geçmek için ideal altyapı. fast-check’in güncel 4.9.0 sürümü 24 Temmuz 2026’da yayınlanmış durumda; modern sürümlerde shrinking ve graph generation desteği de güçlendi. 
Fast Check
+1

En değerli property seti:

Property	Beklenen invariant
Single-op inverse	invert(apply(G, op)) == G
Batch inverse	reverse(invert(ops)) tam state’i geri getirir
Replay	replay(commits) == materialized tables
Time travel	stateAt(N) yalnız seq≤N commit’lerinden oluşur
Independent commute	ayrık field/entity operation’ları sıra bağımsızdır
Conflict symmetry	conflicts(A,B) == conflicts(B,A)
Branch safety	aynı field, stale base → main değil branch
Region closure	cascade içinde korunmuş node/edge atlanamaz
Distributed race	2 service + 2 connection + same base overlap → branch
Rebuild after revert	revert sonrasında replay oracle hâlâ eşit

Özellikle son iki property şu anda sıradan unit testlerden çok daha değerli.

9. PostgreSQL template DB test deseni

server/src/testDb.ts:15-33 şemayı bir template DB’ye bir kez kuruyor. :35-60 ise testler için CREATE DATABASE ... TEMPLATE ... ile clone oluşturuyor ve cleanup sırasında backend’leri sonlandırıyor.

Bu, event-sourcing ve transaction testleri için iyi bir seçim: her test gerçek PostgreSQL semantiği, gerçek constraints ve gerçek transaction isolation görüyor; migration/schema oluşturma maliyetini ise her testte tekrar ödemiyorsunuz.

Ana limit paralellik:

her cloned DB katalog/filesystem işi yaratır;

her PrismaClient kendi connection’larını açabilir;

worker sayısı max_connections sınırına çarpabilir;

cleanup’taki pg_terminate_backend yoğun paralellikte pahalı hale gelebilir.

Bu yüzden worker sayısını CI CPU sayısından ziyade DB connection budget ile sınırlayın.

Alternatifler:

basit CRUD testleri: transaction rollback;

test-worker başına schema;

suite başına Testcontainers;

concurrency/migration/event sourcing için mevcut DB clone modeli.

Ben mevcut yaklaşımı kaldırmazdım.

10. Minimum gözlemlenebilirlik + minimal gizlilik

Şu anda server/src/app.ts:82 Fastify’ı açıkça logger: false ile başlatıyor. Kod taramasında bütünleşik tracing/metrics/error tracking katmanı görünmüyor.

Fastify v5’in güncel logging mekanizması Pino tabanlı structured JSON loglarını doğrudan destekliyor. OpenTelemetry’nin 2026 Node/JS dokümantasyonu da traces ve metrics için standart yol sunuyor. 
Fastify
+2
OpenTelemetry
+2

Minimum set:

Katman	Toplanacak	Toplanmayacak
Log	request ID, route template, status, latency, seq, outcome	node title/body, brief text, prompt, email, token
Metrics	request count/error/p95, tx latency, commit latency, branch ratio	kullanıcı içeriği
WS	active socket count, reconnect/error	message body
MCP	proposal count, approval/reject latency, timeout	persona/brief content
AI	model, latency, token count, estimated cost	prompt/response varsayılan olarak
Error tracking	stack, route, opaque IDs	headers, cookies, body
Tracing	sampled HTTP→DB→commit span	content attributes

Canvas/user identifier gerekiyorsa production telemetry’de raw ID yerine secret-keyed HMAC kullanabilirsiniz.

Local build telemetry default = tamamen off olmalı.

Cloud için 7–30 günlük kısa operational retention, body capture kapalı, açık privacy dokümantasyonu Co-Pronoia’nın minimal-data duruşuyla gayet uyumlu.

11. Rakip haritası

2026’daki önemli değişim şu: “ajan + canvas” artık boş bir kategori değil.

Miro, Canvas 26 duyurusunda 19 Mayıs 2026 itibarıyla canvas’ı üçüncü taraf ajanların MCP üzerinden okuyup yazabildiği bir çalışma yüzeyi olarak konumlandırıyor. 
Miro
+1

Figma/FigJam, Nisan 2026’da coding agent’ların doğrudan ortak whiteboard üzerinde çalışmasını duyurdu. 
Figma
+1

Linear’da agent işinin diff/PR olarak incelenip insan tarafından onaylanması güçlü bir analoji oluşturuyor; Linear ayrıca 2026’da planning/review/ship döngüsünü ajanlarla genişletiyor. 
Linear
+2
Linear
+2

Jira da Ağustos 2026 itibarıyla ajan orkestrasyonu ve insan+ajan yönetişimini doğrudan ürün mesajına taşıyor. 
Atlassian
+2
Atlassian
+2

Rakip karşılaştırması
Ürün	Güçlü yanı	Co-Pronoia'nın gerçek farkı	Tehdit
Miro	Çok güçlü collaborative canvas, MCP/AI agents, büyük integration ekosistemi	Graph değişikliklerinin first-class numaralı commit/branch olması + proposal-only external agents + explicit approval pipeline	Çok yüksek
FigJam / Figma	Tasarım/ideation ağı, shared agent canvas	Plan değişikliklerinin event-sourced/audit edilebilir yönetişimi	Yüksek
Linear	Developer workflow, issue/project modeli, agent→diff/PR→review	Issue değişimi değil görsel plan graph’ının kendi VCS-benzeri tarihi; çoklu planner ajanları	Yüksek
Jira	Enterprise süreç, permission, automation, agent governance	Daha hafif graph-native workflow, local dağıtım, explicit proposal→graph commit	Yüksek, özellikle enterprise
Notion	Doküman + database + Custom Agents	Graph-first planning ve field/entity seviyesinde conflict history	Orta/Yüksek
Obsidian Canvas	Local-first, açık JSON Canvas biçimi	Realtime ekip, authorization regions, agent proposal governance	Orta
Mermaid / Structurizr	Text/diagram-as-code, Git diff/PR	Visual collaborative authoring + semantic graph ops + app-level time travel	Düşük/Orta

Obsidian’ın JSON Canvas’ı açık bir format olarak yayınlaması özellikle önemli; local-first kullanıcı kitlesi artık veri taşınabilirliğini bekliyor. 
Obsidian
+1

Pazar boşluğu gerçek mi?

Dar ama gerçek.

İncelediğim ana ürünlerin kamuya açık dökümanlarında aynı anda şu üçünü native şekilde birlikte bulamadım:

1. kanvasın first-class numaralı, branchable uygulama içi commit geçmişi;

2. harici MCP ajanlarının doğrudan state değiştiremeyip yalnız proposal üretmesi;

3. proposal’ın ayrı bir supervisor policy/agent adımından sonra canonical graph commit’e dönüşmesi.

Ama bunu “kimsenin yapmadığı AI canvas” diye konumlandırmak tehlikeli. Miro ve Jira bu boşluğa hızla giriyor.

Daha savunulabilir ürün tanımı:

Planların insanlar ve ajanlar tarafından birlikte değiştirildiği ortamlarda audit, approval ve conflict governance katmanı.

Ana ICP bence genel whiteboard kullanıcısı değil; 5–50 kişilik yazılım/product/research ekipleri, aynı projede birden çok coding/planning agent kullanan ekipler ve “ajan neyi neden değiştirdi?” sorusuna cevap vermesi gereken ekipler.

Bu ihtiyaç için veri de var: 2026’da 1.000’den fazla mühendisle yapılan AI engineering araştırmasında ajan kullanan ekiplerde write access hızla artarken, %65 human-in-the-loop, %73 human approval guardrail bildirildi. Araştırma vendor kaynaklı olduğu için tarafsız akademik pazar ölçümü sayılmaz, fakat yön sinyali güçlü. 
Notion

Bu da kodunuzdaki bir ürün tercihini sorgulatıyor: web/src/components/CoPronoiaPanel.tsx:371-386 insan için approval UI’sinin bilinçli olarak bulunmadığını, owner’ın yalnız cleanup/rejection müdahalesi yaptığını belirtiyor.

Ben bunu configurable hale getirirdim:

supervisor-agent only / human owner only / supervisor + human / düşük risk auto-approve.

Bu, supervisor modelini zayıflatmaz; enterprise trust story’yi güçlendirir.

12. Özellik önceliklendirmesi

Kod tabanı bazı eksikleri doğruluyor. shared/src/types.ts:4-27 ve db/prisma/schema.prisma:219-247 Node üzerinde first-class tag, attachment, due date alanları olmadığını gösteriyor. Edge’de ise dependency semantiği zaten mevcut: shared/src/types.ts:29-40.

Ayrıca mevcut “Timeline” iş-zamanlaması değil; commit/time-travel görünümü: web/src/views/TimelineView.tsx:4-34.

Özellik	Kullanıcı değeri	Maliyet	Standart / farklılaştırıcı	Öncelik
Arama	L	S	Standart	P0
Etiket + filtre	L	S/M	Standart	P0
Şablon kütüphanesi	L	M	Standart ama activation kritik	P0
Yorum / tartışma	L	M	Standart collaboration primitive	P0/P1
Bildirimler	M/L	M	Standart; comments/proposals üstüne	P1
Commit-temelli ilerleme raporu	L	M	Farklılaştırıcı	P1
Komut paleti	M	S	Standart power-user	P1
Markdown/Mermaid export	M/L	M	Portability; kısmen farklılaştırıcı	P1
Public read-only link	M	M	Standart	P1
Başlangıç/bitiş tarihi + calendar	L	M	Standart PM özelliği	P2
Dependency auto-scheduling	L	L	Standart fakat zor	P2/P3
Webhook	M/L	M	Platform standardı	P2
GitHub Issues/Projects bridge	L, developer ICP’de	L	Stratejik entegrasyon	P2
Node attachments/files	M	L	Standart; storage/security maliyetli	P3

Özellikle progress report farklı yapılabilir:

“Son toplantıdan beri 17 graph commit; 4 agent proposal kabul edildi, 2 reddedildi, 1 branch açık; backend region’da 3 dependency eklendi.”

Bu rapor Miro/Jira’daki sıradan “summary”den doğrudan sizin event modelinizden türediği için daha savunulabilir.

13. İlk değer anı ve MCP onboarding

Mevcut UI tamamen sıfırdan değil. web/src/components/CoPronoiaPanel.tsx:37-60 .mcp.json ve Claude CLI command üretiyor; :65-83 kullanıcıya token placeholder değiştirme/kopyalama adımlarını gösteriyor; :92-106 secret reveal/kopyalama akışını içeriyor.

Fakat 2026 geliştirici araçları çıtayı yükseltmiş durumda.

VS Code, elle JSON yapıştırma modelinden MCP server install akışlarına geçti; Cursor marketplace/deeplink ve OAuth destekliyor; Claude Code claude mcp add ile project-level .mcp.json üretebiliyor. MCP’nin güncel protokol sürümü 2026-07-28 ve authorization tarafı OAuth 2.1 resource-server modelini standardize ediyor. 
Model Context Protocol
+6
Visual Studio Code
+6
Visual Studio Code
+6

İlk beş dakikayı şöyle tasarlardım:

Dakika 0–1: üç template: “Teknik Proje Planı”, “Ürün Roadmap’i”, “Multi-Agent Planning Lab”.

1–2: boş kanvas yerine 6–10 node’lu örnek açılır.

2–3: kullanıcı ilk node’u değiştirir → UI görünür biçimde Commit #1 üretildiğini gösterir.

3–4: built-in AI ile tek küçük plan değişikliği → preview → Commit #2.

4–5: “Ajan bağla” CTA.

MCP setup wizard:

Claude Code | Cursor | VS Code | Other.

Sonra:

canvas scope → agent role → permissions → authentication → install → connection test → first proposal.

Mümkün olduğunda uzun ömürlü tma_... secret yapıştırmak yerine OAuth 2.1 + short-lived access token kullanın. Cursor/VS Code için one-click install/deep-link; Claude için copyable claude mcp add; Other için JSON fallback.

Son ekranda kullanıcıya boş terminal değil hazır görev verin:

“Canvas brief’ini oku, backend authentication için üç alternatif öner ve proposal olarak gönder.”

İlk agent proposal’ının UI’da görünmesi ikinci activation moment olmalı.

14. Fiyatlandırma

Burada iyi güncel emsaller var.

GitLab güncel paketlerinde seat ücretinin yanında ayrıca GitLab Credits dahil ediyor; örneğin Premium için kullanıcı başına aylık kredi katmanı mevcut. Bu doğrudan seat + AI-credit hybrid örneği. GitLab aynı zamanda uzun süredir open-core modelini açıkça tanımlıyor. 
GitLab
+1

Miro AI credits’i organization/seat kapasitesiyle havuzluyor ve MCP usage için de limitler tanımlıyor. 
help.miro.com
+2
help.miro.com
+2

Notion Custom Agents ise agent kullanımını ayrı credit ekonomisine dönüştürmüş durumda; güncel modelde credits paket halinde satılıyor. 
Notion
+2
Notion
+2

Co-Pronoia için en temiz model:

Katman	Ödeme
Local/self-hosted	Ücretsiz; hosted LLM yok; BYOK mümkün
Cloud Free	Küçük ekip/canvas kotası, düşük hosted-AI kredi havuzu
Cloud Team	Editor seat + workspace’e pooled AI credits
AI overage	Kullanım bazlı ve hard budget/cap destekli
External MCP agent	Co-Pronoia model maliyeti ödemiyorsa ayrıca “AI token vergisi” almamak daha anlaşılır
Enterprise	SSO, policy, admin, retention, support, deployment controls

Fiyatın kendisinden daha önemli özellikler: budget cap, warning threshold, model bazlı maliyet görünürlüğü ve workspace-level pooling. 2026 mühendis araştırmasında ekiplerin yaklaşık dörtte üçünin maliyet nedeniyle AI kullanım davranışını değiştirmesi bu ihtiyacı destekliyor. 
Notion

Open-core uygulanacaksa mantıklı sınır:

Açık/ücretsiz çekirdek: operation engine, replay/invert, local deployment, data format, import/export, MCP protocol yüzeyi.

Ücretli managed değer: hosted cloud, organization governance, hosted AI budgets, enterprise identity/policy, managed backups/HA/support.

Bu noktada repo lisansını değerlendirmediğim için bunu mevcut lisans durumunuzun tanımı değil, strateji önerisi olarak okuyun.

Önerilen yol haritası
Sıra	İş	Neden önce geliyor?
0.1	Cross-process commit conflict yarışını düzelt	İkinci replica öncesi correctness prerequisite
0.2	İki-service distributed concurrency testi	Yukarıdaki garantinin regression kapısı
0.3	Prisma Migrate baseline	Bundan sonraki tüm schema çalışmalarının zemini
0.4	Final OCI DCE/security test	“local image auth’suz” iddiasını gerçek artifact’a bağlar
0.5	Structured logs + core metrics + error scrubbing	Bundan sonraki ölçek kararlarını ölçülebilir yapar
0.6	Session pruning, proposal delta index, Map TTL/LRU	Ucuz operasyonel hijyen
1.1	Search + tags/filter	Temel kullanılabilirlik
1.2	Templates + güçlü empty state	Activation
1.3	Comments + notification foundation	Ekip collaboration eksikliği
1.4	Commit/proposal tabanlı progress report	Ürüne özgü değer
1.5	Configurable human/supervisor approval policy	Ajan governance story
2.1	MCP onboarding wizard	Agent activation friction
2.2	OAuth 2.1 / short-lived MCP auth	Token-copy modelinden çıkış
2.3	Markdown/Mermaid export + public read-only	Shareability/portability
2.4	Webhooks	Entegrasyon zemini
3.1	Global commit IDs + ancestry	Gerçek sync prerequisite
3.2	Incremental cloud→local fetch	Bir defalık importtan gerçek replication’a ilk geçiş
3.3	Local→cloud push + explicit branch semantics	İki yönlü local-first
3.4	Snapshot/checkpoint protocol	Uzun commit geçmişinde clone/replay maliyeti
3.5	LISTEN/NOTIFY broker	İkinci server replica devreye alınırken
4.1	Dates/calendar	Planning depth
4.2	Dependency scheduling	Dates sonrası
4.3	GitHub bridge	Developer ICP expansion
4.4	Attachments	Object-storage/security maliyeti nedeniyle sonra

Partitioning bu roadmap’e bilerek girmiyor. Önce metrik üretin; tablo hacmi gerçekten zorlayınca ekleyin.

Açık sorular

Cloud deployment bugün gerçekten tek replica mı? İkinci replica yakınsa concurrency + event broker P0; değilse birkaç milestone ertelenebilir.

Local ve cloud’un aynı canvas’ı aynı anda düzenlemesi ürün gereği mi, yoksa local daha çok “offline fork” mu? Sync protokolünü dramatik biçimde değiştirir.

Supervisor approval’ın özellikle insan tarafından yapılamaması bilinçli ürün ilkesi mi? Kod bunun bilinçli olduğunu söylüyor, ancak pazar sinyali configurable human gate yönünde.

Terminal proposal/history için yasal veya ürün kaynaklı retention hedefi var mı?

Bir canvas için beklenen üst sınır sadece 10k commit mi, yoksa birkaç yılda 100k–1M commit gerçekçi mi?

Public paylaşım, comments ve attachments commit tarihinin parçası mı olmalı, yoksa ayrı collaboration event stream’i mi olmalı?

Local dağıtımın hangi kısmı açık kaynak olacak? Lisans modeli netleşmeden open-core sınırı kesinleştirilemez.

İki yönlü sync’te cloud ve local kullanıcı/ajan kimlikleri aynı global identity namespace’inde mi tutulacak? Audit attribution için bunu commit replication’dan önce çözmek gerekir.

Sonuç

Teknik açıdan Co-Pronoia’nın en değerli özelliği React Flow kanvası veya Gemini entegrasyonu değil; değişikliklerin semantik op’lar olarak modellenmiş olması. Bu, replay, diff, authorization, branch, agent proposals, local replication ve audit’i aynı primitive’in üzerine kurmanıza izin veriyor.

Bence bugün en önemli karar, bu avantajı koruyup sistemi “AI destekli whiteboard” yerine “insanlar ve ajanlar tarafından ortaklaşa değiştirilen planlar için governance/versioning layer” olarak geliştirmek. Rakiplerin 2026 yönelimi bunun hem gerçek bir ihtiyaç olduğunu hem de pencerenin sonsuza kadar açık kalmayacağını gösteriyor. 
Miro
+2
Atlassian
+2

Connection interrupted. Waiting for the complete answer
