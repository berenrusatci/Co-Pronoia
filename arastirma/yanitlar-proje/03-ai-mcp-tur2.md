Co-Pronoia — Yapay zekâ katmanı mimari incelemesi

İnceleme tarihi: 14 Ağustos 2026. Değerlendirme, yüklediğiniz gerçek server/shared/db kaynak kodu ile 2025–2026 MCP spesifikasyonu, framework dokümantasyonu ve güncel agent-security çalışmalarının çapraz kontrolüne dayanıyor.

Yönetici özeti

MCP tarafındaki “her POST için taze server + transport, session yok” yaklaşımınız doğru yönde; 28 Temmuz 2026 MCP sürümü protokol çekirdeğini resmen stateless yaptı. 
Model Context Protocol Blog
+1

Ancak kodunuzun wire-level testleri hâlâ 2025-03-26 protokolünü hedefliyor; güncel _meta, header routing ve server/discover modeline geçiş gerekiyor. server/src/mcp.test.ts:32-54.

“MCP'de server→client push yok” varsayımı artık güncel değil: 2026-07-28'de subscriptions/listen ile client-açılmış SSE notification stream'i var. 
Model Context Protocol
+1

Buna rağmen wait_for_changes gibi domain-level long-poll aracı geçerli bir uyumluluk deseni; 25 saniye makul ve yaygın proxy varsayımlarının altında. 
Nginx
+1

Statik Bearer anahtarınız MCP açısından yasak değil; MCP authorization optional, custom authentication izinli. Fakat standart interoperable MCP auth profili OAuth 2.1 tabanlı. 
Model Context Protocol
+1

Proposal → supervisor → normal commit hattınız genel olarak çok güçlü bir mimari: ajan doğrudan state değiştiremiyor ve onay sonrasında bile insan aktörün güncel yetkileri yeniden uygulanıyor.

Fakat aiAllowed:false bugün güvenlik sınırı değil. Merkezi commit choke point'i AI provenance veya aiAllowed kontrolü yapmıyor.

Daha önemlisi owner'ın yerleşik ajanı aiAllowed ve bölge geometrisini model çıktısıyla değiştirip aynı turda kapalı bölge filtresini aşabiliyor.

Prompt injection yüzeyi yüksek: node title/description/notes/data, region description ve ortak brief doğrudan LLM bağlamına giriyor; brief'i herhangi bir MCP ajanı değiştirebiliyor.

Claim sistemi doğru biçimde “soft lease” olarak tasarlanmış; fakat acquisition atomik değil, yatay ölçeklemede iki ajan aynı claim'i yarışla alabilir.

Gemini tarafında şu anda JSON mode var, Structured Output yok; heuristic JSON repair yerine gerçek JSON Schema kullanılmalı.

En iyi genel yön: LLM'leri planlayıcı, kodu tek otorite/reference monitor yapma yaklaşımınızı koruyup AI provenance, immutable security policy, typed output ve durable event cursor eklemek.

Bulgular
1. MCP stateless sunucu modeli: tasarımınız artık güncel MCP ile çok iyi örtüşüyor
İddia

28 Temmuz 2026 MCP sürümü önemli bir kırılma yaptı: initialize/initialized handshake'i ve Mcp-Session-Id kaldırıldı; her istek protokol versiyonu, client kimliği ve capability bilgisini kendi _meta alanında taşıyan self-contained bir request haline geldi. MCP artık açıkça stateless tanımlanıyor. 
Model Context Protocol Blog
+1

Resmî TypeScript SDK migration dokümanı özellikle eski v1 deseninizle neredeyse bire bir eşleşen şu geçişi tarif ediyor: sessionIdGenerator: undefined + request başına fresh server/transport, yeni handler modeline doğrudan taşınabiliyor. 
GitHub

Kodunuz gerçekten bunu yapıyor:

yeni McpServer: server/src/mcp/mcpRoutes.ts:34

yeni StreamableHTTPServerTransport: server/src/mcp/mcpRoutes.ts:35-38

sessionIdGenerator: undefined: server/src/mcp/mcpRoutes.ts:35-37

request kapanınca transport+server cleanup: server/src/mcp/mcpRoutes.ts:39-45

Bu aynı zamanda Şubat 2026'da TypeScript MCP SDK'sında yayımlanan cross-client response leakage advisory'sinin önerdiği güvenli desendir; advisory, her request için ayrı server + transport kullanan uygulamaların etkilenmediğini açıkça belirtiyor. 
GitHub

Kodunuzdaki eksik

Test client'ınız:

server/src/mcp.test.ts:50-54

protocolVersion: '2025-03-26'

kullanıyor ve RPC helper'ı server/src/mcp.test.ts:36-46 güncel 2026 _meta/routing modelini üretmiyor.

Mimarinize etkisi

Mimariyi değiştirmeyin; transport katmanını upgrade edin.

Yeni SDK'da factory-per-request modelini koruyun. 2025 client'lar hâlâ gerekiyorsa SDK'nın legacy stateless fallback mekanizmasını kullanabilirsiniz. Güncel MCP ayrıca MCP-Protocol-Version, Mcp-Method ve Mcp-Name gibi HTTP-level routing bilgisini tanımladı. 
Model Context Protocol Blog
+1

2. wait_for_changes: geçerli desen, fakat artık MCP'nin tek seçeneği değil

Burada başlangıç varsayımınızın bir kısmı eskimiş durumda.

Güncel MCP

2026-07-28 MCP üç temel message pattern tanımlıyor:

request/response,

MRTR,

Subscribe and Notify.

subscriptions/listen, client'ın açtığı uzun ömürlü POST/SSE response stream'i üzerinde server→client notifications taşıyor. Server bağımsız bir JSON-RPC request başlatamıyor, fakat notification push yapabiliyor. 
Model Context Protocol
+2
Model Context Protocol
+2

Dolayısıyla:

“MCP'de hiçbir server→client push yok”

artık doğru değil.

Daha doğru ifade:

“Server kendiliğinden yeni bir client RPC çağrısı başlatamaz; ancak client'ın açtığı subscriptions/listen stream'i üzerinden server notifications gönderebilir.”

Sizin long-poll implementation

server/src/mcp/mcpServer.ts:417-495

iyi düşünülmüş:

max timeout 25 s,

commit head izleniyor,

proposal değişikliği izleniyor,

brief revision izleniyor,

event subscription var,

abort signal ele alınıyor,

finally ile unsubscribe ediliyor.

Özellikle server/src/mcp/mcpServer.ts:467-473, uyandırıldıktan sonra in-memory event'e körü körüne güvenmiyor; kalıcı state'i tekrar okuyor. Bu doğru tasarım.

Long-poll MCP araçlarının gerçek dünyada örnekleri de var. YAR MCP'nin listen aracı 5–120 saniye + after_id cursor kullanıyor; RogerThat 1–60 saniyelik long-poll kullanıyor. 
GitHub
+1

25 saniye makul mü?

Evet. Örneğin nginx proxy_read_timeout varsayılanı 60 saniye. 25 saniye, kurumsal proxy'ler için de muhafazakâr bir değer. 
Nginx

Fakat proxy timeout hiçbir zaman garanti değildir.

Esas problem: reconnect cursor'ı

Commit için durum iyi:

sinceSeq

kalıcı cursor görevi görüyor.

Fakat brief ve proposal için aynı kalite yok. Şu anda baseline çağrı sırasında alınıyor:

server/src/mcp/mcpServer.ts:453-458.

Örneğin:

brief değişti,

long-poll bunu fark etti,

response ağda kayboldu,

client tekrar wait_for_changes çağırdı.

Yeni request mevcut brief'i baseline yapacağı için briefChanged:false görebilir.

Bu veri kaybı değildir — get_brief ile son state alınabilir — ama event delivery semantiği at-least-once değildir.

Öneri

Tool'u şu yönde evriltin:

sinceSeq
sinceBriefRevision
sinceProposalRevision / sinceEventSeq

Daha iyisi canvas-level tek monotonik:

activitySeq

üretmek.

Uzun vadede:

modern MCP client → subscriptions/listen,

eski/agent-loop client → wait_for_changes

ikisini beraber desteklemek en iyi çözüm olur.

3. Bearer API key ve OAuth: mevcut modeliniz uyumlu ama “standard MCP OAuth” değil

2026-07-28 authorization spesifikasyonu açıkça:

Authorization MCP implementations için OPTIONAL.

diyor. HTTP implementation auth destekliyorsa standart authorization specification'a uyması SHOULD, ayrıca genel MCP overview client/server'ın custom authentication stratejisi anlaşabileceğini açıkça söylüyor. 
Model Context Protocol
+1

Dolayısıyla OAuth zorunlu değil.

Mevcut token modeliniz

Kod:

yalnız owner token basabiliyor: server/src/routes.ts:550-560

token tma_ + nanoid(32): server/src/agentRoleService.ts:157-181

DB'de SHA-256 hash: server/src/agentRoleService.ts:98-101

raw token yalnız create/rotate cevabında: db/prisma/schema.prisma:311-318

rotate: server/src/agentRoleService.ts:205-225

revoke: server/src/agentRoleService.ts:200-202

revoked token çözülmüyor: server/src/agentRoleService.ts:230-249

canvas scope token üzerinde sabit: db/prisma/schema.prisma:319-337

Bu, kapalı ve administratively provisioned agent ortamı için gayet makul.

Nerede OAuth gerekir?

Generic MCP host'larının sizin server'ınızı otomatik authorization discovery ile kullanmasını istiyorsanız MCP standard authorization profile:

OAuth 2.1,

protected resource metadata,

auth server discovery,

Bearer access tokens

bekliyor. 
Model Context Protocol
+1

Eksikler

Mevcut AgentToken'da:

db/prisma/schema.prisma:319-337

expiry alanı yok.

Bu nedenle önerim:

mevcut tma_ token'larını internal/service credential olarak koruyun;

expiresAt,

lastUsedFrom,

optional allowed-tools/capabilities,

audit trail

ekleyin.

Dış MCP ekosistemine açılacağınız zaman OAuth katmanını ayrıca ekleyin.

4. Çok ajanlı koordinasyon modelleri

Anthropic'in Haziran 2025 üretim araştırma sistemi sizin yapınıza kavramsal olarak oldukça yakın: bir lead agent işi planlıyor, paralel subagent'lar araştırma yapıyor ve lead sonuçları sentezliyor. Anthropic özellikle multi-agent sistemlerin coordination, evaluation ve reliability maliyetlerini vurguluyor. 
Anthropic

Sizin önemli farkınız daha güvenli:

Worker agent → doğrudan state mutation değil → proposal.

Bu ayrım birçok framework'ün varsayılanından daha sert.

Çok ajanlı çerçeve karşılaştırması
Çerçeve	Koordinasyon	Onay/veto modeli	Güvenlik açısından	2026 olgunluğu	Co-Pronoia uyumu
AutoGen	Group chat, selector; GraphFlow ile sequential/parallel/conditional/loop	UserProxyAgent ile APPROVE/reject döngüsü kurulabiliyor	Tool erişimi ve flow sizin tarafınızdan sınırlandırılmalı	AgentChat olgun; GraphFlow hâlâ experimental 
Microsoft GitHub
+1
	Orta-yüksek
CrewAI	Sequential veya hierarchical; manager ajan delegasyon ve validation yapıyor	Flow'larda @human_feedback; manager outcome doğruluyor	Role/task bazlı tool ayrımı kolay; hard policy yine dış kodda tutulmalı	Dokümanlarda v1.15.16; HITL ≥1.8 
CrewAI Documentation
	Yüksek
LangGraph	Açık state graph; supervisor + specialist subagents	Persisted interrupt; approve/edit/reject/respond	Deterministik control-flow ile LLM kararlarını ayırmak çok kolay	v1 stable, persistence ve HITL first-class 
Docs by LangChain
+2
Docs by LangChain
+2
	En yüksek
OpenAI Swarm	Agent + handoff	Native durable approval modeli sınırlı	Basit orchestration prototipleri için	Experimental/educational ve artık superseded; production için Agents SDK öneriliyor 
GitHub
	Yeni proje için düşük

Swarm'ın güncel karşılığı olan OpenAI Agents SDK artık sensitive tool calls üzerinde persisted/serializable HITL approval sunuyor; nested agent tool çağrılarındaki approval da outer run'a taşınıyor. 
OpenAI GitHub Pages

Sonuç

Eğer Co-Pronoia koordinasyonunu bir framework'e taşımanız gerekseydi LangGraph'ın control-plane modeli mimarinize en yakın olanı olurdu.

Fakat mevcut proposal/commit sisteminiz zaten ürününüzün domain semantics'ini taşıyor. Sırf “multi-agent framework kullanalım” diye bunu framework içine taşımak bence gereksiz.

Framework ajanları koordine etsin; otorite Co-Pronoia server'da kalsın.

5. “Ajan önerir, supervisor + kod uygular” modeliniz literatürde nereye oturuyor?

Tek bir terim değil, üç desenin kesişimi:

Human/agent-in-the-loop approval gate

least privilege / capability restriction

reference monitor / complete mediation

LangGraph ve OpenAI Agents SDK'daki sensitive-tool approval modelleri aynı genel fikri uygular: model action üretir, execution ayrı bir policy/approval aşamasından geçer. 
Docs by LangChain
+1

2025 “Design Patterns for Securing LLM Agents against Prompt Injections” çalışması da esas savunmanın modelden “iyi davranmasını” istemek değil, modelin untrusted input gördükten sonra gerçekleştirebileceği consequential actions'ı mimari olarak kısıtlamak olduğunu savunuyor. 
arXiv
+1

Kodunuz burada oldukça güçlü.

Proposal validation yalnız ilk kabul sırasında yapılmıyor:

server/src/proposalService.ts:82-109

sadece erken feedback.

Gerçek onay sırasında:

server/src/proposalService.ts:243-265

token hâlâ mevcut mu?

token creator hâlâ canvas member mı?

şu anki rolü viewer mı?

sonra normal CommitService.commit().

Özellikle:

server/src/proposalService.ts:260-265

supervisor'ın kendi güçlü kimliğiyle commit atmaması çok iyi.

Supervisor agent bir editor'ın proposal'ını owner yetkisine yükseltemiyor.

Bu, privilege escalation'a karşı doğru pattern.

Zayıf tarafı

Kod yalnızca “bu mutation teknik olarak izinli mi?” sorusunu iyi cevaplıyor.

Şunu cevaplamıyor:

“Supervisor neden bunu onayladı; supervisor proposal summary'sindeki prompt injection tarafından kandırıldı mı?”

OWASP'ın 2026 Agentic Top 10'u bunu doğrudan ASI09 – Human-Agent Trust Exploitation ve agent-to-agent poisoning/cascading failures sınıfında ele alıyor. 
OWASP Gen AI Security Project

Bu nedenle supervisor'a yalnız persuasive summary değil, deterministik diff gösterilmeli.

6. Claim sistemi: doğru olarak soft lease, ama acquisition race var

Claim'lerin correctness lock olmaması doğru.

Kod bunu açıkça söylüyor:

server/src/claimService.ts:6-13

claim DANIŞMA katmanı; commit hâlâ tek otorite.

TTL:

min 30 sn

default 600 sn

max 900 sn

server/src/claimService.ts:16-19.

Bu, klasik lease desenine uygun. Kubernetes de dağıtık koordinasyon için Lease + renewTime + expiration yaklaşımını kullanıyor. 
Kubernetes

Fakat acquisition atomik değil

Şu sıra var:

live claims oku,

overlap kontrol et,

sonra create.

server/src/claimService.ts:138-176.

İki ayrı server process aynı anda çalışırsa:

A: overlap yok
B: overlap yok
A: INSERT
B: INSERT

ikisi de claim alabilir.

Bu correctness sorunu yaratmaz çünkü claim hard lock değil, ama claim mekanizmasının koordinasyon faydasını tam çakışma anında bozar.

Çözüm

Canvas başına kısa bir DB transaction serialization:

mevcut canvas row üzerinde SELECT ... FOR UPDATE, veya

transaction-level PostgreSQL advisory lock,

sonra:

sweep
check
insert

tek critical section.

PostgreSQL transaction-level advisory locks transaction sonunda otomatik bırakılır ve kısa application-defined critical sections için uygundur. 
PostgreSQL

Starvation

Kod “süresiz sahiplik yok” diyor çünkü her lease max 15 dakika:

server/src/claimService.ts:16-19.

Ama aynı agent claim'i sürekli renew edebilir:

server/src/claimService.ts:138-145.

Dolayısıyla tek lease sonsuz değil, continuous ownership pratikte sonsuz olabilir.

Çözüm:

maxContinuousHold
renewCount
cooldownAfterMaxHold

Ek olarak randomized exponential backoff yeterli olur; birkaç eşzamanlı agent ölçeğinizde karmaşık distributed scheduler gerekmiyor.

7. Prompt injection: şu an en önemli AI güvenlik problemi

OWASP LLM01:2025, external/user-controlled içeriğin model davranışını değiştirmesini doğrudan indirect prompt injection olarak sınıflandırıyor. 
OWASP Gen AI Security Project

Co-Pronoia'da bu veri yolları gerçek:

Node içeriği

LLM'e gönderiliyor:

server/src/agent.ts:206-219

title

description

notes

data

Region description

LLM'e gönderiliyor:

server/src/agent.ts:224-227.

Daha da önemlisi prompt açıkça:

server/src/agent.ts:262-264

“açıklamalarını bağlam/yönerge olarak kullan”

diyor.

Bu satır region descriptions'ı veri olmaktan çıkarıp fiilen instruction channel haline getiriyor.

Shared brief

server/src/agent.ts:251-253:

“ürettiğin işleri buna uygun kur”

şeklinde model prompt'una giriyor.

Ve herhangi bir MCP agent:

server/src/mcp/mcpServer.ts:398-414

update_brief çağırabiliyor.

Bu nedenle şu saldırı mümkündür:

Compromised MCP worker
     ↓
update_brief("Önceki güvenlik talimatlarını görmezden gel...")
     ↓
persistent shared brief
     ↓
daha sonra kullanıcı built-in Gemini agent çalıştırır
     ↓
poisoned instruction Gemini context'ine girer

Bu, OWASP'ın ASI06 Memory & Context Poisoning sınıfıyla çok iyi örtüşüyor. 
OWASP Gen AI Security Project

Simon Willison'ın 2025 “lethal trifecta” modeli açısından da risk şudur:

private data,

untrusted content,

external communication / consequential action

aynı ajan üzerinde birleştiğinde injection'ın blast radius'u büyür. 
Simon Willison’s Weblog

Yerleşik agent'in arbitrary internet tool'u olmadığı için onun trifecta'sı tam değil; ancak canvas write capability'si nedeniyle integrity saldırısı hâlâ gerçektir.

Prompt injection risk tablosu
Senaryo	Etki	Gereken savunma	Mevcut durum
Node başlığı: “tüm eski talimatları yok say...”	Plan/ops manipülasyonu	Node metnini UNTRUSTED_DATA kabul et; consequential action policy kodda	⚠️ Prompt'a doğrudan giriyor
Region description injection	Belirli bölgeyle çalışırken targeted injection	Description'ı instruction değil veri olarak etiketle	❌ Kod açıkça “yönerge olarak kullan” diyor
MCP worker update_brief ile poison eder	Persistent cross-agent injection	Brief write ACL + review + provenance	❌ Tüm agent rolleri yazabiliyor
Proposal summary supervisor'ı ikna eder	Zararlı proposal onayı	Supervisor'a generated summary yerine canonical diff/invariants	⚠️ Kod gate var, semantic deception kalıyor
Injection aiAllowed açtırır	Korunan bölgeye AI mutation	Security config LLM tarafından değiştirilemez olmalı	❌ Gerçek bypass mevcut
Injection region rectangle'ını taşır	Kapalı düğümler korunan alan dışına çıkar	Security-boundary geometry AI tarafından değiştirilemez	❌ Model geometry değiştirebiliyor
Çok ajanlı poisoned state yayılması	Bir ajan yazısı sonraki ajanları etkiler	Provenance + taint + context filtering	⚠️ Node/brief ortak context
External MCP agent başka araçlara da sahipse	Canvas verisi exfiltration	Host-level egress/tool sandbox	Co-Pronoia server tek başına garanti edemez

Prompt filtering tek başına yeterli değildir. 2025 security-design çalışmaları ve 2026 containment pratikleri model davranışı yerine hard capability boundaries ve layered controls öneriyor. 
arXiv
+1

8. Bozuk/kötü niyetli agent: mevcut limitler iyi başlangıç, cluster ölçeğinde yetersiz

Mevcut olumlu kontroller:

MCP proposal

title ≤120

summary ≤2000

intent ≤200

server/src/proposalService.ts:10-12, server/src/mcp/mcpServer.ts:505-510.

Claims

max 200 node

TTL max 900 s

30 write/min/token

server/src/claimService.ts:16-24, server/src/claimService.ts:121-128.

Built-in agent

prompt max 8000 chars,

user+canvas 8 request/min,

user global 20/min,

Gemini request timeout 60 s.

server/src/routes.ts:33-58, server/src/agent.ts:60-100.

OWASP LLM10:2025 “Unbounded Consumption” için request quotas ve rate limiting temel kontroller arasında. 
OWASP Gen AI Security Project

İki sorun
1. Rate limiter process-local
TypeScript
const agentCalls = new Map(...)

server/src/routes.ts:45-58

ve claim limiter:

server/src/claimService.ts:21-33.

İki server replica olduğunda limit iki katına çıkar.

Bunu PostgreSQL/Redis tabanlı shared limiter'a taşıyın.

2. Intent sayısı ≠ gerçek mutation maliyeti

200 intent limitliyorsunuz, ancak bir intent expansion sonrası birden fazla actual op üretebilir.

Bu nedenle ayrıca:

MAX_EXPANDED_OPS
MAX_TOUCHED_NODES
MAX_TOUCHED_EDGES
MAX_SERIALIZED_DIFF_BYTES

ölçün.

Ayrıca LLM response için açık:

maxOutputTokens
maxResponseBytes
maxOps

bütçesi konmalı.

9. aiAllowed:false: yalnız bir katman değil — şu anda kolay aşılabilir

Bu incelemenin en önemli kod bulgusu bu.

Kullanıcı bağlamındaki hedef:

“kapalıysa yapay zekâ o bölgeye dokunamıyor.”

Gerçek kod bunu merkezi olarak garanti etmiyor.

Problem A — merkezi commit choke point aiAllowed bilmiyor

Actor:

server/src/commitService.ts:15-19

yalnız:

userId
role

taşıyor.

AI/human provenance yok.

Central guard:

server/src/commitService.ts:431-455

yalnızca:

regionViolation(...)

çalıştırıyor.

Ve shared guard:

shared/src/regionGuard.ts:22-28

yalnız:

memberIds.includes(userId)

kontrol ediyor.

aiAllowed hiç okunmuyor.

MCP sonucu

Supervisor proposal'ı onayladığında:

server/src/proposalService.ts:260-265

actor olarak token'ı oluşturan human member geçiyor.

Dolayısıyla:

MCP agent-generated proposal
→ supervisor approve
→ human creator actor
→ commit guard
→ aiAllowed kontrolü YOK

Editor'ın normalde yazabildiği ama aiAllowed:false bölge, MCP agent proposal'ı tarafından değiştirilebilir.

Problem B — owner built-in agent kapalı bölgeyi aynı request içinde açabiliyor

Model output schema'nız açıkça şunu kabul ediyor:

server/src/agent.ts:328-338

aiAllowed?: boolean
x/y/width/height?

Parser da bunu kabul ediyor:

server/src/agent.ts:344-364.

Daha sonra execution sırası:

model updateRegions üretir,

region config DB'ye yazılır,

regions yeniden yüklenir,

sonra AI-closed filter uygulanır.

Kod:

server/src/agent.ts:625-643

ve:

server/src/agent.ts:823-830.

Örneğin injection:

JSON
{
  "updateRegions": [
    {"id": "secret-region", "aiAllowed": true}
  ],
  "ops": [
    {"op": "delete_node", "...": "..."}
  ]
}

ürettirirse server önce region'ı açar, sonra yeni region listesiyle filtreler.

Aynı bypass aiAllowed değiştirmeden geometry'yi başka yere taşıyarak da yapılabilir.

Sonuç

aiAllowed şu an güvenlik kontrolü değil, ağırlıklı olarak model-level/ad-hoc application guard.

Bu, prompt ile korunmaması gereken bir güvenlik özelliği.

2025–2026 agent-security çalışmaları da tam olarak modelin davranışını güvenlik boundary'si yapmamak ve consequential capabilities'i dış policy layer'da kısıtlamak gerektiğini savunuyor. 
arXiv
+1

10. Natural language → JSON diagram: JSON mode yerine gerçek Structured Output

Mevcut Gemini request:

server/src/agent.ts:71-78

yalnız:

TypeScript
responseMimeType: 'application/json'

kullanıyor.

responseSchema yok.

Sonra parser bozuk JSON'u şu şekilde tamir etmeye çalışıyor:

server/src/agent.ts:437-457

text
text + '}'
text + ']}'
text + '"}'

Bu artık gereksiz derecede kırılgan.

Google Gemini Structured Outputs doğrudan JSON Schema'ya uyan predictable/type-safe output destekliyor ve bunu agent workflows için öneriyor. 
Google AI for Developers

OpenAI de JSON mode ile Structured Outputs ayrımını net yapıyor:

JSON mode → yalnız valid JSON,

Structured Outputs → JSON Schema adherence.

OpenAI Developers

Anthropic de guaranteed schema compliance gereken durumlarda native Structured Outputs öneriyor. 
Claude Platform Docs

Co-Pronoia için önerilen schema

Tek canonical Zod/JSON Schema:

AgentDiagramResponse
  mode
  reply
  message
  ops[]
  parts[]
  newRegions[]
  updateRegions[]
  newSubCanvases[]
  fillSubCanvases[]

Fakat güvenlik nedeniyle updateRegions içinden en az:

aiAllowed
x
y
width
height

AI capability'sini çıkarmanızı öneriyorum.

Model çıktısı:

provider schema validation
       ↓
local Zod validation
       ↓
semantic validation
       ↓
authorization/policy
       ↓
expand
       ↓
commit

olmalı.

11. Model bağımsızlığı: Llm injection doğru başlangıç ama interface fazla dar

Mevcut:

server/src/agent.ts:12-13

TypeScript
type Llm = (system: string, user: string) => Promise<string>

test edilebilirlik için güzel.

Ama production provider layer doğrudan Gemini'ye gömülü:

server/src/agent.ts:49-100.

Bu yüzden bugün gerçek anlamda provider-independent değilsiniz.

Daha iyi adapter

Örneğin kavramsal olarak:

TypeScript
interface StructuredLlm<T> {
  generate(input: {
    system: string
    user: string
    schema: JsonSchema
    timeoutMs: number
    maxOutputTokens: number
  }): Promise<{
    value: T
    provider: string
    model: string
    usage: Usage
    finishReason: string
  }>
}

Provider adapter'ları:

GeminiAdapter
OpenAIAdapter
ClaudeAdapter
LocalAdapter
Neden ortak “OpenAI-compatible API” yeterli değil?

Provider feature semantiği gerçekten farklı.

Örneğin Anthropic'in güncel OpenAI compatibility dokümanı strict function-calling parametresinin compatibility layer'da ignore edildiğini, guaranteed schema için native Claude Structured Outputs gerektiğini söylüyor. response_format da compatibility katmanında ignore ediliyor. 
Claude Platform Docs

Bu yüzden abstraction'ın:

“hepsi aynı endpoint formatını konuşuyor”

değil,

“hepsi bizim StructuredLlm contract'ımızı gerçekten sağlıyor”

olması daha güvenli.

Fallback

Mevcut Gemini fallback'iniz:

server/src/agent.ts:49-100

429/503 → retry → alternatif Gemini model.

Bu iyi.

Cross-provider fallback'i ise yalnız:

transport error,

provider unavailable,

quota,

gibi operational hatalarda yapın.

Policy/schema validation failure'ında başka modele geçip aynı zararlı işlemi yeniden denemeyin.

12. Eval: “iyi plan” için tek metrik yetmez

OpenAI'nin güncel eval rehberi task-specific dataset, production-distribution örnekleri, automated checks + calibrated human review ve sürekli regression testing öneriyor. 
OpenAI Developers
+1

Agent workflow'larda trace-level değerlendirme ayrıca tool selection, handoff ve safety-policy violation'larını ölçmek için kullanılabiliyor. 
OpenAI Developers

Sizin kullanımınıza çok yakın 2026 R2ABench çalışması requirement → architecture diagram üretimini üç katmanda değerlendiriyor:

structural graph metrics,

multidimensional quality scoring,

architecture anti-pattern detection.

Çalışmanın önemli bulgusu: modeller syntax'ta iyi olsa bile component relationships tarafında daha çok hata yapıyor; agentic workflow her zaman kaliteyi artırmıyor. 
arXiv

Co-Pronoia için eval seti

Ben dört katman öneririm.

A. Deterministik güvenlik/invariant eval'leri

100% geçmek zorunda:

schema valid
expandAll succeeds
apply succeeds
rebuildCheck succeeds
no unauthorized region touch
no aiClosed touch
valid parent structure
valid edge endpoints

Mevcut replay/invert/rebuild test altyapınız burada büyük avantaj.

B. Graph kalite metrikleri

Plan türüne göre:

connected component sayısı,

orphan node oranı,

dependency DAG bekleniyorsa cycle sayısı,

parent-cycle,

duplicate node oranı,

requested concepts coverage,

yanlış dependency yönü,

edge/node ratio,

aşırı derin decomposition,

node overlap,

edge crossing,

region containment.

C. Gold set + semantic scoring

Türkçe gerçek kullanıcı promptlarından 100–300 vaka:

proto
detailed
selected nodes
selected regions
viewer/editor/owner
stale canvas
aiAllowed:false
prompt injection
stepwise
existing partial plan

Her vaka için full exact graph yerine:

mandatory concepts,

forbidden changes,

expected relationships,

invariant set

tutmak daha esnek olur.

D. LLM-as-judge

Rubric:

kapsam
eyleme dönüklük
ayrıştırma kalitesi
dependency doğruluğu
gereksiz düğüm
mevcut planı koruma

LLM judge kullanılabilir ama insan değerlendirmesiyle düzenli kalibre edilmelidir. 
OpenAI

Her:

model değiştirme,

system prompt değiştirme,

provider değiştirme,

structured-output schema değiştirme

PR'ında regression eval çalıştırın.

Mevcut tasarımınızın güçlü tarafları

Özellikle korunmasını önerdiğim noktalar:

MCP agent'a commit tool vermemeniz.

Proposal'ın approval sırasında tekrar normal commit pipeline'ından geçmesi.

Supervisor yetkisinin proposal creator'ın gerçek canvas yetkisini yükseltememesi.

Fresh MCP server/transport-per-request.

Proposal'ların size-limitli olması.

Claims'in correctness lock değil advisory coordination olması.

baseSeq korunarak stale proposal'ın normal conflict/branch mekanizmasına girmesi.

LLM fonksiyonunun testlerde injectable olması.

Bunların çoğu modern agent-security'nin “model karar verir ama authority kodda kalır” yönüyle uyumlu. 
arXiv
+1

Öneriler

Buradaki S / M / L efor büyüklüğüdür, önem seviyesi değil.

Efor	Öneri	Öncelik	Yapılmazsa ne olur?
M	Actor/commit metadata'ya origin: human | builtin_ai | mcp_agent ekle; aiAllowed kontrolünü merkezi CommitService'e taşı	P0	MCP proposal path AI-kapalı bölgeyi değiştirmeye devam eder
S	LLM'in aiAllowed değiştirmesini tamamen kaldır	P0	Prompt injection aynı request'te bölgeyi açabilir
S/M	AI'nın aiAllowed:false region geometry'sini değiştirmesini yasakla	P0	Kapalı dikdörtgen taşınıp koruma aşılabilir
M	Built-in AI filtresini “model sonrası convenience filter” olarak bırak ama gerçek policy'yi commit choke point'e taşı	P0	Farklı mutation yollarında policy drift oluşur
S/M	Gemini responseSchema + Zod canonical schema kullan; heuristic JSON repair'i kaldır	P1	Bozuk/kısmi çıktılar ve semantik parser sürprizleri devam eder
M	update_brief için role/capability politikası ekle; agent-authored brief'i untrusted provenance ile işaretle	P1	Persistent cross-agent prompt injection kalır
S	Region descriptions için prompt'taki “yönerge olarak kullan” ifadesini kaldır; açık UNTRUSTED CANVAS DATA ayrımı yap	P1	Region text instruction channel olmaya devam eder
S	Supervisor'a proposal summary yerine canonical structured diff + touched regions + destructive-op sayısı göster	P1	Persuasive/hallucinated summary supervisor'ı kandırabilir
S/M	MAX_EXPANDED_OPS, touched-node ve response-byte limitleri koy	P1	Küçük intent listesi büyük gerçek mutation'a dönüşebilir
M	Agent/claim rate limitlerini process Map'ten shared DB/Redis limiter'a taşı	P1	Horizontal scaling rate limitleri baypas eder
M	Claim acquire işlemini canvas-level DB transaction/advisory lock ile serialize et	P2	İki paralel agent aynı advisory claim'i alabilir
S	Claim'e max continuous tenure + retry/backoff ekle	P2	Agresif agent sürekli renew ederek diğerlerini starve edebilir
M	wait_for_changes için durable activitySeq veya brief/proposal cursor ekle	P2	Connection loss sonrası event görülmeden baseline ileri alınabilir
M	MCP'yi 2026-07-28 SDK/request modeline geçir; legacy fallback gerekiyorsa koru	P1	Güncel MCP host'larıyla interoperability giderek bozulur
L	Generic MCP ekosistemi hedefleniyorsa OAuth 2.1 discovery/profile ekle	P3	Statik Bearer çalışır ama standard MCP auth interoperability sınırlı kalır
M/L	Gold eval + adversarial prompt injection regression suite oluştur	P1	Model/prompt değişikliklerinin kalite veya güvenliği bozduğu geç fark edilir
Önerdiğim hedef güvenlik hattı

Co-Pronoia için ideal mutation zinciri bence şu:

                    ┌───────────────┐
Untrusted canvas ──▶│      LLM      │
content             └───────┬───────┘
                            │ typed proposal
                            ▼
                    JSON Schema / Zod
                            │
                            ▼
                     Semantic limits
                            │
                            ▼
                 Supervisor approval
                            │
                            ▼
             ┌── CENTRAL POLICY ENGINE ──┐
             │ human role                │
             │ region membership         │
             │ actor origin              │
             │ aiAllowed                 │
             │ immutable security config │
             │ expanded-op budget        │
             └───────────┬───────────────┘
                         ▼
                    expandAll
                         ▼
                conflict detection
                         ▼
                Commit / Branch

LLM, supervisor ve prompt hiçbir zaman aiAllowed'ın gerçek enforcement mekanizması olmamalı.

Bunu CommitService seviyesine indirdiğinizde mimarinizin en güçlü özelliği olan “bütün mutation yolları aynı choke point'ten geçer” ilkesi gerçekten AI katmanı için de geçerli hale gelir.

Açık sorular

aiAllowed semantiği tam olarak nedir? AI tarafından üretilmiş içerik, insan supervisor açıkça approve etse bile yasak mı kalmalı? Bağlamınızdaki tanıma göre cevabın “evet” olması gerekiyor; o durumda proposal provenance commit'e kadar korunmalı.

Human owner'ın “bu proposal için bir kerelik AI-closed override” vermesine ihtiyaç var mı? Varsa normal approval'dan ayrı ve açık bir yüksek-risk action olmalı.

MCP supervisor kendisi LLM mi, bazen insan-controlled MCP client mı? Security modelinde bu ayrım önemli.

update_brief gerçekten bütün worker agent'ların ortak yazma alanı mı olmalı, yoksa supervisor-owned briefing mi?

Region geometry güvenlik sınırının bir parçası mı? aiAllowed dikdörtgene bağlı olduğuna göre pratikte evet; dolayısıyla AI geometry mutation'ı da security-sensitive config sayılmalı.

Proposal approval için aynı anda iki supervisor'ın onay basması test edildi mi? approveProposal() mevcut status'u okuyup commit yaptıktan sonra status update ediyor (server/src/proposalService.ts:243-286); conditional/CAS transition olmadığı için concurrency testi eklemeye değer.

Dış MCP agent process'lerinin hangi başka tool/network capability'lerine sahip olacağı kontrolünüzde mi? Canvas'ın confidential data sınırı yalnız Co-Pronoia MCP server tarafından garanti edilemez.

Modern MCP subscriptions/listen desteklemeyen Claude Code/Cursor vb. host'larla ne kadar süre compatibility hedefleniyor? Bu, wait_for_changes'in uzun vadeli rolünü belirler.

Genel değerlendirme: temel multi-agent fikriniz — özellikle proposal-only workers + supervisor + normal commit enforcement — sağlam. Yeniden tasarlanması gereken kısım çok ajanlı model değil; AI provenance ve security-sensitive region policy'nin merkezi commit authority'ye taşınması. Bu yapıldığında mevcut architecture, AutoGen/CrewAI tarzı “manager agent'a güven” yaklaşımından daha sert ve LangGraph/HITL/reference-monitor çizgisine daha yakın bir güvenlik modeli haline geliyor. 
Docs by LangChain
+1