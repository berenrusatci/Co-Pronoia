---
tags:
  - log/duzen
  - rol/duzenleyici-1
rol: duzenleyici-1
model: gpt-5.6-sol
konu: 07-mcp-tehdit-modeli
tur: duzen
zaman: 2026-08-16T15:54:05
karakter: 29979
ham: false
kaynak: arastirma/vault/7 Log/ham/2026-08-16 1521 07-mcp-tehdit-modeli.md
---

# 07 — MCP dış ajan tehdit modeli — düzenlenmiş ve doğrulanmış sürüm

Kaynak ham kayıt: `arastirma/vault/7 Log/ham/2026-08-16 1521 07-mcp-tehdit-modeli.md`.

Doğrulama anı: 16 Ağustos 2026; canlı depo depo kökü esas alındı.

## D1 düzeltme kaydı

Ham kayıtta 94 satır-numaralı kod atfı vardır. Atıfların 94'ünün hedef dosyası bulundu; 16'sı zaten tam doğru yol, 78'i eksik/yanlış yoldu. Aşağıdaki eşleme, ham metindeki bütün tekrarlarına uygulanmıştır:

| Ham gösterim | Doğrulanmış gösterim |
|---|---|
| ~~`routes.ts`~~ | `server/src/routes.ts` (D1 yol düzeltmesi) |
| ~~`proposalService.ts`~~ | `server/src/proposalService.ts` (D1 yol düzeltmesi) |
| ~~`commitService.ts`~~ | `server/src/commitService.ts` (D1 yol düzeltmesi) |
| ~~`mcpServer.ts`~~ | `server/src/mcp/mcpServer.ts` (D1 yol düzeltmesi) |
| ~~`schemas.ts`~~ | `server/src/mcp/schemas.ts` (D1 yol düzeltmesi) |
| ~~`mcpRoutes.ts`~~ | `server/src/mcp/mcpRoutes.ts` (D1 yol düzeltmesi) |
| ~~`app.ts`~~ | `server/src/app.ts` (D1 yol düzeltmesi) |
| ~~`claimService.ts`~~ | `server/src/claimService.ts` (D1 yol düzeltmesi) |
| ~~`briefService.ts`~~ | `server/src/briefService.ts` (D1 yol düzeltmesi) |
| ~~`agentRoleService.ts`~~ | `server/src/agentRoleService.ts` (D1 yol düzeltmesi) |
| ~~`agent.ts`~~ | `server/src/agent.ts` (D1 yol düzeltmesi) |
| ~~`groupRoutes.ts`~~ | `server/src/groupRoutes.ts` (D1 yol düzeltmesi) |
| ~~`db/prisma/schema.prisma`~~ | `server/prisma/schema.prisma` (D1 yol düzeltmesi) |
| ~~`schema.prisma`~~ | `server/prisma/schema.prisma` (D1 yol düzeltmesi) |
| ~~`shared/types.ts`~~ | `shared/src/types.ts` (D1 yol düzeltmesi) |

Satır kalibrasyonu: ~~`server/src/app.ts:82`~~ → `server/src/app.ts:82-83` (D1 satır düzeltmesi); Fastify çağrısı 83. satırdadır.

Bulunamayan atıf: yok. `DOĞRULANAMADI` işareti gereken kod atfı yoktur.

## 1. Yönetici özeti

Model A — kullanıcının kendi Claude/Codex ajanı — mevcut mimaride kullanılabilir: worker doğrudan commit atamaz; proposal onayı normal commit hattına girer ve `actor.ai:true` ile AI-kapalı bölgeler merkezî olarak reddedilir (`server/src/proposalService.ts:257-270`, `server/src/commitService.ts:455-465`, `shared/src/regionGuard.ts:69-127`). Bu bulgu kapalıdır.

Model A'nın gerçek tehditleri kanvas kaynaklı indirect prompt injection, ele geçirilmiş agent host'u ve çalınmış uzun ömürlü `tma_` anahtarıdır. Kullanıcı ile kendi ajanını varsayılan olarak karşı taraf saymak doğru ürün modeli değildir.

Model B — bilinçli olarak saldırgan olabilecek üçüncü taraf ajan — için mevcut rol/persona yapısı yetki sınırı değildir. Onaylanan proposal, token'ı basan kullanıcının kanvas rolüyle uygulanır (`server/src/proposalService.ts:243-270`); owner tarafından basılmış token AI-açık alanlarda owner kapsamına sahiptir.

`aiAllowed:false` bu yetki mirasını sınırlayan gerçek hard-stop'tur; Model B'deki açık risk, AI-açık graph alanlarında delegated write/read scope bulunmamasıdır.

`update_brief` bütün MCP token'larında kayıtlıdır ve canonical brief bütün agent prompt'una girer (`server/src/mcp/mcpServer.ts:172-184`, `:223-228`, `:398-413`). Model B'de kalıcı ortak-bağlam zehirleme kanalıdır.

Proposal'da 200 intent ve alan bazlı Zod sınırları vardır (`server/src/mcp/mcpServer.ts:500-511`, `server/src/mcp/schemas.ts:15-60`); fakat aggregate intents, expanded-op, proposal-rate ve open-proposal kotası yoktur.

~~“Ham JSON bayt sınırı yok”~~ → MCP route'a özel sınır yoktur; fakat canlı kurulumdaki Fastify 5.10.0 varsayılan body limiti 1 MiB'dir (`server/src/app.ts:82-83`, `node_modules/fastify/build/build-validation.js:32`, D1 şiddet/olgu düzeltmesi).

~~“SDK sürümü bilinmiyor”~~ → canlı depoda `@modelcontextprotocol/sdk` aralığı `^1.29.0`, lockfile/kurulu sürüm 1.29.0'dır (`server/package.json:23`, `package-lock.json:1187-1190`, D1 olgu düzeltmesi). Test yine legacy `2025-03-26` gönderir (`server/src/mcp.test.ts:50-54`); 2026 uyumluluğu yalnız sürüm numarasından çıkarılamaz.

Claim bir güvenlik kilidi değil, soft lease'tir. Yarış veya starvation graph yetki ihlali değil; koordinasyon/kapasite kalitesi sorunudur (`server/src/claimService.ts:7-24`, `:103-178`).

Ham yanıtın atladığı açık bulgu: proposal kararında CAS yoktur; açık durum 248'de okunur, graph etkisi doğar, durum 276-289'da koşulsuz güncellenir (`server/src/proposalService.ts:243-289`). Eşzamanlı onay/ret ikinci branch veya karar/graph izi ayrışması yaratabilir.

MVP önceliği: canonical brief için insan onayı, proposal kota/rate sınırları, proposal karar CAS'ı ve risk-triggered insan step-up. Model B yayınından önce delegated scopes ve kısa ömürlü credential da zorunludur.

## 2. Bulgular

### 2.1 İki tehdit modeli

| Boyut | Model A — kullanıcının ajanı | Model B — üçüncü taraf ajan |
|---|---|---|
| Korunan varlık | Graph/commit ve brief bütünlüğü, canvas gizliliği, anahtar, kapasite, gerçek kullanıcı niyeti | Bunlara ek olarak ajan izolasyonu, fairness, provenance ve supervisor karar bütünlüğü |
| Güvenilen | Kullanıcı, normal koşulda seçtiği host, deterministic commit denetimleri | Kullanıcı ve deterministic sunucu denetimleri; dış worker/supervisor güvenilmez |
| Giriş noktaları | Node metni, brief, başka tool çıktısı, `/api/mcp`, sızmış token | Bunlara ek proposal spam, claim renewal, full-state read, self-approval ve role manipulation |
| En kötü gerçek sonuç | Ele geçirilmiş supervisor/token AI-açık canvas'ta token minter kapsamıyla değişiklik yapar ve canvas'ı okur; AI-kapalı bölge reddedilir | Saldırgan ajan owner-minted token ve supervisor onayıyla bütün AI-açık canvas'ı değiştirebilir; full `get_state` ile canvas verisini okuyabilir |
| Artık risk | Semantik hata ve host taraflı exfiltration tamamen sıfırlanamaz | Scope eklense bile yetkili kapsamda yanıltıcı proposal ve insan/supervisor semantik hatası kalır |

### 2.2 Persona yetki sınırı değildir — doğrulandı

Token üretimi owner-only'dir (`server/src/routes.ts:550-560`). Token `createdById` ve `canvasId` ile saklanır (`server/src/agentRoleService.ts:157-181`; `server/prisma/schema.prisma:319-337`). Bearer her request'te hash lookup ve revoke kontrolünden geçer (`server/src/agentRoleService.ts:230-249`).

Onayda token creator bulunur, creator'ın güncel canvas rolü çözülür ve commit `authorId:creatorId`, `actor:{userId:creatorId, role, ai:true}` ile çalışır (`server/src/proposalService.ts:243-270`). `AgentRoleDef.name/persona/isSupervisor` workflow kabiliyetini belirler; graph region/capability scope sağlamaz.

Gerçekte ne olur: üçüncü taraf worker tek başına commit atamaz. Ancak kötü/ele geçirilmiş supervisor proposal'ı onaylarsa işlem token minter'ın rolüyle değerlendirilir. Owner minter için AI-açık alanlarda membership bypass vardır; AI-kapalı alan yine reddedilir (`server/src/commitService.ts:455-465`). Şiddet: Model A'da orta, Model B'de yüksek; “bütün güvenlik kontrollerini aşar” değildir.

### 2.3 Kontrol matrisi

| Kontrol | Model A | Model B | Bugün |
|---|---|---|---|
| Proposal → supervisor → normal commit | gerekli | gerekli | var |
| Merkezî `aiAllowed:false` | gerekli | gerekli | var ve testli |
| Agent başına capability/read/write/region scope | önerilir | zorunlu | yok |
| Riskli değişiklikte insan step-up | gerekli | zorunlu | yok |
| Canonical brief'e doğrudan agent write | kaldırılması önerilir | kaldırılmalı | açık |
| Aggregate proposal byte/op ve rate/open kota | gerekli | zorunlu | eksik; yalnız 1 MiB framework body varsayılanı var |
| Claim fairness/aging | operasyonel iyileştirme | zorunlu koordinasyon kontrolü | yok |
| Claim'i hard graph lock yapmak | gereksiz | gereksiz | zaten değil |
| Token expiry/delegated scope | önerilir | zorunlu | yok; revoke/rotate var |
| Region-bazlı read restriction | ürün isterse | gizlilik vaadi varsa zorunlu | yok |
| Proposal karar CAS | gerekli | gerekli | yok |
| Güvenlik `AuditLog` modeli | önerilir | gerekli | yok; domain geçmişleri tam güvenlik audit'i değildir |

### 2.4 MCP hükümleri ve kod karşılığı

| Konu | Kaynak hükmü | Kod karşılığı | Kalibre hüküm |
|---|---|---|---|
| Tool input/access/rate | Tools sayfası server için validate/access control/rate limit'i MUST sayar (E06-E08) | Zod + business replay var; proposal rate yok | validation güçlü, tüketim kontrolü kısmi |
| Tool annotations | Güvenilmeyen server annotations MUST untrusted sayılır (E09) | Araçlar repo içinde statik `registerTool()` ile kayıtlı (`server/src/mcp/mcpServer.ts:143+`) | Bu server'da dinamik tool-poisoning yüzeyi düşük; multi-MCP host ayrı sınır |
| Kullanıcı onayı | Human-in-loop/deny ve sensitive call confirmation SHOULD (E10) | AI supervisor var; insan approve HTTP yolu bilinçli yok (`server/src/routes.ts:587-590`) | High-impact işlerde eksik; her çağrı için insan şartı değil |
| Auth/scope/audience | HTTP auth kullanılıyorsa spec uyumu/least privilege ve audience kontrolleri (E12-E14) | Canvas-bound custom `tma_`; capability/region/expiry yok | MCP MUST ihlali diye abartılmamalı; Model B least-privilege açığı |
| Token passthrough/confused deputy | Inbound token upstream'e geçirilmemeli; proxy consent ayrımı gerekir (E15-E16) | Upstream OAuth proxy akışı yok | bugün uygulanmaz |
| Stateless/version | 2026 revizyonu per-request `_meta` ve HTTP header ister (E01-E05) | fresh server/transport/POST; test `2025-03-26` (`server/src/mcp/mcpRoutes.ts:12-45`, `server/src/mcp.test.ts:50-54`) | 2026 compliance doğrulanmadı; `wait_for_changes` uygulama long-poll'udur, spec subscription değildir |

### 2.5 `update_brief`: canonical memory poisoning — doğrulandı

Tip yorumu Editor+ üyeler ve MCP agent'ların yazdığını söyler (`shared/src/types.ts:183-187`). HTTP Editor+ yazabilir (`server/src/routes.ts:405-415`); MCP `update_brief` bütün token'lara kayıtlıdır (`server/src/mcp/mcpServer.ts:398-413`). Brief hash/version'a ve prompt'un tamamına girer (`server/src/mcp/mcpServer.ts:172-184`, `:223-228`).

Revision append-only'dir, fakat yalnız content/authorLabel/time taşır (`server/src/briefService.ts:26-49`, `shared/src/types.ts:196-201`). Bu provenance yararlıdır ama approval boundary değildir.

Gerçekte ne olur: kötü token doğrudan graph yazmaz; sonraki ajanların prompt'unda kalıcı ve güvenilir görünümlü bir talimat bırakır. Deterministic Zod/region guard yine çalışır, fakat semantik kararlar ve düşük riskli proposal'lar yönlendirilebilir. Model A orta, Model B yüksek.

Seçilen politika: MCP'den `update_brief` kaldırılır, `propose_brief_update` eklenir; Editor+/owner insan onayı yeni canonical revision üretir. Revision; `parentRevisionId`, `sourceProposalId`, `authorKind`, `authorUserId`, `approvedByUserId`, `contentSha256`, `rollbackOfRevisionId` taşır. Rollback eski satırı değiştirmez; eski içeriği yeni append-only revision olarak yazar.

### 2.6 `submit_proposal`: fiilî limitler ve düzeltme

| Boyut | Canlı fiilî durum | Kanıt |
|---|---|---|
| Intent | 1–200 | `server/src/mcp/mcpServer.ts:505-509`, `server/src/proposalService.ts:10-12`, `:92-94` |
| Title/summary | 120 / 2.000 karakter | `server/src/proposalService.ts:10-11`, `:123-135` |
| Node title/description/notes | 200 / 2.000 / 20.000 | `server/src/mcp/schemas.ts:23-28`, `:38-45` |
| data | 50 key; key 100, value 2.000 | `server/src/mcp/schemas.ts:15-18` |
| ID/ref | add id 64; update/delete/move ve source/target/parent/link refs açık max | `server/src/mcp/schemas.ts:22`, `:27`, `:36-60` |
| Expanded op | kota yok | `server/src/proposalService.ts:95-109` |
| Route raw body | route'a özel kota yok; etkin Fastify default 1.048.576 byte | `server/src/app.ts:82-83`, `server/src/mcp/mcpRoutes.ts:26-45`, `node_modules/fastify/build/build-validation.js:32` |
| Submit/update rate ve açık proposal/token | kota yok | `server/src/proposalService.ts:112-190`, `server/prisma/schema.prisma:375-399` |

~~“Request raw JSON byte: yok”~~ → “MCP'ye özgü limit yok, framework varsayılanı 1 MiB” (D1 şiddet düzeltmesi). Açık risk sınırsız tek request değil; 1 MiB içinde pahalı expand/clone ve sınırsız tekrar/open-row birikimidir.

MVP: route 256 KiB; serialized intents 128 KiB; 100 intent; 50 add-node; 100 add-edge; 300 expanded op; token başına submit+update 8/60 s; açık proposal 10. Parse öncesi aşım HTTP 413, protocol şekil hatası JSON-RPC error, business kota aşımı `isError:true` ve makine kodu döndürür. Hiçbir kota aşımı DB satırı oluşturmamalıdır.

Repo içi emsaller yalnız politika gerekçesidir, kapasite kanıtı değildir: prompt 8.000 (`server/src/routes.ts:33-44`, `:225-234`), region/tur 4 ve subcanvas/tur 3 (`server/src/agent.ts:37-44`, `:306-320`, `:376-390`), stepwise parça 6 (`server/src/agent.ts:34-35`, `:883-885`).

### 2.7 Claim fairness — güvenlik değil koordinasyon

Bugün TTL min/default/max 30/600/900 s, node claim max 200, aynı token/scope renewal, başka token overlap'te hata değil conflict, yalnız kendi claim'ini release ve owner force-release vardır (`server/src/claimService.ts:16-24`, `:103-203`). Proposal overlap yalnız warning'dir (`server/src/claimService.ts:214-244`). DB uniqueness yoktur (`server/prisma/schema.prisma:352-372`).

Check ve create aynı transaction/lock içinde değildir; eşzamanlı process'ler iki live claim oluşturabilir. Gerçekte ne olur: commit yetkisi açılmaz ve graph bozulmaz; agent koordinasyon vaadi bozulur, boşa çalışma/starvation artar.

MVP soft lease: token başına 2 live claim; node union/token `min(200,max(20,ceil(N×0,20)))`; canvas live-claimed node union en çok %80; TTL default 120/max 300 s; waiter varken renewal yok; FIFO/aging; aynı resource için en eski eligible waiter 330 s içinde grant veya terminal denial. Conflict-check/create canvas-scoped DB transaction/lock ile seri hale gelir. Hard graph lock reddedilir.

### 2.8 Supervisor ele geçirilirse ve CAS açığı

Supervisor aracı, token'ın rollerinden biri supervisor ise kaydolur; çağrıda seçilen rol ayrıca supervisor olmalıdır (`server/src/mcp/mcpServer.ts:570-608`). Supervisor worker araçlarını kullanabilir, kendi proposal'ını submit edip onaylayabilir (`server/src/mcp/mcpServer.ts:190-197`), proposal kararları verebilir ve doğrudan config niteliğindeki region yaratabilir (`server/src/mcp/mcpServer.ts:610-680`). Grup admin veya `canManageRoles`, `isSupervisor` bayrağını değiştirebilir (`server/src/groupRoutes.ts:75-84`, `:190-207`; `server/src/agentRoleService.ts:51-69`). Owner revoke/rotate/reject/force-release yapabilir (`server/src/routes.ts:565-619`).

Gerçekte ne olur: ele geçirilmiş supervisor AI-kapalı bölgeyi aşamaz; fakat AI-açık owner kapsamlı proposal'ı self-approve edebilir, region config yazabilir ve brief zehirleyebilir. Etki yüksek, “tam sistem ele geçirilmesi” değildir.

Ham yanıtın atladığı CAS açığı: approval açık status'u okur (`server/src/proposalService.ts:243-249`), commit'i uygular (`:257-270`), sonra proposal'ı koşulsuz günceller (`:275-289`). `decideProposal` da read-then-update yapar (`:208-224`). İki eşzamanlı kararın biri main commit, diğeri branch/son durum üzerine yazma üretebilir. Çözüm: `updateMany({where:{id,status:{in:OPEN_STATUSES}}, data:{status:'applying'}})` ile tek kazanan; commit ve final state için transaction/outbox veya idempotency key; yarış testi.

İnsan step-up sinyali: intent >50; expanded op >100; etkilenen mevcut node `>max(10,ceil(N×0,05))`; herhangi `delete_node`; `delete_edge>10`; cross-region/move across boundary; self-approval; brief değişikliği; region-policy değişikliği. `aiAllowed:false` için insan override yoktur.

Çift otomatik supervisor bağımsız trust boundary garantilemez; MVP risk-triggered owner step-up + anlık revoke'dur. False positive maliyeti bulk refactor/cleanup için bir owner click ve gecikmedir.

### 2.9 Saldırı ağacı

| Kök/yaprak | Önkoşul | A/B | Bugünkü kontrol | Öneri | Tespit | Artık risk |
|---|---|---|---|---|---|---|
| Ortak bağlamı zehirle → `update_brief` | geçerli token | A: compromise; B: doğrudan | append revision + authorLabel | direct write kaldır, insan-approved proposal | token brief-change, source refs | insan kötü içeriği onaylayabilir |
| Kaynak tüket → proposal spam/şişirme | token | A+B | 200 intent, 1 MiB body default | byte/op/rate/open kotaları | 413/quota/rate counters | sınırlı workload kalır |
| Diğer ajanı aç bırak → claim renew/race | token/paralel process | A: ops; B: bilinçli | TTL, 30 write/dk | max2, %20/%80, FIFO, no-renew-if-waiter | oldest wait age, ratio | claim advisory olduğu için yalnız verim kaybı |
| Yetkili supervisor ile graph değiştir | supervisor compromise/semantic hata | A+B, B kritik | validation + AI fence | scope + CAS + risk step-up | self-approve, high-impact event | yetkili kapsamda insan hatası |
| Canvas verisini sızdır → full `get_state` | geçerli canvas token | A: çoğu kez beklenen; B: kritik | canvas scope | açık full-read consent veya read scope | bulk read/provider kimliği | yetkili kapsam provider'a gider |
| Host başka tool ile exfiltrate eder | host'ta network/send tool | A+B | server göremez | client confirmation/sandbox | host audit | server tek başına önleyemez |

`get_state` bütün nodes/edges/regions'i döndürür (`server/src/mcp/mcpServer.ts:268-278`); `list_regions` üye adlarını da döndürür (`:282-295`). Bu bugün authorization bypass değil, çünkü region kodu write restriction'dır. Model B'de gizli partition bekleniyorsa ürün sözleşmesi ve read scope gerekir.

### 2.10 Dış kaynak/URL denetimi

Sayım yöntemi: ham kayıttaki tekrarlar birleştirilerek 28 ayrı dış factual/normative iddia birimi çıkarıldı; salt ürün eşiği önerileri dış iddia sayılmadı. 28/28 iddianın tam URL'si ve erişim tarihi vardır; `[URL YOK — karar kaydına giremez]` işareti gereken iddia yoktur.

| ID | Dış iddia | Tam kaynak ve erişim | Durum |
|---|---|---|---|
| E01 | Güncel yayımlanmış MCP revizyonu 2026-07-28 | https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E02 | Modern sürüm per-request `_meta` taşır | https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E03 | 2025-11-25 ve öncesi initialize/legacy sınıfıdır | https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E04 | HTTP header ile `_meta` version eşleşmelidir | https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E05 | Notification stream `subscriptions/listen` ile açılır | https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E06 | Server tool input doğrulamalıdır | https://modelcontextprotocol.io/specification/2026-07-28/server/tools — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E07 | Server proper access control uygulamalıdır | https://modelcontextprotocol.io/specification/2026-07-28/server/tools — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E08 | Server tool çağrılarını rate-limit etmelidir | https://modelcontextprotocol.io/specification/2026-07-28/server/tools — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E09 | Untrusted server tool annotations güvenilmez sayılmalıdır | https://modelcontextprotocol.io/specification/2026-07-28/server/tools — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E10 | Human-in-loop ve sensitive call confirmation SHOULD'dur | https://modelcontextprotocol.io/specification/2026-07-28/server/tools — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E11 | Protocol malformed request ile tool execution error ayrılır | https://modelcontextprotocol.io/specification/2026-07-28/server/tools — erişim 16 Ağustos 2026 | URL var |
| E12 | Authorization optional; HTTP'de uygulanıyorsa spec uyumu beklenir | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index — erişim 16 Ağustos 2026 | URL var |
| E13 | Token audience binding/validation gerekir | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E14 | Short-lived access token SHOULD'dur | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E15 | Token passthrough yasaktır | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E16 | Upstream proxy'de confused-deputy/consent ayrımı gerekir | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E17 | Dış içerik indirect prompt injection taşıyabilir | https://genai.owasp.org/llmrisk/llm01-prompt-injection/ — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E18 | LLM01 least privilege önerir | https://genai.owasp.org/llmrisk/llm01-prompt-injection/ — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E19 | LLM01 high-risk action için human approval önerir | https://genai.owasp.org/llmrisk/llm01-prompt-injection/ — erişim 16 Ağustos 2026 | URL var; curl destekledi |
| E20 | LLM06 malicious/compromised peer agent'i kapsar | https://genai.owasp.org/llmrisk/llm062025-excessive-agency/ — erişim 16 Ağustos 2026 | URL var |
| E21 | LLM06 kullanıcı bağlamı/minimum privilege/human approval kontrollerini destekler | https://genai.owasp.org/llmrisk/llm062025-excessive-agency/ — erişim 16 Ağustos 2026 | URL var |
| E22 | LLM10 size/rate/quota/timeout/queue sınırları önerir | https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/ — erişim 16 Ağustos 2026 | URL var |
| E23 | LLM02 least-privilege data access ile ilişkilidir | https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/ — erişim 16 Ağustos 2026 | URL var |
| E24 | LLM03 inventory/SBOM/supplier/verifiable source kontrolleri verir | https://genai.owasp.org/llmrisk/llm032025-supply-chain/ — erişim 16 Ağustos 2026 | URL var |
| E25 | Shared/global memory poisoning sonraki ajan davranışını etkileyebilir | https://genai.owasp.org/2025/04/25/recap-from-owasp-gen-ai-security-projects-nyc-insecure-agents-hackathon/ — erişim 16 Ağustos 2026 | URL var |
| E26 | Third-party MCP rehberi prompt/tool/memory poisoning risklerini kapsar | https://genai.owasp.org/resource/cheatsheet-a-practical-guide-for-securely-using-third-party-mcp-servers-1-0/ — erişim 16 Ağustos 2026 | URL var |
| E27 | NIST AI 600-1 gönüllü GenAI profilidir; 26 Temmuz 2024 yayımlanmıştır | https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence — erişim 16 Ağustos 2026 | URL var |
| E28 | NIST GV-6.1-008 provenance'ta source/timestamp/metadata ister; ham kaydın diğer madde kimlikleri aynı PDF'dedir | https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf — erişim 16 Ağustos 2026 | URL var; PDF curl+pdftotext destekledi |

URL örneklemesi: 6 ayrı resmî URL (`versioning`, `streamable-http`, `tools`, `authorization/security-considerations`, OWASP LLM01, NIST AI 600-1 PDF) `curl` ile HTTP 200 açıldı; seçilen 6 kaynak, bunlara bağlanan iddiaları metin içinde destekledi.

URL: 28/28, 6 tanesi açılarak sınandı, 6 tanesi iddiayı destekliyor.

## 3. Risk sıralaması

| Sıra | Kalibre risk | Gerçekte ne olur | Model/varsayım |
|---|---|---|---|
| 1 | Owner-minter yetkisinin third-party proposal'a mirası + supervisor trust | AI-açık graph owner kapsamıyla değişebilir; AI-kapalı alan reddedilir | B, adversarial agent |
| 2 | Canonical brief poisoning | sonraki agent prompt'ları kalıcı kötü bağlam alır; deterministic guard'lar kalır | B kritik; A compromise |
| 3 | Supervisor compromise/self-approval | graph/region/brief üzerinde yüksek etkili ama canvas-sınırlı işlem | A+B |
| 4 | Full-canvas read | geçerli token bütün graph'ı ve region metadata'yı okur | B, full read beklenmiyorsa |
| 5 | Long-lived static token leakage | revoke edilene kadar canvas MCP yetkisi | A+B |
| 6 | Proposal decision CAS yokluğu | eşzamanlı karar graph sonucu ile proposal durumunu ayırabilir, ikinci branch doğurabilir | A+B, concurrency |
| 7 | Proposal amplification/spam | 1 MiB altında CPU/memory/DB ve queue yükü, tekrarlarla kalıcı row birikimi | A+B |
| 8 | Claim starvation/race | ajan planlama verimi düşer; graph integrity bozulmaz | B ağırlıklı |
| 9 | Tool poisoning | repo server'ından çok local/multi-MCP host sınırı | A/B host varsayımı |

## 4. Öneriler — karar kaydı

| ID | Karar | Efor | A/B | Yapılmazsa | Ölçülebilir kabul kriteri | Reddedilen alternatif |
|---|---|---|---|---|---|---|
| R1 | Agent token'a capability + read/write/region scope; commit delegated principal ile | L | A öneri/B zorunlu | third-party proposal AI-açık owner kapsamına çıkar | r1 token'ın r2 proposal onayı %100 reddedilir; AI fence testleri geçer | persona'yı auth saymak |
| R2 | `update_brief` → human-approved `propose_brief_update` | M | A öneri/B zorunlu | tek token bütün prompt'lara kalıcı talimat verir | tools/list'te direct update yok; MCP revision'ların %100ünde proposal+approver; rollback yeni revision | supervisor-only direct write |
| R3 | 256/128 KiB, 100 intent, 50 node, 100 edge, 300 op, 8/dk, 10-open | M | A+B | bounded body içinde CPU/DB spam sürer | 262.145 B→413; diğer sınır +1→zero DB write; 9. çağrı rate error | yalnız 200 intent'e güvenmek |
| R4 | Proposal karar CAS/idempotency | M | A+B | iki karar iki etki/branch veya yanlış final status doğurur | 50 paralel approve/reject testinde tam 1 winner; en çok 1 graph outcome; final status winner ile aynı | process-local mutex |
| R5 | FIFO soft-lease fairness: max2, %20/%80, TTL120/max300, no-renew-if-waiter, 330 s | M | A ops/B zorunlu | kötü agent peer'i bekletir | 50 overlap testinde tek holder; max2; oldest eligible ≤330 s; commit semantiği değişmez | hard lock |
| R6 | Risk-triggered owner step-up + emergency revoke | M | A+B | compromised supervisor yüksek etkili self-approve yapar | her trigger `awaiting_human`; commit yok; insan onayı sonrası normal guard; closed region override yok | her çağrıda insan/çift AI |
| R7 | Token expiry + scopes; B'de MCP-standard auth yolu | L | A öneri/B zorunlu | çalınmış key süresizdir | B token 24 h, supervisor 1 h; expiry/revoke sonrası her request 401 | uzun ömürlü static key |
| R8 | Third-party read contract: explicit full-read veya read scopes | M/L | A gereksiz/B ürün kararına bağlı | “region özel” sanılan veri valid token'a görünür | restricted modda forbidden node/member hiçbir response'ta yok | write region'ı read privacy saymak |
| R9 | Test/lint/conformance CI ve güvenlik decision audit | M | A+B | Docker publish test kapısı olmadan çıkar; karar olayları ilişkilendirilemez | PR/main'de test+lint zorunlu; `proposalId/tokenId/decision/actor/result` audit olayı %100; lockfile/SBOM artifact | yalnız Docker build workflow |

MVP sırası: R2 + R3 + R4 + R6. Model B desteğinden önce R1 + R7 + ürün kararına göre R8. Ajan sayısı/yük büyümeden R5. R9 release hygiene olarak paralel.

## 5. Açık sorular

1. Model B ajanı bütün canvas'ı okumaya yetkili mi? Evetse `get_state` bug değildir; hayırsa read scope yeni güven sınırıdır.
2. Third-party agent davetinde owner, proposal'ın owner rolüyle uygulanmasına açıkça onay veriyor mu?
3. Canonical brief onaylayıcısı Editor+ mı, yalnız owner mı olmalı?
4. Supervisor region oluşturma planlama koordinasyonu mu, security policy administration mı?
5. Third-party token metadata'sında provider/org/data-retention/expiry zorunlu olacak mı?
6. `canManageRoles` sahibinin bağlı token'ı anında supervisor'a yükseltebilmesi istenen davranış mı?
7. 256/128 KiB ve 50/100/300 eşikleri gerçek 1k-node/10k-commit benchmark'ından sonra nasıl ayarlanacak?

## 6. Kaynaklar

- Model Context Protocol, Specification 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28 — erişim 16 Ağustos 2026.
- MCP Versioning and Compatibility: https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning — erişim 16 Ağustos 2026.
- MCP Streamable HTTP: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http — erişim 16 Ağustos 2026.
- MCP Tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools — erişim 16 Ağustos 2026.
- MCP Authorization: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index — erişim 16 Ağustos 2026.
- MCP Authorization Security Considerations: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations — erişim 16 Ağustos 2026.
- OWASP LLM01:2025: https://genai.owasp.org/llmrisk/llm01-prompt-injection/ — erişim 16 Ağustos 2026.
- OWASP LLM02:2025: https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/ — erişim 16 Ağustos 2026.
- OWASP LLM03:2025: https://genai.owasp.org/llmrisk/llm032025-supply-chain/ — erişim 16 Ağustos 2026.
- OWASP LLM06:2025: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/ — erişim 16 Ağustos 2026.
- OWASP LLM10:2025: https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/ — erişim 16 Ağustos 2026.
- OWASP Third-Party MCP Guide v1.0: https://genai.owasp.org/resource/cheatsheet-a-practical-guide-for-securely-using-third-party-mcp-servers-1-0/ — erişim 16 Ağustos 2026.
- OWASP Insecure Agents Hackathon Recap: https://genai.owasp.org/2025/04/25/recap-from-owasp-gen-ai-security-projects-nyc-insecure-agents-hackathon/ — erişim 16 Ağustos 2026.
- NIST AI 600-1 PDF: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf — yayın 26 Temmuz 2024; erişim 16 Ağustos 2026.
- NIST publication record: https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence — erişim 16 Ağustos 2026.

Son karar: Model A savunulabilir; Model B için delegated authorization, human-controlled canonical brief, proposal CAS ve risk-triggered human approval release blocker'dır.
