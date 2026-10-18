# (özel ChatGPT sohbeti)/c/6a7f12cf-a738-83eb-bee4-8b26a070d8e8

Edit
Co-Pronoia Yetki, Kimlik ve Gizlilik Araştırması

Araştırma tarihi: 14 Ağustos 2026
Kapsam: copronoia-server, copronoia-db, copronoia-shared, copronoia-web, copronoia-docs kaynak bundle'ları + güncel IETF/NIST/OWASP/KVKK/GDPR kaynakları.

Yönetici özeti

Co-Pronoia'nın commit üzerinden merkezi bölge yetkilendirmesi güçlü bir temel, fakat bugün tam anlamıyla tek yetkilendirme choke point'i değil.

En önemli mimari açık, CommitService içindeki actor alanının opsiyonel olması: aktör yoksa bölge kontrolü fail-open atlanıyor.

Kanvas viewer/editor kontrolü de commit çekirdeğinde değil, çoğunlukla HTTP/ajan/proposal giriş noktalarında; yeni bir iç servis yolu yanlışlıkla bunları aşabilir.

Buna karşılık supervisor önerilerinde orijinal kullanıcının güncel yetkisini yeniden kontrol edip onun kimliğiyle commit etmek confused-deputy açısından çok iyi.

En acil güvenlik sorunu mimariden ziyade kimlik katmanında: 4 karakter parola alt sınırı + login rate-limit yokluğu güncel NIST/OWASP seviyesinin belirgin altında.

30 günlük oturum süresi tek başına anormal değil; NIST AAL1 için 30 gün üst sınırı öneriyor. Asıl eksik session hashing, oturum listesi, revoke/rotation ve gerektiğinde re-auth.

tma_ MCP anahtarlarında göster-bir-kez + SHA-256 + revoke/rotate tasarımı iyi; expiry ve işlem kapsamları eklenmeli.

Aktivasyon akışındaki PKCE-benzeri proof doğru, fakat RFC 8252'nin loopback modelinden daha geniş olan RFC1918/.local callback kabulü gereksiz güven yüzeyi açıyor.

Mevcut aktivasyon callback'i bugün SSRF değil; bulut callback adresini fetch etmiyor, tarayıcıyı yönlendiriyor. DNS rebinding de mevcut akışın ana tehdidi değil.

Uygulamada özel davranış telemetrisi bulunmaması güçlü bir privacy-by-default pozisyonu; ancak commit yazar/zaman bilgileri zaten ürünün doğal bir davranış izi.

Aktif süre eklenecekse ham heartbeat/event log tutmak yerine 60 sn idle + 15–30 sn bounded heartbeat + günlük kullanıcı kovası + multi-tab dedup öneriyorum.

Yönetici içerik-körlüğü korunabilir; fakat audit log olmaması savunulamaz. İçeriksiz, append-only güvenlik denetim kaydı eklenmeli.

1. Çok katmanlı yetkilendirme
Bulgu 1 — Piyasadaki yaygın model “hiyerarşik inheritance + açık override/grant”; asıl tehlike precedence'ın belirsiz kalması

Figma üst seviye ekip/klasör izinlerini alt kaynaklara miras bırakıyor ve belirli dosya/klasörde açık yetkiyle miras alınan yetkiyi değiştirebiliyor. Notion benzer şekilde teamspace → page → subpage mirası uyguluyor ve sayfa düzeyinde özelleştirmeye izin veriyor. Miro tek board'a kullanıcı, space, team/company veya public-link gibi birden fazla erişim kaynağı tanımlıyor. Linear ise workspace/team sınırıyla birlikte private team kullanıyor; ayrıca API anahtarını hem permission hem de team bazında daraltabiliyor. Bunlar 14 Ağustos 2026'da erişilen güncel ürün dokümanlarıdır.

Co-Pronoia da aynı probleme sahip, ancak precedence şu an kod tarafından örtük tanımlanıyor:

Doğrudan CanvasMember varsa grup yetkisi hiç değerlendirilmeden onun rolü dönüyor: server/server/src/canvasService.ts:109-114.

Doğrudan üyelik yoksa grup üyeliği, özel iş rolü ve CanvasRoleAccess devreye giriyor: canvasService.ts:116-131.

Dolayısıyla bir grup rolünde kanvas erişimi none olsa bile kullanıcıda doğrudan CanvasMember kaydı varsa erişmeye devam eder.

Bölge üyeliği de doğrudan RegionMember ile rol bazlı üyeliklerin birleşimi olarak hesaplanıyor: canvasService.ts:226-238.

Bu yanlış olmak zorunda değil. Figma gibi sistemlerde explicit grant'in inheritance'ı aşması olağandır. Sorun, ürün sahibinin "none = explicit deny" diye düşünmesi halinde ortaya çıkar.

Önerilen semantik: bunu resmi bir politika olarak yaz:

owner > direct canvas grant > group-role grant > no access

ve none değerinin deny mı yoksa yalnızca “bu kaynaktan grant yok” mu olduğunu açıkça belirt. Ben Co-Pronoia için none = no grant yaklaşımını tercih ederim; gerçek deny katmanı eklersen çoklu üyeliklerde precedence önemli ölçüde karmaşıklaşır.

OWASP, erişim kararlarının merkezi, deny-by-default ve her giriş yolunda uygulanmasını özellikle vurguluyor.

Confused deputy açısından

Confused deputy, daha yüksek yetkili bir bileşenin kendi yetkisini daha düşük yetkili çağıran adına yanlış kullanmasıdır; klasik sınıflandırması CWE-441'dir.

Co-Pronoia'nın supervisor yolu burada iyi tasarlanmış:

server/server/src/proposalService.ts:243-255 supervisor onay anında token'ı oluşturan gerçek kullanıcının hâlâ kanvas üyesi olup olmadığını ve viewer'a düşüp düşmediğini yeniden kontrol ediyor. Sonra commit'i supervisor'ın yetkisiyle değil:

proposalService.ts:257-265

orijinal creatorId ve onun güncel rolüyle yapıyor.

Bu, “supervisor onay verdi → supervisor'ın tüm yetkisini proposal'a ödünç verdi” tasarımından çok daha güvenli.

Yerleşik AI'da da aynı düşünce görülüyor: aiAllowed=false alanları ayrıca server-side filtreleniyor (server/server/src/agent.ts:491-547) ve commit actor olarak isteği yapan kullanıcıyla uygulanıyor (agent.ts:850-869).

Özellikle test edilmesi gereken yetki hataları

Aynı kullanıcıya direct membership + group role ile çelişkili erişim verilmesi.

Kullanıcının rolü proposal oluşturduktan fakat supervisor onayından önce değiştirilmesi.

Düğümün korumasız bölgeden korunan bölgeye taşınması.

Edge'in yalnız bir endpoint'inin korunan bölgede olması.

Branch oluşturma → rol kaybetme → merge denemesi.

Revert/restore ile bugün erişilemeyen bir bölgenin geçmiş durumuna dokunma.

AI/MCP/export/WS gibi alternatif yolların write veya read sınırlarını genişletmesi.

2. Tek choke point ve tip sistemiyle zorunlu yetkilendirme
Bulgu 2 — Bölge kontrolü merkezi; fakat “tüm yetkilendirme tek choke point'te” iddiası kodda henüz tam doğru değil

Güçlü taraf açık:

CommitService.applyCommit() materialized Node/Edge tablolarına yazmadan hemen önce assertRegions() çağırıyor:

server/server/src/commitService.ts:431-443 — bölge kuralı.

commitService.ts:445-463 — gerçek commit transaction'ı.

commitService.ts:465-496 — Node/Edge materialized write'lar.

commitService.ts:333-355 — revert/restore yine applyCommit().

commitService.ts:196-213 — merge yine applyCommit().

Çatışma sonucu branch'e park edilen özel yol ayrıca assertRegions() çağırıyor: commitService.ts:300-303.

Bu, OWASP'ın merkezi access-control kararları ve bütün hassas yolların aynı politikaya bağlanması tavsiyesiyle güçlü biçimde uyumlu.

Ancak iki boşluk var.

2.1 actor opsiyonel ve eksikliği “system” sayılıyor
commitService.ts:15-19
actor omitted for system paths ... → no region check

ve:

commitService.ts:30-35
actor?: Actor

Ardından:

commitService.ts:439
if (!actor || actor.role === 'owner') return;

Dolayısıyla yeni bir geliştirici şu hatayı yaparsa:

service.commit(ops, { authorId: user.id })

TypeScript hiçbir şey söylemez ve bölge koruması kapanır.

Bu klasik fail-open API tasarımıdır.

2.2 viewer/editor kontrolü commit çekirdeğinde değil

Normal HTTP commit'i önce requireEditor() yapıyor, sonra actor geçiriyor:

server/server/src/routes.ts:78-95,187-209.

Revert/restore/merge de aynı şekilde route seviyesinde korunuyor:

routes.ts:273-327.

Ayrıca bütün canvas HTTP yolları üyelik kontrolünden geçiyor:

server/server/src/app.ts:258-270.

Fakat CommitService.applyCommit() "actor.role === viewer ise reddet" demiyor.

Bugünkü public yollar büyük ölçüde doğru; gelecekte eklenecek internal path'e güveniliyor.

Tavsiye edilen desen: capability/permit tipi

Mutation API'sinin ham userId/role değil, yalnız yetkilendirme modülünün üretebildiği bir nesne kabul etmesi daha güvenli:

export class WritePermit {
  #brand = true;

  private constructor(
    readonly canvasId: string,
    readonly actor: { userId: string; role: 'owner' | 'editor' },
  ) {}

  static async issue(
    prisma: PrismaClient,
    canvasId: string,
    userId: string,
  ): Promise<WritePermit> {
    const role = await memberRole(prisma, canvasId, userId);
    if (role !== 'owner' && role !== 'editor') throw new ForbiddenError();
    return new WritePermit(canvasId, { userId, role });
  }
}

Ardından:

commit(inputs: OpInput[], permit: WritePermit, opts?: CommitMeta)
revert(seq: number, permit: WritePermit)
restore(seq: number, permit: WritePermit)
mergeBranch(id: string, permit: WritePermit)

TypeScript private constructor/private fields ve unique symbol branding gibi mekanizmalarla bu tür nominal-benzeri capability'ler kurulmasına izin veriyor.

Bu tek başına bir güvenlik sınırı değildir; as any ile TypeScript kandırılabilir. Bu yüzden runtime'da da permit.canvasId === this.canvasId, rol ve gerekiyorsa aktör kontrol edilmeli.

Seed/migration için de actorı yok saymak yerine açıkça ayrı:

SystemWritePermit

oluştur. “Actor verilmedi → sistemdir” deseni kaldırılmalı.

3. Sır ailelerinin farklı biçimde saklanması
Bulgu 3 — Farklı sır türlerine farklı hash kullanmak tutarsızlık değil; entropi ve tehdit modeline göre doğrudur

Co-Pronoia şu anda üç farklı model kullanıyor:

Sır	Kod	Mevcut saklama	Değerlendirme
Parola	auth.ts:8-20	scrypt + random salt	Doğru sınıf
6 haneli e-posta kodu	auth.ts:23-26, authRoutes.ts:55-62	scrypt	Mantıklı
Session ID	auth.ts:46-57	256-bit random token ham	Entropi iyi, DB-breach açısından gereksiz risk
MCP tma_	agentRoleService.ts:98-101,157-181	SHA-256	İyi
Instance tmi_	activationService.ts:427-445	SHA-256 bulut tarafında	İyi
Canvas/group invite	schema.prisma:162-169,210-217	ham	İyileştirilmeli
Neden e-posta kodunda scrypt, API anahtarında SHA-256 normal?

6 haneli kod yalnız yaklaşık 20 bitlik bir arama uzayına sahiptir. DB sızarsa hızlı SHA-256 ile bütün 1 milyon aday rahatça denenebilir. Memory-hard parola KDF'si burada anlamlıdır.

Buna karşılık:

tma_ + nanoid(32)

yüksek entropili rastgele sırdır (agentRoleService.ts:172). Saldırganın hash'i görüp bütün uzayı brute-force etmesi gerçekçi değildir. Bu nedenle SHA-256 lookup için kabul edilebilir.

Bir adım daha sertleştirmek istersen:

HMAC-SHA-256(serverPepper, token)

kullanılabilir. Böylece yalnız DB dump alan saldırgan verifier'ı bile çevrimdışı üretemez.

Session için

auth.ts:46-50 32 random byte → hex üretiyor. Entropi gayet güçlü.

Ama Session.id doğrudan bearer değeridir:

db/db/prisma/schema.prisma:33-39.

DB read yetkisi alan biri session tablosundaki değeri doğrudan cookie olarak kullanabilir. Burada da SHA-256/HMAC verifier saklamak, kullanım kolaylığını değiştirmeden blast radius'u azaltır.

E-posta doğrulama

Mevcut:

10 dakika TTL: authRoutes.ts:16-18,61

en fazla 5 yanlış deneme: authRoutes.ts:79-91

resend'de eski kod hash'i değiştirilip TTL yeniden başlatılıyor: authRoutes.ts:117-133

gayet iyi temel.

Ancak resend-code için ayrıca gönderim rate-limit'i eklenmeli; aksi halde e-posta bombardımanı yapılabilir.

Invite'lar

Hem GroupInvite.token hem Invite.token ham primary key ve expiresAt yok:

schema.prisma:162-169,210-217.

Üretimde 24 karakter NanoID kullanılıyor:

server/server/src/canvasService.ts:348
server/server/src/groupService.ts:279.

Entropi problemi değil; problem DB leak + süresiz geçerlilik.

Bunlara:

tokenHash

expiresAt

usedAt veya tek kullanımlılık politikası

revoke timestamp

eklenmeli.

4. Göster-bir-kez MCP API anahtarları
Bulgu 4 — Mevcut tma_ tasarımı iyi bir başlangıç; eksik olan yaşam süresi ve gerçek capability scope

Bugünkü kod:

kolay tanınan prefix: tma_ — agentRoleService.ts:98

32 karakter NanoID — agentRoleService.ts:172

DB'de SHA-256 — agentRoleService.ts:101,174-181

ham sır yalnız mint cevabında — routes.ts:546-562

revoke — agentRoleService.ts:193-203

rotate eski anahtarı anında öldürüyor — agentRoleService.ts:205-225

lastUsedAt en fazla yaklaşık dakikada bir yazılıyor — agentRoleService.ts:230-249

anahtar canvas ve ajan rolleriyle sınırlı — schema.prisma:319-337

Bu endüstri pratiğine oldukça yakın.

Linear'ın güncel modeli de API key'i belirli Read/Write/Admin vb. izinler ve belirli takımlarla sınırlandırabiliyor.

Co-Pronoia'da ise explicit:

read
propose
claim
wait
manage_proposals
supervise

gibi capability bitleri yok.

Ajan rolü persona/iş rolünü temsil ediyor; authentication credential'ının teknik yetkisiyle aynı şey olmamalı.

Önerilen format

Örneğin:

tma_v1_<random>
tmi_v1_<random>

Version/prefix, secret scanner ve gelecekte parser migration açısından değerlidir.

GitHub Secret Scanning custom pattern destekliyor ve Push Protection eşleşen sırların repository'ye girmesini daha push gerçekleşmeden engelleyebiliyor. GitHub ayrıca credential provider'ların secret-scanning partner programına katılmasına imkân veriyor; bulunan sır için normal müdahale credential'ı derhal rotate/revoke etmektir. Güncel GitHub dokümanları, erişim 14 Ağustos 2026.

Co-Pronoia için regex tabanlı custom pattern hemen eklenebilir.

Anahtara eklenmesi gereken alanlar
expiresAt
scopes[]
lastRotatedAt
revokedAt
lastUsedAt

Varsayılan uzun ömür örneğin 30–90 gün olabilir; gerçek otomasyon gerekiyorsa süre ürün ihtiyacına göre daha uzun seçilebilir. Buradaki süre bir mevzuat gereği değil, risk tercihi.

Sızıntı halinde otomatik “yeni sır üretme” yerine otomatik revoke daha güvenlidir. Yeni anahtarın doğru ajana güvenli biçimde ulaştırılması ayrı bir provisioning işlemidir.

5. Activation handshake, PKCE ve redirect URI
Bulgu 5 — Kod tehdit modelini doğru fark etmiş; fakat allowlist RFC 8252'den gereğinden geniş

Kodun kendi yorumu saldırıyı çok doğru tarif ediyor:

server/server/src/activationService.ts:323-334.

Akışı saldırgan başlatırsa verifier saldırgandadır. Eğer saldırgan redirect değerini de kontrol edebiliyorsa:

saldırgan activation başlatır,

kurban gerçek Co-Pronoia cloud ekranında onaylar,

authorization code saldırgan callback'ine gider,

saldırgan zaten verifier'ı bildiği için PKCE-benzeri proof onu engellemez,

tmi_ anahtarını alabilir.

Yani PKCE redirect validation'ın yerine geçmez.

RFC 9700, Ocak 2025 tarihli OAuth 2.0 Security BCP, redirect URI kontrolünde exact matching'i güvenliğin temel parçalarından biri olarak koruyor.

Co-Pronoia bugün ne yapıyor?

İzin verilenler:

activationService.ts:339-362

localhost

*.localhost

*.local

IPv6 loopback

127/8

10/8

172.16/12

192.168/16

169.254/16

CLOUD_ALLOWED_LOCAL_HOSTS

ve activationService.ts:365-378 yalnız:

http: veya https:

userinfo yok

hostname allowlistte mi

kontrol ediyor.

Callback path'i kayıtlı sabit bir URI olarak karşılaştırılmıyor; verilen origin'in sonuna:

/api/activation/callback

ekleniyor (activationService.ts:400-412).

Ayrıca yerel origin sabitlenmediyse Host ve x-forwarded-proto üzerinden üretiliyor:

server/server/src/activationRoutes.ts:13-26.

Bu savunma yeterli mi?

Arbitrary public Internet attacker'a karşı önemli ölçüde işe yarıyor. Saldırgan doğrudan https://evil.example yazamıyor.

Ama bunu “RFC 8252 uyumlu loopback security” diye değerlendirmem.

RFC 8252, Ekim 2017, native-app loopback redirect'lerinde özellikle IP-literal loopback adreslerini öneriyor. localhost kullanımı bile “NOT RECOMMENDED” olarak belirtiliyor; sebebi yanlış interface'e bind olma ve hostname resolution belirsizliğinden kaçınmak.

Dolayısıyla:

127.0.0.1
::1

başka bir güven seviyesi;

192.168.x.x
*.local
custom hostname

başka bir güven seviyesidir.

DNS rebinding / SSRF

Burada önemli bir ayrım var:

Mevcut kod SSRF yapmıyor.

Bulut:

redirectTo = private URL

üretip browser'ı yönlendiriyor. Bulut sunucusu private adrese HTTP isteği göndermiyor.

Bu yüzden klasik cloud → 169.254.169.254 SSRF zinciri bugün yok.

Aynı nedenle DNS rebinding de bu implementasyondaki temel bypass değildir; validator domain'i resolve etmiyor, string hostname sınıfına bakıyor.

Ancak:

*.local,

private-LAN servisleri,

CLOUD_ALLOWED_LOCAL_HOSTS,

ve local Host header'a güvenilmesi

LAN'daki kötü niyetli servis/misconfiguration tehdit yüzeyini büyütür.

Eğer ileride cloud bu callback adresini kendisi fetch etmeye başlarsa durum tamamen değişir ve OWASP'ın SSRF allowlist/DNS pinning tedbirleri gerekir.

6. RFC 8252 sonrası güncel IETF durumu
Bulgu 6 — Aynı makinedeki istemci için loopback; uzak LAN Docker için device/cross-device flow daha temiz

İlgili standart çizgisi:

RFC 8252 — OAuth 2.0 for Native Apps, Ekim 2017: loopback IP literal redirect; localhost önerilmez.

RFC 8628 — OAuth 2.0 Device Authorization Grant, Ağustos 2019: display/input kısıtlı veya farklı cihazda gerçekleşen authorization için standart device flow.

RFC 9700 / BCP 240 — OAuth 2.0 Security Best Current Practice, Ocak 2025: exact redirect validation ve modern OAuth tehdit modeli.

RFC 10027 / BCP 247 — Best Current Practice for Security of Cross-Device Flows, Ağustos 2026: cross-device akışlar için yeni güvenlik BCP'si.

Bu nedenle iki deployment türünü ayırırdım.

Docker/UI aynı makinedeyse

Yalnız:

http://127.0.0.1:<port>/api/activation/callback
http://[::1]:<port>/api/activation/callback

kabul et.

Callback path sabit olsun.

Docker başka LAN cihazındaysa

RFC1918 callback allowlist'ini genişletmek yerine bir device authorization/backchannel polling akışı daha temiz.

Örneğin yerel instance:

random device secret üretir,

cloud'dan kısa ömürlü activation handle alır,

kullanıcı normal cloud URL'sini açıp onaylar,

local instance kendi outbound HTTPS bağlantısıyla sonucu poll eder,

sonuç yalnız ilk device secret ile alınabilir.

Böylece browser'ın LAN adresine geri yönlendirilmesine hiç gerek kalmaz.

Co-Pronoia'nın “yerel Docker başka bilgisayarda olabilir” gereksinimine RFC 8252 native loopback'i zorla genişletmekten daha uygun.

7. Kimlik ve 30 günlük oturum
Bulgu 7 — 30 gün asıl sorun değil; parola ve login abuse koruması daha acil

Co-Pronoia:

server/server/src/auth.ts:28-29

ile 30 günlük süre kullanıyor.

Session:

256 bit CSPRNG — auth.ts:46-47

DB expiry — auth.ts:48-50

HttpOnly — auth.ts:81-88

SameSite=Lax — aynı yer

production'da Secure — auth.ts:68-88

Bu temel kötü değil.

NIST SP 800-63B-4, 1 Ağustos 2025 itibarıyla önceki 800-63-3 sürümünün yerini alan güncel kılavuzdur. AAL1 için overall reauthentication timeout'un 30 günden uzun olmamasını öneriyor; AAL2'de 24 saat ve en fazla yaklaşık 1 saat inactivity önerisi var.

Dolayısıyla “30 günlük session = otomatik kritik zafiyet” sonucu doğru olmaz.

Fakat parola politikası ciddi biçimde geride

Register:

server/server/src/authRoutes.ts:39-47

ve parola değiştirme:

authRoutes.ts:159-174

yalnız 4 karakter istiyor.

Admin reset de aynı:

server/server/src/adminService.ts:81-92.

NIST SP 800-63B-4, single-factor password için minimum 15 karakter istiyor ve yaygın/compromised password blocklist kullanılmasını öngörüyor.

Login yolu:

authRoutes.ts:136-143

üzerinde repository içinde bir rate-limit mekanizması görünmüyor.

OWASP Authentication Failures 2025 de failed-login denemelerinin sınırlandırılması/geciktirilmesi ve brute-force/credential-stuffing sinyallerinin izlenmesini öneriyor.

Bu nedenle bugün öncelik sıram:

4-char password + unlimited login attempts > 30-day session.

Minimum uygulanabilir session seti

Ben şunları eklerdim:

Session DB'de ham token yerine hash/HMAC.

createdAt.

lastSeenAt, ancak her request'te değil örneğin 5–15 dakikalık coarse update.

“Oturumlarım” ekranı.

Tek session revoke.

“Diğer tüm oturumları kapat”.

Password değişiminde session rotation/re-auth.

Admin olma gibi privilege elevation'da yeni session ID.

Hassas işlemlerde yakın zamanda tekrar authentication.

Yeni session açıldığında e-posta bildirimi.

OWASP özellikle authentication/privilege değişimlerinde session ID yenilenmesini ve idle/absolute timeout'ların server-side uygulanmasını öneriyor.

IP/User-Agent tutmadan şüpheli giriş yapılabilir mi?

Kısmen.

Kalıcı IP/UA olmadan:

failed-login rate limiting için kısa ömürlü in-memory/Redis sayaç,

mümkünse IP'nin raw hali yerine günlük dönen anahtarla HMAC edilmiş ephemeral fingerprint,

yeni login e-postası,

hesap başına başarısız deneme frekansı

kullanılabilir.

Fakat “bu cihaz normalde İstanbul'daydı, şimdi başka ülkeden” gibi anomaly detection doğal olarak IP/device sinyali ister. Privacy duruşunu koruyacaksan bunu bilinçli olarak yapmamak tamamen makul bir ürün tercihi.

8. @fastify/oauth2 state cookie ve Secure
Bulgu 8 — Eksik Secure gerçek bir hardening boşluğu; fakat mevcut durumda onu “kolay hesap ele geçirme” diye sınıflandırmam

Google OAuth kurulumu:

server/server/src/googleAuth.ts:37-56

içinde @fastify/oauth2 register edilirken explicit cookie yapılandırması yok.

Güncel @fastify/oauth2 dokümanı v7.2.0'dan itibaren state yönetiminin cookie gerektirdiğini, default cookie'nin HttpOnly ve SameSite=Lax olduğunu ve gerektiğinde:

cookie: {
  secure: true
}

şeklinde override edilmesini gösteriyor.

Bu nedenle production için explicit:

cookie: {
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
}

koyardım.

Repository bundle'ında package.json/lockfile bulunmadığından gerçekte hangi @fastify/oauth2 sürümünün kullanıldığını doğrulayamadım. Bu nedenle bu finding sürüm-koşullu.

Gerçek istismar olmuş mu?

OAuth state yönetimi teorik bir sorun değil. Fastify OAuth2'nin GHSA-g8x5-p9qc-cf95, 3 Temmuz 2023 tarihli gerçek security advisory'si, state'in yeniden kullanılması nedeniyle OAuth CSRF açığını belgeliyor ve çözüm v7.2.0'da per-user state cookie'ye geçmek olmuştu. CVSS 6.1 olarak sınıflandırılmıştı.

Ancak bu advisory Secure flag eksikliğinin kendisi değildir; aynı güvenlik mekanizmasının ne kadar kritik olduğunu gösterir.

Co-Pronoia production ortamında bütün HTTP trafiği HTTPS'e zorlanıyor ve HSTS varsa Secure eksikliğinin pratik exploitability'si düşer. Yine de güvenlik kontrolünü deployment davranışına bırakmak yerine flag'i explicit yapmak daha doğru.

9. Radikal-minimal gizlilik duruşu
Bulgu 9 — Bu duruş ticari olarak yaşayabilir ve farklılaştırıcı olabilir; fakat “hiç davranış verisi yok” ifadesini dikkatli kullan

Kod tabanında ayrı:

audit
telemetry
userAgent
req.ip
activeSeconds

saklama katmanı bulamadım.

Mevcut WebSocket presence tamamen memory üzerinde tutuluyor:

server/server/src/app.ts:136-166.

Ancak admin paneli zaten mevcut ürün verilerinden:

session sayısı,

lastCommitAt

üretiyor:

server/server/src/adminService.ts:8-20,25-57.

Ayrıca commit sisteminin doğası gereği commit'in authorId ve zamanı da kalıcı bir davranış izi.

Dolayısıyla pazarlama ifadesini:

“IP, user-agent, sayfa görüntüleme ve davranışsal event telemetrisi toplamıyoruz.”

şeklinde kurmak,

“Kullanıcı davranışına ilişkin hiçbir veri tutmuyoruz.”

demekten daha doğru.

Ticari örnekler

Plausible Analytics açıkça cookiesiz ve kişisel veri toplamadan analytics sunduğunu söylüyor. Simple Analytics de cookie/visitor identifier/personal profile kullanmayan ücretli bir analytics ürünü olarak aynı privacy-first yaklaşımı ticarileştiriyor.

Signal ise ürün mimarisini retained data'yı minimize edecek biçimde tasarladığını ve hukuki taleplerde çok sınırlı kullanıcı metadatası üretebildiğini açıkça yayınlıyor.

Proton da düzenli transparency report yayımlayarak hem hukuki taleplere uyum hem veri-minimizasyonu yaklaşımının aynı anda var olabileceğini gösteriyor.

Bunlar Co-Pronoia'nın aynı mimari güvenceye sahip olduğu anlamına gelmiyor. Özellikle Co-Pronoia'nın “admin UI içeriği göstermiyor” özelliği zero-access encryption değildir; DB erişimi olan operatörün Node/Commit verisini okuyamayacağına dair kriptografik bir engel yok.

Privacy mesajında bu ayrımı korumak önemli.

10. Aktif kullanım süresi nasıl ölçülmeli?
Bulgu 10 — “Sekme açıktı” yerine “yakın zamanda doğrulanmış insan etkileşimi + görünür sekme” ölçülmeli

Analytics dünyasında “engaged time” için evrensel tek tanım yok.

Parse.ly'nin 24 Eylül 2025 tarihli güncel metodolojisinde yaklaşık 5 saniye hareketsizlikten sonra visitor engaged sayılmayı bırakıyor. Chartbeat ise engaged durumdaki client'lardan yaklaşık 15 saniyede bir ping aldığını ve engaged kavramını okuma/yazma/scrolling gibi aktif etkileşim olarak tanımlıyor.

Co-Pronoia haber sitesi olmadığı için aynı eşikleri kopyalamak doğru değil.

Kanvas üzerinde kullanıcı:

diyagram okuyor,

düşünerek bekliyor,

başka düğümleri inceliyor,

text yazıyor,

node sürüklüyor

olabilir.

Önerdiğim istemci algoritması

active = true yalnız şu koşullarda:

document.visibilityState === "visible"
AND window focused
AND son kullanıcı etkileşiminden beri <= idleThreshold

Etkileşim olarak yalnız ham olmayan sinyalleri kullan:

pointerdown
pointermove/drag sırasında throttled activity
keydown
wheel
touch
canvas mutation
selection/navigation

Hangi tuşa basıldığı, koordinat, node başlığı gibi ayrıntıyı server'a göndermeye gerek yok.

Client yalnız:

{
  "bucket": "2026-08-14",
  "activeDeltaSeconds": 20
}

benzeri bounded delta gönderebilir.

Heartbeat

15–30 saniyelik heartbeat uygundur.

Server:

delta <= heartbeatInterval + tolerance

diye clamp etmeli. Client'ın “bugün 8 saat aktiftim” diye tek request göndermesine güvenme.

Çok sekme

İki koruma birlikte:

Client: BroadcastChannel veya Web Locks ile bir origin'de yalnız leader tab heartbeat gönderir.

Server: aynı (userId, 30-sec time-slot) bir kez sayılır.

Böylece laptopta üç Co-Pronoia sekmesi açılması süreyi üçe katlamaz.

Ham heartbeat saklama

Saklama.

Request geldiği anda:

UsageDaily(userId, date)
activeSeconds += acceptedDelta
lastUpdatedAt = now

yap ve raw beat'i at.

Bu hem privacy hem DB ölçeği açısından daha iyi.

Idle eşiği ne demek?
Idle threshold	Ölçtüğün şey	Yan etki
30 sn	çok sıkı “hands-on interaction”	okuma/düşünme süresini eksik sayar
60 sn	etkileşimli çalışma	Co-Pronoia için en dengeli başlangıç
3 dk	foreground/presence'e yaklaşır	kısa telefon/kahve aralarını aktif sayar

Ben başlangıçta 60 saniye seçerdim.

Admin UI'da da:

“Aktif süre — son etkileşimden sonra 60 sn boşta kalma eşiği”

diye açıkça yazardım.

Aksi halde “2 saat aktif” rakamı bilimsel kesinlik taşıyormuş gibi algılanır.

Daha da iyi ürün seçeneği

Kişi bazında leaderboard yapmak yerine varsayılan:

ekip toplam aktif süre
günlük aktif kullanıcı
aktif gün sayısı

göster.

“Kişi X bugün 7 saat 23 dakika çalıştı” metriği çok kolay biçimde çalışan performansı gözetleme aracına dönüşür. KVKK'nın işyeri izleme kararları amaçla bağlantılılık ve ölçülülük problemlerini açıkça ortaya koyuyor.

11. KVKK/GDPR açısından aktif süre
Bulgu 11 — Günlük aggregate kullanmak önemli bir iyileştirme, fakat userId bağlı kaldığı sürece anonimleştirme değildir

Şu kayıt:

userId = abc
date = 2026-08-14
activeSeconds = 4380

hâlâ belirlenebilir bir kişiyle ilişkili olduğu için kişisel veridir.

“Raw heartbeat'i sildim” demek veriyi otomatik anonim yapmaz.

Ancak çok ciddi bir data-minimization avantajı sağlar:

tam aktivite timeline'ı yok,

“09:13 aktif, 09:14 pasif...” rekonstrüksiyonu yapılamıyor,

breach sonucu daha az ayrıntı çıkıyor,

saklama/DSAR/export işlemleri basitleşiyor.

GDPR altında ilgili kişiye veri işlemenin amacı, veri türleri, alıcıları ve diğer temel unsurlar hakkında önceden bilgi verilmesi gerekiyor; erişim, düzeltme ve şartları oluştuğunda silme gibi haklar da bulunuyor.

KVKK'da Aydınlatma Yükümlülüğü Tebliği 10 Mart 2018 tarihli. Kurum ayrıca aydınlatmanın açık rıza veya başka bir işleme şartı seçilmiş olmasından bağımsız bir yükümlülük olduğunu açıkça belirtiyor.

Özellikle çalışan takibine dönüşürse

Kurul'un 2022/797 sayılı işyeri izleme kararı, hangi verinin hangi amaç ve hangi işleme şartıyla bağlantılı olduğunun açık olması gerektiğini ve işyeri gözetiminde ölçülülüğün önemini gösteriyor.

Bu yüzden B2B üründe iki tarafı ayır:

Co-Pronoia → SaaS veri sorumlusu/veri işleyen rolü sözleşme modeline göre,

müşteri şirket → çalışanlarının isimli kullanım süresini hangi amaçla kullandığını belirleyen taraf.

“Ürün kullanım metriği” diye topladığın veriyi sonradan sessizce “çalışan verimlilik puanı” olarak kullanmak amaç uyumluluğu açısından çok daha zor savunulur.

12. Admin körlüğü ve audit log
Bulgu 12 — İçeriği göstermeyen admin tasarımı korunabilir; audit log olmaması ise ciddi operasyonel güvenlik açığı

Admin API açıklaması bunu bilinçli biçimde doğruluyor:

server/server/src/adminRoutes.ts:20-24

admin yalnız metadata görür, canvas state/commit içeriği endpoint'i yok.

Admin scope da yalnız isAdmin kullanıcıya açılıyor:

server/server/src/app.ts:290-300.

Bu güzel bir ürün sınırı.

Fakat admin şunları yapabiliyor:

kullanıcıya admin yetkisi verme — adminRoutes.ts:92-98

kullanıcı şifresini resetleme — 100-106

session'ları kapatma — 109-112

kullanıcı silme — 114-123

canvas silme — 131-138

üye rollerini değiştirme — 146-168

bütün invite'ları revoke etme — 171-177

grup silme — 185-188

Kod ve Prisma şemasında bu işlemleri kalıcı biçimde kaydeden uygulama seviyesinde bir AuditLog modeli bulunmuyor.

OWASP, yüksek değerli işlemlerin integrity kontrollü audit trail'e sahip olmasını ve security event'lerin öncesi/sonrasının loglanmasını öneriyor. Secrets Management rehberi de credential lifecycle ve yönetim işlemlerinin audit edilmesini özellikle vurguluyor.

İçeriği görmeden destek nasıl yapılır?

Destek akışını:

metadata ve sistem sağlık bilgileri,

kullanıcı tarafından açıkça paylaşılan diagnostics bundle,

gerektiğinde kullanıcı kontrollü geçici support grant

olarak tasarla.

Normal admin'e gizlice “canvas içeriğini aç” butonu ekleme.

Abuse complaint

İki seviye yapılabilir:

Metadata investigation: hesap/kanvas kimliği, üyelikler, oluşturma/silme zamanları, token/audit olayları.

Content complaint: şikâyetçinin kendisinin raporladığı node/commit snapshot veya açık support grant.

Bu, uygulamanın rutin olarak kullanıcı içeriğini taramasını gerektirmez.

Legal request

Sistem elinde hangi veri varsa mevzuata uygun hukuki süreç kapsamında yalnız onu üretir.

Privacy-by-design ürünlerde “bizde yok” gerçekten bir cevaptır; Signal ve Proton gibi sistemler veri minimizasyonunu tam da hukuki taleplerde üretilebilecek veri miktarını azaltan teknik özellik olarak kullanıyor.

Ancak Co-Pronoia içeriği DB'de plaintext saklıyorsa:

“Yöneticimizin UI'da erişimi yok”

ile:

“Şirket teknik olarak içeriğe erişemiyor”

aynı iddia değildir.

Pazarlamada mutlaka ayır.

Minimum AuditLog

Ben şunu tutardım:

id
timestamp
actorType       user | admin | agent | system
actorId
action
targetType
targetId
canvasId?
groupId?
result           success | denied | failed
requestId
source           web | mcp | agent | admin | activation
reasonCode?
policyVersion?

Tutma:

node title/body,

prompt,

email verification code,

session token,

API key,

full IP/UA

yok.

Audit tablosu append-only olmalı; delete/update normal application rolüne kapalı olmalı.

Risk sıralaması

Skor: İstismar edilebilirlik (1–5) × Etki (1–5).

#	Risk	İstismar senaryosu	E × I	Seviye
1	4 karakter parola + login throttling yok	Remote attacker zayıf parolaları/credential stuffing listelerini yüksek hızda dener; başarılı giriş tüm kullanıcının eriştiği kanvasları açar. authRoutes.ts:39-46,136-143	5×5=25	Kritik
2	Admin audit log yok	Ele geçirilmiş/kötü niyetli admin parola resetler, kullanıcı/canvas siler veya rol değiştirir; sonradan kim/ne zaman yaptı güvenilir biçimde belirlenemez. adminRoutes.ts:92-188	4×4=16	Yüksek
3	actor?: Actor fail-open mutation API	Yeni internal path actor geçirmeden commit/revert/merge çağırır; bölge guard'ı tamamen atlanır. commitService.ts:15-35,436-455	3×5=15	Yüksek
4	Aktivasyon callback trust alanı geniş	Attacker-initiated PKCE-benzeri akışta attacker verifier'ı bilir; kurbanın browser'ını saldırganın kontrol edebildiği izinli LAN/local callback'e yönlendirebilirse tmi_ alabilir. activationService.ts:323-412	3×4=12	Orta-yüksek
5	Ham session token DB'de + 30 gün bearer	Session tablosu read leak'i doğrudan replay edilebilir cookie verir; session başına revoke/device görünürlüğü yok. auth.ts:46-57, schema.prisma:33-39	3×4=12	Orta-yüksek
6	MCP token expiry/technical scope yok	Bir tma_ sızıntısı revoke edilene kadar aynı canvas üzerinde agent yüzeyine erişir; commit doğrudan yapılamaması ve supervisor modeli etkiyi azaltır. schema.prisma:319-337	3×3=9	Orta
7	Raw ve süresiz invite token	Eski invite DB/backuplardan sızarsa sahibi revoke edene kadar üyelik kazanmak için kullanılabilir. schema.prisma:162-169,210-217	3×3=9	Orta
8	OAuth state cookie için explicit Secure yok	OAuth start HTTP üzerinden erişilebiliyorsa state cookie transport seviyesinde açığa çıkabilir/manipüle edilebilir; strict HTTPS/HSTS pratik riski düşürür. googleAuth.ts:47-56	2×4=8	Orta-düşük
9	Verification resend throttling yok	Bir adres için sürekli doğrulama e-postası üretilerek abuse/mail maliyeti yaratılır. authRoutes.ts:115-134	3×2=6	Düşük-orta
Öneriler

Burada S/M/L geliştirme boyutunu, güvenlik önceliğinden ayrı kullanıyorum.

Öncelik	Boyut	Yapılacak	Yapılmazsa ne olur?
P0	S	Parola alt sınırını single-factor hesaplarda ≥15 yap; leaked/common password blocklist ekle.	En kolay account-takeover yolu açık kalır.
P0	S/M	Login, verify ve resend için account + kısa ömürlü network kaynaklı rate-limit.	Credential stuffing/brute force ve mail abuse ölçeklenebilir.
P0	M	actor? modelini kaldır; bütün mutation'lar WritePermit gerektirsin.	Yeni bir servis endpoint'i tek satırla bütün bölge politikasını yanlışlıkla bypass edebilir.
P1	S	Production Google OAuth state cookie için secure:true açıkça ver; HSTS'i zorunlu tut.	Deployment değişikliğinde state cookie plaintext HTTP'ye düşebilir.
P1	S/M	Session DB verifier'ını SHA-256 veya tercihen HMAC-SHA-256 yap.	DB read leak'i aktif session'ları doğrudan bearer credential olarak verir.
P1	M	Session listesi + revoke-one/all + coarse lastSeenAt + privilege-change rotation.	Çalınan session'ı kullanıcı fark edemez ve cihaz bazında iptal edemez.
P1	M	Append-only security AuditLog ekle.	Admin/token/rol olaylarında forensic attribution yapılamaz.
P1	S	AgentToken.expiresAt + explicit technical scopes ekle.	Unutulan agent credential gereğinden geniş ve süresiz kalır.
P1	S	tma_v1_/tmi_v1_ secret scanning pattern + GitHub Push Protection.	Anahtarlar source code'a girdikten sonra ancak sonradan fark edilir.
P1	S/M	Invite token'ları hashle, expiry ve one-use/revoke semantiği koy.	Eski davetler backup/DB leak'lerinde uzun ömürlü capability olur.
P1	M	Same-machine activation'da yalnız IP-literal loopback + sabit callback path.	RFC1918/.local güven alanı gereksiz biçimde korunmaya devam eder.
P2	L	Remote-LAN Docker activation'ı RFC 8628/10027 tarzı device/backchannel modele taşı.	Browser→LAN redirect'inin karmaşık güven modeli uzun vadede kalır.
P2	M	Günlük active-time aggregate + 60s idle + multi-tab dedup.	“Aktif süre” sekme açık süresine dönüşür ve hem yanlış hem privacy açısından pahalı olur.
P2	L	Passkey/MFA ve risk-temelli auth ekle.	Password compromise tek faktör olarak kalır.
P3	L	Audit log'u ayrı append-only/tamper-evident storage'a taşı.	DB-admin seviyesindeki saldırgan ana audit kaydını değiştirebilir.
KVKK/GDPR uyum notu
Aktif süre telemetrisi için somut gereklilikler

Amaç: “ürün kullanım/adoption metriği”, “lisans ölçümü”, “güvenlik” veya “çalışan performansı” birbirinden ayrılmalı. Aynı günlük activeSeconds verisini sonradan farklı amaçta sessizce kullanmamalısın.

Hukuki dayanak: KVKK m.5 / GDPR Art.6 kapsamındaki gerçek işleme dayanağı belirlenmeli. “Aydınlatma metninde var” tek başına hukuki dayanak değildir.

Aydınlatma: en az veri kategorisi, amaç, toplama yöntemi, hukuki sebep, alıcı/aktarım kategorileri, saklama yaklaşımı ve ilgili kişi hakları açıklanmalı. KVKK aydınlatması işleme başlamadan ve seçilen işleme şartından bağımsız olarak gerekir.

Minimizasyon: raw mouse/keyboard event'leri, node isimleri, URL history, IP/UA gibi alanlar aktif süreyi üretmek için gerekmiyorsa toplanmamalı.

Aggregation: raw heartbeat anında günlük aggregate'e dönüştürülüp atılmalı. Bu minimizasyondur; kullanıcıya bağlı olduğu sürece anonimleştirme değildir.

Saklama süresi: net ve otomatik uygulanmalı. Örneğin ürün kararı olarak kişi-level kullanımın 90 gün, daha eski istatistiğin yalnız ekip-level aggregate tutulması güçlü bir başlangıç olabilir. Bu sayılar yasal zorunluluk değil, minimizasyon önerisidir.

İmha: işleme sebebi ortadan kalktığında KVKK'nın silme/yok etme/anonimleştirme rejimi uygulanmalı. Saklama-imha politikası kapsamındakiler için periyodik imha aralığı altı ayı geçemez; politika hazırlama yükümlülüğü olmayanlarda yükümlülük doğduktan sonraki üç aylık kural ayrıca düzenlenmiştir. Yönetmelik 28 Ekim 2017 tarihlidir.

Access control: isimli active-time yalnız gerçekten ihtiyacı olan yönetici/owner rollerine görünmeli; bu verinin admin tarafından görüntülenmesi de audit edilebilir olmalı.

İlgili kişi hakları: erişim/export, düzeltme ve uygulanabilir hallerde silme/itiraz süreçlerine dahil edilmeli. GDPR hakları ve talepleri buna açıkça uygulanır.

Çalışan izleme değerlendirmesi: müşteri kuruluş bunu personel performansında kullanacaksa ölçülülük ve çalışan gözetimi riski ayrıca değerlendirilmeli. Geniş ölçekli/sistematik izleme senaryolarında GDPR DPIA gerekip gerekmediği launch öncesi değerlendirilmelidir.

Yurt dışı aktarım: telemetry/audit altyapısı Türkiye dışındaysa güncel KVKK m.9 rejimi uygulanmalı. 2024 değişiklikleri sonrasında standart sözleşmeler ve bağlayıcı şirket kuralları uygun güvence mekanizmaları arasında yer alıyor. GDPR kapsamındaki üçüncü ülke transferleri için de ilgili aktarım mekanizması gerekir; Avrupa Komisyonu SCC'leri bu mekanizmalardan biri olarak tanımlıyor.

Audit log için

Audit log da kişisel veridir çünkü actorId + timestamp + action bir kişiyi tanımlar.

Ancak güvenlik/hesap verebilirlik amacı davranış analytics'inden farklıdır; daha uzun retention savunulabilir.

Minimum prensip:

content yok
secret yok
raw request body yok
IP/UA varsayılan yok
actor/action/target/result/time var

Retention'ı tehdit modeli, sözleşme ve hukuki ihtiyaçla belgeli biçimde seç. Örneğin 12 aylık operasyonel audit window ürün politikası olarak makul bir başlangıç olabilir; bunu “KVKK 12 ay ister” şeklinde sunmamak gerekir.

Security audit verisine erişen admin'lerin kendisi de audit edilmeli.

Özellikle iyi yapılmış mevcut kararlar

Kod incelemesinde birkaç kararın korunmasını öneriyorum:

Materialized graph write'larının commit transaction'ında yapılması ve DB-level FOR UPDATE seq kilidi: commitService.ts:379-389.

Replay/materialized-state rebuildCheck() oracle'ı: commitService.ts:506-514.

Bölge kontrolünün route'a değil commit katmanına yakın konması: commitService.ts:431-463.

Conflict branch'e inerken de region kontrolünün ayrıca yapılması: commitService.ts:300-303.

Supervisor'ın kendi yetkisini proposal'a ödünç vermemesi: proposalService.ts:243-265.

Built-in AI'da aiAllowed için modelden bağımsız server filtresi: agent.ts:491-547.

MCP token'ın ham halinin yalnız ilk response/rotate sırasında gösterilmesi: routes.ts:546-578, agentRoleService.ts:157-225.

Production session cookie'de HttpOnly/SameSite/Secure yaklaşımı: auth.ts:68-88.

Admin API'de state/commit içeriğinin bilinçli olarak sunulmaması: adminRoutes.ts:20-24.

Local build'da auth modülünün bundle'dan kaldırılmasına yönelik build-time kapı: app.ts:244-253.

Bunlar yeniden tasarımda kaybedilmemesi gereken güçlü özellikler.

Açık sorular

none gerçek deny mı? Bir kullanıcı direct CanvasMember=editor, group role=none ise hangi izin kazanmalı? Kod bugün direct üyeliği kazandırıyor.

System mutation gerçekten production'da gerekli mi? actor verilmeden yapılan seed/test dışı mutation var mı? Yoksa optional actor tamamen kaldırılabilir.

Region configuration'ın kendisi audit/commit history'ye girmeli mi? Region sınırı veya üyeliği değiştiğinde geçmiş graph commit'lerinin yetki bağlamı değişebiliyor.

Admin “körlüğü” ürün taahhüdü mü, yalnız UI özelliği mi? Eğer pazarlama iddiası olacaksa DBA/operator erişimi ve encryption modeli ayrıca tanımlanmalı.

Remote Docker temel kullanım senaryosu mu? Çoğu kurulum aynı makinede olacaksa RFC1918 callback desteğini kaldırmak kolay. NAS/homelab temel senaryoysa device-flow daha önemli.

MCP anahtarı gerçekten insan kullanıcının delegation'ı mı yoksa bağımsız service identity mi? Offboarding/expiry politikası buna göre değişmeli.

Agent role persona ile authorization scope ayrılacak mı? Bence ayrılmalı; “Backend Engineer” persona'sı ile proposal:create capability'si aynı kavram değil.

İsimli active-time ne amaçla kullanılacak? Ürün adoption ölçmekle çalışan performansı ölçmek hukuken ve etik olarak farklı ürünlerdir.

Aktif süre müşterinin adminine mi, site adminine mi görünecek? Site adminine isimli kullanım vermek mevcut “admin körlüğü” duruşunu önemli ölçüde zayıflatır.

Audit retention için müşteri/sözleşme beklentisi nedir? Enterprise hedefleniyorsa bunu erken sabitlemek veri modeli ve export API'sini etkiler.

Google OAuth dependency sürümü nedir? Sağlanan source bundle'da package manifest/lockfile bulunmadığı için @fastify/oauth2 sürümünü doğrulayamıyorum. Secure ve 2023 advisory değerlendirmesi için deployed sürüm ayrıca doğrulanmalı.

Son değerlendirme

Co-Pronoia'nın authorization mimarisini sıfırdan değiştirmezdim. Commit-as-authority boundary + region guard + original-principal AI/proposal modeli doğru yön. En büyük mimari iyileştirme, bu yaklaşımın bugün “konvansiyonla uyulan” kısımlarını derleyicinin ve API tasarımının zorunlu tuttuğu capability modeline çevirmek.

Öncelik sıram net olarak:

(1) parola/rate-limit → (2) mandatory WritePermit → (3) audit log → (4) hashed/manageable sessions → (5) agent/invite credential lifecycle → (6) activation flow'u loopback/device-flow olarak ikiye ayırmak → (7) privacy-preserving active-time.

Bu yapıldığında sistemin özellikle AI ve MCP gibi yeni write yolları eklenirken yetki politikasının sessizce delinmesine karşı dayanıklılığı ciddi biçimde artar.
