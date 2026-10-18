---
tags:
  - arastirma/yanit
  - kaynak/kod
  - baslik/02
baslik: Yetki, Güvenlik ve Gizlilik
tur: kod
tur_no: 1
kelime: 4315
sohbet: (özel ChatGPT sohbeti)
kaynak: 02-yetki-guvenlik.md
---
> [!abstract] ChatGPT Project yanıtı — Sources'taki gerçek koda `dosya:satır` atıflı
> Sorular: [[02 Yetki, Güvenlik ve Gizlilik - sorular]] · Web sürümü: [[02 Yetki, Güvenlik ve Gizlilik - web]]

Co-Pronoia — Yetki, Kimlik ve Gizlilik Araştırması

Araştırma tarihi: 15 Ağustos 2026.
Kod doğrulama tabanı: yüklediğiniz copronoia-shared / server / web / db / docs bundle’ları. Aşağıdaki kod referansları proje-köküne göre dosya:satır biçimindedir. Bu bölüm bir penetrasyon testi değil; mevcut tasarımınızı gerçek kodla doğrulayıp güncel endüstri uygulamalarıyla karşılaştıran mimari/güvenlik araştırmasıdır.

Yönetici özeti

Co-Pronoia’nın tek commit choke point + katmanlı bölge kontrolü mimarisi güçlü; özellikle normal commit, auto-merge, revert/restore ve supervisor-onaylı proposal’ın aynı doğrulama yoluna dönmesi doğru tasarım.

Ancak güvenlik garantisi şu anda tip sistemiyle zorunlu değil: actor opsiyonel ve actor yoksa region guard atlanıyor. Bunu açık SystemPrincipal + forge edilemeyen AuthorizedMutationContext modeline çevirmek öncelikli.

Grup/iş rolü modeliniz piyasadaki Figma/Notion/Miro/Linear ACL modellerinden daha ince taneli; buna karşılık izin önceliğinin/formal deny semantiğinin belgelenmesi gerekiyor.

Özellikle roleDef olmayan eski grup üyesini editor kabul eden fallback least-privilege açısından kaldırılmalı.

En acil kimlik sorunu 30 günlük session değil; 4 karakterlik parola alt sınırı ve kodda görünür login throttling bulunmaması.

30 günlük absolute session AAL1 sınıfında güncel NIST yaklaşımıyla tek başına anormal değil; fakat session inventory, revoke-all, security-event rotation ve step-up authentication eksik.

MCP anahtarlarının tma_ prefix + show-once + SHA-256 + revoke/rotate modeli genel olarak iyi. Süre sonu ve otomatik secret-leak müdahalesi eklenmeli.

Aktivasyon akışında PKCE doğru kullanılıyor fakat “herhangi bir private/LAN host güvenlidir” varsayımı fazla geniş. Aynı makine senaryosunda literal loopback’e daraltılmalı.

@fastify/oauth2 için yalnız secure:true yeterli çözüm değil; __Host- cookie semantiği ve session-bound one-time state tercih edilmeli.

Mevcut ürün olağanüstü veri-minimal: uygulama şemasında IP/UA/behavior telemetry yok. Bu korunabilir ve pazarlanabilir.

Aktif kullanım için WebSocket bağlantı süresi değil, visible + recent interaction + kısa heartbeat + server dedupe + günlük aggregate kullanılmalı.

Admin UI’nın içeriğe kör olması iyi; fakat şu an bu kriptografik körlük değil. Commit JSON’u veritabanında bulunduğundan DB/altyapı operatörü teknik olarak içeriği okuyabilir.

İçeriği audit log’a kopyalamadan, yönetim/yetki/security olayları için ayrı ve tamper-evident audit log eklenmesi güçlü biçimde önerilir.

KVKK/GDPR bakımından user-linked activeSeconds kişisel veridir; günlük aggregate olması veri minimizasyonu sağlar fakat onu anonim veri yapmaz.

Öncelik sırası: parola/throttling → activation redirect → non-optional principal → audit log → session lifecycle → telemetry.

Bulgular
1. Çok katmanlı yetkilendirme: piyasa nasıl modelliyor?

Figma, Notion, Miro ve Linear’ın ortak yönü, izinleri çoğunlukla resource hierarchy + membership + inheritance + explicit overrides şeklinde modellemeleri.

Figma’da takım/folder/file seviyelerinde miras bulunuyor; alt kaynaklar üst seviyeden erişim miras alabiliyor ve ayrıca daha geniş explicit access verilebiliyor. Bu nedenle “üstten kaldırdım ama kullanıcı hâlâ alt kaynağa erişiyor” gibi inheritance sürprizleri gerçek bir ürün tasarım problemi. 
Figma Help Center
+2
Figma Help Center
+2

Notion’da teamspace/page/subpage hiyerarşisi ve kişi/grup bazlı full access/edit/comment/view düzeyleri kullanılıyor; subpage izinlerinin parent’tan türemesi yine temel mekanizma. 
Notion
+1

Miro’da Space ve board yetkileri üst üste binebiliyor; daha yüksek Space rolü board erişimini etkileyebiliyor. Miro’nun 4 Mayıs 2026 tarihli rol dokümanı ve güncel sharing dokümanları bu katmanlı öncelik yapısını açıkça gösteriyor. 
Miro Help Center
+2
Miro Help Center
+2

Linear da workspace/team/private-team modelini kullanıyor; private team’lerde explicit membership ve yönetici/team-owner ayrıcalıkları var. 
Linear
+1

Co-Pronoia farkı: siz resource hierarchy’nin üzerine geometrik bir ABAC/ReBAC benzeri constraint koyuyorsunuz. Bir kullanıcı editör olsa bile bulunduğu koordinata göre işlem reddedilebiliyor. Bu, yukarıdakilerden daha güçlü ama daha karmaşık.

Kodda mevcut öncelik:

Direct CanvasMember varsa grup erişimini bastırıyor.

Direct membership yoksa approved GroupMember değerlendiriliyor.

Group admin → editor.

Eski üyede roleDef yoksa → editor fallback.

Aksi durumda CanvasRoleAccess, yoksa rolün default access’i değerlendiriliyor.

server/src/canvasService.ts:109-131

Özellikle:

server/src/canvasService.ts:123-131

buradaki !roleDef -> editor davranışı “eksik politika = erişim” anlamına geliyor. OWASP Authorization Cheat Sheet ise deny by default, least privilege ve her istekte authorization kontrolünü öneriyor. 
OWASP Cheat Sheet Series

Mimarinize etkisi

Yetki modelini bir “izinler toplamı” yerine aşağıdaki gibi deny-dominant bir lattice olarak tanımlamanızı öneririm:

canvas ceiling ∩ group/job permission ∩ region permission ∩ AI restriction

Yani alt katmanlar yalnızca erişimi daraltabilsin, yanlışlıkla genişletmesin.

Bir başka önemli gerçek kod semantiği: üst üste binen bölgelerde blockingRegion() aktörün üye olmadığı herhangi bir bölgeyi engelliyor. Dolayısıyla kullanıcı bütün örtüşen bölgelerin üyesi olmak zorunda.

shared/src/regionGuard.ts:22-29

Bu iyi bir güvenli-varsayılan olabilir, fakat ürün sözleşmesinde açıkça belirtilmeli.

Koordinatı bulunmayan mind-map düğümlerinin ise region kontrolüne girmemesi bilinçli davranış:

shared/src/regionGuard.ts:4-11

Bu da açık politika kararı olmalı; aksi halde ileride beklenmedik yetki boşluğuna dönüşür.

2. Tek choke point güçlü mü? Tip sistemiyle nasıl zorlanır?

Mevcut mimarinin en güçlü noktalarından biri gerçekten burada.

Normal commit:

server/src/commitService.ts:228-240

Head ilerlemiş ve ayrık değişiklik auto-merge olduğunda:

server/src/commitService.ts:245-273

Conflict branch oluşturulurken:

server/src/commitService.ts:288-329

Revert/restore:

server/src/commitService.ts:333-356

ve gerçek DB mutasyonu öncesi:

server/src/commitService.ts:431-463

aynı region guard çevresinde toplanıyor.

HTTP tarafında normal commit, built-in AI, revert, restore ve branch merge de aktörü geçiriyor:

server/src/routes.ts:187-198
server/src/routes.ts:225-267
server/src/routes.ts:273-280
server/src/routes.ts:288-295
server/src/routes.ts:317-322

Supervisor proposal’ı da doğrudan tablo yazmıyor, normal commit yoluna dönüyor:

server/src/proposalService.ts:227-270

Bu çok iyi.

Zayıf nokta

CommitOptions.actor opsiyonel:

server/src/commitService.ts:15-19
server/src/commitService.ts:30-35

ve:

server/src/commitService.ts:431-443

içinde kabaca:

TypeScript
if (!actor || actor.role === 'owner') return;

semantiği var.

Dolayısıyla şu anda:

“Bütün bilinen kullanıcı yolları choke point’ten geçiyor”

garantiniz var;

ama:

“Kod tabanı aktörsüz kullanıcı mutasyonu yazılmasını imkânsız kılıyor”

garantiniz yok.

Gerçek bir aktörsüz kullanım da root seed sırasında mevcut:

server/src/canvasService.ts:96-100

Bu kullanım meşru; sorun undefined’ın hem “güvenilir sistem işi” hem “geliştirici aktörü unutmuş” anlamına gelebilmesi.

Daha güçlü desen

TypeScript’te şu yaklaşım uygulanabilir:

TypeScript
type MutationPrincipal =
  | HumanPrincipal
  | SystemPrincipal;


declare const authorized: unique symbol;


interface AuthorizedMutationContext {
  readonly [authorized]: true;
  readonly canvasId: string;
  readonly principal: MutationPrincipal;
}

CommitService.commit() yalnız AuthorizedMutationContext alır.

SystemPrincipal ise örneğin yalnız:

initial_canvas_seed

migration

rebuild_recovery

gibi enumerate edilmiş nedenlerle, ayrı bir internal module tarafından üretilebilir.

Daha da önemlisi, authorized token yetki kontrolünün yerine geçmemeli. Membership/region bilgisi authorize ile commit arasında değişebileceği için canlı politika yine commit transaction’ı içinde yeniden değerlendirilmelidir.

Bu, capability/typestate yaklaşımının uygulama seviyesindeki karşılığıdır: mutasyona erişim, belirli bir yetki nesnesine sahip olmayı gerektirir. Fakat TypeScript’te as ve any ile brand kırılabileceğinden tek başına güvenlik sınırı değildir. Module boundary + private DB mutator + lint/dependency rule + test birlikte kullanılmalı.

Confused-deputy problemi tam olarak daha yetkili bir bileşenin çağıranın bağlamını kaybedip kendi otoritesiyle işlem yapmasıdır. AWS’nin güncel confused-deputy rehberi de otoriteyi beklenen kaynak/context ile bağlama yaklaşımını kullanır. 
AWS Documentation
+1

Co-Pronoia’da güzel bir detay

Supervisor proposal onayladığında commit aktörü supervisor yapılmamış; token’ı oluşturan kullanıcının güncel membership/rolü tekrar çözülüyor:

server/src/proposalService.ts:243-265

Bu confused-deputy açısından iyi bir karar: supervisor’ın yüksek yetkisi proposal sahibine aktarılmıyor.

3. Secret ailelerini farklı saklamak yanlış mı?

Hayır. Secret sınıflarının aynı algoritmayla saklanması gerekmez. Tehdit modeli farklıysa farklı saklama tam tersine doğru olabilir.

Parola

Mevcut:

server/src/auth.ts:8-20

Salted scrypt. Temel yaklaşım doğru fakat parametreler explicit/versioned biçimde saklanmıyor.

OWASP Password Storage Cheat Sheet güncel önerisi Argon2id; bulunmuyorsa scrypt için açık memory/work parametreleri öneriyor. 
OWASP Cheat Sheet Series

Öneri:

$scrypt$v=1$N=...$r=...$p=...$salt$hash

gibi migration yapılabilir bir format.

6 haneli e-posta kodu

Kod:

server/src/auth.ts:23-26

ve hash:

server/src/authRoutes.ts:55-60

6 hane yalnız 1 milyon olasılık taşıdığı için SHA-256 tek başına DB dump alan saldırgana karşı zayıf olur. Slow KDF burada mantıklı.

Ayrıca mevcut:

10 dk TTL

5 başarısız deneme

başarılı olunca silme

iyi:

server/src/authRoutes.ts:75-112

Ancak resend/login/register için uygulama kaynak kodunda ayrı rate limiter görünmüyor.

MCP API anahtarı

server/src/agentRoleService.ts:157-181

anahtar show-once üretiliyor; DB’de SHA-256 tutuluyor:

server/src/agentRoleService.ts:96-102

ve rotate/revoke mevcut:

server/src/agentRoleService.ts:193-249

Bu sınıfta SHA-256 uygun: token yüksek entropili rastgele secret olduğu için offline brute-force pratik problem değildir.

DB-only compromise’a ekstra savunma için SHA-256 yerine server-secret ile HMAC-SHA-256 kullanılabilir ama bu zorunlu bir endüstri standardı değildir.

Session ID

Buradaki tutarsızlık daha problemli.

Session 32 random byte:

server/src/auth.ts:46-51

ama token’ın kendisi DB primary key olarak ham tutuluyor:

db/prisma/schema.prisma:33-39

Yüksek entropy tahmin saldırısını engeller ama DB read = doğrudan çalışan bearer credential demektir.

API key’de kullandığınız prensibi session’a da uygulayabilirsiniz:

cookie = random secret
DB = SHA-256/HMAC(secret)

Böylece salt DB sızıntısı doğrudan session replay’e dönüşmez.

4. Show-once API key standardı

Mevcut MCP key tasarımınızın büyük bölümü iyi:

ayırt edilebilir tma_ prefix,

kriptografik random secret,

show once,

hash-at-rest,

canvas/role scope,

revokedAt,

rotation,

lastUsedAt.

server/src/agentRoleService.ts:157-181,193-249

Eksik ana parça lifetime/leak lifecycle.

GitHub Secret Scanning özel secret formatları için tarama destekliyor; push protection ise credential daha repo’ya girmeden push’u bloke edebiliyor. GitHub’ın partner secret-scanning akışında sağlayıcı, tespit edilen credential’ı compromised kabul edip revoke edebiliyor. 
GitHub Docs
+2
GitHub Docs
+2

GitHub’ın remediation rehberi de secret sızıntısında en önemli adımın secret’ı revoke etmek olduğunu vurgular. 
GitHub Docs

Önerdiğim format örneği:

cpr_mcp_prod_v1_<public-id>_<secret>

Böylece:

GitHub pattern çok düşük false-positive ile eşleşir,

loglarda yalnız public-id tutulabilir,

kullanıcı hangi key’in sızdığını anlayabilir,

secret hiçbir zaman tekrar gösterilmez.

“Her API key mutlaka 90 günde rotate olmalı” diye evrensel bir standart yok. Daha iyi model:

supervisor/high privilege → kısa max lifetime,

normal MCP → configurable expiration,

leak/offboarding → zorunlu anında revoke,

rotation → yeni key üret + kısa overlap + eskisini kapat.

5–6. Activation handshake: PKCE + redirect neden hâlâ tehlikeli?

Burada kodunuzun kendi threat-model yorumu oldukça iyi.

server/src/activationService.ts:323-334

açıkça şu saldırıyı tanımlıyor: saldırgan kendi PKCE verifier’ını bildiği bir flow başlatır, kurbanı approval’a ikna eder, redirect kendisine dönüyorsa kodu alıp persistent instance credential’a çevirebilir.

Bu çok önemli:

PKCE yanlış redirect URI’yi güvenli hale getirmez.

PKCE esas olarak authorization code’u çalan üçüncü tarafın, verifier olmadan kullanmasını engeller. Flow’u başlatan saldırgansa verifier zaten saldırgandadır.

RFC 8252 — OAuth 2.0 for Native Apps, Ekim 2017, BCP 212 — loopback redirect için literal IPv4 127.0.0.1 veya IPv6 [::1] listener ve dinamik port modelini tanımlar. 
rfc-editor.org

RFC 9700 — Best Current Practice for OAuth 2.0 Security, Ocak 2025, BCP 240 — authorization code sızıntısını önlemek için redirect URI matching’i sıkılaştırır ve client tarafında open redirector kullanımından kaçınılmasını ister. Loopback portu gibi açıkça tanımlı istisnalar dışında exact matching esastır. 
rfc-editor.org
+1

Mevcut allowlist

Kod şu hedefleri kabul ediyor:

localhost,

.localhost,

.local,

IPv6 loopback,

tüm 127/8,

RFC1918,

link-local,

ayrıca environment üzerinden ek hostlar.

server/src/activationService.ts:339-377

Bu, arbitrary internet URL’den çok daha iyi; fakat RFC 8252 loopback profili değildir.

192.168.x.y güvenli demek:

“Bu LAN’daki herhangi bir cihaz OAuth callback alıcısı olabilir”

demektir.

Bu fazla geniş.

DNS rebinding?

Literal 127.0.0.1 veya literal private IP DNS’e bağlı değildir, dolayısıyla klasik DNS rebinding doğrudan bu literal adresi değiştiremez.

Ama:

.local adları name-resolution/mDNS trust surface’i açar,

environment ile eklenen DNS hostname’ler rebound/misdirection riskine sahip olabilir,

daha temel problem DNS olmadan da vardır: private LAN’daki host saldırgana ait olabilir.

SSRF?

Bugünkü akışta ana risk SSRF değil.

Kod cloud server’ın callback URL’ye server-side fetch() yapması yerine browser’ı redirect ediyor. Dolayısıyla klasik “sunucu iç ağa HTTP isteği yaptı” SSRF modeli mevcut değil.

İleride server callback hedefini dereference etmeye başlarsa SSRF ayrıca devreye girer.

Önerilen iki profil

Local uygulama aynı bilgisayarda çalışıyorsa:

yalnız literal 127.0.0.1 ve [::1];

listener yalnız loopback interface’e bind;

random ephemeral port;

exact /api/activation/callback;

tek-use code;

kısa TTL;

state + PKCE.

Bu RFC 8252’ye çok daha yakın.

Local aslında ayrı LAN appliance/server ise:

Bunu “loopback OAuth” gibi modellememek daha doğru. Bunun yerine:

device pairing,

bir defalık kısa cihaz kodu veya QR,

cihaz public key/fingerprint,

kullanıcıya onay ekranında cihaz kimliği gösterme,

authorization’ı exact registered device’a bağlama

daha sağlam olur.

Ayrıca local public origin şu an Host/proxy bilgilerinden türeyebiliyor:

server/src/activationRoutes.ts:13-26

Production’da mümkünse configured canonical origin zorunlu olsun.

7. 30 günlük session bugün nerede duruyor?

Burada ilk bakışta beklenebilecekten daha nüanslı bir sonuç var.

NIST SP 800-63B-4 finali 31 Temmuz 2025 tarihinde yayımlandı. AAL1’de overall reauthentication timeout için 30 günü aşmama yönünde SHOULD, inactivity timeout için ise zorunlu bir limit yok. AAL2’de sınırlar çok daha sıkı: yaklaşık 24 saat overall ve 1 saat inactivity. 
NIST Pages
+2
NIST Pages
+2

Dolayısıyla mevcut:

server/src/auth.ts:28-29,46-66

30 günlük absolute session tek başına kötü tasarım değil.

Fakat session modeli:

db/prisma/schema.prisma:33-39

yalnız:

id,

userId,

createdAt,

expiresAt

tutuyor.

lastUsedAt, session/device label, revoke reason vs. yok.

Password change sırasında bütün diğer session’lar siliniyor fakat mevcut session aynen yaşamaya devam ediyor:

server/src/authRoutes.ts:159-174

OWASP Session Management rehberi authentication/privilege değişikliklerinde session identifier regeneration ve idle/absolute/renewal timeout modellerini öneriyor. 
OWASP Cheat Sheet Series

Minimum uygulanabilir session güvenliği

Ben Co-Pronoia için şunları yeterli minimum olarak görürdüm:

/settings/sessions ekranı: oluşturulma, kaba son kullanım, cihaz adı varsa cihaz adı.

Tek session revoke.

“Diğer bütün oturumları kapat”.

Password/email/admin-role değişiminde current session ID dahil rotate.

Agent supervisor token üretme, cloud activation approve, password/email değişimi gibi işlemlerde recent-auth/step-up.

Yeni session oluşturulduğunda e-posta bildirimi.

İstenirse AAL1 kullanımında 30 günlük absolute süre korunabilir.

Şüpheli login ve privacy

IP/UA hiç tutmadan da:

başarısız giriş patlamaları,

kısa sürede çok sayıda session,

revoke sonrası yeniden login,

yeni session yaratılması

izlenebilir.

Ancak “yeni ülke / yeni cihaz / impossible travel” istiyorsanız bir miktar network/device sinyali gerekecek. Privacy duruşunu korumak için bunu analytics’ten ayrı security-only, kısa ömürlü veri deposuna koymak daha doğru.

Kimlikte bundan daha acil bir sorun: parola tabanı

Kod:

server/src/authRoutes.ts:39-46

ve password-change:

server/src/authRoutes.ts:159-164

yalnız 4 karakter istiyor.

NIST SP 800-63B-4, tek faktör olarak kullanılan parolalarda minimum 15 karakter, en az 64 karakterlik maksimum destek ve keyfi composition rule yerine blocklist yaklaşımını öneriyor. 
NIST Pages
+1

Ayrıca login:

server/src/authRoutes.ts:136-143

içinde application-level throttling görünmüyor.

Ingress/WAF seviyesinde ayrıca limiter kullanıyor olabilirsiniz; supplied bundle bunu doğrulamıyor.

Bu nedenle 30 günlük session’dan önce password + brute-force defense’i düzeltirdim.

8. @fastify/oauth2 state cookie ve secure meselesi

Kodda plugin:

server/src/googleAuth.ts:37-56

şeklinde kuruluyor ve explicit cookie hardening görünmüyor.

Burada önemli nüans:

Sorun sadece secure:true geçilmemesi değil.

@fastify/oauth2 güncel upstream dokümanı, OAuth state/verifier cookie’lerinin HTTPOnly ve SameSite=Lax olduğunu; hostPrefixedCookies: true açıldığında __Host- prefix kullanımına geçildiğini ve HTTPS gerektiğini açıklıyor. Upstream ayrıca sibling subdomain’in cookie plant ederek login-CSRF oluşturabildiği senaryoda yalnız Secure bayrağının problemi çözmediğini, __Host- cookie kullanımının savunma sağladığını belirtiyor. 
GitHub

Gerçek geçmiş istismar sınıfı da var: @fastify/oauth2 için CVE-2023-31999 / GHSA-g8x5-p9qc-cf95, 3 Temmuz 2023. <7.2.0 sürümleri static/reused state nedeniyle CSRF’e açıktı; 7.2.0’da per-user cookie yaklaşımına geçildi. 
GitHub

Önemli sınır: yüklenen bundle’da package.json/lockfile olmadığı için sizde yüklü gerçek @fastify/oauth2 sürümünü doğrulayamıyorum.

Öneri:

güncel supported sürüm,

hostPrefixedCookies: true,

HTTPS + HSTS,

callback state’i browser session’a bağlama,

callback’te state’i one-time consume etme.

Bu saldırının tipik sonucu “saldırgan kurbanın Google token’ını çalar” değil; kurbanı saldırganın hesabına login ettiren login-CSRF/account confusion türüdür.

9. Radikal telemetry-minimal duruş sürdürülebilir mi?

Evet.

Kod bunu gerçekten büyük ölçüde uyguluyor:

db/prisma/schema.prisma:33-39

session’da IP/UA yok.

Admin kullanıcı sorgusu:

server/src/adminService.ts:8-57

session sayısı ve lastCommitAt gibi ürün içi bilgilerden özet çıkarıyor; davranış profili toplamıyor.

Uygulama şemasında ayrıca activeSeconds, userAgent, ipAddress veya genel analytics event modeli görünmüyor.

Plausible gibi ticari analytics ürünleri “personal data / cookies / persistent identifiers kullanmadan analytics” pozisyonunu doğrudan ürün avantajı olarak satıyor. Güncel privacy-first ürün açıklaması bunu sürdürüyor; şirket ayrıca 22 Haziran 2022’de bootstrapped, kârlı ve $1M ARR’ye ulaştığını açıklamıştı. Yani ticari sürdürülebilirliğe gerçek örnek var. 
Plausible Analytics
+1

Co-Pronoia için avantaj

“Hiç davranış kaydetmiyoruz” pozisyonundan:

“Yalnız ürünün gerçekten kullanıldığı süreyi günlük toplam olarak tutuyoruz; içerik, tuşlar, ziyaret edilen node’lar, IP ve UA tutulmuyor.”

pozisyonuna geçmek hâlâ güçlü bir privacy-by-default anlatısı olabilir.

Ama “zero tracking” demeye devam etmek doğru olmaz.

GDPR Article 5’in data minimisation, purpose limitation ve storage limitation ilkeleri açısından az veri toplamak önemli yapısal avantaj sağlar. 
EUR-Lex

10. “Aktif kullanım süresi” nasıl ölçülmeli?

Mevcut WebSocket heartbeat’i kullanmayın.

server/src/app.ts:141-167

30 saniyelik ping/pong bağlantının hâlâ canlı olduğunu gösteriyor; kullanıcının uygulamaya baktığını bile göstermez.

Tavsiye edilen tanım

Bir kullanıcı ancak:

document visible
AND
son T saniye içinde meaningful interaction olmuş

ise aktif.

Meaningful interaction:

pointer/touch,

drag,

keydown — tuşun değeri değil,

wheel/scroll,

canvas operation,

editor interaction.

İstemci her 10–15 saniyede, yalnız aktifken heartbeat gönderir.

Server:

browser timestamp’ına güvenmez,

kendi receive-time’ını kullanır,

aynı kullanıcıyı aynı zaman diliminde yalnız bir kez sayar.

Çok sekme

Browser içinde BroadcastChannel veya Web Locks ile bir “leader tab” seçmek gereksiz beat’leri azaltır.

Ama doğruluğun güvenlik sınırı bu olmasın. İki tab split-brain yaşayabilir.

Server tarafında örneğin 15 saniyelik bucket:

(userId, floor(serverTime / 15s))

unique kabul edilirse iki sekmenin aynı süreyi iki kere yazması engellenir.

Saklama

Ham beat’leri kalıcı event log’a çevirmeyin.

Tercihim:

UsageDaily
- userId
- date
- activeSeconds

İhtiyaç varsa workspaceId de eklenebilir.

Ham heartbeat debug için gerekiyorsa çok kısa TTL; normal durumda server topladıktan sonra atabilir.

30 saniye / 60 saniye / 3 dakika

Bunlar aynı metriğin farklı hassasiyetleri değil; farklı kavramlar ölçer.

Parse.ly’nin 24 Eylül 2025 güncel engaged-time dokümanı birkaç saniyelik inactivity sonrası engagement heartbeat’ini kesiyor; bu içerik okuma bağlamında oldukça katı bir “attention” ölçüsü. 
Parse.ly Help & Support Documentation

Google Analytics 4 ise engagement’ı browser focus/app foreground ve session davranışı gibi daha geniş sinyallerle tanımlar; “engaged session” için 10 saniye veya key event / çoklu view gibi kurallar kullanır. 
Google Help

Co-Pronoia gibi planlama aracında:

30 sn: “hands-on interaction”; düşünürken/okurken undercount.

60 sn: iyi başlangıç noktası.

3 dk: daha çok “ekranda/presence”; toplantıda açık bırakılan tabı fazla sayar.

Ben başlangıç metriğini 60 saniye idle threshold olarak seçip adını:

Etkileşimli aktif süre

yapardım.

“Çalışma süresi” demeyin; analitik olarak savunulamayacak kadar güçlü bir iddia olur.

11. KVKK/GDPR açısından active-time

User ID’ye bağlı:

2026-08-15 → 6.240 activeSeconds

kişisel veridir.

Günlük aggregate olması onu anonymous yapmaz; yalnız granulariteyi ve privacy riskini azaltır.

GDPR Article 5 veri minimizasyonu, amaçla sınırlılık ve saklama sınırlılığı getirir; Article 6 geçerli hukuki dayanak gerektirir; Article 13 ise veri toplanırken amaç, hukuki dayanak, alıcılar, saklama ve haklar gibi bilgilerin açıklanmasını ister. GDPR: 27 Nisan 2016, OJ 4 Mayıs 2016. 
EUR-Lex
+1

EDPB’nin Article 25 “Data Protection by Design and by Default” Guidelines 4/2019 final sürümü 20 Ekim 2020 tarihlidir ve minimizasyonun tasarım aşamasına alınmasını destekler. 
European Data Protection Board

KVKK bakımından da aydınlatma yükümlülüğü yalnız rızaya dayalı işlemelerde değil, kişisel veri işlendiği her durumda vardır. Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ 10 Mart 2018’de yayımlandı. 
KVKK
+1

KVKK Kurulunun 18 Şubat 2026 tarihli 2026/347 kararı da aydınlatma ve açık rıza süreçlerinin birbirine karıştırılmaması gerektiğini yeniden vurguluyor. 
KVKK

Önemli sonuç:

Her telemetry için otomatik olarak “açık rıza checkbox’ı” gerekmez. Somut amaca göre sözleşmenin ifası veya meşru menfaat gibi başka dayanaklar değerlendirilebilir; ancak gereklilik/ölçülülük gerçekten gösterilmelidir. KVKK da meşru menfaati temel haklara zarar vermeme şartına bağlar. 
KVKK

Bireysel kullanıcıların performansını veya çalışan verimliliğini ölçmeye dönüştüğünde risk ciddi biçimde yükselir. KVKK’nın 19 Ocak 2023 tarihli 2023/86 kararı da çalışan izleme bağlamında şeffaflık ve ölçülülüğün önemini gösteriyor. 
KVKK

12. Content-blind admin + audit log

Kodda admin canvas listesi gerçekten içerik çekmiyor:

server/src/adminService.ts:163-185

yalnız:

canvas adı,

owner,

group,

member count,

commit count,

createdAt

gibi metadata dönüyor.

Bu iyi.

Ancak buna “kriptografik olarak admin içeriği okuyamaz” dememek gerekir.

Çünkü Commit tablosunda bütün op payload’ı string olarak saklanıyor:

db/prisma/schema.prisma:263-276

ve node tablosunda title, description, notes vb. plaintext:

db/prisma/schema.prisma:220-246

Dolayısıyla:

ürün admin UI’sı content-blind,

normal application admin route’u content-blind,

ama database/infrastructure yetkisi olan operatör teknik olarak içeriği okuyabilir.

Bu ayrım privacy policy’de çok önemli.

Audit log yoksa?

Admin servisinde oldukça yüksek etkili operasyonlar var:

admin role değişimi:
server/src/adminService.ts:60-76

password reset/session invalidation:
server/src/adminService.ts:78-97

kullanıcı/content delete:
server/src/adminService.ts:102-160

Supplied Prisma şemasında bunlar için ayrı bir AuditLog modeli görünmüyor.

OWASP Logging Cheat Sheet authentication, authorization failure, session/security event ve yönetimsel değişikliklerin kaydedilmesini önerirken aynı zamanda gereksiz hassas verinin loglanmaması gerektiğini vurgular. 
OWASP Cheat Sheet Series
+1

Miro’nun 9 Şubat 2026 tarihli enterprise yönetim belgelerinde de security/company admin’lerin audit log görme/export etme yeteneği ayrı bir administrative capability olarak bulunuyor. 
Miro Help Center

Co-Pronoia için minimum audit event

İçerik koymadan:

id
occurredAt
actorType
actorId
action
targetType
targetId
canvasId?
outcome
reasonCode?
requestId

Yazılabilecek event’ler:

login/new session/revoke,

admin grant/revoke,

password reset,

user delete,

group/canvas permission değişimi,

region membership / aiAllowed değişimi,

MCP token create/rotate/revoke,

activation approve/exchange/revoke,

export/import,

support-access grant.

Normal node değişikliklerini audit log’a tekrar kopyalamanıza gerek yok; zaten Commit provenance’ı var.

Risk sıralaması

Skor burada CVSS değil; İstismar Edilebilirlik (E) 1–5 × Etki (I) 1–5 şeklinde mimari önceliklendirme.

#	Risk	İstismar senaryosu	E × I	Seviye
1	4 karakter parola + kaynak kodda görünür login throttling olmaması	Credential stuffing / guessing → 30 günlük geçerli session	5×5=25	Kritik
2	Privileged işlemler için uygulama audit log’unun olmaması	Ele geçirilen/kötü niyetli admin reset/delete/role değiştirir; olayın güvenilir rekonstrüksiyonu zorlaşır	4×4=16	Yüksek kontrol açığı
3	Activation redirect’in tüm private/LAN/.local hedeflerini kabul etmesi	Kurban saldırganın verifier’ıyla başlayan flow’u onaylar; attacker-controlled LAN callback code’u alıp tmi_ üretir	3×5=15	Yüksek
4	Gelecekte kişi bazlı active-time’ın amaç/saklama sınırı olmadan eklenmesi	“Usage analytics” giderek çalışan performans takibine dönüşür	3×4=12	Yüksek privacy/compliance
5	actor? opsiyonel ve yokluğu region bypass anlamına geliyor	Yeni internal caller actor geçmeyi unutur, region authorization sessizce devre dışı kalır	2×5=10	Yüksek tasarım riski
6	roleDef yoksa legacy editor fallback	Eksik/migrate edilmemiş grup rolü yanlışlıkla edit hakkına dönüşür	3×3=9	Orta
7	Ham session bearer DB’de + mevcut session password change sonrası rotate olmuyor	DB read doğrudan session replay sağlar; security event current token’ı değiştirmez	2×4=8	Orta
8	MCP API key expiration/leak automation yok	Unutulmuş/sızdırılmış agent token revoke edilene kadar kullanılabilir	2×4=8	Orta
9	OAuth state cookie’de explicit __Host- hardening yok	Sibling-domain compromise cookie planting → login-CSRF/account confusion	2×3=6	Orta-düşük / koşullu
Öneriler

Buradaki S/M/L mühendislik kapsamını ifade ediyor: S küçük lokal değişiklik, M birkaç bileşenli değişiklik, L ürün/mimari seviyesinde iş.

Boyut	Yapılacak	Yapılmazsa ne olur
S	Parolayı NIST seviyesine çıkar: single-factor için min 15, max ≥64, breached/common-password blocklist; login/register/resend/verify throttling ekle	En kolay account-takeover yolu açık kalır
S	actor?: Actor kaldır; HumanPrincipal | SystemPrincipal zorunlu yap; explicit system reasons kullan	Yeni bir internal caller region guard’ı fark etmeden atlayabilir
S	!roleDef => editor legacy fallback’i migrate edip view veya none yap	Eksik yetki konfigürasyonu privilege grant olmaya devam eder
S	Same-machine activation ise literal 127.0.0.1/[::1] + exact callback; RFC1918/.local genel iznini kaldır	PKCE olsa bile yanlış local recipient authorization code’u alabilir
S	Google OAuth’ta güncel library + hostPrefixedCookies:true + HTTPS/HSTS + session-bound one-use state	Sibling domain vakalarında login-CSRF riski kalır
S	Session DB’de raw token yerine digest/HMAC sakla; password/security değişiminde current session ID’yi rotate et	DB read doğrudan bearer theft’e dönüşür
S	tma_/tmi_ için GitHub secret scanning custom pattern + push protection + leak runbook	Show-once olması repo’ya sızmış key’i kurtarmaz
M	Session management ekranı, revoke-one/revoke-all, coarse last-used, new-login alert ekle	Kullanıcı ele geçirilmiş cihazı göremez/tekil olarak kapatamaz
M	İçeriksiz, append-only/tamper-evident security audit log ekle	Admin abuse, incident response, support ve hukuki süreçlerde delil zayıf olur
M	Authorization policy matrix + property tests: direct/group/region/overlap/revert/restore/merge/proposal/AI	Yetki davranışı ürün büyüdükçe sessizce drift eder
M	Agent token’a optional/max lifetime ve özellikle supervisor token’larında daha kısa lifetime ekle	Forgotten secret’lar yıllarca canlı kalabilir
M	Active-time: 60 sn idle + visibility/input + 10–15 sn heartbeat + server dedupe + günlük aggregate	“Aktif kullanım” yerine açık sekme/presence ölçersiniz
L	Passkey/MFA ve hassas işlemlerde step-up authentication	Parola hesabı ele geçirilince high-impact operasyonların tamamı tek faktöre bağlı kalır
L	LAN deployment gerçekten gerekiyorsa cryptographic device pairing modeli tasarla	“Private IP = güvenilir cihaz” varsayımı mimari borç olarak kalır
L	User-authorized, zaman sınırlı support access + abuse/legal request workflow	Content-blind admin modeli gerçek support/abuse ihtiyacında ad-hoc bypass’larla delinmeye başlar
Uyum notu — KVKK/GDPR için somut minimum
Aktif kullanım telemetrisi

Uygulamadan önce en az şunları belirleyin:

Amaç: örn. “lisans/ürün benimsenmesini ölçmek”. “Belki sonra analiz ederiz” yeterli amaç değildir.

Metric tanımı: “visible tab + son 60 sn içinde kullanıcı girdisi”.

Toplanan veri: yalnız günlük activeSeconds; mouse koordinatı, key value, node title, visited node tutulmadığını açıkça belirtin.

Hukuki dayanak: GDPR Art.6 / KVKK m.5 bakımından amaç özelinde belirleyin; meşru menfaat kullanılacaksa necessity/balancing değerlendirmesini belgeleyin.

Aydınlatma: kullanıcıya verinin amacı, dayanağı, alıcısı, saklaması ve hakları collection başlamadan anlatılmalı. 
EUR-Lex
+1

Admin görünürlüğü: kişinin günlük aktif süresini hangi workspace/admin rollerinin görebildiğini açıkça sınırlayın.

Saklama: kanun tek bir “90 gün” sayısı vermiyor. Ürün tercihi olarak 90 gün identifiable daily data, sonra workspace/month de-identified aggregate iyi bir privacy default olur.

Raw heartbeat: mümkünse hiç kalıcı saklanmasın; gerekiyorsa çok kısa operational TTL.

Employee monitoring: müşteri veriyi personel performans kararlarında kullanabilecekse ayrı risk değerlendirmesi ve daha güçlü şeffaflık gerekir. 
KVKK

DSR/KVKK başvuruları: access/delete/account deletion süreçlerinde UsageDaily dahil edilmeli.

Processor/cross-border: analytics/veritabanı başka sağlayıcıdaysa processor sözleşmeleri ve ilgili aktarım rejimi ayrıca değerlendirilmelidir.

Consent gerekiyorsa, aydınlatma ve rıza metnini tek checkbox/metne birleştirmeyin. 
KVKK

Günlük user-linked aggregate pseudonymized/minimized olabilir ama anonim değildir.

Audit log

Audit log da kişisel veri olduğundan:

yalnız security/accountability amacıyla kullanın;

içerik/op JSON’u loglamayın;

raw password/token/session/cookie kesinlikle loglamayın;

admin/audit-reader erişimini RBAC ile sınırlandırın;

audit log’a erişimi de audit edin;

UPDATE/DELETE’i normal uygulama rolüne kapatın;

retention süresini olay tipine göre belgeleyin;

retention bitince silme/anonymization süreçlerini işletin;

legal hold gerekiyorsa ayrı, kontrollü süreç kullanın.

KVKK’nın 28 Ekim 2017 tarihli silme/yok etme/anonimleştirme düzenlemesinde, silme/yok etme/anonimleştirme işlemlerine ilişkin kayıtların en az üç yıl saklanması öngörülüyor. Bu üç yıllık kuralın “bütün application audit log’ları üç yıl tutulmalı” şeklinde genellenmemesi gerekir. 
KVKK

Admin körlüğünde şikâyet, destek ve yasal talep

Ben mevcut “admin board’u keyfine göre açıp okuyamaz” duruşunu korurdum.

Bunun yerine üç ayrı kanal:

Kötüye kullanım şikâyeti: şikâyetçi, incelemeye izin verdiği node/commit/screenshot/export’u kendisi ekler. Moderatör bütün canvas’ı dolaşmaz.

Destek: kullanıcı açıkça “support access” verir; kapsam canvasId, süre ve mümkünse read-only olarak sınırlandırılır. Yetki otomatik sona erer ve erişimin tamamı audit edilir.

Yasal talep: talebin hukuki geçerliliği doğrulanır, yalnız sistemde gerçekten bulunan ve hukuken gerekli veri korunur/çıkarılır. Bunun için legal-hold prosedürü ayrıca tanımlanır.

Burada pazarlama dili de önemli:

“Ürün yöneticileri normal yönetim arayüzünden canvas içeriğini görüntüleyemez.”

demek mevcut kodla savunulabilir.

“Co-Pronoia hiçbir koşulda kullanıcı içeriğine erişemez.”

demek ise mevcut server-side plaintext/DB mimarisiyle doğru olmaz.

Açık sorular

Üst üste gelen iki region’da kullanıcının ikisinin de üyesi olması zorunluluğu bilinçli ürün kuralı mı? Mevcut kod öyle davranıyor (shared/src/regionGuard.ts:22-29).

Koordinatsız mind-map düğümlerinin region dışında sayılması bilinçli mi?

roleDef olmayan approved group member için editor fallback hâlâ legacy müşteriler açısından gerekli mi?

Agent token yaratıcısı daha sonra gruptan çıkarıldığında mevcut proposal’ların davranışı tam olarak ne olmalı? Kod supervisor approval sırasında creator’ın güncel üyeliğini tekrar kontrol ediyor (server/src/proposalService.ts:243-265).

Proposal’ın gerçek yetki aktörü token creator mı olmalı, supervisor mı, yoksa ikisinin yetkilerinin kesişimi mi? Mevcut kod creator modelini kullanıyor.

“Yerel kurulum” pratikte aynı bilgisayardaki Docker mı, yoksa LAN’daki başka bir cihaz/server mı? Activation tasarımındaki en kritik ayrım bu.

Cloud domain’in bütün sibling subdomain’lerini siz mi kontrol ediyorsunuz?

Supplied bundle’da package manifest/lockfile bulunmadığı için gerçek @fastify/oauth2 sürümü nedir?

Render/reverse proxy/WAF seviyesinde login/register/email-code rate limiting var mı? Kod bunu göstermiyor.

Aktif süre metriğinin ticari amacı “ürün benimsenmesi/seat value” mı, yoksa “hangi çalışan kaç saat çalıştı” mı? İkinci kullanım KVKK/GDPR riskini belirgin biçimde değiştirir.

Enterprise müşteriler için zorunlu retention/audit şartları öngörüyor musunuz?

Content-blind admin ürün ilkesi mi, yoksa ileride user-granted temporary support access kabul edilebilir mi?

Sonuç

Mevcut mimaride yeniden tasarım gerektiren temel bir yetkilendirme problemi görmüyorum; aksine commit-as-authoritative-mutation + common region guard + proposal’ın normal commit yoluna dönmesi oldukça sağlam bir temel. En değerli sonraki adım, bu güvenliği “geliştiricilerin doğru çağrı yapmasına bağlı” olmaktan çıkarıp non-optional principal + deny-by-default policy + typed capability + auditability seviyesine taşımak.

Kimlik tarafında ise öncelikleri ters çevirmemek önemli: 30 günlük session’ı kısaltmak ilk iş değil. Önce 4 karakter password floor, throttling, activation redirect binding ve session lifecycle düzeltilmeli. Privacy tarafında da active-time ölçümü eklenebilir; ancak mevcut minimalizmden fazla vazgeçmeden bunu günlük aggregate seviyesinde tutmanız hem mimari hem KVKK/GDPR hem de ürün konumlandırması açısından en dengeli yaklaşım olur.
