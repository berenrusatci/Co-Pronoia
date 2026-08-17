# https://chatgpt.com/c/6a7effe6-497c-83eb-9fae-90815fcc2067

Co-Pronoia — Yetki, Kimlik, Sırlar, Gizlilik ve Audit Mimari Araştırması

Araştırma tarihi: 14 Ağustos 2026. Bu değerlendirme kod denetimi değildir; verdiğin mimariyi güncel IETF, NIST, OWASP, KVKK/GDPR kaynakları ve Figma/Notion/Miro/Linear’ın güncel ürün modelleriyle karşılaştırır. KVKK/GDPR kısmı teknik uyum analizi niteliğindedir, somut hukuki görüş yerine geçmez.

Yönetici özeti

Üç katmanlı yetki modelin genel olarak doğru yönde; büyük işbirliği ürünleri de workspace/team/resource erişimini birbirinden ayırıyor. 
Linear
+3
Figma Help Center
+3
Notion
+3

Bence mevcut tasarımdaki en kritik yetkilendirme riski supervisor’ın “confused deputy” haline gelmesi: ajanın yapamadığı şeyi kendi otoritesiyle yapmamalı.

aiAllowed=false, yalnız kullanıcı/role kontrolü değil, işlemin provenance/origin bilgisinin parçası olmalı.

Tek commit apply choke point çok güçlü bir tasarım; ancak güvenlik garantisi, başka hiçbir yolun Commit/materialized state yazamamasıyla geçerli. OWASP da merkezî, her istekte uygulanan erişim kontrolünü öneriyor. 
OWASP Cheat Sheet Series
+1

TypeScript'te branded/capability tipleri yanlış yolu zorlaştırabilir; fakat TS yapısal olduğu için any, cast veya doğrudan Prisma erişimi karşısında tek başına güvenlik sınırı değildir. 
TypeScript
+1

Yerel→bulut aktivasyonunda RFC1918/link-local/.local redirect izin verme; yalnız 127.0.0.1 / [::1] loopback literal yaklaşımı IETF tavsiyesine daha uygundur. 
datatracker.ietf.org
+1

PKCE gevşek redirect validation'ın yerine geçmez.

30 günlük session NIST AAL1 sınırının tamamen dışında değil, fakat session inventory/revocation/rotation olmaması modern SaaS açısından zayıf kurtarma modeli yaratıyor. 
NIST Pages
+1

MCP anahtarlarında show-once + yüksek entropi + digest/HMAC + belirgin prefix + dar scope + hızlı revoke doğru baseline.

@fastify/oauth2 state/PKCE çerezlerinde Secure açıkça set edilmeli; SameSite=Lax transport confidentiality sağlamaz. 
GitHub
+1

IP/UA saklamayan privacy-first yaklaşım ticari olarak mümkündür; Plausible bugün 20k+ ücretli abone ve kârlı, abonelikle finanse edilen privacy-first bir örnek. 
Plausible Analytics
+1

Aktif süreyi raw event/heartbeat arşivi yerine günlük kişi kovaları olarak saklaman hem mimari hem veri minimizasyonu açısından daha savunulabilir.

Commit geçmişi içerik değişiklik audit'i sağlar ama security/control-plane audit log'un yerine geçmez.

Bulgular
1. Çok katmanlı yetkilendirme: modelin piyasadaki desenlerle uyumlu

Figma şu anda plan/organization → team → folder → file/prototype gibi farklı kaynak seviyelerinde izin veriyor; folder'larda inheritance var, guest'ler yalnız açıkça davet edildikleri kaynakları görebiliyor. Notion workspace rolleri, teamspace üyeliği ve page-level erişimi ayırıyor. Miro board/Space/team/company seviyelerinde roller tanımlıyor. Linear workspace/team sınırı, private teams, guests ve ayrıca team-scoped API key'ler kullanıyor. Yani “kimlik rolü” ile “hangi resource’a erişebilir?” sorularını ayrı tutmak yaygın desen. 
Linear
+5
Figma Help Center
+5
Figma Help Center
+5

Co-Pronoia'ya etkisi: canvasRole, group/jobRole ve regionMembership'ı tek bir nihai enum'a flatten etme. Bunları bağımsız authorization facts olarak tutman daha sağlıklı. Zanzibar'ın Google servislerinde kullandığı yaklaşım da authorization'ı kullanıcı–nesne ilişkileri üzerinden ortak bir modelle ifade etmenin ölçeklenebilir olduğunu gösteriyor. 
Google Research

En önemli konu birleşim semantiğini açıkça tanımlamak. Örneğin:

writeAllowed =
    canvasRole >= editor
    AND operationSpecificPermission
    AND regionPolicyAllows(actor, affectedResources)
    AND originPolicyAllows(origin)

Burada grup rolünün yetki ekleyip eklemediği, yoksa yalnız iş dağıtımı bilgisi mi olduğu özellikle belli olmalı. “Bir yerde editor ise başka yerdeki deny'ı override eder” tipi additive grant modelleri kolayca privilege escalation üretir. OWASP least privilege, deny-by-default ve her request için authorization kontrolünü öneriyor. 
OWASP Cheat Sheet Series

Özellikle tanımlanması gereken sınır durumları

move_node için yalnız eski bölge mi, yeni bölge mi, yoksa ikisi de mi yetki gerektiriyor? Güvenli varsayım origin AND destination. add_edge iki farklı bölgedeki node'u bağlıyorsa iki uç üzerinde de yetki gerekip gerekmediği tanımlanmalı. parentId değiştirmek bir node'u başka authorization domain'ine taşıyabiliyorsa yalnız update_node(parentId) gibi görülmemeli. Delete sırasında authorization “before” durumuna; create sırasında “after” durumuna göre yapılmalı.

Bunlar senin spatial-region modelini Figma/Notion'dan daha karmaşık yapıyor; çünkü authorization resource ağacın statik klasörlerden değil, geometrik pozisyon ve graf ilişkilerinden türeyebiliyor.

2. Choke point iyi; capability-gated mutation daha da iyi

OWASP tüm erişim kontrollerinin server-side uygulanmasını, deny-by-default olmasını ve uygulama çapında merkezi şekilde yapılmasını özellikle tavsiye ediyor. Bir saldırganın yalnız tek bir unutulmuş code path bulmasının yeterli olduğu açıkça belirtiliyor. 
OWASP Cheat Sheet Series
+1

Bu nedenle bütün mutasyonların:

intent
→ expand
→ authorize
→ conflict/merge decision
→ commit
→ replay/materialize

şeklinde tek yol kullanması Co-Pronoia'nın güçlü taraflarından biri.

Fakat choke point'in güvenlik özelliği şu invariant'a bağlı olmalı:

Yetkilendirilmemiş uygulama kodunun Commit, Node veya Edge persistent state'ine yazma primitive'i olmamalı.

Yani sadece “ekibimiz burayı çağırmayı unutmaz” yeterli değil.

TypeScript'te capability/token tipi

Capability security'de temel fikir, bir nesneye erişim referansının aynı zamanda o işlem için authority'yi temsil etmesidir; bu yaklaşım klasik confused-deputy problemini azaltır. 
erights.org
+1

Co-Pronoia için örneğin:

TypeScript
type AuthorizedCommit = {
  readonly __brand: unique symbol
  actorId: UserId
  canvasId: CanvasId
  origin: "human" | "builtin-ai" | "mcp-agent"
  policyVersion: number
}

ve:

TypeScript
applyCommit(
  auth: AuthorizedCommit,
  intents: Intent[]
)

gibi bir API kullanılabilir. AuthorizedCommit oluşturabilen fonksiyon yalnız authorization package'ının içinde bulunur.

TypeScript nominal değil, structural type system'dir; TypeScript'in kendi belgeleri brand benzeri tekniklerle nominal davranış taklit edilebildiğini gösteriyor. Dolayısıyla bu desen compile-time guardrail olur fakat bir security boundary değildir: as AuthorizedCommit, any veya doğrudan DB write bunu aşabilir. 
TypeScript
+1

Bu nedenle üç katman kullanırdım:

Type gate: yalnız authorization sonucu dönen opaque/branded capability.

Module gate: Prisma'nın core mutation API'si yalnız commit-engine package'ında.

Runtime/CI gate: test/lint ile başka package'lardan prisma.node.update, Commit.create vb. yasak.

Daha ileri seviyede prod DB rolünü bile buna göre daraltmak mümkün.

TOCTOU

Authorization sonucu ile commit arasında bölge üyeliği veya policy değişebiliyorsa capability stale olabilir. Bu nedenle token'a policyVersion bağlamak veya authorization'ı aynı canvas lock/transaction bağlamında tekrar doğrulamak daha sağlam olur. Zanzibar'ın authorization kararlarında ordering/consistency konusuna özel önem vermesi de bu problemin gerçek önemini gösteriyor. 
Google Research

3. En ciddi authorization tasarım sorusu: supervisor confused deputy

Klasik confused deputy probleminde daha yüksek yetkili bir bileşen, daha düşük yetkili çağıranın isteği üzerine kendi authority'sini yanlışlıkla kullanır. Capability sistemlerinin önemli avantajlarından biri authority'yi açık hale getirerek bunu önlemektir. 
erights.org
+1

Senin MCP akışında:

agent → proposal → supervisor approves → normal commit path

çok iyi bir human/agent separation oluşturuyor. Fakat “normal commit path” hangi actor ile çalışıyor?

Şu model tehlikeli:

proposal from Agent A
→ Supervisor approves
→ commit executes with Supervisor's full permissions

Çünkü Agent A bölgeye yazamasa bile supervisor üzerinden yazdırabilir.

Ben execution authority'yi şu şekilde tanımlardım:

effectiveAuthority =
  approvalAuthority
  ∩ proposalKeyScope
  ∩ selectedAgentRoleScope
  ∩ canvasPolicy
  ∩ regionPolicy
  ∩ originPolicy

Ayrıca commit provenance:

origin: mcp_agent
proposedBy: agent/key
approvedBy: supervisor
executedFor: ...

olarak korunmalı.

aiAllowed için kritik nokta

aiAllowed=false kontrolü yalnız:

if actor.isAI

ile yapılmamalı.

Supervisor bir insan olsa bile değişikliğin origin'i AI proposal ise bölge bunu reddedebilmeli. Aksi halde supervisor approval, aiAllowed=false için laundering mekanizmasına dönüşür.

Yerleşik Gemini için de aynı prensip geçerli: actor kullanıcı olabilir ama provenance builtin-ai olmalı.

4. Sır ailelerinin farklı saklanması tutarsızlık olmak zorunda değil

Farklı secret türlerine farklı algoritma kullanmak tek başına anti-pattern değildir. Doğru algoritma secret'ın entropy'si, kullanım biçimi ve DB compromise threat model'i ile belirlenir. OWASP da secret lifecycle'ını creation, rotation, revocation ve expiration olarak ele alıyor. 
OWASP Cheat Sheet Series

Session ID

Session ID yüksek entropili, makine üretimi bir bearer secret olmalı. OWASP CSPRNG üretimini ve privilege change sonrasında session ID rotation'ı öneriyor. 
OWASP Cheat Sheet Series

DB'de ham session token tutmanın sonucu şudur:

Read-only session-table dump = aktif session'ların doğrudan kullanılabilmesi.

Bu yüzden yüksek entropili session token'ı cookie'de ham tutup DB'de:

HMAC-SHA-256(sessionToken, serverSidePepper)

veya en azından yüksek entropi garanti ediliyorsa SHA-256 digest saklamak daha iyi compartmentalization sağlar.

HMAC benim tercihim olur; DB-only compromise'da ayrıca server secret gerekir.

Uzun ömürlü MCP/API key

Yüksek entropili 256-bit random key için hızlı SHA-256/HMAC digest uygundur; password hashing gibi Argon2/scrypt zorunlu değildir çünkü brute-force edilebilir düşük entropy yoktur.

Show-once:

cpr_mcp_<public-id>_<secret>

gibi düşünülebilir.

DB:

id
prefix/publicId
secretDigest
last4
scope
canvasId
roles
createdAt
expiresAt
revokedAt
lastUsedAt

GitHub secret-scanning partner programı özellikle benzersiz prefix + high-entropy random value + 32-bit checksum formatını kaliteli secret detection için öneriyor; ayrıca bulunan public secret'ların compromised kabul edilip revoke edilmesini öneriyor. 
GitHub Docs

E-posta kodu

Burada kodun biçimi belirleyici.

6 haneli:

000000–999999

kod yalnız 1 milyon olasılığa sahip. scrypt saldırıyı pahalılaştırır ama search space'i büyütmez.

Daha güçlü desen:

HMAC(serverPepper, code || user || purpose || challengeId)
+ 5–15 dk TTL
+ single-use
+ attempt limit
+ resend eski challenge'ı invalidate eder

OWASP reset/verification tokenlarının CSPRNG ile üretilmesini, süreli, tek kullanımlık ve güvenli saklanmasını öneriyor. 
OWASP Cheat Sheet Series
+1

Eğer e-posta tokenı 128–256 bit random URL token ise scrypt gereksizdir; hızlı digest/HMAC daha doğal.

Sonuç

“Session raw / API SHA256 / email scrypt” şeklinde algoritma bazlı değil, şu tabloyla standardize et:

secret class
entropy
bearer?
storage transform
TTL
scope
rotation
revocation
logging/redaction
compromise response

Tutarlılık aynı algoritmayı kullanmakta değil, aynı threat-model metodolojisini kullanmakta olmalı.

5. Show-once MCP anahtarları

Linear'ın güncel API anahtarları izin bazında daraltılabiliyor ve belirli team'lere scope edilebiliyor; bu Co-Pronoia'nın canvas-scoped agent key modeline oldukça yakın bir güncel örnek. 
Linear
+1

Co-Pronoia için baseline:

Show once.

≥256 bit CSPRNG secret.

Açıkça ayırt edilebilir cpr_mcp_... prefix.

Prod/test/local farklı prefix.

DB'de digest/HMAC.

Canvas scope zorunlu.

read, propose, claim, wait ayrı scope.

Role set key oluşturulurken sabitlensin.

Client “ben şu role sahibim” diyerek key'de olmayan role geçemesin.

Key revoke edilince anında etkisiz.

Agent role silinmesi/key geçerli olsa bile effective authority'yi anında düşürmeli.

Key rotation sırasında kısa süre iki key'in birlikte çalışabileceği overlap desteği.

Public repo secret leak bulunursa otomatik revoke + owner bildirimi.

GitHub'ın current partner programı public repo/npm sızıntılarını provider verify/revocation endpoint'ine taşıyabiliyor; ilk aşamada kendi GitHub org'un için custom secret pattern kullanıp, ürün büyüdüğünde partner programına geçmek mantıklı. 
GitHub Docs
+1

Sabit “90 günde mutlaka rotate” gibi bir endüstri standardı yok. OWASP lifetime'ın secret'ın kullanımına ve koruduğu şeye göre değişeceğini söylüyor; compromise-driven rotation + açık expiry policy daha anlamlı. 
OWASP Cheat Sheet Series

6. Local→cloud PKCE akışı: RFC1918 allowlist fazla geniş

RFC 8252, native client loopback redirect için şu biçimleri tarif ediyor:

http://127.0.0.1:{ephemeralPort}/...
http://[::1]:{ephemeralPort}/...

ve client'ın yalnız loopback interface üzerinde dinlemesini söylüyor. Hatta localhost hostname kullanımını bile yanlış interface/name-resolution ihtimali nedeniyle önermiyor. RFC Ekim 2017 tarihli; halen native app loopback için temel BCP. 
IETF Datatracker

RFC 9700, Ocak 2025 OAuth Security BCP, redirect URI eşleşmesinin exact olması gerektiğini ve client/authorization server'ın arbitrary redirect yapan open redirector sunmamasını şart koşuyor. Geçmiş gerçek saldırıların gevşek redirect validation'dan yararlandığını da anlatıyor. 
IETF Datatracker

Dolayısıyla:

127.0.0.1 / ::1       GOOD
RFC1918               fazla geniş
link-local            fazla geniş
*.local               önermem
localhost hostname    IETF bile önermiyor
Neden RFC1918 kötü?

192.168.x.x “bu bilgisayar” anlamına gelmez. Aynı LAN'daki başka bir cihaz olabilir.

Dolayısıyla browser:

cloud auth
→ redirect 192.168.1.73:...

yaptığında kod yanlış makineye gidebilir.

DNS rebinding

.local veya DNS tabanlı allowlist'te hostname → IP mapping'i güvenlik kararı olarak kullanmak rebinding/name-resolution sınıfı problemleri yeniden getirir. RFC 8252'nin literal loopback tavsiyesinin avantajlarından biri bu alanı ortadan kaldırmasıdır. 
IETF Datatracker

SSRF?

Browser'ın redirect olması kendi başına SSRF değildir.

Ama bulut sunucun:

userCallbackUrl → resolve → HTTP request/fetch

yapıyorsa artık SSRF yüzeyi oluşur.

Mümkünse cloud local callback'e hiçbir zaman server-side request yapmasın.

PKCE bunu kurtarmıyor mu?

PKCE authorization-code interception'a karşı çok önemli ve RFC 9700 modern client'larda PKCE kullanımını güçlendiriyor. Fakat aynı RFC ayrıca redirect URI doğrulamasını zorunlu tutuyor. Yani:

PKCE + loose redirect ≠ safe redirect. 
IETF Datatracker

Önerdiğim akış:

local:
  bind 127.0.0.1 / ::1 on random ephemeral port
  generate verifier
  challenge = S256(verifier)
  random state
  one-time transaction id


browser:
  cloud authorize


cloud:
  redirect only to literal loopback
  returns only short-lived one-time authorization code


local:
  receives code
  redeems code + verifier


cloud:
  validates code, transaction, verifier, expiry, single-use
  issues import authorization

Cloud access token veya data payload'ını redirect URL'e koyma.

7. 30 günlük session bugün nerede duruyor?

NIST SP 800-63B-4 Temmuz 2025 final sürümünde AAL1 için overall reauthentication timeout'unun 30 günü aşmaması öneriliyor; inactivity timeout AAL1 için opsiyonel. AAL2'de tavsiye çok daha sıkı: overall ≤24 saat, inactivity ≤1 saat. Dolayısıyla yalnız “30 gün” rakamı tek başına skandal değil. 
NIST Computer Security Resource Center
+1

Sorun 30 günün yanında:

no rotation
no session inventory
no revoke-other-sessions
no device/session identification

olması.

NIST ayrıca session cookie'lerinin secure-only, minimum host/path, tercihen HttpOnly, __Host- ve SameSite Lax/Strict olmasını söylüyor; kolay logout mekanizması da öneriliyor. 
NIST Pages

Minimum uygulanabilir session seti

Ben:

Session
  idDigest
  userId
  createdAt
  lastSeenAt
  absoluteExpiresAt
  revokedAt
  label

tutardım.

UI:

Oturumlarım
- Bu cihaz
- Firefox / 3 gün önce oluşturuldu
- ...
[Oturumu kapat]
[Diğer tüm oturumları kapat]

Raw UA saklamak istemiyorsan label user-created olabilir veya session creation sırasında bir defa kaba browser family'sine dönüştürülüp raw UA atılabilir.

Özellikle şu işlemlerde yeniden authentication / step-up:

e-posta değişikliği

şifre/authenticator değişikliği

owner transfer

API key oluşturma

export/import

tüm sessionları revoke

kritik role/region security değişikliği

OWASP privilege değişimlerinde session identifier yenilenmesini özellikle öneriyor. 
OWASP Cheat Sheet Series
+1

Bir cookie-session mimarisinde ayrıca OAuth tarzı “refresh token” koyman şart değil. Server-side session rotation daha basit olabilir.

8. @fastify/oauth2 CSRF state çerezinde Secure

Güncel @fastify/oauth2 dokümantasyonu state'i httpOnly, sameSite: Lax cookie'ye koyduğunu belirtiyor; PKCE kullanıldığında code verifier cookie'sini de yönetiyor. 
GitHub

Ancak NIST session benzeri cookie'lerin yalnız secure HTTPS sessions üzerinde erişilebilir olmasını açıkça istiyor. SameSite ve HttpOnly başka tehditleri azaltır; plaintext HTTP üzerinde cookie'nin taşınmasını engellemez. 
NIST Pages

Bu yüzden production:

Secure
HttpOnly
SameSite=Lax   // OAuth redirect ihtiyacıyla uyumlu

olmalı.

__Host- kullanılabiliyorsa ekstra iyi.

Gerçek istismar önemi

Bu ihmalin etkisi deployment'a bağlıdır.

Tüm domain/subdomain HTTPS-only + sağlam HSTS ise exploitability ciddi düşer. Buna rağmen Secure bayrağının eksik olması, yanlış proxy config, HTTP endpoint, ilk bağlantı veya gelecekteki deployment regression durumlarında state/verifier'ın plaintext taşınmasına izin veren gereksiz bir açıklık oluşturur.

İncelediğim kaynaklarda “@fastify/oauth2 Secure default eksikliği” için spesifik bir CVE görmedim. Ancak CSRF/OAuth transaction cookie'sinin HTTPS'e kilitlenmesi standart savunmadır; bunu düşük maliyetli hardening değil baseline olarak görürdüm. 
IETF Datatracker
+1

9. Radikal privacy-minimal duruş sürdürülebilir mi?

Evet, ticari olarak mümkün olduğuna dair güncel iyi bir örnek Plausible. Şirket bugün kendi sitesinde no cookies/no persistent identifiers yaklaşımını öne çıkarıyor; 20.000+ ücretli müşteri, self-funded/bootstrapped ve kârlı olduklarını belirtiyor. 
Plausible Analytics
+1

Bu, “her collaboration SaaS hiç log tutmadan çalışabilir” anlamına gelmez. Ama şu pazarlama mesajının gerçek ticari değeri olabileceğini gösteriyor:

“Davranış profili oluşturmuyoruz; ihtiyacımız olmayan veriyi toplamıyoruz.”

KVKK/GDPR açısından da veri minimizasyonu, purpose limitation ve storage limitation yönünde avantaj sağlar. GDPR Article 5 bu temel ilkeleri düzenler; KVKK uygulaması da işleme amacı ve gerekli süreyle sınırlılığı vurgular. 
EUR-Lex
+1

Fakat zero telemetry ile zero security metadata'yı birbirine bağlama.

Şu ikisi farklı:

kullanıcının hangi node'a 17 kere tıkladığını saklamamak

ve:

bir owner'ın API key'i kimin oluşturduğunu bilmemek

İlki privacy kazanımı, ikincisi incident-response kaybı olabilir.

Ben Co-Pronoia'nın duruşunu:

“No behavioral surveillance; minimum purpose-bound security metadata.”

şeklinde tanımlardım.

10. Aktif kullanım süresi nasıl ölçülmeli?

“Tab açık” = active usage değildir. Chartbeat ölçümünde aktif tab ve browser/application focus'u ayrı değerlendiriyor. Parse.ly ise kullanıcı beş saniye hiçbir etkileşim göstermediğinde engaged time saymayı bırakıyor. Medium'ın Total Time Reading yaklaşımı da başlangıç, pause ve stop noktalarını davranış sinyallerinden türetiyor. 
help.chartbeat.com
+2
Parse.ly Help & Support Documentation
+2

Ancak bunların çoğu içerik okuma ürünü. Co-Pronoia'da kullanıcı 40 saniye diyagrama bakıp düşünürken gerçekten çalışıyor olabilir.

Bu yüzden 5 saniye Co-Pronoia için fazla agresif.

Önerdiğim state machine
ACTIVE =
    document.visibilityState === "visible"
    AND windowHasFocus
    AND secondsSinceRelevantActivity <= IDLE_THRESHOLD

Relevant activity:

keyboard
pointer/touch
canvas pan/zoom
node select
node edit
edge operation
timeline interaction

Mouse'ın her piksel hareketini göndermene gerek yok; client yalnız local “lastActivityAt” güncellesin.

Heartbeat

Örneğin 15 veya 30 saniyede bir, yalnız ACTIVE iken:

JSON
{
  "day": "2026-08-14",
  "activeSeconds": 30,
  "metricVersion": 1,
  "sessionWindow": "random-id"
}

Sunucu raw beat history tutmadan:

DailyUsage(userId, date)
activeSeconds += validatedIncrement

yapabilir.

Çok sekme

İki tab aynı anda açıksa iki kat süre yazmamalısın.

Client'ta:

BroadcastChannel, veya

Web Locks

ile tek leader seçmek mümkün.

Ben ayrıca server-side dedupe koyardım; örneğin usageSessionId + 30s window aynı interval'i iki kez increment edemesin.

30 sn / 60 sn / 3 dk farkı

30 saniye: Etkileşim ağırlıklı, konservatif. Uzun süre diyagrama bakıp düşünen kişiyi erken idle kabul eder.

60 saniye: Planlama/canvas ürünü için başlangıç noktası olarak bana en mantıklısı geliyor.

3 dakika: “Gerçek kullanım”dan ziyade “uygulamanın yakınında bulunma süresi” ölçmeye başlar; kullanıcı başka şey yaparken dakikalar eklenebilir.

Dolayısıyla dashboard'da rakamın adını bile:

Yaklaşık aktif kullanım süresi

yapardım; “çalışma süresi” veya “verimlilik” deme.

Parse.ly'nin beş saniyelik tanımı ile Chartbeat'in focus/interaction yaklaşımının birbirinden farklı olması zaten “engaged time”ın evrensel fiziksel ölçüm değil, ürün tarafından tanımlanmış bir metric olduğunu gösteriyor. 
Parse.ly Help & Support Documentation
+1

Ayrıca metric'i versionla:

metricVersion = 1
idleThreshold = 60s

Sonradan 30 saniyeye geçirirsen geçmiş ile yeni veriyi aynıymış gibi karşılaştırmazsın.

11. KVKK/GDPR açısından aktif kullanım süresi

userId → 14 Ağustos → 2 saat 13 dakika şeklindeki kayıt anonim değildir. Kişiyle ilişkilendirilebildiği için kişisel veri olarak ele alınmalıdır. GDPR'ın lawfulness/transparency, purpose limitation ve minimization ilkeleri ile bir hukuki dayanak gerekir. 
EUR-Lex

KVKK bakımından da kişisel veri işleme şartlarından biri bulunmalı; Kurumun güncel materyali, veri sorumlusunun meşru menfaati için işlemenin ancak ilgili kişinin temel hak ve özgürlüklerine zarar vermemek ve işlemenin zorunlu olması koşuluyla mümkün olduğunu vurguluyor. 
KVKK

Buradaki kritik ayrım:

“Ürün ne kadar kullanılıyor?”

ile

“Ahmet bugün yalnızca 42 dakika çalıştı.”

aynı privacy riski değil.

İkincisi customer organizasyonlarında çalışan gözetimine dönüşebilir. İş ortamındaki izleme için gereklilik, ölçülülük, beklenti ve şeffaflık değerlendirmesi çok daha önemli hale gelir; KVKK'nın işyeri izleme kararları da bu dengeyi vurguluyor. 
KVKK
+1

Consent otomatik çözüm değil

Özellikle employer→employee ilişkisinde “kabul etmezsen sistemi kullanamazsın” tarzı consent özgür irade açısından problemli olabilir. GDPR legitimate-interest yaklaşımında da EDPB üç aşamalı değerlendirme istiyor: legitimate interest, necessity ve kişinin haklarıyla balancing. 
European Data Protection Board
+1

Raw heartbeat yerine daily bucket

Bu çok iyi bir minimizasyon önlemi olur.

Raw kayıt:

10:32 click
10:32 heartbeat
10:33 node edit
10:33 heartbeat
...

yerine:

2026-08-14 → activeSeconds=5210

tutmak:

kişinin tam davranış akışını yeniden oluşturmayı zorlaştırır,

breach etkisini azaltır,

secondary-use imkanını azaltır,

retention/deletion uygulamasını kolaylaştırır.

Ama userId bulunuyorsa hala kişisel veridir, anonim değildir.

12. Kör admin modeli ve audit log

Signal uçtan uca şifreleme ve veri minimizasyonu nedeniyle hukuki taleplerde çoğu kullanıcı verisini veremediğini; bazı tarihsel taleplerde yalnız account creation ve last-connect timestamp'lerini sağlayabildiğini açıkça yayımlıyor. Bu, “elde olmayan veriyi talep üzerine üretemezsin” yaklaşımının gerçek bir örneği. 
Signal Messenger
+1

Fakat Co-Pronoia ile önemli fark var:

Senin “admin kanvas okuyamaz” modelin kriptografik E2EE değilse bunu E2EE gibi pazarlamamalısın.

Sunucunun commit replay, Gemini context oluşturma vb. için içeriği teknik olarak okuyabildiği mimaride bu daha çok:

product/application-level administrative blindness

olur.

Bu da değerli bir özellik; ama threat model'i Signal'dan farklı.

Kötüye kullanım/support modeli

Kalıcı “support person can read everything” yetkisi yerine:

User-driven report bundle

Kullanıcı şikâyet oluştururken belirli node/commit/message'ı bilinçli olarak case'e ekler. Support yalnız gönderilen payload'ı görür.

Temporary support grant

Owner:

Support'a bu canvas için 30 dakika read access ver

der.

time limited

canvas scoped

UI'da görünür

her access audit edilir

otomatik expire olur

Bu privacy duruşuyla çok daha uyumlu.

Audit log şart

OWASP uygulama security event logging'inin her sistemde bulunmasını, auth/authz olaylarının ve hassas işlemlerin audit trail oluşturmasını öneriyor; audit log'un kendisinin de değiştirilmeye/silinmeye karşı korunması gerekiyor. 
OWASP Cheat Sheet Series
+1

Senin Commit tablon:

who changed node X?
what was before/after?

sorusuna çok iyi cevap verir.

Ama şunları cevaplamaz:

Kim API key oluşturdu?
Kim bölge üyeliğini değiştirdi?
Kim aiAllowed'u açtı?
Hangi proposal kim tarafından onaylandı?
Kim export yaptı?
Kim başarısız şekilde yasaklı bölgeye yazmaya çalıştı?
Support access kim tarafından verildi?

Bu nedenle ayrı ControlPlaneAuditEvent gerekir.

Önerilen minimum kayıt:

timestamp
actorType
actorId
sessionId/keyId       // secret değil
eventType
tenantId
canvasId
targetType/targetId
result: allow|deny
reasonCode
origin
proposerId
approverId
policyVersion
commitSeq/proposalId
requestId

Node title/content veya op JSON'unu tekrar audit log'a kopyalama.

Bu model “admin içeriği göremez” duruşunu bozmaz.

Risk sıralaması
#	Risk	Örnek istismar senaryosu	Exploitability	Impact	Skor
1	Supervisor confused deputy / AI provenance kaybı	Yetkisiz agent yasaklı bölge için proposal üretir; supervisor onayı commit'i supervisor authority ile geçirir	3/5	5/5	15 – Yüksek
2	Geniş local redirect allowlist	Attacker-controlled LAN host / hostname callback auth code veya handoff bilgisini alır	3/5	5/5	15 – Yüksek
3	Raw/uzun ömürlü session + yetersiz revoke	Session DB/log/cookie sızıntısı sonrası saldırgan uzun süre kullanıcı olur	3/5	4/5	12 – Yüksek
4	MCP key leakage	Agent key public repo'ya düşer; attacker canvas okur/proposal/claim yapar	3/5	4/5	12 – Yüksek
5	Region boundary semantics belirsizliği	move_node, parentId veya cross-region edge bir deny boundary'sini bypass eder	3/5	4/5	12 – Yüksek
6	Audit log yokluğu	Privileged abuse/key compromise olur fakat kimin ne yaptığı sonradan belirlenemez	3/5	4/5	12 – Yüksek/Orta
7	Choke point future bypass	Yeni worker/import endpoint doğrudan Prisma ile Node/Commit yazar	2/5	5/5	10 – Orta/Yüksek
8	Individual active-time'ın surveillance'a dönüşmesi	Customer manager dakika verisini çalışan performans ölçümünde kullanır	4/5 likelihood	3/5	12 – Privacy/uyum yüksek
9	OAuth state/PKCE cookie Secure değil	HTTP erişimi mümkün hale gelen deployment'ta transaction secret ağdan sızar	2/5	4/5	8 – Orta
10	Authorization TOCTOU	Authority check sonrası region membership/policy değişir, stale karar commit edilir	2/5	4/5	8 – Orta

Buradaki skorlar code exploit kanıtı değil, verdiğin tasarıma dayalı architecture threat-ranking'dir.

Öneriler

Burada S/M/L = uygulama eforu, severity değil.

Efor	Öneri	Yapılmazsa
S	Local callback'i yalnız 127.0.0.1 / [::1] + ephemeral port + fixed/random path yap	Gereksiz LAN/DNS callback saldırı yüzeyi kalır
S	OAuth state/verifier cookie'lerine Secure, HttpOnly, uygun SameSite koy	HTTP/misconfiguration durumunda OAuth transaction secret'ları gereksiz risk taşır
S	origin = human / builtin_ai / mcp_agent bilgisini commit/proposal boyunca koru	aiAllowed supervisor üzerinden bypass edilebilir
S	Proposal'da proposedBy, approval'da approvedBy; ikisini ayrı audit et	Attribution ve confused-deputy analizi zorlaşır
S	Secret-class matrix oluştur	Farklı token türleri zamanla rastgele güvenlik davranışları kazanır
S	MCP key'e unique prefix + high entropy + digest/HMAC + last4 ekle	DB leak/leak scanning/rotation operasyonları zorlaşır
S	move_node, parentId, edge ve delete için authorization semantiğini yazılı invariant yap	Spatial boundary bypass bug'ları çıkması çok muhtemel olur
M	AuthorizedCommitContext capability tipi + restricted module API	Yeni geliştirici choke point'i yanlışlıkla bypass edebilir
M	CI'da core tablolara doğrudan Prisma write yasakla	Type-level koruma cast/raw client ile kolayca aşılır
M	Session listesi + revoke-one/revoke-all + rotation + sensitive action reauth	Çalınan session'a kullanıcı etkili şekilde müdahale edemez
M	Metadata-only control-plane audit log	Incident investigation, customer dispute ve privileged abuse accountability zayıf kalır
M	Daily active-time aggregator; raw beat tutma	Telemetri beklenenden daha ayrıntılı çalışan davranış geçmişine dönüşür
M	Multi-tab dedupe + metricVersion	Aktif süre iki/üç kat sayılır ve eşik değişimleri historikleri bozar
M	Temporary scoped support access + report bundle	Ya support imkânsız hale gelir ya da sonradan broad admin bypass eklenir
M	Authorization/property-based test matrisi	Region/branch/undo/AI gibi yollar büyüdükçe combinatorial auth bug'ları çıkar
L	Secret-scanning provider entegrasyonu / otomatik leak revoke	Büyük kullanıcı tabanında public key leaks manuel yönetilir
L	Tamper-evident/immutable security audit archive	Enterprise incident/compliance gereksinimleri karşısında log güvenilirliğini kanıtlamak zorlaşır
L	Gerektiğinde Zanzibar-benzeri ReBAC/policy engine	Şimdilik gerekmez; ancak resource/region/team modeli çok büyürse custom policy kodu karmaşıklaşabilir

Şu aşamada Zanzibar benzeri ayrı authorization servisi kurmanı önermiyorum. Mevcut ölçeğinde merkezi, saf, iyi test edilen bir policy katmanı + capability-gated commit engine daha mantıklı.

KVKK / GDPR uyum notu — somut kontrol listesi
Aktif kullanım telemetrisi

1. Amacı önceden sabitle.

Örneğin:

“Workspace yöneticilerine ürün benimsemesini ve lisans kullanımını yaklaşık olarak göstermek.”

Sonradan sessizce “çalışan performans değerlendirmesi”ne dönüştürme. GDPR purpose limitation ve KVKK belirli/açık/meşru amaç ilkesi bunu önemli hale getiriyor. 
EUR-Lex
+1

2. Hukuki dayanağı veri akışı bazında belirle.

Meşru menfaat kullanılacaksa necessity + balancing değerlendirmesini belgelemek gerekir; “bizim işimize yarıyor” tek başına yeterli değildir. 
KVKK
+1

3. Aydınlatmayı collection başlamadan yap.

KVKK Madde 10 ve GDPR Article 13 mantığıyla en az:

veri sorumlusu,

hangi kullanım verisinin toplandığı,

amaç,

hukuki sebep,

kimlerin görebildiği,

processors/alıcılar,

yurt dışı aktarım,

saklama süresi/kriteri,

kullanıcı hakları

açıkça belirtilmeli. KVKK kararları aydınlatma amacının muğlak olmamasını ve hukuki sebebin açıkça belirtilmesini özellikle vurguluyor. 
KVKK
+1

4. Raw interaction history tutma.

İhtiyacın dakika ise node ID, mouse coordinate, click sequence ve raw heartbeat tutma.

5. Retention'i teknik olarak enforce et.

Örneğin ürün kararı olarak:

user-level daily buckets: 90 gün
team-level aggregated statistics: 12 ay

gibi bir politika seçilebilir. Bunlar kanunun dayattığı sihirli rakamlar değil; seçtiğin süreyi amaçla gerekçelendirmelisin. KVKK saklama politikasında işleme amacı için gerekli azami sürenin belirlenmesini bekliyor. 
KVKK

6. “Anonim” kelimesini dikkatli kullan.

userId + dailySeconds

pseudonymous olabilir ama anonim değildir.

7. Kullanıcı erişim haklarını düşün.

Admin kişinin aktif süresini görebiliyorsa kişinin kendi verisini görmesi, itiraz/silme taleplerinin nasıl ele alınacağı da tasarıma konmalı.

8. Employee-monitoring risk assessment yap.

B2B müşteri bu veriyi çalışan performansında kullanabilecekse GDPR DPIA/risk assessment ihtimalini ayrıca değerlendirmek güçlü şekilde tavsiye edilir; yoğun ve sistematik kişi izleme riski arttırır. GDPR'ın risk yaklaşımı ve EDPB'nin legitimate-interest rehberi bunun önceden değerlendirilmesini destekliyor. 
EUR-Lex
+1

9. Yurt dışı processors ayrı konu.

Gemini, telemetry infrastructure veya diğer processors Türkiye dışındaysa KVKK'nın güncel yurt dışı aktarım mekanizmaları ayrıca uygulanmalı. Kurumun bu konuda güncel rehberi ve standart sözleşme mekanizmaları bulunuyor. 
KVKK
+1

Audit log için uyum yaklaşımı

Audit log'un privacy-first olması için:

NEEDED:
actor id
event type
resource ids
allow/deny
timestamp
policy version
key/session id
request id


AVOID:
node text
prompt content
canvas content
raw API keys
session secret
email verification codes
unnecessary IP/UA

Audit log da kişiyle ilişkilendiriliyorsa kişisel veridir. Bu nedenle yine purpose, access control ve retention gerektirir.

Ama güvenlik amacıyla gerekli minimum audit kayıtlarını tutmak, “privacy by default” ile çelişmez. NIST de retained security/session records için privacy-risk assessment ve tanımlı retention politikasını öneriyor; OWASP ise security-event application logging'i temel kontrol olarak görüyor. 
NIST Pages
+1

Audit log'a erişim de audit edilmelidir ve logların sonradan değiştirilmesi/silinmesine karşı koruma bulunmalıdır. 
OWASP Cheat Sheet Series

Tavsiye ettiğim nihai yetki modeli

Co-Pronoia için şu zihinsel model mimarinin geri kalanıyla çok iyi oturuyor:

                    Actor identity
                         │
              ┌──────────┴──────────┐
              │                     │
         Authentication          Origin
        user/session/key    human / builtin-ai /
                              mcp-agent
              │                     │
              └──────────┬──────────┘
                         ▼
                Authorization Facts
          ┌──────────────┼───────────────┐
          │              │               │
     canvas role     group/job role   key scope
          │              │               │
          └──────────────┼───────────────┘
                         ▼
                   Intent expansion
                         │
                         ▼
             Exact affected resources
                         │
                         ▼
                 Region authorization
                + aiAllowed/provenance
                         │
                         ▼
               AuthorizedCommitContext
                         │
                         ▼
                Conflict resolution
                         │
            ┌────────────┴─────────────┐
          main                        branch
            │                           │
            └────────────┬──────────────┘

Burada kritik fikir şu:

Authorization'ı endpoint adına değil, expand edilmiş gerçek etkiler + actor + provenance üzerine uygula.

Böylece undo, branch merge, AI, MCP proposal, normal edit gibi farklı üst seviye yolların güvenlik davranışı ayrışmaz.

Açık sorular

Bunlar cevaplanmadan bazı risklerin severity'sini kesinleştirmek mümkün değil:

Supervisor proposal'ı onayladığında commit'in actor'ı bugün gerçekte kim oluyor? Supervisor, proposal owner, API key yoksa service actor mı?

aiAllowed=false, MCP agent proposal'ının bir insan supervisor tarafından kabul edilmesini de engelliyor mu?

move_node authorization'ı eski bölge, yeni bölge veya ikisine karşı mı yapılıyor?

Cross-region add_edge için hangi bölgenin yetkisi gerekiyor?

parentId değişince child node fiziksel olarak aynı yerde kalsa authorization domain'i etkileniyor mu?

Commit engine dışında Node, Edge veya Commit tablolarına Prisma write yapabilen herhangi bir worker/import/admin code path var mı?

Local→cloud el sıkışmasında redirect URI'yi kim seçiyor ve cloud server bu URI'ye herhangi bir HTTP request yapıyor mu?

Redirect'ten local'e dönen şey yalnız one-time code mu, yoksa access/import credential veya doğrudan veri de var mı?

Session ID'leri DB dışında log, backup, error tracing veya observability sistemine düşebiliyor mu?

MCP key ile canvas'ın tamamı okunabiliyor mu? read ile propose ayrı scope mu?

Aktif kullanım süresi workspace yöneticisine kişi bazında mı gösterilecek, yoksa yalnız takım/aggregate görünüm de yeterli olur mu?

Müşterilerin bu süreyi çalışan performansı/değerlendirmesi amacıyla kullanmasına ürün veya sözleşme seviyesinde izin vermeyi düşünüyor musun?

“Admin kanvas içeriğini okuyamaz” garantisi yalnız UI/API policy'si mi, yoksa operasyon ekibi/DB administrator açısından da teknik izolasyon var mı?

Öncelik sırasıyla, ben ilk olarak (1) supervisor authority/provenance, (2) local callback allowlist, (3) region move/edge kuralları, (4) session inventory/revocation, (5) metadata-only audit log konularını kapatırdım. Bunlar çözüldüğünde temel güvenlik mimarin oldukça güçlü ve kendi commit modelinle tutarlı bir hale geliyor.
