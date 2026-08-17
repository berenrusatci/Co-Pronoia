---
tags:
  - log/not
  - rol/duzenleyici-1
rol: duzenleyici-1
model: gpt-5.6-sol
konu: 07-mcp-tehdit-modeli değerlendirme
tur: not
zaman: 2026-08-16T15:54:05
karakter: 7816
ham: false
---

# 07 — MCP dış ajan tehdit modeli değerlendirmesi

Hüküm: 7,5/10 — İki tehdit modelini ve bütün takip sorularını güçlü biçimde yanıtlıyor; ancak 78 eksik/yanlış yol, iki canlı-depo olgu hatası ve proposal CAS açığının atlanması karar kaydı kalitesini düşürüyor.

## Kod-dayalılık

Ham kayıtta 94 satır-numaralı kod atfı sayıldı.
94/94 atfın hedef dosyası canlı depoda bulundu.
16/94 atıf zaten tam ve doğru depo yoluyla yazılmıştı.
78/94 atıf zip düzleştirmesinden kalan eksik ya da yanlış yol taşıyordu.
Yanlış yol örnekleri: `db/prisma/schema.prisma` yerine `server/prisma/schema.prisma` ve `shared/types.ts` yerine `shared/src/types.ts`.
Eksik yol örnekleri: `mcpServer.ts`, `proposalService.ts`, `routes.ts`, `claimService.ts` ve `schemas.ts`.
Bulunamayan, bu nedenle `DOĞRULANAMADI` işareti gereken atıf yoktur.
`server/src/app.ts:82` atfı bir satır eksikti; gerçek Fastify çağrısı 83. satırdadır.
Atıfların satır içerikleri örneklenerek token-minter authority, AI fence, brief write, proposal limitleri, claim semantics ve supervisor araçları sınandı.
Hedefli test sonucu: `server/src/mcp.test.ts` ve `server/src/claim.test.ts`, 2 dosyada 29/29 test geçti.
Testler AI-kapalı proposal reddini, brief'in bütün token'lara açıklığını ve claim conflict'in bloklamayan warning olduğunu ayrıca doğruladı.

## URL denetimi

Tekrarlanan dış anlatımlar birleştirilerek 28 ayrı factual/normative dış iddia sayıldı.
28/28 iddianın ham yanıtta eşlenebilir tam `https://` URL'si ve 16 Ağustos 2026 erişim tarihi vardı.
URL'siz dış iddia sayısı 0'dır; `[URL YOK — karar kaydına giremez]` işareti gereken iddia bulunmadı.
Altı ayrı resmî URL `curl` ile açıldı ve HTTP 200 verdi.
Sınanan kaynaklar MCP versioning, streamable HTTP, tools, authorization security, OWASP LLM01 ve NIST AI 600-1 PDF'dir.
MCP Tools sayfası input validation, access control, rate limiting, human-in-loop ve untrusted annotation iddialarını destekledi.
MCP versioning/transport sayfaları per-request `_meta`, legacy initialize, header eşleşmesi ve `subscriptions/listen` iddialarını destekledi.
Authorization security sayfası short-lived token, audience ve passthrough iddialarını destekledi.
OWASP LLM01 sayfası indirect injection, least privilege ve high-risk human approval iddialarını destekledi.
NIST PDF'de GV-6.1-008 altında sources, timestamps ve metadata provenance ifadesi bulundu.
URL: 28/28, 6 tanesi açılarak sınandı, 6 tanesi iddiayı destekliyor.

## Şemadaki sorular

Soru 1 — MCP güvenlik rehberi/kod eşlemesi: yanıtlanmış.
Normatif MUST/SHOULD ayrımı ile tool poisoning, approval, input, rate, scope, audience, passthrough ve confused deputy ele alınmış.
Eksik kalan yön, kurulu SDK sürümünün canlı depoda aslında bulunabilir olması ve 2026 conformance testinin çalıştırılmamış olmasıdır.
Soru 2 — `update_brief` politika seçimi: yanıtlanmış.
Dört desen karşılaştırılmış, human-approved proposal seçilmiş, provenance/rollback alanları verilmiş.
Soru 3 — proposal kaynak sınırları: yanıtlanmış ama bir olgu kalibrasyonu gerekli.
200 intent ve alan limitleri doğru; “raw byte limiti yok” ifadesi etkin Fastify 1 MiB varsayılanını atlıyor.
Soru 4 — claim fairness: yanıtlanmış.
TTL, renewal, conflict, release, process-local rate ve yarış doğrulanmış; sayısal FIFO MVP verilmiş.
Şiddet ancak düzenleme sonrası doğru: bu authorization/graph-integrity açığı değil, koordinasyon ve kapasite sorunudur.
Soru 5 — OWASP/NIST eşlemesi: yanıtlanmış.
İlgili ve uygulanmayan riskler ayrılmış, madde kimlikleri ve test fikirleri verilmiş.
Bütün NIST madde yorumları tek tek açılmadı; URL örneklemesinde yalnız GV-6.1-008 doğrudan metinle sınandı.
Soru 6 — supervisor compromise/insan eşiği: yanıtlanmış.
Self-approval, region config, role escalation, revoke ve sayısal step-up sinyalleri kodla bağlanmış.
Eksik kalan kritik concurrency kontrolü proposal karar CAS/idempotency'dir.

## En değerli 5 bulgu

1. Agent persona'nın authorization principal olmadığı ve onaylı proposal'ın token minter rolüyle uygulandığı bulgusu Model A/B ayrımının merkezidir.
2. `actor.ai:true` ile `aiAllowed:false` kalkanının proposal onayını da kapsadığı doğrulanmış; kapanmış açık yeniden açılmamıştır.
3. Bütün MCP token'larının canonical brief'i yazıp bütün agent prompt'larını kalıcı etkileyebilmesi somut ve yüksek değerli bir Model B bulgusudur.
4. Proposal'ın 200 intent sınırı olmasına rağmen aggregate/expanded/rate/open-proposal kotalarının eksikliği doğru ayrıştırılmıştır.
5. Claim'in hard lock olmadığı, fairness yarışlarının graph güvenliği değil koordinasyon kalitesi olduğu doğru temel ayrımdır.

## Yanlış ya da şüpheli 3 iddia

1. “Request raw JSON byte limiti yok” ifadesi fazla geniştir.
`server/src/app.ts:82-83` route'a özel limit vermiyor, fakat kurulu Fastify 5.10.0 kaynağı `node_modules/fastify/build/build-validation.js:32` varsayılanı 1 MiB yapıyor.
Gerçek risk sınırsız tek body değil; 1 MiB içinde clone/expand maliyeti ve sınırsız tekrarlı submit/open-row birikimidir.
2. “Bundle'da package manifesti yok, SDK sürümü kesinleştirilemez” canlı depo için yanlıştır.
`server/package.json:23` `^1.29.0` ister; `package-lock.json:1187-1190` ve kurulu paket 1.29.0 gösterir.
Yine de `server/src/mcp.test.ts:50-54` legacy 2025-03-26 test ettiği için 2026-07-28 conformance sonucu çıkarılamaz.
3. Claim starvation'ı güvenlik kontrolü gibi önceliklendirmek şiddet açısından şüphelidir.
`server/src/claimService.ts:7-13`, `:146-178` ve `:214-244` claim'in advisory olduğunu, commit'i bloke etmediğini ve overlap'in warning kaldığını gösterir.
Gerçek sonuç yetki aşımı veya graph bozulması değil; boşa çalışma, düşük throughput ve Model B'de kasıtlı bekletmedir.

## Atlanan açık durumlar

Proposal kararında CAS yoktur: status `server/src/proposalService.ts:243-249` arasında okunur, graph etkisi `:257-270` arasında doğar, final status `:275-289` arasında koşulsuz yazılır.
Eşzamanlı approve/reject veya iki approve, bir main sonuçtan sonra ikinci branch ve son-durum/graph ayrışması üretebilir.
Kabul kriteri 50 paralel karar denemesinde tam bir kazanan, en çok bir graph outcome ve kazananla eşleşen final status olmalıdır.
Genel bir `AuditLog` modeli yoktur; commit/proposal/brief geçmişleri vardır ama security decision audit yerine geçmez.
`.github/workflows/docker.yml` Docker publish eder, test/lint release gate çalıştırmaz; “CI yok” ifadesi test CI'sı bakımından doğrudur.
16 Ağustos notundaki login oran sınırı kapanmıştır: canlı `server/src/authRoutes.ts:20-36` ve `:233-253` bunu gösterir.
Canlı kaynakta parola alt sınırı artık 4 değil 8'dir: `shared/src/types.ts:371`, `server/src/authRoutes.ts:135-136`, `:274-275`.
Bu son iki auth olgusu MCP yanıtının puanını etkilemedi; yalnız sağlanan durum notu ile canlı worktree farkını kaydeder.

## Şiddet kalibrasyonu

Model B delegated-scope açığı yüksek: etki AI-açık canvas ve token-minter rolüyle sınırlıdır, platform geneli değildir.
Brief poisoning yüksek/orta: deterministic schema ve region guard'ı devre dışı bırakmaz, semantik karar bağlamını etkiler.
Supervisor compromise yüksek: AI-kapalı bölgeyi aşamaz; AI-açık graph, region config ve brief üzerinde etkilidir.
Proposal tüketimi orta: etkin 1 MiB body freni vardır, fakat rate/open/expanded-op kotaları eksiktir.
Claim starvation düşük/orta operasyonel risktir; authorization açığı değildir.
Whole-canvas read, yalnız Model B ürün sözleşmesi region/read privacy vaat ediyorsa yüksek gizlilik riskidir.
Tool poisoning bu repo server'ında düşük, multi-MCP host sınırında koşullu risktir.

## Tamamlanma kararı

Bu başlık karar kaydına girecek kadar güçlüdür, fakat güvenli Model B release kararı için bir kısa tur daha gereklidir.
Gerekli tek soru: Proposal approve/reject/update yarışlarında tek-kazanan CAS/idempotency nasıl uygulanacak ve 50 paralel karar testi hangi tek graph sonucunu garanti edecek?
TAMAMLANDI: hayır.
