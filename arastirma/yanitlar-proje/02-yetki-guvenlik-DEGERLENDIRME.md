# Co-Pronoia Yetki/Güvenlik Araştırması — Değerlendirme

## Puan: 7,4/10

Yanıt, 12 sorunun tamamına temas eden, mimariye özgü ve büyük ölçüde gerçek kodla desteklenen güçlü bir araştırmadır.
En başarılı tarafı, genel güvenlik önerilerini projedeki somut yetki, oturum, aktivasyon ve ajan anahtarı akışlarına bağlamasıdır.
Özellikle opsiyonel `actor`, legacy `editor` fallback'i, private-LAN redirect kabulü, ham session bearer'ı ve içeriksiz audit log ihtiyacı doğru önceliklendirilmiştir.
Puanı düşüren ana kusur, kaynakların bağlantı olarak verilmemesidir: metinde “OWASP”, “NIST Pages”, “Figma Help Center”, “EUR-Lex” gibi etiketler var, fakat gerçek URL yoktur.
Bu nedenle “iddia + kaynak (bağlantı, tarih)” çıktı şartı biçimsel ve doğrulanabilirlik bakımından karşılanmamıştır.
Ayrıca gerçek repoda bulunmayan `db/prisma/schema.prisma` yolu tekrar tekrar kullanılmış, kurulu OAuth kütüphanesi sürümü gözden kaçırılmıştır.
Bazı piyasa karşılaştırmaları araştırma derinliğinde değil, iyi bir mimari yorum düzeyinde kalmıştır.

## Kod-dayalılık ve atıf doğruluğu

Kod atıflarının büyük çoğunluğundaki dosya ve satır semantiği gerçek repoyla uyuşuyor.
`server/src/canvasService.ts:109-131` gerçekten doğrudan üyeliğe öncelik veriyor; grup adminini `editor` yapıyor ve `roleDef` yoksa `editor` fallback'i uyguluyor (`:123-124`).
`shared/src/regionGuard.ts:22-29` gerçekten örtüşen bölgelerden aktörün üye olmadığı ilkini engelliyor; dolayısıyla bütün örtüşen bölgelerin üyesi olma sonucu doğru.
Aynı dosyanın `:22-23` satırları koordinatsız düğümü bölge dışında sayıyor; metindeki `:4-11` atfı ise davranıştan çok bunu açıklayan yorum bloğuna işaret ediyor.
`server/src/commitService.ts:15-35` içinde `actor?: Actor` opsiyonel; `:436-442` içinde aktör yoksa veya owner ise region kontrolü gerçekten atlanıyor.
`server/src/canvasService.ts:96-100` seed commit'ini aktörsüz çağırıyor; “undefined hem sistem işi hem unutulmuş aktör olabilir” bulgusu kodla doğrudan doğrulanıyor.
Normal commit/auto-merge/revert/restore/merge yolları `assertRegions`e ulaşıyor; route'lar da `server/src/routes.ts:187-198,273-322` aralığında aktörü geçiriyor.
Proposal onayı `server/src/proposalService.ts:243-265` içinde token yaratıcısının güncel rolünü çözüp onun aktörüyle normal `commit()` çağrısı yapıyor; confused-deputy yorumu sağlam.
Parola ve doğrulama kodu `server/src/auth.ts:8-25` içinde scrypt ile özetleniyor; kod altı haneli.
`server/src/authRoutes.ts:39-46,159-174` gerçekten dört karakter alt sınırı kullanıyor ve parola değişiminde mevcut session'ı bırakıp diğerlerini siliyor.
Login route'unda uygulama içi rate limiter görünmüyor (`server/src/authRoutes.ts:136-143`); repo genelindeki limiter'lar ajan/claim alanında, auth alanında değil.
Session 32 rastgele byte'tan üretilip ham token ile aranıyor (`server/src/auth.ts:46-57`); şemadaki `Session.id` de ham primary key.
MCP anahtarı `tma_` + `nanoid(32)` olarak üretilip SHA-256 ile saklanıyor; revoke ve rotate akışları `server/src/agentRoleService.ts:157-225` içinde gerçekten var.
Aktivasyon allowlist'i `server/src/activationService.ts:339-377` içinde localhost, `.local`, 127/8, RFC1918, link-local ve env istisnasını gerçekten kabul ediyor.
WebSocket heartbeat'i `server/src/app.ts:141-166` içinde 30 saniyelik bağlantı canlılığı ölçüyor; aktif kullanım göstergesi olmadığı yorumu doğru.
Admin canvas listesi yalnız metadata seçiyor (`server/src/adminService.ts:163-185`); Node ve Commit içerikleri ise plaintext olarak `server/prisma/schema.prisma:219-276` içinde bulunuyor.
Şemada `AuditLog`, `activeSeconds`, IP veya user-agent alanı/modeli yok; minimal telemetri ve audit açığı bulguları doğrulanıyor.

## 12 araştırma sorusunun kapsanması

1. **Yüzeysel:** Figma/Notion/Miro/Linear'ın hiyerarşi ve miras yaklaşımı özetlenmiş; Co-Pronoia'nın geometrik kısıtıyla karşılaştırılmış. Ürün başına somut politika örnekleri ve gerçek bağlantılar eksik; confused deputy açıklaması daha çok sonraki bölüme bırakılmış.
2. **Yanıtlanmış:** Choke point'in artıları, opsiyonel aktör zayıflığı, typed principal/capability önerisi ve TypeScript brand'inin tek başına sınır olmadığı iyi anlatılmış.
3. **Yanıtlanmış:** Parola, e-posta kodu, MCP anahtarı ve session için entropy/tehdit modeline göre farklı saklama, rotasyon ve iptal desenleri ayrıştırılmış.
4. **Yanıtlanmış:** Show-once, prefix/public-id, hash-at-rest, scope, expiry, revoke, overlap rotation ve secret scanning ele alınmış; uygulamaya özel format önerilmiş.
5. **Yanıtlanmış:** PKCE'nin saldırganın başlattığı akışta yanlış redirect'i kurtarmadığı doğru açıklanmış; LAN/.local, DNS ve SSRF ayrımı yapılmış.
6. **Yanıtlanmış:** RFC 8252 literal loopback/dinamik port ve RFC 9700 exact matching ilkeleri mevcut yaklaşımla açık biçimde karşılaştırılmış.
7. **Yanıtlanmış:** 30 günlük absolute session nüanslı değerlendirilmiş; inventory, revoke, rotation, step-up ve bildirimden oluşan minimum set verilmiş.
8. **Yanıtlanmış:** Fastify OAuth state-cookie riski, Secure ile `__Host-` ayrımı ve login-CSRF sonucu ele alınmış; ancak kurulu sürüme uygulanabilir seçenek yanlış/eksik doğrulanmış.
9. **Yüzeysel:** Privacy-by-default avantajı ve Plausible örneği verilmiş; ticari sürdürülebilirlik tek örneğe dayanıyor ve doğrulanabilir bağlantılar yok.
10. **Yanıtlanmış:** Visibility + yakın etkileşim, heartbeat, server zamanı, çok sekme dedupe, günlük bucket ve 30/60/180 saniye anlam farkı somutlaştırılmış.
11. **Yanıtlanmış:** Kişisel veri niteliği, amaç/dayanak/aydınlatma/saklama/çalışan izleme ve günlük aggregate'in anonimlik sağlamadığı açıklanmış.
12. **Yanıtlanmış:** UI körlüğü ile kriptografik körlük ayrılmış; support access, şikâyet/yasal talep ve içeriksiz minimum audit event şeması verilmiş.
Özet: 10 soru yanıtlanmış, 2 soru yüzeysel, 0 soru atlanmış.

## En değerli 5 bulgu

1. `actor` opsiyonelliğinin fail-open region bypass üretmesi ve bunun zorunlu `HumanPrincipal | SystemPrincipal` ile kapatılması.
2. `!gm.roleDef => editor` legacy davranışının eksik politikayı yetki yükseltmeye çevirmesi.
3. PKCE'nin attacker-initiated flow'da serbest/LAN redirect'i güvenli yapmaması; aynı makine için literal loopback'e daraltma önerisi.
4. Dört karakter parola alt sınırı ile auth throttling yokluğunun 30 günlük session süresinden daha acil hesap ele geçirme riski olması.
5. Admin UI'nın içerik-kör, veritabanının ise plaintext olması; buna içerik kopyalamayan tamper-evident audit log önerisi.

## Yanlış veya şüpheli 3 iddia

1. **Yanlış dosya yolu:** Yanıt `db/prisma/schema.prisma:33-39,220-276` diyor; gerçek repoda `db/prisma/schema.prisma` yok. Doğru yol `server/prisma/schema.prisma`; satır numaraları burada yaklaşık olarak tutuyor.
2. **Sürüm doğrulanamaz iddiası gerçek repo için yanlış:** `server/package.json:20` `@fastify/oauth2` için `^8.2.0`, kök `package-lock.json` ise kurulu sürümü tam `8.2.0` olarak gösteriyor. “Manifest/lockfile yok” notu yüklenen bundle'a özgü olabilir, fakat gerçek kaynak doğrulamasında geçerli değil.
3. **Tek choke point ifadesi fazla güçlü:** Ana hat graph yazıları `applyCommit()`te birleşse de çakışma dalı `server/src/commitService.ts:300-324` içinde `assertRegions()` sonrası doğrudan `tx.commit.create()` yapıyor. Yani tek bir mutasyon fonksiyonu değil, ortak region guard'ı kullanan en az iki yazma yolu var.
Ek şüphe: önerilen `hostPrefixedCookies: true` seçeneği kurulu `@fastify/oauth2` 8.2.0 kaynak/tiplerinde yok; bu sürüm `cookie: { secure: true, ... }` kabul ediyor. Öneri sürüm yükseltme hedefiyle ve desteklenen gerçek option adıyla verilmeliydi.

## Eksikler

Kaynak etiketleri gerçek Markdown bağlantıları ve erişim/yayın tarihleriyle verilmemiş; bu en büyük teslimat kusuru.
Figma/Notion/Miro/Linear karşılaştırmasında aynı örnek kaynak üzerinde inheritance, explicit deny, external guest, private-team ve yönetici override matrisi yok.
Typed capability önerisi iyi, fakat repodaki tüm `CommitService` çağrı noktalarının derleme zamanı migration planı ve negatif test örneği verilmemiş.
“Tek choke point” iddiası için doğrudan Prisma içerik yazılarını yasaklayan import/dependency rule veya lint kuralı somutlaştırılmamış.
Fastify OAuth önerisi kurulu 8.2.0 API'siyle eşleştirilmemiş; `secure`, cookie adları/prefix koşulları ve upgrade yolu ayrıştırılmalıydı.
Risk tablosu iyi olsa da mevcut kontrol, önkoşul, kalan risk ve kanıt testi sütunları bulunmuyor.
Hukuki bölüm faydalı, ancak hukuki görüş olmadığı sınırı ve veri sorumlusu/veri işleyen rol ayrımı daha açık olmalıydı.

## Somut takip soruları

1. Aynı makine kurulumu ile ayrı LAN appliance kurulumunu ürün düzeyinde iki farklı aktivasyon profiline ayıracak mısınız; her profil için kayıtlı callback/device identity nedir?
2. `actor` zorunlu yapıldığında seed, import, test ve recovery için izin verilen `SystemPrincipal.reason` değerleri hangileri olacak ve bunları hangi modül üretebilecek?
3. Aktif süre yöneticilere kişi bazında mı gösterilecek, yoksa yalnız grup/gün aggregate'i mi olacak; amaç, saklama süresi ve çalışan performans kararlarında kullanım yasağı nedir?

## Sonuç

Yanıt teknik içgörü ve gerçek koda bağlanma bakımından güçlü, kapsam bakımından neredeyse tamdır.
Kaynak URL'lerinin kaybolması, Prisma yolunun yanlış olması, OAuth sürüm/API doğrulamasının eksikliği ve “tek choke point” söyleminin aşırı genellenmesi nedeniyle doğrudan karar kaydı olarak kullanılmadan önce düzeltilmelidir.
