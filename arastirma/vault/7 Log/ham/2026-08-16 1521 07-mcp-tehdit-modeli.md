---
tags:
  - log/ham
  - rol/luna-tasiyici
rol: luna-tasiyici
model: gpt-5.6-luna
konu: 07-mcp-tehdit-modeli
tur: ham
zaman: 2026-08-16T15:21:24
karakter: 42517
ham: true
sohbet: (özel ChatGPT sohbeti)/c/6a81a781-590c-83ed-bd1b-03200cf2d857
kaynak: proj_one.mjs
---

> [!warning] BİREBİR KOPYA — düzenlenmemiştir. Değiştiren, kaydı geçersiz kılar.

# (özel ChatGPT sohbeti)/c/6a81a781-590c-83ed-bd1b-03200cf2d857

1. Yönetici özeti

Model A — kullanıcının kendi Claude/Codex ajanı: mevcut mimari temelde savunulabilir. Ajanın doğrudan commit aracının olmaması, proposal → supervisor → normal commit() hattı ve actor.ai:true ile çalışan merkezi aiAllowed:false guard güçlü sınırlar oluşturuyor. aiAllowed provenance açığı kapalıdır; yeniden açık bulgu değildir (server/src/proposalService.ts:257-270, server/src/commitService.ts:455-465, shared/src/regionGuard.ts:69-127).

Model A'nın asıl tehditleri kanvastan gelen indirect prompt injection, ele geçirilmiş yerel agent host'u ve çalınmış uzun ömürlü tma_ anahtarıdır. Kullanıcı ile kendi ajanını birbirine düşman saymak doğru model değildir.

Model B — üçüncü taraf ajan: aynı kod yeterli izolasyonu sağlamıyor. Agent role/persona iş bölümü yapıyor fakat graph yetkisini sınırlandırmıyor; onaylanan proposal, proposal sahibinin agent rolüyle değil token'ı basan kullanıcının kanvas rolüyle — pratikte owner ile — uygulanıyor (routes.ts:550-560, proposalService.ts:243-270).

Bu nedenle Model B'de supervisor onayı, yalnız bir “kalite kapısı” değil, owner yetkisine delegation kapısıdır. aiAllowed:false yine geçilemez; risk AI-açık alanlardaki owner kapsamıdır.

update_brief bugün gerçekten bütün MCP ajanlarına açıktır ve canonical brief'in tamamı her ajanın get_brief prompt'una girer (mcpServer.ts:398-413, mcpServer.ts:223-228). Model B'de bu kalıcı ortak-bağlam zehirleme kanalıdır.

Varsayılan brief politikam: MCP ajanları canonical brief'i doğrudan yazmasın; append-only brief change proposal oluştursun, Editor+/owner insan onayı yeni revision üretsin. Model A'da da öneriyorum, Model B'de zorunlu görüyorum.

submit_proposal tamamen sınırsız değildir: 200 intent, title 120, summary/description 2.000, notes 20.000, data için 50×2.000 sınırları vardır. Ancak bazı ID alanları sınırsızdır; aggregate JSON-byte, expanded-op ve proposal-rate kotası yoktur (schemas.ts:15-60, proposalService.ts:10-12,82-109).

MCP endpoint'inde projeye ait açık bir bodyLimit konfigürasyonu yoktur (app.ts:82, mcpRoutes.ts:26-45). Bundle'da package manifesti bulunmadığı için Fastify/SDK sürümünden bir varsayılan limit tahmin etmiyorum.

Proposal için MVP sınırım: 256 KiB MCP request, 128 KiB intents JSON, 100 intent, 50 add-node, 100 add-edge, 300 expanded op ve token başına 8 submit/update/dk.

Claim mevcut haliyle güvenlik kilidi değil, doğru biçimde soft lease. Bugün TTL 30–900 s/default 600 s, 200 node/claim ve process-local 30 write/dk vardır; aktif-claim kotası, global claimed ratio, waiter/aging ve cross-process yarış serileştirmesi yoktur (claimService.ts:7-24,103-178).

Claim MVP'sinde hard-lock kullanmam. Token başına 2 aktif claim, ≤%20 node/token ve hard max 200, canvas toplam ≤%80, TTL default 120/max 300 s, waiter varken renew yok, FIFO aging ve 330 s starvation SLO seçiyorum.

Supervisor için blanket “her proposal insana sor” da iki otomatik supervisor zorunluluğu da seçmiyorum. Risk-triggered step-up human approval + anlık revoke MVP için en iyi denge: silme, büyük etki alanı, cross-region, self-approval, region-config ve brief değişiklikleri insan kapısına gider.

MCP'nin güncel yayımlanmış spesifikasyonu 2026-07-28'dir. Modern sürümde protocol bilgisi her request'in _meta alanındadır; 2025-11-25 ve öncesi initialize tabanlı “legacy” olarak sınıflandırılmıştır. Repo testi ise açıkça 2025-03-26 gönderiyor; bundle'da package.json/lockfile olmadığı için kurulu @modelcontextprotocol/sdk sürümünü ve sunucunun 2026-07-28 uyumluluğunu kesinleştiremiyorum. 
Model Context Protocol
+1

URL: https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
 — erişim: 16 Ağustos 2026.
URL: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
 — erişim: 16 Ağustos 2026.

2. Bulgular
2.1 İki tehdit modeli — birbirinden ayrı
Model A — ajan, kullanıcının kendi aracıdır
Boyut	Hüküm
Korunan varlıklar	Graph/commit bütünlüğü, commit geçmişi, brief bütünlüğü, canvas gizliliği, tma_ anahtarı, servis kapasitesi, kullanıcının gerçek niyeti
Güvenilenler	Kullanıcı; normal durumda kullanıcının seçtiği Claude/Codex host'u; Co-Pronoia commit doğrulama kodu
Güvenilmeyen giriş	Node title/description/notes, shared brief, başka insanların canvas'a koyduğu metin, başka MCP/tool çıktıları
Saldırgan	Canvas'a prompt injection yerleştiren kişi/veri; ele geçirilmiş local agent; çalınmış tma_ anahtarı
Güven sınırları	Canvas data → LLM context; local host → /api/mcp; proposal → supervisor; supervisor → normal commit choke point
En kötü sonuç	Ele geçirilmiş supervisor veya çalınmış supervisor token'ı AI-açık canvas'ta owner kapsamlı proposal üretip onaylar; bütün canvas içeriği okunabilir. aiAllowed:false bölgeler yine hard-stop'tur
Artık risk	Semantic/prompt-injection etkisi tamamen sıfırlanamaz; fakat least privilege + high-impact insan onayı zararın blast radius'unu küçültür

OWASP LLM01:2025, external content'in indirect prompt injection taşıyabileceğini ve yüksek riskli işlemlerde insan onayı ile least privilege'ı açık mitigasyonlar arasında sayıyor. 
OWASP Gen AI Security Project

URL: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
 — erişim: 16 Ağustos 2026.

Model B — üçüncü taraf ajan bilinçli saldırgan olabilir
Boyut	Hüküm
Ek korunan varlıklar	Ajanlar arası fairness, provider/organizasyon izolasyonu, provenance, canonical shared context, supervisor karar bütünlüğü
Güvenilmeyenler	Üçüncü taraf worker ve supervisor dahil olmak üzere dış agent process'i
Ek yetenekler	Bilinçli brief poisoning, proposal spam, claim hoarding, renewal, yanıltıcı proposal summary, supervisor manipülasyonu, izin verilen read API'sinden sistematik veri çekimi
Kritik sınır	Agent role ≠ graph authorization principal
En kötü sonuç	Kötü/ele geçirilmiş supervisor kendi proposal'ını oluşturup kendi onaylar ve token minter'ın owner yetkisiyle bütün AI-açık canvas'ı değiştirir
Gizlilik sonucu	Mevcut token bütün canvas'ı get_state ile okuyabilir; region sistemi write restriction'dır, read partition değildir
Artık risk	Delegated scopes getirildikten sonra bile kötü agent sınırlı kapsamda yanıltıcı proposal üretebilir ve insan/supervisor semantik hata yapabilir

OWASP LLM06:2025 özellikle multi-agent sistemde malicious/compromised peer agent'ı excessive-agency tetikleyicisi olarak sayıyor ve işlemleri gerçek kullanıcı bağlamında, minimum privilege ile yürütmeyi ve high-impact actions için human approval kullanmayı öneriyor. 
OWASP Gen AI Security Project
+1

URL: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
 — erişim: 16 Ağustos 2026.

2.2 En önemli kod bulgusu: agent persona yetki sınırı değil

Token yalnız owner tarafından basılıyor:

/agent-tokens → requireOwner: server/src/routes.ts:550-559

Token createdById ile saklanıyor: server/src/agentRoleService.ts:157-181

Token canvas'a doğrudan bağlı: server/src/agentRoleService.ts:164-177

AgentToken'da expiration yok; createdAt, lastUsedAt, revokedAt var: db/prisma/schema.prisma:319-337

Bearer her MCP request'te hash lookup + revoked check'ten geçiyor: server/src/agentRoleService.ts:230-249

Ama proposal onayında:

proposal token'ının createdBy kullanıcısı bulunuyor, proposalService.ts:243-252;

bu insanın canvas memberRole'ü çözülüyor, proposalService.ts:253-255;

commit authorId: creatorId ve actor:{ userId:creatorId, role, ai:true } ile yapılıyor, proposalService.ts:257-270.

Dolayısıyla AgentRoleDef.name/persona/isSupervisor, worker'ın graph üzerindeki write scope'unu tanımlamıyor. Agent rolleri workflow rolüdür; gerçek commit authority token minter'dan gelir.

Bu özellikle Model B'de önemli, çünkü central region guard:

AI actor -> önce aiAllowed fence
owner    -> sonra membership region kontrolünden bypass

şeklindedir (server/src/commitService.ts:455-465). Bu, kapatılmış aiAllowed bulgusunu yeniden açmak değildir. aiAllowed:false owner adına çalışan AI'ı dahi durdurur (shared/src/regionGuard.ts:69-127). Açık kalan sorun, AI-açık bölgelerde üçüncü taraf ajan için delegated graph scope bulunmamasıdır.

Bu yapı OWASP LLM06'nın “downstream işlemleri generic high-privilege identity yerine belirli kullanıcı ve minimum scope bağlamında yürüt” kontrolüyle doğrudan ilgilidir. 
OWASP Gen AI Security Project

URL: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
 — erişim: 16 Ağustos 2026.

2.3 Kontrol matrisi — A'da mı B'de mi gerekli?
Kontrol	Model A	Model B	Bugün
Proposal → supervisor → normal commit	Gerekli	Gerekli	✅ Var
Merkezi aiAllowed:false enforcement	Gerekli	Gerekli	✅ Var
Agent başına explicit write/region scope	İsteğe bağlı / önerilir	Zorunlu	❌ Yok
Riskli değişikliklerde insan step-up	Gerekli, compromised-agent tehdidi için	Zorunlu	❌ Yok
Her proposal için insan onayı	Gereksiz	Gereksiz	—
Canonical brief'e doğrudan agent write	Tolere edilebilir ama önermiyorum	Kaldırılmalı	⚠️ Açık
Brief provenance + insan onayı	Önerilir	Zorunlu	❌ Eksik
Aggregate proposal byte/op limiti	Gerekli	Zorunlu	❌ Eksik
Proposal rate limit	Gerekli	Zorunlu	❌ Eksik
Claim fairness/aging	Opsiyonel–önerilir	Zorunlu	❌ Eksik
Claim'i hard graph lock yapmak	Gereksiz	Gereksiz	✅ Zaten değil
Kısa ömürlü/scope'lu access token	Önerilir	Zorunlu	❌ Static key
Region-bazlı read restriction	Normal owner-agent kullanımında gereksiz	Ürün gizlilik sözleşmesine bağlı; gizli partition varsa zorunlu	❌ Yok
Token passthrough engeli	Upstream API yokken uygulanmaz	Upstream API yokken uygulanmaz	N/A
İki otomatik supervisor imzası	Gereksiz	Varsayılan olarak gereksiz	Yok
Emergency owner revoke	Gerekli	Gerekli	✅ Var
2.4 Güncel MCP güvenlik hükümleri → Co-Pronoia

Güncel MCP 2026-07-28 Tools bölümü; tool input'larının doğrulanmasını, access control ve rate limiting'i server için MUST, sensitive calls için kullanıcı confirmation'ını client için SHOULD olarak belirtiyor. Aynı bölüm tool annotations'ın trusted server'dan gelmiyorsa MUST be considered untrusted diyor. 
Model Context Protocol

URL: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
 — erişim: 16 Ağustos 2026.

MCP konusu	Normatif hüküm	Co-Pronoia karşılığı	Kontrol	A etkisi	B etkisi
Tool poisoning	Spec “tool poisoning” adını normatif terim olarak kullanmıyor; fakat tool annotations'ın trusted server dışında MUST untrusted sayılmasını ister	Tool'lar runtime üçüncü taraf registry'den gelmiyor; registerTool() ile server kodunda statik: mcpServer.ts:143+	Server tarafındaki klasik malicious-tool-metadata yüzeyi düşük. Agent host başka MCP'leri birleştiriyorsa host kontrolü gerekli	Önemli, özellikle local Claude/Codex çok MCP bağlarsa	Önemli ama çoğunlukla üçüncü taraf host sorumluluğu
User approval	Human-in-loop SHOULD; sensitive calls öncesi confirmation SHOULD	Supervisor approval var fakat supervisor da AI olabilir; insan approve HTTP yolu bilinçli yok: routes.ts:587-590; supervisor self-proposal açık: mcpServer.ts:190-197	Eksik: high-impact human gate	Gerekli	Gerekli
Input validation	Server MUST validate all tool inputs	Zod var: mcpServer.ts:505-511, schemas.ts:15-60; business replay validation var: proposalService.ts:82-109	✅ güçlü, aggregate kota hariç	olumlu	olumlu
Rate limit	Server MUST rate-limit tool invocations	claim için process-local 30/60 s var; proposal submit/update için yok: claimService.ts:21-33, proposalService.ts:112-140	Kısmi / proposal'da yok	Gerekli	Kritik
Auth scopes	Authorized HTTP serverlarda scopes least privilege için kullanılmalı; tools auth'a göre değişebilir	Token canvas-bound ve agent roles taşıyor; capability/region scopes yok	Eksik	Tercihe bağlı	Kritik
Token audience	OAuth access tokens target MCP server için doğrulanmalı	tma_ server-specific DB secret; fakat OAuth audience claim/discovery yapısı değil	Custom auth	A'da yeterli olabilir	B'de standard scoped auth tercih edilmeli
Token passthrough	MCP server inbound access token'ını upstream API'ye MUST NOT pass-through	Bu MCP server'ın upstream OAuth proxy akışı yok	Uygulanmaz	N/A	N/A
Confused deputy	Özellikle third-party API'lere intermediary olan MCP proxy'leri için consent ve ayrı upstream auth gerekli	Repo böyle bir OAuth intermediary değil	Bugünkü mimariye uygulanmaz	N/A	N/A
Session state	Modern MCP'de implicit protocol session yok; auth her call'da kontrol edilmeli	Her POST fresh server+transport, Bearer her POST çözülüyor: mcpRoutes.ts:26-45	✅ yapısal olarak uyumlu	olumlu	olumlu

Authorization'ın kendisi MCP'de OPTIONAL; fakat HTTP üzerinde kullanılıyorsa specification'a uyum SHOULD. Yani mevcut tma_ anahtarını “MCP MUST ihlali” diye sınıflandırmıyorum. Standart OAuth discovery/scopes'a uymaması bir SHOULD/interoperability + least-privilege boşluğu, özellikle Model B için önemlidir. 
Model Context Protocol
+1

URL: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index
 — erişim: 16 Ağustos 2026.

MCP auth security ayrıca short-lived access token öneriyor ve inbound token'ın upstream API'ye pass-through edilmesini açıkça yasaklıyor. 
Model Context Protocol
+1

URL: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations
 — erişim: 16 Ağustos 2026.

Protokol sürümü konusunda karar

Repo:

StreamableHTTPServerTransport: server/src/mcp/mcpRoutes.ts:3,35-38

fresh server+transport/request: mcpRoutes.ts:12-17,26-45

GET/DELETE = 405: mcpRoutes.ts:48-51

regression test protocolVersion:'2025-03-26': server/src/mcp.test.ts:50-54

Modern 2026-07-28 her request'te _meta protocol version kullanır ve HTTP POST'ta MCP-Protocol-Version header'ının _meta ile eşleşmesini ister; notification stream ise subscriptions/listen ile açılır. 
Model Context Protocol
+1

Hüküm: route'un “fresh POST” yaşam döngüsü modern modele yakın, fakat test suite legacy 2025-03-26'yı hedefliyor. SDK package sürümü bundle'dan doğrulanamadığı için “2026-07-28 compliant” kararı verilemez.

Ayrıca Co-Pronoia'nın wait_for_changes aracı MCP subscriptions/listen değildir; uygulama seviyesinde canvas-scoped long-poll'dur (mcpServer.ts:417-496). Bu güvenlik kusuru değildir.

2.5 update_brief: canonical memory poisoning

Kod yorumu tartışmasız:

Editor+ üyeler ve MCP ajanları (update_brief) günceller.

shared/src/types.ts:183-187.

İnsan tarafında Editor+ yazabiliyor (server/src/routes.ts:405-415). MCP tarafında tüm ajanlara açık (server/src/mcp/mcpServer.ts:398-413).

Daha önemlisi:

canonical brief hash/version'a giriyor: mcpServer.ts:172-184

tamamı prompt'a ekleniyor: mcpServer.ts:223-224

agent'a brief'e “uy” deniyor: mcpServer.ts:226-228

revision append-only olsa da sadece content/authorLabel/time tutuluyor: briefService.ts:26-49, shared/types.ts:196-201.

OWASP'nin 2025 agent hackathon gözlemi, shared/global memory'ye malicious bilgi yazılmasının sonraki agent davranışını kalıcı biçimde etkileyebilen Memory Poisoning olduğunu gösteriyor. 
OWASP Gen AI Security Project

URL: https://genai.owasp.org/2025/04/25/recap-from-owasp-gen-ai-security-projects-nyc-insecure-agents-hackathon/
 — erişim: 16 Ağustos 2026.

OWASP'nin üçüncü taraf MCP rehberi de tool poisoning yanında prompt injection ve memory poisoning'i doğrudan MCP riskleri arasında sayıyor. 
OWASP Gen AI Security Project

URL: https://genai.owasp.org/resource/cheatsheet-a-practical-guide-for-securely-using-third-party-mcp-servers-1-0/
 — v1.0, 4 Kasım 2025; erişim 16 Ağustos 2026.

Dört politika
Politika	Model A	Model B	Sorun
Yalnız supervisor canonical yazar	İyi, düşük sürtünme	Yetersiz	Compromised supervisor hâlâ global memory'yi zehirler
Append-only + kaynaklı agent önerisi	Çok iyi audit	Çok iyi audit	Tek başına approval boundary değil
Agent-başına ayrı brief bölümü	Faydalı scratchpad	İzolasyonu artırır	Tüm bölümler ortak prompt'a girerse poisoning yine mümkün
İnsan onaylı değişiklik	Bir miktar UX maliyeti	En güçlü sınır	İnsan darboğazı
Seçtiğim varsayılan

Canonical brief = insan kontrollü. MCP agent = append-only değişiklik önerisi.

Yeni MCP tool:

propose_brief_update

Mevcut update_brief MCP'den çıkarılır.

Önerilen kayıt:

CanvasBriefChangeProposal
- id
- canvasId
- baseRevisionId
- proposedContent / patch
- proposerTokenId
- proposerRoleName
- reason
- sourceRefs[]
- status: submitted | approved | rejected
- createdAt
- decidedAt
- decidedByUserId

CanvasBriefRevision da şu provenance alanlarını kazanır:

parentRevisionId
sourceProposalId
authorKind: human_direct | agent_proposal | rollback
authorUserId
approvedByUserId
contentSha256
rollbackOfRevisionId

Rollback revision silmez/değiştirmez. Eski revision'ın içeriğini yeni bir append-only revision olarak tekrar yazar ve rollbackOfRevisionId işaretler. Böylece bugünkü append-only karakter korunur.

NIST AI 600-1 GV-6.1-008, üçüncü taraf içerik değişikliklerinde kaynak/timestamp/metadata provenance tutulmasını öneriyor. 
NIST Publications

URL: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
 — NIST AI 600-1, 26 Temmuz 2024; erişim 16 Ağustos 2026.

2.6 submit_proposal: bugünkü gerçek limitler
Şu anda gerçekten var
Boyut	Fiilî limit	Kanıt
Intent sayısı	1–200	mcpServer.ts:505-509; proposalService.ts:10-12,92-94
Title	120 karakter	mcpServer.ts:506; proposalService.ts:10,123-124
Summary	2.000	mcpServer.ts:507; proposalService.ts:11,135
Node title	200	schemas.ts:23,38
Description	2.000	schemas.ts:24,39
Notes	20.000	schemas.ts:28,45
data	≤50 key; key≤100, value≤2.000	schemas.ts:15-18
add-node supplied id	64	schemas.ts:36
add-edge supplied id	64	schemas.ts:53
update/delete/move id	açık max yok	schemas.ts:48-50
sourceId/targetId	açık max yok	schemas.ts:54-55
parentId/linkedCanvasId	açık max yok	schemas.ts:22,27,37,44
Expanded-op count	Yok	proposalService.ts:98-109
Request raw JSON byte	Repo konfigürasyonunda açık limit yok	app.ts:82; mcpRoutes.ts:26-45
Submit/update rate	Yok	proposalService.ts:112-185
Open proposal/token	Yok	Prisma PlanProposal: schema.prisma:375-399

Dolayısıyla önceki “intent sınırsız” ifadesi doğru olmazdı. Doğru bulgu:

200 intent sınırı vardır; fakat aggregate request/proposal ağırlığı ve genişletilmiş çalışma maliyeti sınırlı değildir ve bazı string alanlarının kendisi de bounded değildir.

validateIntents() henüz aggregate ucuz bir kontrol yapmadan önce tüm current state'i alıp full Graph clone ediyor ve expandAll() çalıştırıyor (proposalService.ts:95-103). Bu nedenle sadece DB row boyutu değil CPU/memory amplification da düşünülmeli.

Repo içi kıyas noktaları

Yerleşik agent için zaten daha muhafazakâr sınırlandırma kültürü var:

prompt: 8.000 karakter: routes.ts:33-44,225-234

yeni region/tur: 4: agent.ts:37-38,306-320

yeni subcanvas/tur: 3: agent.ts:43-44,376-390

stepwise part max: 6: agent.ts:34-35,883-885

Bunlar proposal sınırını matematiksel olarak kanıtlamaz; MVP için repo içi tasarım emsalleridir.

Önerdiğim üç kademeli kapı
Katman	MVP sınırı	Reddetme
HTTP/body — parse öncesi	/api/mcp 256 KiB = 262.144 byte	HTTP 413 Payload Too Large; hiçbir SDK/tool/DB işlemi başlamaz
Zod/schema	intents <=100; bütün node/edge/canvas id/ref stringleri <=64; mevcut description <=2.000 korunur	malformed CallToolRequest ise JSON-RPC protocol validation error
Business quota	serialized intents <=128 KiB; add_node<=50; add_edge<=100; expanded ops <=300	isError:true, machine-readable PROPOSAL_QUOTA_EXCEEDED
Rate	token başına submit+update <=8 / 60s	isError:true, RATE_LIMITED, retryAfter
Queue	token başına submitted/changes_requested <=10	TOO_MANY_OPEN_PROPOSALS

MCP 2026-07-28 tool errors, malformed protocol-level request ile business/input-execution error'ı ayırıyor: malformed request JSON-RPC error; recoverable input/business error isError:true result olmalı. 
Model Context Protocol

URL: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
 — erişim: 16 Ağustos 2026.

OWASP LLM10:2025 de input size limits, rate limits, quotas, timeout/throttling ve queued-action sınırlarını doğrudan mitigasyon olarak veriyor. 
OWASP Gen AI Security Project

URL: https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/
 — erişim: 16 Ağustos 2026.

Atomiklik: body/schema/business limitlerinden herhangi biri fail olursa planProposal.create() hiç çalışmamalı. Expanded-op 301 çıkarsa da proposal satırı yaratılmamalı. update_proposal fail olursa eski proposal unchanged kalmalı.

2.7 Claim fairness: bugün ne var?

Kod açıkça claim'in güvenlik lock'u olmadığını söylüyor:

server/src/claimService.ts:7-13 ve server/src/mcp/mcpServer.ts:315-320.

Bugün:

min TTL 30 s,

default 600 s,

max 900 s: claimService.ts:16-19;

aynı token, aynı scope'u claim ederse renewal: claimService.ts:138-144,165-176;

node claim max 200: claimService.ts:124-128;

başka token overlap ederse conflict, hata değil: claimService.ts:146-163;

release yalnız kendi claim'i: claimService.ts:181-191;

owner force release: claimService.ts:194-203, routes.ts:612-619;

proposal overlap sadece warning: claimService.ts:214-244;

write limiter 30/60 s, process-local Map: claimService.ts:21-33;

DB'de overlap'ı engelleyen uniqueness constraint yok: schema.prisma:352-372.

Yarış

Şu akış transaction/lock altında değil:

canlı claim'leri oku,

conflict bak,

create.

İki eşzamanlı process aynı anda 1–2'yi geçip ikisi de claim yaratabilir (claimService.ts:146-176). Bu authorization ihlali değildir, çünkü claim zaten advisory'dir. Fakat claim'in koordinasyon vaatlerini zayıflatır.

Fairness seçenekleri
Seçenek	A	B	Hüküm
Sadece mevcut TTL + random retry	Yeterli olabilir	Kötü	Starvation guarantee yok
Priority queue	Gereksiz karmaşıklık	Faydalı	MVP için erken
FIFO + aging	Basit	Güçlü	Seçimim
Hard graph lock	Kötü	Kötü	Reddedildi; ürün modelini bozar
Seçtiğim MVP

max aktif claim/token = 2

node-union/token = min(200, max(20, ceil(canvasNodeCount × 0.20)))

canvas toplam live-claimed node union = ≤%80

region claim, quota hesabında region içindeki mevcut node'lara expand edilir

TTL: default 120 s, min 30, max 300 s

overlapping waiter varsa incumbent renew edemez

waiting sırası: earliest createdAt, yani FIFO aging

conflict-check + claim-create kısa canvas-scoped DB transaction/lock ile seri hale getirilir

starvation SLO: aynı resource için en eski eligible waiter, kendisinden eski waiter yoksa ≤330 s içinde grant veya terminal denial almalı

proposal/commit davranışı değişmez; claim conflict proposal'ı güvenlik nedeniyle yasaklamaz.

Bu özellikle Model B'de zorunludur; Model A'da daha çok throughput/coordination kalite kontrolüdür.

2.8 OWASP + NIST: sadece gerçekten uygulanabilen maddeler

NIST AI 600-1, zorunlu güvenlik standardı değil; NIST bunu AI RMF 1.0'ın voluntary-use GenAI profile'ı olarak yayımladı. Sürüm 26 Temmuz 2024'tür. 
NIST
+1

URL: https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
 — erişim: 16 Ağustos 2026.

Tehdit / madde	Mevcut kod	Eksik kontrol	A/B	Otomatik test
OWASP LLM01:2025 Prompt Injection	Deterministic Zod/expand/commit guard var; node/brief modeli besliyor	untrusted-context provenance + high-risk human step-up	A+B	injected node/brief sonrası delete/cross-region proposal insan onayı olmadan commit olamaz
OWASP LLM06:2025 Excessive Agency	Worker direct commit yok; supervisor kapısı var	owner-derived delegated scope + self-approval	A+B, B kritik	third-party token'a regions:[r1] scope verildiğinde r2 proposal approval fail
OWASP LLM10:2025 Unbounded Consumption	200 intent; claim rate limit	raw/aggregate/expanded/rate/open-proposal limitleri	A+B	262145-byte request=413; 301 expanded op=no DB row
OWASP LLM02:2025 Sensitive Information Disclosure	token canvas scoped	third-party agent için optional read partitions yok	A'da çoğunlukla uygulanmaz; B confidentiality istenirse zorunlu	scoped token'ın yasak region node'u get_state sonucunda bulunmaz
OWASP LLM03:2025 Supply Chain	tool registration statik	supplied bundle'da dependency manifest/lock/SBOM doğrulanamıyor	A+B	CI lockfile zorunlu + SBOM artifact + critical dependency policy
OWASP third-party MCP / Memory Poisoning	brief revisions var	bütün ajanların canonical write yetkisi	A önerilir/B zorunlu	MCP tools/list içinde direct update_brief yok; MCP-origin revision human approver'sız oluşamaz
NIST GV-3.2-005 Threat Modeling	Bu inceleme manuel olarak yapılıyor	CI'da abuse-case regression	A+B	attack-suite release gate
NIST GV-1.3-002 assurance thresholds	yok	numerical step-up thresholds	A+B	threshold boundary tests
NIST GV-6.1-007 third-party inventory	token label/roles/creator/list_agents var	provider/org/data handling/expiry envanteri yok	B	bütün third-party tokens için provider+expiry+scope non-null
NIST GV-6.1-008 provenance	proposal labels; brief authorLabel	source refs, approver, immutable linkage	B kritik	agent brief rev → sourceProposal+approver zorunlu
NIST MS-2.7-004 security metrics	lastUsed ve bazı audit izleri var	starvation, rate-denial, step-up ve scope-denial metriği	A+B	dashboard/metric counters mevcut
NIST MS-2.7-007 red teaming	normal unit tests var	prompt/brief/claim/supervisor abuse suite	A+B	release test suite malicious fixtures ile geçmeli

OWASP LLM02 least-privilege data access önermektedir. 
OWASP Gen AI Security Project

URL: https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/
 — erişim: 16 Ağustos 2026.

OWASP LLM03 component inventory/SBOM, supplier vetting ve verifiable sources gibi supply-chain kontrollerini önerir. 
OWASP Gen AI Security Project

URL: https://genai.owasp.org/llmrisk/llm032025-supply-chain/
 — erişim: 16 Ağustos 2026.

NIST maddeleri: GV-3.2-005 threat modeling; GV-1.3-002 measurable assurance/go-no-go thresholds; GV-6.1-007/008 third-party inventory/provenance; MS-2.7-004/007 security metrics/red-teaming. 
NIST Publications
+3
NIST Publications
+3
NIST Publications
+3

URL: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
 — erişim: 16 Ağustos 2026.

Bilerek dahil etmediklerim

Training/fine-tuning poisoning: bu MCP akışında training/fine-tuning veya vector-store ingestion kodu yok. update_brief problemi runtime persistent context poisoning'dir; training-data poisoning diye yeniden adlandırmıyorum.

MCP confused deputy/token passthrough: mevcut server third-party OAuth API'lerine inbound MCP token'ıyla proxy yapmıyor. Dolayısıyla bugün doğrudan uygulanmaz. İleride MCP tool'ları Google/GitHub vb. upstream kullanıcı API'lerine bağlanırsa yeniden açılmalıdır. MCP burada inbound token'ın upstream'e aktarılmasını MUST NOT olarak yasaklıyor. 
Model Context Protocol

Dynamic server-side tool poisoning: repo üçüncü taraf MCP tool kataloglarını kendi server prompt'una dinamik olarak import etmiyor; doğrudan server-side bulgu değil. Local Claude/Codex host'u başka MCP sunucularıyla aynı tool space'i kullanıyorsa host tehdididir. MCP tool annotations'ın untrusted kabul edilmesi zorunluluğu burada devreye girer. 
Model Context Protocol

2.9 Supervisor ele geçirilirse
Bugünkü supervisor yetkisi

Bağlantının herhangi bir rolünde isSupervisor=true ise supervisor tools register edilir; fakat çağrı anında seçilen rol de supervisor olmalıdır (mcpServer.ts:570-580).

Supervisor:

tüm normal worker tool'larını kullanabilir;

submit_proposal yapabilir;

kendi proposal'ını onaylayabilir — prompt bunu açıkça söyler: mcpServer.ts:190-197;

approve_proposal: mcpServer.ts:582-608;

reject/request changes: 610-640;

doğrudan create_region yapabilir; bu commit değildir, config write'tır: 643-680;

update_brief yapabilir: 398-413.

Üstelik supervisor rolünün isSupervisor bayrağı agent-role CRUD'da değiştirilebilir (agentRoleService.ts:51-69); group admin veya canManageRoles kullanıcısı agent role yönetebilir (groupRoutes.ts:75-84,190-207). Token'ın role kayıtları her bearer resolve'da DB'den yeniden okunur (agentRoleService.ts:230-249).

Owner tarafında ise:

token revoke: routes.ts:565-570;

rotate: 573-579;

stale proposal reject: 587-603;

claim force release: 612-619.

Ama insan proposal approve route'u bilerek yoktur (routes.ts:587-590).

Risk-triggered insan eşiği

Supervisor approve_proposal çağırdığında aşağıdakilerden biri bile doğruysa status awaiting_human olmalı:

intentCount > 50;

expandedOps > 100;

etkilenen mevcut node sayısı > max(10, ceil(N×0.05));

herhangi bir delete_node;

delete_edge > 10;

proposal birden fazla region'a dokunuyor veya node region sınırından geçiyor;

supervisor kendi token'ının proposal'ını onaylıyor;

MCP-origin canonical brief change;

MCP create_region/region-policy change.

aiAllowed:false için step-up override yoktur. Closed region'a AI dokunuyorsa işlem mevcut central guard'da reddedilmeye devam eder.

Neden çift supervisor seçmedim?

İki automated supervisor:

aynı poisoned brief'i okuyabilir;

aynı upstream model/provider'dan gelebilir;

aynı compromised host veya credential domain'inde olabilir.

Dolayısıyla iki AI imzası bağımsız bir trust boundary olduğunu garanti etmez. MCP'nin ve OWASP'nin human-in-the-loop ilkesi high-impact actions için daha güçlü bağımsızlık getirir. 
Model Context Protocol
+1

URL: https://modelcontextprotocol.io/specification/2026-07-28
 — erişim: 16 Ağustos 2026.
URL: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
 — erişim: 16 Ağustos 2026.

False-positive maliyeti: bulk refactor, plan cleanup veya normal büyük roadmap güncellemesi ekstra bir owner click'i bekler. Maliyet veri kaybı değil, approval latency'dir. Eşiği %5 + minimum 10 node seçmemin sebebi küçük canvas'larda her 1–2 değişikliği sürekli step-up'a çevirmemektir; bu sayı bir dış standart değil, Co-Pronoia için önerdiğim MVP policy threshold'udur.

2.10 Zorunlu saldırı ağacı
Kök / yaprak	Önkoşul	A	B	Bugünkü kontrol	Önerilen kontrol	Tespit sinyali	Artık risk
1. Ortak bağlamı zehirle → update_brief	Geçerli herhangi MCP token	Compromised agent ile evet	Doğrudan evet	Append revision + authorLabel	MCP direct write kaldır; human-approved proposal	brief-change by token; sourceRefs; rejection rate	İnsan kötü içeriği onaylayabilir
1 → malicious canvas text supervisor'u yönlendirir	Agent canvas içeriğini model context'e alır	Evet	Evet	Zod/commit deterministic guard	untrusted provenance + step-up	poisoned fixture → high-risk proposal	Düşük-etkili semantic yanlış karar kalır
2. Kaynak tüket → proposal şişir/spamla	MCP token	Compromised key	Bilinçli	200 intents; field limits	byte/op/count/rate/open limits	413/QUOTA/RATE counters	Allowed bounded workload
2 → claim hoarding/renewal	MCP token	accidental/compromise	Bilinçli	TTL 900 max, 30 calls/min	max2 + %20/%80 + waiter blocks renewal	oldest-wait age, claim ratio	Claim zaten advisory
2 → simultaneous claim race	Paralel requests/processes	Evet	Evet	conflict check	canvas-scoped short transaction	overlapping-live-claim invariant	Scheduler outage affects coordination only
3. Zararlı graph → worker supervisor'u kandırır	Worker proposal + supervisor semantic mistake	Evet	Evet	supervisor + commit guard	delegated scopes + risk step-up	high-impact approval ratio	İnsan yanlış onaylayabilir
3 → compromised supervisor self-submit+self-approve	Supervisor token kompromisi	Evet	Kritik	aiAllowed:false, validation	self-approval always human + scoped short-lived token	selfApproveAttempt event	AI-open authorized scope içinde zarar kalabilir
3 → supervisor region config değiştirir	Supervisor role	Evet	Evet	tool supervisor-only	region config human step-up	region-policy audit event	İnsan policy hatası
4. Canvas verisini sızdır → valid token get_state	Canvas MCP token	Kullanıcı zaten bunu isteyebilir	Evet	canvas scope	B'de optional read scopes / explicit full-read consent	bulk state reads / provider identity	Yetkili kapsam içindeki veri hâlâ provider'a gider
4 → çalınmış tma_ key	Secret elde edilir	Evet	Evet	hash-at-rest + revoke	expiry + scopes + rotation + anomaly logs	yeni IP/device/provider fingerprint, lastUsed	Expiry süresi kadar pencere
4 → injected agent başka tool ile exfiltrate eder	Host'un başka network/send tool'u var	Önemli	Host'a bağlı	Co-Pronoia server bunu göremez	client-side tool confirmation/sandbox	MCP host audit	Server tek başına tam önleyemez

get_state'in full mode'u bütün nodes/edges/regions'i döndürüyor (mcpServer.ts:268-278); list_regions member names dahil ediyor (mcpServer.ts:282-295). Bu bugünkü tasarıma göre unauthorized read bypass değil, çünkü region tanımı kodda write restriction olarak uygulanıyor. Model B'de third-party agent'ların tüm canvas'ı görmemesi isteniyorsa ürün sözleşmesi değiştirilmelidir.

MCP ana spesifikasyon kullanıcı verisinin server'lara açılması ve tool invocation için explicit consent/control ilkelerini belirtmektedir. 
Model Context Protocol

URL: https://modelcontextprotocol.io/specification/2026-07-28
 — erişim: 16 Ağustos 2026.

3. Risk sıralaması
Sıra	Risk	Gerçekte kimin başına gelir?	Model / varsayım
1	Owner-minter yetkisinin third-party proposal'a miras kalması + supervisor trust boundary	Canvas sahibinin AI-açık graph'ı	B, third-party agent gerçekten adversarial ise
2	Canonical brief poisoning	Aynı brief'i kullanan tüm ajanların sonraki kararları	B kritik, A'da compromised/local injection
3	Supervisor compromise/self-approval	AI-açık canvas bütünlüğü	A+B; B'de daha ağır
4	Whole-canvas read ile third-party veri erişimi	Gizli canvas içeriği	B, yalnız ajanların full-read yetkili olmaması bekleniyorsa
5	Long-lived static token leakage	Canvas confidentiality + proposal/control plane	A+B
6	Proposal resource amplification/spam	API latency, DB/CPU/memory ve diğer ajanlar	A+B; B saldırganında daha kolay
7	Claim starvation / race	Diğer ajanların planlama verimliliği	B; graph integrity riski değil
8	Tool poisoning	Local/multi-MCP host	A ağırlıklı; bu server'ın dinamik tool-ingestion açığı değil
4. Öneriler — karar kaydı
ID	Karar	Efor	A/B	Uygulanacağı katman	Yapılmazsa	Ölçülebilir kabul kriteri	Reddedilen alternatif
R1	Agent token'a explicit capability + read/write/region scope ekle; proposal commit'i minter'ın full owner rolü yerine delegated principal ile değerlendir	L	A: önerilir; B: zorunlu	AgentToken, agentRoleService.ts, proposalService.ts, commitService.ts	Third-party proposal supervisor onayından sonra bütün AI-açık owner alanına erişir	Region r1 scope'lu token'ın r2 proposal'ı supervisor onayında %100 reddedilir; aiAllowed:false testleri aynen geçer	Agent persona'yı authorization saymak
R2	MCP update_brief → propose_brief_update; insan-approved canonical revisions	M	A: önerilir; B: zorunlu	mcpServer.ts, briefService.ts, Prisma, web approval UI	Tek kötü token bütün agent prompt'larına persistent talimat enjekte eder	tools/list direct update_brief içermez; MCP-origin canonical revision'ların %100ünde sourceProposalId+human approver vardır; rollback bir yeni revision yaratır	Supervisor-only direct write
R3	Proposal 256KiB/128KiB/100 intents/50 nodes/100 edges/300 expanded ops/8-dk/10-open kotası	M	A+B zorunlu	mcpRoutes.ts, schemas.ts, proposalService.ts	Tek token CPU/RAM/DB tüketimini büyütür	262145 B→413; 101 intents/131073 B/51 nodes/101 edges/301 ops → zero DB write; 9. request/60s→rate error	Sadece intent=200 sınırına güvenmek
R4	FIFO soft-lease fairness: max2/token, %20/token, %80 canvas, TTL120/max300, waiter→no-renew, 330s SLO	M	A: opsiyonel; B: zorunlu	claimService.ts, Prisma	Kötü agent claim'leri sürekli yenileyerek peer ajanı bekletebilir	50 simultaneous overlap testinde tek live holder; max2 invariant; en eski eligible waiter ≤330 s; proposal commit semantics değişmez	Hard locks; priority scheduler
R5	Risk-triggered owner step-up + emergency revoke	M	A+B zorunlu	proposalService.ts, MCP approve, routes.ts, web	Compromised supervisor self-submit/self-approve ile büyük değişiklik geçirir	9 trigger'dan her biri awaiting_human; hiçbir commit yok; human approve sonrası normal commit guard; closed-region asla override edilmez	Her call'da human; çift AI supervisor
R6	Token expiry + short-lived credential + scopes; B için MCP-standard OAuth/step-up yoluna geç	L	A: önerilir; B: zorunlu	auth/MCP route, Prisma	Sızmış key revoke edilene kadar süresiz çalışır	B token default lifetime ör. 24h, privileged supervisor 1h; expiry sonrası her request 401; revoke anında 401	Tek uzun ömürlü static key
R7	Third-party read contract'ını explicit yap: full-canvas-read veya region/read scopes	M/L	A: gereksiz; B: ürün kararına bağlı zorunlu	get_state, list_regions, token scopes	“Region özel” zannedilen veri valid external agent tarafından okunur	Restricted-read modunda forbidden node/member info hiçbir get_state/list_regions response'unda görünmez	Write regions'ın kendiliğinden read privacy sağladığını varsaymak
R8	Protocol/supply-chain release gate: SDK version pin + lockfile + SBOM + MCP 2026 conformance tests	S/M	A+B gerekli	monorepo manifests/CI + mcp.test.ts	Test legacy 2025-03-26'da kalırken deployed SDK davranışı belirsizleşir	CI'da lockfile+SBOM zorunlu; 2026-07-28 _meta/header/version rejection testleri; dependency version raporu	SDK versiyonunu source import'tan tahmin etmek
MVP öncelik sıram

İlk release gate: R2 + R3 + R5.
Model B'yi gerçekten desteklemeden önce: R1 + R6 + ürün kararına göre R7.
Çok ajanlı yük arttıkça: R4.
Hemen CI hygiene olarak: R8.

Başka ifadeyle: mevcut haliyle Model A'yı kullanılabilir buluyorum; Model B'yi “third-party adversarial agents supported” diye güvenlik sözü vererek yayınlamam. Önce delegated authority, canonical brief governance ve human step-up eklenmeli.

5. Açık sorular

Bunlar kod okuyarak cevaplanamaz; ürün/güven politikası kararı gerekiyor:

Model B'deki üçüncü taraf ajan bütün canvas'ı okumaya yetkili mi? Evetse get_state bug değil; hayırsa read scopes yeni bir güven sınırı olmak zorunda.

Üçüncü taraf ajanı davet eden canvas owner, onun proposal'larının owner yetkisiyle uygulanmasını gerçekten kabul etmiş mi, yoksa “agent role”ün teknik yetki de sınırlaması bekleniyor mu?

Brief human approval'ını Editor+ mı, yalnız owner mı yapmalı? Mevcut human brief policy Editor+'dır; yüksek riskli supervisor step-up için benim seçimim owner.

Third-party agent provider'ları için provider/org/data-retention bilgisi token metadata'sında tutulacak mı?

Supervisor'ın region oluşturma yetkisi “planlama koordinasyonu” mu, yoksa “security policy administration” mı? İkincisiyse MCP'de doğrudan write yerine human proposal olmalı.

256/128 KiB ve 50/100/300 proposal eşikleri MVP policy seçimidir. Gerçek 1k-node/10k-commit benchmarklarından sonra telemetry ile artırılabilir; kodda bu workload'un ölçümü olmadığı için daha yüksek eşiği kanıtlanmış kapasite gibi sunmuyorum.

Bir grup canManageRoles yetkilisinin mevcut agent role'de isSupervisor bayrağını değiştirmesiyle bağlı token'ların supervisor yetkisinin değişmesi istenen ürün davranışı mı? Kod bunu mümkün kılıyor (groupRoutes.ts:75-84,190-207, agentRoleService.ts:51-69,230-249). Eğer supervisor bir güvenlik rolüyse, bu değişiklik owner re-approval/token rotation gerektirmeli.

6. Kaynaklar

MCP — resmî specification, sürüm 2026-07-28

Model Context Protocol — Specification 2026-07-28. https://modelcontextprotocol.io/specification/2026-07-28
 — yayın/sürüm: 28 Temmuz 2026; erişim: 16 Ağustos 2026. 
Model Context Protocol

MCP — Versioning and Compatibility. https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
 — sürüm: 2026-07-28; erişim: 16 Ağustos 2026. 
Model Context Protocol

MCP — Streamable HTTP. https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
 — sürüm: 2026-07-28; erişim: 16 Ağustos 2026. 
Model Context Protocol

MCP — Tools. https://modelcontextprotocol.io/specification/2026-07-28/server/tools
 — sürüm: 2026-07-28; erişim: 16 Ağustos 2026. 
Model Context Protocol

MCP — Authorization. https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index
 — sürüm: 2026-07-28; erişim: 16 Ağustos 2026. 
Model Context Protocol
+2
Model Context Protocol
+2

MCP — Authorization Security Considerations. https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations
 — sürüm: 2026-07-28; erişim: 16 Ağustos 2026. 
Model Context Protocol
+1

OWASP — resmî GenAI Security Project

OWASP LLM01:2025 Prompt Injection. https://genai.owasp.org/llmrisk/llm01-prompt-injection/
 — sürüm: LLM Top 10 2025; erişim: 16 Ağustos 2026. 
OWASP Gen AI Security Project

OWASP LLM02:2025 Sensitive Information Disclosure. https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/
 — sürüm: 2025; erişim: 16 Ağustos 2026. 
OWASP Gen AI Security Project

OWASP LLM03:2025 Supply Chain. https://genai.owasp.org/llmrisk/llm032025-supply-chain/
 — sürüm: 2025; erişim: 16 Ağustos 2026. 
OWASP Gen AI Security Project
+1

OWASP LLM06:2025 Excessive Agency. https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
 — sürüm: 2025; erişim: 16 Ağustos 2026. 
OWASP Gen AI Security Project
+1

OWASP LLM10:2025 Unbounded Consumption. https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/
 — sürüm: 2025; erişim: 16 Ağustos 2026. 
OWASP Gen AI Security Project

OWASP, A Practical Guide for Securely Using Third-Party MCP Servers 1.0. https://genai.owasp.org/resource/cheatsheet-a-practical-guide-for-securely-using-third-party-mcp-servers-1-0/
 — v1.0, 4 Kasım 2025; erişim: 16 Ağustos 2026. 
OWASP Gen AI Security Project

OWASP, NYC Insecure Agents Hackathon Recap. https://genai.owasp.org/2025/04/25/recap-from-owasp-gen-ai-security-projects-nyc-insecure-agents-hackathon/
 — 25 Nisan 2025; erişim: 16 Ağustos 2026. 
OWASP Gen AI Security Project

NIST — resmî

NIST AI 600-1, Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile. https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
 — 26 Temmuz 2024; erişim: 16 Ağustos 2026. Kullanılan maddeler: GV-1.3-002, GV-3.2-005, GV-6.1-007, GV-6.1-008, MS-2.7-004, MS-2.7-007. 
NIST Publications
+3
NIST Publications
+3
NIST Publications
+3

NIST publication record. https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
 — yayın: 26 Temmuz 2024, sayfa güncellemesi 8 Nisan 2026; erişim: 16 Ağustos 2026. 
NIST

NIST AI Risk Management Framework landing page. https://www.nist.gov/itl/ai-risk-management-framework
 — erişim: 16 Ağustos 2026; NIST AI 600-1 yayın tarihini ve AI RMF'nin voluntary-use niteliğini doğrulamak için kullanıldı. 
NIST

Son karar: Co-Pronoia'nın mevcut MCP hattı, Model A için savunulabilir bir “user-delegated agent” mimarisi; fakat Model B'nin gerçekten düşmanca üçüncü taraf ajanlarını güvenle barındırdığı söylenemez. Model B için release-blocker üçlü delegated authorization scope + human-controlled canonical brief + risk-triggered human approval olmalıdır.
