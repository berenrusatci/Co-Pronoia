---
tags:
  - arastirma/yanit
  - kaynak/web
  - baslik/05
baslik: Dağıtım, Veri ve Ürün
tur: web
tur_no: 1
kelime: 4469
sohbet: https://chatgpt.com/c/6a7f0024-cb84-83eb-a2e5-9305d34bdee2
kaynak: 05-dagitim.md
---
> [!abstract] Web kaynaklı yanıt (koda atıfsız)
> Sorular: [[05 Dağıtım, Veri ve Ürün - sorular]]

Co-Pronoia — Dağıtım, Veri Katmanı, Kalite ve Ürün Araştırması

Araştırma tarihi: 14 Ağustos 2026. Teknik konularda mümkün olduğunca resmi dokümantasyon ve birincil kaynakları; ürün karşılaştırmalarında üreticilerin güncel ürün/dokümantasyon sayfalarını kullandım. Aşağıdaki kaynak atıfları tıklanabilir bağlantılardır.

Yönetici özeti

Bulut + yerel için tek kod tabanı mantıklı. define + dead-code elimination gerçek ve kullanılan bir desen; ancak DCE'nin kendisi güvenlik garantisi değildir. Güvenceyi nihai Docker artifact'ının CI'da test edilmesi sağlamalıdır. 
esbuild.github.io
+2
vitejs
+2

Yerel sürümde auth/admin'i gerçekten kaldırmak için feature flag'i fonksiyon içlerine serpiştirmek yerine modül grafiği sınırında kesmek daha güvenli.

İki yönlü senkron için çekirdeği CRDT'ye dönüştürmeni önermiyorum. Mevcut commit/branch tasarımın Git-benzeri fetch/push + “local changes → branch” modeline çok iyi oturuyor. 
inkandswitch.com
+2
automerge.org
+2

seq, replika sınırları arasında commit kimliği olmamalı; iki yönlü sync öncesinde ayrıca immutable commitId eklemek kritik.

prisma db push üretim/self-host güncellemeleri için zayıf nokta. Prisma Migrate'a şimdi geçmenin maliyeti ileride geçmekten belirgin biçimde düşük. 
Prisma
+2
Prisma
+2

10k commit/canvas henüz PostgreSQL partitioning gerektiren bir ölçek değil. Öncelik doğru B-tree indeksleri + snapshot/checkpoint + ölçüm olmalı.

Commit geçmişini budamak ürünün en güçlü özelliklerinden birini yok eder. Commit'leri sıcak/soğuk katmana taşıyabilirsin ama varsayılan olarak geçmişi silmemelisin.

Çok replica'da in-memory WebSocket setleri sorun değil; replicalar arası event emitter ve global rate limiter sorun olur. WS mesajlarını “hint” yaparsan PostgreSQL LISTEN/NOTIFY başlangıçta Redis ihtiyacını erteleyebilir. 
PostgreSQL
+1

Property-based/model-based testing senin commit çekirdeğine olağanüstü iyi uyuyor; fast-check burada normal unit testten daha değerli olabilir. 
fast-check.dev
+1

2026 itibarıyla “canvas + AI” tek başına farklılaştırıcı değil: Miro, FigJam, Linear, Jira ve Notion bu alana hızla ilerlemiş durumda. 
notion.com
+3
miro.com
+3
linear.app
+3

Asıl ürün farkın: replay edilebilir numaralı değişiklik geçmişi + external agent proposal'ları + supervisor kontrollü promotion + bölgesel AI yetkisi.

İncelediğim büyük ürünlerde bu kombinasyonun tamamını birlikte doğrulayamadım; fakat bu pazarın kanıtlandığı anlamına gelmiyor. En büyük iş şu anda özellik eklemekten çok bu governance tezini kullanıcılarla doğrulamak.

Bulgular
1. Tek kod tabanı + compile-time feature elimination
İddia

Yaklaşım teknik olarak sağlam. esbuild define sabitlerini build sırasında yerleştiriyor ve tree-shaking/dead-code elimination statik olarak erişilemeyen kodları çıkarabiliyor. Vite da import.meta.env değerlerini build-time sabitleri olarak değiştirip tree-shaking'e olanak veriyor. Chromium gibi büyük açık kaynak projelerde de build-time feature flag'ler, belirli özelliklerin derlenmiş ürüne girip girmemesini belirlemek için kullanılıyor. 
Chromium Git Repositories
+3
esbuild.github.io
+3
vitejs
+3

Buradaki önemli ayrım:

Compile-time flag bir mekanizmadır; artifact absence ise güvenlik özelliğidir.

Dolayısıyla LOCAL_MODE=true olduğunda testin “branch çalışmıyor” demesi yeterli değil. Auth/admin implementasyonunun çıktıda bulunmadığını kanıtlamalısın.

Co-Pronoia'ya etkisi

Şuna yönelmeni öneririm:

packages/server/
    core/
    deployment/
        cloud/
            auth/
            admin/
            invitations/
        local/

ve mümkün olduğunca:

TypeScript
if (BUILD_MODE === "cloud") {
  // 500 satır cloud logic
}

yerine build graph seviyesinde ayrılmış entry point/modüller.

Özellikle şunlar DCE'yi şaşırtabilir veya cloud kodunun artifact'ta kalmasına yol açabilir:

side-effect import'lar,

CommonJS/dinamik require,

runtime-computed dynamic import yolları,

cloud ve core kodunun aynı dosyada yoğun biçimde karıştırılması,

source map içine source content gömülmesi,

production image'a istemeden tüm monorepo'nun kopyalanması,

“bundle temiz ama node_modules/source tree image'da duruyor” durumu.

Açık kaynakta build-time feature omission için güçlü örnekler var; ancak araştırdığım büyük JS SaaS/self-host ürünleri arasında “self-host build'de auth/admin'i özellikle esbuild DCE ile fiziksel olarak siliyoruz” şeklinde açıkça belgelenmiş birebir bir örneği doğrulayamadım. Dolayısıyla Chromium/Vite/esbuild desenin doğruluğunu, ama senin birebir packaging kararını değil, doğruluyor.

2. Kodun gerçekten kaldırıldığını CI'da kanıtlama

Bunu güvenlik regression testi haline getirmen doğru.

En sağlam kapı şu kombinasyon olur:

Gerçek production local Docker image'ını oluştur.

Image filesystem'i üzerinde yasaklı dosya/modül isimlerini ara.

Oluşan JS bundle'larında cloud-only sentinel'ları tara.

esbuild build graph/metafile çıktısında cloud modüllerinin transitively reachable olmadığını doğrula.

Source map'leri ayrıca kontrol et.

Runtime smoke test ile /auth, /admin, invitation vb. yüzeylerin 404/route missing olduğunu doğrula.

Aynı kontrolleri dependency/bundler yükseltmelerinde zorunlu tut.

En iyi test, gerçek sembollere güvenmek yerine cloud-only modüle benzersiz bir sentinel koymak olabilir:

TypeScript
export const CLOUD_BUILD_SENTINEL =
  "CO_PRONOIA_CLOUD_AUTH_SENTINEL_7d9...";

Local artifact içerisinde bu byte dizisi bulunursa CI kırılır.

Bu yaklaşım minifier'ın sembol adlarını değiştirmesine karşı da daha dayanıklı olur.

Daha da önemlisi: testi sadece dist/server.js üzerinde değil Docker image'ın tamamında çalıştır. Çünkü güvenlik iddian “bundle'da import edilmiyor” değil, “bu kod dağıtılan imajda yok”.

3. Yerel ↔ bulut: CRDT yerine Git-benzeri replikasyon

Ink & Switch'in 2019 tarihli Local-first Software çalışması yerel sahiplik, çevrimdışı çalışma ve çoklu replika senkronizasyonunu local-first'in temel ilkeleri arasında ele alıyor; CRDT'leri bunun önemli teknik araçlarından biri olarak tartışıyor. Güncel Automerge mimarisi de belge bazında local state ve replika sync modelini kullanıyor. 
Ink & Switch
+2
Automerge
+2

Ama:

Local-first olmak = CRDT kullanmak değildir.

Senin sistemde zaten:

intent
  ↓
ops
  ↓
commit
  ↓
main / conflict branch

var.

Dolayısıyla ilk iki yönlü sync sürümünde şöyle bir protokol daha doğal:

Local                            Cloud


commit A
commit B
commit C
   |
   | FETCH remote head
   v
base = cloud #194


local commits:
  L1
  L2
   |
   | PUSH
   v


Cloud conflict engine
   ├── disjoint ──→ main
   └── overlap  ──→ branch/local-device-X

Git'in refspec/fetch/push modeli de farklı ref alanlarının seçilerek aktarılmasına dayanıyor. 
Git
+1

Kritik mimari değişiklik: seq ≠ commit identity

Şu anda:

canvasId + seq

commit'i tanımlamak için yeterli olabilir.

İki bağımsız replika yazmaya başladığında yeterli olmaz.

Önerim:

commitId: UUIDv7 / ULID / content hash
seq:      cloud main sıralaması

Örneğin:

local:
commitId = 01K...
localSeq = 38


cloud'a promotion sonrası:
commitId = 01K...      ← değişmez
seq      = 2041

Böylece aynı commit'in iki sistemde yeniden yaratılması sorun olmaz.

İlk sync protokolü

Ben olsam:

V1

canvas-level sync

immutable commitId

remote-head bilgisi

snapshot + tail commits

push local changes as branch

cloud mevcut conflict engine'iyle çözüm

local branch → cloud main promotion

HTTP catch-up

V2

belirli branch/ref fetch

delta/snapshot optimizasyonu

resumable transfer

V3 ancak gerçek ihtiyaç varsa

region/subgraph partial clone

CRDT staging/ephemeral collaboration

Subgraph partial sync ilk bakışta kolay görünse de parentId, edge ve cross-region dependency nedeniyle veri bütünlüğü sınırları karmaşıklaşır.

Snapshot

10k+ commit hedefinde şimdiden:

CanvasSnapshot
- canvasId
- seq
- graph
- checksum
- schemaVersion
- createdAt

eklemeyi düşünürdüm.

Snapshot source of truth olmaz.

Yükleme:

snapshot@9000
+
commit 9001..10037

şeklinde olur.

Automerge tarafında da uzun değişiklik geçmişinin ilk senkronizasyon maliyetinin ayrı bir problem olduğu belgelenmiş durumda. 
Automerge

4. prisma db push → gerçek migration

Burada en belirgin teknik borç bu.

Prisma kendi güncel dokümantasyonunda db push'ı prototipleme ve migration history gerekmeyen kullanım için konumluyor; Prisma Migrate ise SQL migration geçmişini oluşturup üretim deployment'ında migrate deploy ile uygulanmak üzere tasarlanmış. 
Prisma
+3
Prisma
+3
Prisma
+3

Üstelik var olan bir veritabanını sonradan migration sistemine geçirmek için Prisma resmi olarak baselining akışını destekliyor. 
Prisma
+1

Neden Co-Pronoia için özellikle önemli?

Bulut tek başına olsa bile db push riskliydi.

Ama Docker/self-host dağıttığında artık şunu desteklemen gerekiyor:

Co-Pronoia 1.4
database schema 14


       ↓ upgrade


Co-Pronoia 1.5
database schema 15

Yani migration geçmişi ürünün dosya formatının bir parçasına dönüşüyor.

Şimdi geç

Maliyet şu an M, ileride L seviyesine çıkabilir.

İlk geçiş:

mevcut production schema
        ↓
baseline migration
        ↓
migration history
        ↓
fresh install test
        ↓
N → N+1 upgrade test
Zero-downtime

Prisma'nın güncel dokümantasyonunda da önerilen temel yaklaşım expand-contract. 
Prisma
+1

Örneğin:

1. newColumn nullable ekle
2. yeni app hem oldColumn hem newColumn bilir
3. dual-write
4. batch backfill
5. reads → newColumn
6. constraint ekle
7. eski writer'ı bırak
8. sonraki release'de oldColumn'u kaldır

Schema rollback yerine çoğunlukla roll-forward tasarlamak daha güvenli.

Özellikle destructive migration öncesinde local Docker kullanıcıları için otomatik DB backup/checkpoint mantıklı.

Prisma'nın Temmuz 2026'da duyurduğu “Prisma Next” halen Early Access çizgisinde ve Prisma 8'e dönüşmesi planlanıyor; mevcut üretim migration stratejisini bunun üzerine kurmazdım, ancak takip ederdim. 
Prisma
+1

5. Append-only tablolar ve PostgreSQL ölçeği

PostgreSQL 18 güncel dokümantasyonu partitioning'in özellikle eski verinin partition detach/drop ile topluca kaldırıldığı dev tablolarda avantaj sağladığını belirtiyor. BRIN de fiziksel satır sırası ile indekslenen değer arasında korelasyon bulunan çok büyük tablolar için tasarlanmış. 
PostgreSQL
+1

10k commit/canvas için partitioning'e başlamazdım.

1000 canvas × 10k commit = 10M kayıt dahi PostgreSQL açısından olağanüstü bir sayı değil; gerçek eşik satır sayısından çok sorgu profili, indeks boyutu, vacuum ve disk davranışıyla belirlenmeli.

Commit

Minimum:

SQL
UNIQUE (canvas_id, seq)

Branch sorguları sık ise:

SQL
(canvas_id, branch_id, seq)

Ben ops JSONB üzerine otomatik olarak GIN koymazdım.

Ana erişim şeklin:

canvas → commit range

ise B-tree yeterli.

JSON içindeki alanlarda gerçekten sorgulanan veriler oluşursa o alanları ayrı kolonlara çıkarmak daha temiz olabilir.

PostgreSQL de çok kolonlu indekslerin dikkatli kullanılmasını ve aşırı geniş indekslerden kaçınılmasını öneriyor; partial ve covering index'ler belirli query pattern'lerinde yararlı fakat gereksiz indeksler yazma maliyeti getiriyor. 
PostgreSQL
+2
PostgreSQL
+2

Tablo bazında politika
Tablo	Tavsiye
Commit	Varsayılan silme yok; snapshot + gerekirse cold archive
Accepted proposal	Commit'e provenance sağlıyorsa uzun süre sakla
Rejected proposal	Ürün/audit ihtiyacına göre TTL düşünülebilir
Sessions	TTL; agresif temizlenebilir
Brief revisions	Kullanıcıya history veriyorsan sakla, aksi halde bounded
Logs/telemetry	Kısa retention
Snapshots	Eski snapshot'lar azaltılabilir; en az birkaç checkpoint tut

Commit history'nin kendisini silmek istemememin nedeni teknikten çok ürün:

time travel + accountability + agent provenance senin moat'ının bir parçası.

Partitioning zamanı geldiğinde de canvas başına partition açma. Binlerce küçük partition istemezsin.

TTL tablolarında zaman bazlı monthly/quarterly partition daha doğal olabilir.

6. Multi-replica Fastify + WebSocket

Şu parçaları ayıralım.

Replica-local kalabilir
WebSocket connection Set
socket → user mapping
socket heartbeat

Her replica yalnız kendine bağlı socket'leri bilmek zorunda.

Replica-local kalamaz
canvas event emitter      ❌
global rate limiter       ❌
active claim state        ❌ (eğer DB'de değilse)
distributed presence      ❌

DB FOR UPDATE kullanımın çok önemli bir avantaj:

in-process canvas mutex artık correctness için zorunlu değil, latency/serialization optimizasyonu haline gelir.

Çok process correctness'i PostgreSQL transaction lock sağlıyor.

Broadcast için en basit ölçekleme

Commit transaction'ı tamamlandıktan sonra:

JSON
{
  "canvasId": "...",
  "seq": 1042,
  "commitId": "..."
}

yay.

Replica:

NOTIFY
   ↓
Replica A → local WS clients
Replica B → local WS clients
Replica C → local WS clients

PostgreSQL LISTEN/NOTIFY resmi olarak DB session'ları arasında basit asynchronous notification mekanizmasıdır. 
PostgreSQL

Burada özellikle uygun çünkü sen zaten:

WebSocket yalnız broadcast; mutations HTTP.

diyorsun.

WS event'i kaybolursa:

client lastSeq = 1040
incoming seq   = 1042


→ gap detected
→ GET commits?after=1040

yapabilirsin.

Dolayısıyla message bus'ın kendisinin durable olması gerekmez.

Redis Pub/Sub da at-most-once davranır; subscriber kopukken mesaj kaybolabilir. Güçlü teslimat istersen Redis Streams ayrı bir seçenek. 
Redis
+2
Redis
+2

Benim sıra önerim
şimdi:
PostgreSQL LISTEN/NOTIFY


           ↓ ihtiyaç büyürse


Redis
├── Pub/Sub
├── distributed rate limiting
└── ephemeral presence

Sırf WS fanout için bugünkü ölçeğinde Redis zorunlu görünmüyor.

7. Canvas başına servis instance ve memory leak

En önemli kural:

Canvas başına PrismaClient/pool yaratma.

Prisma connection pool uygulama instance'ı seviyesinde yönetilmeli. 
Prisma

İdeal:

Process
  └── PrismaClient
       ├── CanvasService(A)
       ├── CanvasService(B)
       └── CanvasService(C)

Canvas service sadece dependency reference taşımalı.

Şu desen tehlikeli:

TypeScript
const services = new Map<CanvasId, CanvasService>();

ve hiç eviction olmaması.

Node uzun ömürlü süreçlerde retained references üzerinden heap büyümesi yaşayabilir; Node resmi araçları heap snapshot ve sampling heap profiler ile bunu teşhis etmeyi destekliyor. 
Node.js
+2
Node.js
+2

Eğer registry gerekiyorsa

Entry:

lastUsedAt
socketCount
longPollCount
dispose()

ve:

idle TTL,

maximum registry size,

LRU eviction,

socket disconnect → decrement,

AbortController,

timer cleanup,

listener cleanup

olmalı.

WeakMap string canvas ID'leri için sihirli çözüm değildir.

Soak test

CI/nightly:

10.000 canvas aç
socket/long-poll oluştur
kapat
GC çalıştır / bekle

sonra:

activeCanvasServices
listeners
timers
heapUsed
RSS

baseline'a yakın dönmeli.

Bu senin ölçek varsayımında normal unit test kadar değerli.

8. Event-sourced çekirdeğin test stratejisi

fast-check'in Şubat 2026 güncellenen property-based testing rehberi, tek tek örneklerden ziyade girdiler arasındaki genel ilişkilerin test edilmesini öneriyor; Nisan 2026 model-based API'si de state machine/command tabanlı sistemler için doğrudan uygun. 
fast-check.dev
+1

Co-Pronoia bu tekniğe çok uygun.

P0 property'ler

Invertibility

g1 = apply(g0, op)
g2 = apply(g1, invert(op))


assert g2 == g0

Replay consistency

replay(commits) == materialized Node/Edge

Bu zaten rebuildCheck() oracle'ına doğal oturuyor.

Intent determinism

expand(state, intent) === expand(state, intent)

ve:

webPreviewOps === serverExpandedOps

Disjoint commutativity

Eğer A ve B conflict detector'a göre ayrık ise:

apply(apply(G, A), B)
==
apply(apply(G, B), A)

Bu çok değerli; otomatik merge algoritmanın özünü test ediyor.

Conflict detector soundness

Slow/reference implementation yaz.

Random:

base graph
remote commits
local intent

üret.

Production detector sonucu ile brute-force oracle'ı karşılaştır.

Branch

conflict → main unchanged
branch replay → expected graph
takeBranch → expected promoted graph
Permission state machine

fast-check model:

actor
canvasRole
regions
regionMembers
aiAllowed
branch state

Commands:

normalCommit
undo
AICommit
approveProposal
mergeBranch

Property:

Yetkisiz mutasyon hangi yoldan gelirse gelsin apply choke point'i geçemez.

Bu, bölge güvenlik tasarımını tek tek endpoint test etmekten çok daha güçlü test eder.

fast-check 4.5.0'ın ilişkili veri üretimine yönelik yenilikleri de node/edge gibi referanslı yapılar için uygun. 
fast-check.dev

9. PostgreSQL template DB testleri

PostgreSQL 18, CREATE DATABASE ... TEMPLATE ... ile mevcut bir DB'nin klonlanmasını destekliyor; ancak template kaynak DB'ye başka session'ların bağlı olmaması gerekiyor. 
PostgreSQL
+1

Bu nedenle:

DB per individual test yerine:

template
   ├── worker_1_db
   ├── worker_2_db
   ├── worker_3_db
   └── worker_4_db

daha mantıklı.

Her worker kendi DB'sinde:

transaction rollback,

savepoint,

truncate/reset

kullanabilir.

Migration/concurrency gibi transaction semantics'i özellikle test eden suite'lere ise ayrı DB clone verilebilir.

Tuzaklar

CREATE DATABASE transaction içinde çalışmaz.

Çok worker = çok DB connection.

Template DB aktif session kabul etmemeli.

CI runner'da CREATEDB yetkisi gerekir.

30-50 paralel DB açmak storage/catalog açısından ters tepebilir.

Migration'a geçtiğinde template'i db push ile değil migration history'yi uygulayarak üret.

Böylece testlerin gerçek deployment yolunu da test etmiş olur.

10. Minimum gözlemlenebilirlik + privacy

Fastify güncel logging dokümantasyonu Pino entegrasyonu ve header gibi hassas alanların redaction'ını destekliyor. OpenTelemetry de sensitive data'nın instrumentation/export aşamasında uygulama tarafından kontrol edilmesini şart koşuyor; PostgreSQL semantic convention'ları query text/parameter toplamada özel dikkat istiyor. 
Fastify
+2
OpenTelemetry
+2

Minimum set:

Logs

Tut:

requestId
route template
HTTP status
duration
release/build
deploymentMode
commit outcome
error class

Tutma:

node text
brief
Gemini prompt
op JSON
emails
OAuth data
Authorization
API keys
raw proposal content

Canvas bazında troubleshooting lazımsa merkezi telemetry'de gerçek UUID yerine keyed hash kullanılabilir.

Metrics

Örneğin:

http_requests_total
http_request_duration


commits_total{result=main|branch|rejected}
commit_apply_duration
conflicts_total
rebuild_mismatch_total


ws_connections
ws_gap_recovery_total


agent_requests_total
agent_failures_total
agent_cost_units


proposals_total{result=approved|rejected}


db_pool_saturation

Prometheus label'ına şunları koyma:

userId
canvasId
email
commitId

Prometheus dokümantasyonu kullanıcı/e-posta gibi sınırsız cardinality değerlerinden label olarak kaçınılmasını özellikle öneriyor. 
Prometheus
+1

Trace

Tam kullanıcı içeriğini değil:

HTTP request
  └── expand intent
      └── conflict detection
          └── permission check
              └── DB tx
                  └── broadcast

gibi pipeline span'ları.

Başlangıçta:

error traces: yüksek sampling,

successful traces: düşük sampling.

Privacy ile çok iyi bağdaşabilecek bir desen

“Her şeyi merkezi topla” yerine:

user-generated support bundle

Co-Pronoia → Diagnostics → Export

çıktısı:

build,

schema version,

dependency health,

sanitized logs,

counts,

timings

içersin ama canvas içeriğini içermez.

Bu, radikal-minimal privacy ile gözlemlenebilirlik arasında iyi denge.

11. Rakip haritası ve gerçek pazar boşluğu

2026'daki en önemli sonuç: rakiplerin AI tarafı çok hızlı ilerledi.

Miro Mayıs 2026'da canvas üzerinde collaborative AI Flows sunuyor; ayrıca Şubat 2026'da MCP server beta'sını Cursor, Claude Code ve GitHub Copilot gibi istemcilerle bağlanacak şekilde duyurdu. 
Miro
+1

Linear'da ajanlar issue'lara delegate edilebiliyor ve human assignee sorumluluğu koruyor; Linear Agent proje/issue/milestone yapılarında değişiklik yapabiliyor. 
Linear
+1

Atlassian Temmuz 2026'da Jira'yı insanlar ile AI ajanlarının birlikte planlama/iş ataması yaptığı bir sistem olarak konumluyor. 
Atlassian
+1

Notion Şubat 2026'da Custom Agents'ı, Temmuz 2026'da External Agents'ı genişletti. Notion'ın kendi verisine göre erken kullanıcılar 21.000'den fazla Custom Agent yaratmış; Notion şirket içinde yaklaşık 2.800 ajan çalıştırdığını söylüyor. Bunlar bağımsız pazar verisi değil, üretici tarafından yayımlanan kullanım sinyalleridir. 
Notion
+1

Dolayısıyla şu konumlama zayıf:

“AI destekli ortak canvas.”

Şu çok daha güçlü:

“İnsanların ve AI ajanlarının bir plan üzerinde birlikte çalışabildiği, fakat her değişikliğin commit olarak denetlenebilir, geri alınabilir ve yetki politikalarından geçirilmiş olduğu planlama sistemi.”

Daha kısa ürün diliyle:

Git-like governance for collaborative planning and AI agents.

Ama burada “Git-like” implementation değil mental model.

Pazar boşluğu gerçek mi?

Feature-space'te evet. Market-space'te henüz kanıtlanmış değil.

İncelediğim Miro, FigJam, Linear, Jira, Notion, Obsidian Canvas, Mermaid ve GitHub Projects ürünlerinde şu dörtlünün tamamını birlikte doğrulayamadım:

1. canvas-native planning
2. append-only numbered/replayable mutations
3. external agents proposal-only
4. supervisor-governed promotion

Bu “dünyada başka kimse yapmıyor” iddiası değildir; araştırılan ana ürünlerde görülmediği anlamına gelir.

Agent-heavy mühendislik organizasyonlarının gerçek bir davranış değişimi yaşadığına dair sinyaller de var: Linear'ın yayımladığı Ramp vaka çalışması, şirkette merge edilen PR'ların %60'tan fazlasının kendi coding agent'larından geldiğini bildiriyor. Bu da bağımsız pazar araştırması değil, güçlü bir müşteri/vaka sinyali. 
Linear

Senin muhtemel ICP'in bu nedenle genel beyaz tahta kullanıcısından ziyade:

engineering lead,

software architect,

technical PM,

AI-agent kullanan ürün/geliştirme takımı,

değişiklik provenance'ı isteyen ekipler,

AI'nin “neye dokunabileceğini” sınırlandırması gereken organizasyonlar.

Rakip karşılaştırması
Ürün	Güçlü yanı	Co-Pronoia'nın farkı	Tehdit
Miro	Çok güçlü multiplayer canvas; 2026 AI Flows + MCP. 
Miro
+1
	Commit/replay governance, branch conflict modeli, proposal-only external agent	Çok yüksek
FigJam	Çok düşük onboarding friction; AI ile diagram/mind-map/plan üretimi. 
Figma Help Center
+1
	Plan değişikliklerinin transactional/auditable olması	Yüksek UX tehdidi
Linear	Developer-native issue/project workflow; insan+ajan görev modeli. 
Linear
+1
	Spatial graph + commit/branch planning + region governance	Yüksek
Jira / Rovo	Enterprise workflow, permissions, ecosystem ve AI-agent governance. 
Atlassian
+1
	Daha hafif canvas + plan değişikliklerinde Git-benzeri provenance	Yüksek enterprise tehdidi
Notion	Docs/knowledge + otomasyon + Custom/External Agents. 
Notion
+1
	Graph-first planning ve structural diff	Orta-yüksek
Obsidian Canvas	Local files, açık JSON Canvas formatı, extensibility. 
Obsidian
	Gerçek multiplayer + server conflict + agent governance	Orta
Mermaid	Text/code tabanlı, Git-native diagram versioning; güncel dokümanlar Mermaid 11.16.1'i gösteriyor. 
Mermaid
+1
	Görsel eşzamanlı düzenleme + structured planning semantics	Orta, özellikle geliştiricilerde
GitHub Projects	Issues/PR'larla doğrudan bağlantılı board/table/roadmap; agentic issue planning. 
GitHub Docs
+1
	Canvas + mind-map + explicit AI proposal/commit layer	Yüksek ICP overlap

En tehlikeli iki rakip: Miro ve Linear.

Miro senin görsel yüzeyine; Linear ise hedef kullanıcı grubuna yaklaşıyor.

12. Özellik boşlukları ve öncelik

Burada Değer kullanıcı değerini, Maliyet ise mevcut mimariden tahmini geliştirme yükünü gösteriyor.

Özellik	Değer	Maliyet	Standart / farklılaştırıcı	Öneri
Etiket + filtre	H	S	Standart	P0
Şablon kütüphanesi	H	S–M	Standart ama activation kritik	P0
Arama	H	M	Standart	P0
Komut paleti	M/H	S	Dev UX	P1
Markdown/Mermaid export	H	M	Dev ICP için kısmi fark	P1
Yorum/tartışma	H	M	Standart	P1
Bildirim	H	M	Standart	P1, yorumdan sonra
Public read-only link	H	M	Standart + growth	P1
İlerleme/değişiklik raporu	H	M	Farklılaştırıcı olabilir	P1
Webhook	M/H	M	Platform standardı	P2
Tarih + basit deadline	H	S–M	Standart	P1
Dependency scheduling / critical path	H	L	Graph ile birleşince farklılaştırıcı	P2
GitHub Issues/Projects bridge	H	L	ICP için stratejik	P2
Dosya/attachment	M	L	Standart	P3

Özellikle progress report fırsatını küçümsemem.

Normal project tool:

“Bu hafta tamamlanan görevler.”

Co-Pronoia:

“Commit #184–#216 arasında planın hangi bölümleri, kim veya hangi ajan tarafından, neden değişti?”

şeklinde rapor üretebilir.

Sen zaten gerekli veri modeline sahipsin.

Bu gerçek bir commit-native feature.

13. İlk 5 dakika / activation

Onboarding'i MCP ile başlatma.

Yeni kullanıcı önce ürün değerini, sonra agent entegrasyonunu görmeli.

0:00–1:00

Boş canvas yerine:

Ne planlıyorsun?


[ Yazılım özelliği ]
[ Mimari / sistem ]
[ Release planı ]
[ Boş kanvas ]

Seçildiğinde 5–8 düğümlük gerçek düzen gelsin.

1:00–2:00

Kullanıcı bir node'u değiştirir/taşır.

Staging tray:

3 değişiklik hazır
[Değişiklikleri gönder]

Teknik kullanıcı için yanında:

→ commit #2

gösterilebilir.

2:00–3:00 — “aha moment”

İlk commit sonrası:

Planınız kaydedildi.


[ Değişikliği göster ]
[ Geri al ]

Ve gerçek structural diff.

Bence senin ilk büyük değer anın AI değil, “plan da kod gibi güvenli biçimde değiştirilebiliyor” hissi.

3:00–4:00

Built-in agent:

“Bu plana test ve deployment adımları eklemek ister misin?”

Sonra doğrudan mutation yerine proposal/diff görünümü.

Kullanıcı:

+ Integration Tests
+ Staging
+ Monitoring


[Onayla]
4:00–5:00

Ancak bundan sonra:

“Cursor / VS Code / Claude gibi dış ajanları da bu canvasa bağlayabilirsin.”

MCP onboarding

Burada .mcp.json kopyala-yapıştır akışından çıkmalısın.

VS Code güncel MCP desteğinde server gallery, guided Add Server ve install linkleri sunuyor; vscode:mcp/install?... bağlantıları kullanılabiliyor. Cursor da MCP install deep-link yaklaşımını destekliyor. Anthropic, Haziran 2025'te Desktop Extensions ile MCP server kurulumunu tek tıklama modeline taşımıştı. 
Anthropic
+3
Visual Studio Code
+3
Visual Studio Code
+3

Co-Pronoia:

MCP bağlantıları


[ Add to VS Code ]
[ Add to Cursor ]
[ Config kopyala ]

sunmalı.

Akış:

1. Canvas-scoped credential üret
2. Kullanıcı rollerini göster
3. expiration seç
4. deep link ile istemciye gönder
5. connection test
6. ilk canvas_overview çağrısını doğrula

Sonuç sayfası:

✓ Cursor bağlı
✓ Canvas: Backend Redesign
✓ Roller: Architect, Reviewer
✓ 12 MCP tool kullanılabilir

Ayrıca:

rotate,

revoke,

last-used,

client label,

expiration

göster.

MCP'nin güncel specification sürümü 2026-07-28; yeni geliştirmelerde bu revizyonu target olarak ele almak mantıklı. 
Model Context Protocol Blog

14. Fiyatlandırma

2026'daki trend saf seat-based'den seat + pooled AI usage modeline kayıyor.

Miro plan başına/koltuk başına dahil edilen ve workspace çapında havuzlanan AI kredileri kullanıyor; ek credit bundle satın alınabiliyor. 
Miro
+2
Miro Help Center
+2

Linear'ın Basic planı güncel sayfasında yıllık ödemede $10/user/month; Linear ayrıca yüksek tüketimli AI özelliklerinde kredi/usage yaklaşımı kullanıyor ve external agent'ları ücretli insan seat'i saymıyor. 
Linear
+2
Linear
+2

Notion Custom Agents kredileri workspace düzeyinde tüketiyor ve 2026'da agent/workspace harcama limitlerini ekledi. 
Notion
+2
Notion
+2

Jira da ücretli planlarda kullanıcı başına hesaplanan fakat havuzlanan AI kredileri uyguluyor. 
Atlassian

Co-Pronoia için önerdiğim model

Local

Free
1 user
unlimited local canvases
full commit history
import/export
MCP

AI için:

BYO API key

seçeneği güçlü olur.

Cloud Free

küçük editor limiti
temel collaboration
sınırlı AI pool

Commit history/time travel'ı ciddi biçimde kısıtlamazdım; bu ürünün özünü demo edebilmesi gerekiyor.

Team

paid human editor seats
+
workspace pooled AI credits
+
unlimited/non-billable agent identities

Bu son madde önemli:

Çok ajan kullanan müşteriyi çok ajan kullandığı için seat ile cezalandırma.

Linear da external agents'ı billable seat saymıyor. 
Linear

AI kullanımında:

10.000 included credits
+ hard workspace limit
+ per-agent limit
+ optional top-up

gibi bir model daha anlaşılır.

Open-core / self-host

Plane'in Community Edition'ı AGPLv3 altında ücretsiz self-host edilirken ticari katmanlar ücretli özellikler ekliyor; GitLab da cloud/self-managed ürünler ve open-core ticari model kullanıyor. n8n ise Community self-host katmanı ile benzer bir “free local + commercial hosted” referansı sunuyor, ancak lisans modeli klasik açık kaynak olarak adlandırılmamalı. 
n8n Documentation
+3
Plane Developers
+3
GitLab
+3

Co-Pronoia için güçlü ayrım:

Açık/ücretsiz çekirdek

event/commit engine,

replay,

local canvas,

import/export,

MCP protocol/server,

single-user local.

Ücretli hosted value

collaboration,

managed identity,

invitations,

managed AI,

team governance,

hosted integrations,

org administration,

backups/availability.

Bu, local sürümü kasıtlı olarak kötüleştirmekten daha sağlıklı.

Önerilen yol haritası

Bağımlılık sırasına göre şöyle ilerlerdim:

Aşama 0 — Correctness ve dağıtım temeli

1. Prisma Migrate'a geç.

Baseline + fresh-install + upgrade CI.

2. Local-build güvenlik sözleşmesini sertleştir.

module boundaries
→ build
→ Docker artifact scan
→ sentinel test
→ route smoke test

3. Immutable commitId ekle.

Henüz iki yönlü sync yapmadan.

commitId ≠ seq

olması ileride büyük migration'ı engeller.

4. Snapshot/checkpoint formatı ekle.

Checksum + schemaVersion ile.

5. Canvas service lifecycle'ı bounded hale getir.

Shared PrismaClient + TTL/LRU/dispose + soak testing.

Aşama 1 — Multi-replica hazır ol

6. WS'yi seq-based invalidation protokolüne dönüştür.

broadcast {canvasId, seq}
client gap → HTTP catch-up

7. PostgreSQL LISTEN/NOTIFY ile replicas arası broadcast ekle.

Redis'i gerçekten gerekli olana kadar ertele.

8. Property/model-based test suite'i büyüt.

Özellikle:

invert
replay
conflict
branch
permission choke point
Aşama 2 — İlk kullanıcı değerini yükselt

9. Tags + filters.

10. Arama.

11. 3–5 kaliteli template.

Örnek:

Feature Development

System Architecture

Release Plan

Incident Follow-up

Agent-assisted Planning

12. Basic dates.

Timeline görünümün zaten varsa bu gecikmemeli.

13. Commit-native progress/diff report.

Bence roadmap'in en önemli küçük/orta boy ürün özelliklerinden biri.

Aşama 3 — Collaboration

14. Comments → notifications.

Yorumu ilk etapta:

Node
Commit

seviyesinde desteklemek yeterli.

Per-op comment gereksiz olabilir.

15. Public read-only sharing.

Region/permission modelinden geçmesine dikkat.

16. Markdown/Mermaid export.

Developer ICP açısından yüksek getirili.

Aşama 4 — Agent UX

17. Proposal review ekranını ürünün merkezi yüzeylerinden biri yap.

Agent X proposes:
+3 node
-1 edge
2 field changes


Affected regions: Backend, API
Conflicts: none

18. MCP one-click installation.

Cursor / VS Code deep links + fallback config.

19. Supervisor policy UI.

Örneğin:

Architect agent
  → Backend region
  → may propose


Supervisor
  → auto-approve labels only
  → human approval required for delete

Bu, aiAllowed özelliğini gerçek ürün farkına çevirebilir.

Aşama 5 — İki yönlü local/cloud

Ancak önce commitId, snapshots ve migration altyapısı tamamlanmış olsun.

20. Fetch cloud main.

21. Local commits.

22. Push local commits as branch.

23. Cloud conflict evaluation.

24. Promotion.

İlk sürümde CRDT yok.

Aşama 6 — Ekosistem

25. Signed webhook + retry + delivery log.

Ardından:

26. GitHub Issues/Projects bridge.

İlk sürümde iki yönlü “her şeyi sync etme” yerine:

Co-Pronoia node
   ↔ GitHub Issue externalId

ve kontrollü event translation.

Attachments ve gelişmiş dependency scheduler'ı kullanım doğrulandıktan sonra yapardım.

Ürün açısından en önemli üç yatırım

Teknik backlog'dan bağımsız, bugün yalnız üç şey seçsem:

1. Commit/proposal governance'i görünür hale getir

Mimari içinde saklama.

Kullanıcı UI'da görmeli:

#481 Gemini
3 suggestions


#482 Beren
2 manual changes


#483 Architecture Agent
Proposal → approved by Supervisor

Burası ürün.

2. “What changed?” ekranını olağanüstü iyi yap

Sadece:

Diff
title: foo → bar

değil.

Release planı neden değişti?


• Authentication işi 3 gün ileri taşındı.
• Bunun sonucu Deployment düğümünün dependency zinciri değişti.
• Değişiklik Agent/Architect tarafından önerildi.
• Supervisor #2 tarafından kabul edildi.

Commit graph'ın burada gerçek kullanıcı değerine dönüşüyor.

3. External agent'ları kontrollü ama çok kolay bağla

Bugün:

.mcp.json kopyala
API key yarat
config düzenle
restart

ise activation öldürür.

Hedef:

[Connect Cursor]
        ↓
[Allow Architect role on this canvas]
        ↓
Connected ✓

olmalı.

Açık sorular

Bunlar çözülmeden özellikle sync ve ürün konumlandırmasında bazı kararları kilitlemezdim:

Yerel mod “self-host single-user” mı, gerçek “offline-first replica” mı? Bunlar aynı ürün değil.

Local kullanıcı değişiklik yaptığında cloud'a dönüş main'e otomatik merge mi olmalı, yoksa benim önerdiğim gibi her zaman önce local/<device> branch'i mi?

Commit geçmişinin ürün sözleşmesi “sonsuz/audit history” mi? Eğer evetse cold archival formatını uzun vadeli bir compatibility contract olarak tanımlamak gerekir.

seq branch commit'lerinde bugün nasıl davranıyor? Canvas-global mı, main-only mi? İki yönlü sync protokolünü etkiler.

Supervisor ajan otonom olarak proposal approve edebiliyor mu? Eğer evetse ürününü “human approval” olarak pazarlamamalısın. “Policy/supervisor governed” daha doğru olur. İstenirse delete/region-crossing gibi işlemler için zorunlu insan onayı ayrıca getirilebilir.

Timeline yalnızca tarihlerin gösterildiği bir görünüm mü, yoksa dependency propagation / scheduling / critical-path motoru mu olacak? İkincisi ayrı bir büyük ürün.

Yerel build'deki “cloud kodu yok” kontratı tam olarak nerede bitiyor? Prisma schema/migration içinde User, OAuth, Invitation tablo isimlerinin bulunması kabul ediliyor mu, yoksa bunların da artifact'tan çıkarılması mı gerekiyor?

Cloud ve local için tek DB schema mı koruyacaksın? Ben mümkün olduğunca tek core schema öneririm; iki farklı schema migration yükünü ciddi artırır.

MCP server ve commit engine açık kaynak/open-core çekirdeğinin parçası olacak mı? Bence protokol/interoperability açısından olması ürünün güvenilirliğini artırabilir.

Ana hedef gerçekten developer/engineering teams mi? Eğer evetse GitHub/Mermaid/MCP yüksek öncelikli; genel PM pazarı hedefleniyorsa comments, calendar, attachment ve notification çok daha erken gelmek zorunda.

AI maliyetini Co-Pronoia mı üstlenecek, yoksa cloud paid müşteride bile BYO model key desteklemek istiyor musun? Pricing ve privacy stratejisinin ikisini de değiştirir.

Proposal geçmişi “denetim kaydı” mı yoksa geçici çalışma verisi mi? Retention/partitioning politikası buna bağlı.

Genel değerlendirme

Mimarinin en değerli tarafı React Flow, MCP veya Gemini değil. Bunların hepsi ikame edilebilir.

Asıl zor kopyalanabilir parça şu bütünlük:

Intent
   ↓
Deterministic ops
   ↓
Permission / region policy
   ↓
Conflict detection
   ↓
Commit or branch
   ↓
Replayable history
   ↓
Materialized state

ve AI ajanlarını bunun dışından özel bir “arka kapıyla” geçirmek yerine aynı sisteme proposal/promotion olarak bağlaman.

Bu yüzden önümüzdeki ürün kararlarında benim kullanacağım filtre şu olurdu:

“Bu özellik Co-Pronoia'yı başka bir Miro yapıyor mu, yoksa denetlenebilir insan+ajan planlama sistemini güçlendiriyor mu?”

İkinci gruptaki proposal review, commit-native progress report, supervisor policies, region-aware AI permissions, diff/time-travel ve güvenli local↔cloud branch sync özellikleri, bence Co-Pronoia'nın en savunulabilir çekirdeği.
