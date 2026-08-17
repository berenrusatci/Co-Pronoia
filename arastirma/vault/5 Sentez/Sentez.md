---
tags:
  - arastirma/sentez
tur: sentez
---
# Co-Pronoia Araştırması — Nihai Sentez

Tarih: 15 Ağustos 2026 · Yazan: düzenleyici turu · Girdi: 5 başlık × 2 kanal (web-kaynaklı
standalone + koda atıflı proje turu), 2 başlıkta ikinci tur, 5 değerlendirme dosyası.
Bu belgedeki her iddia ham yanıttan alınmadı; kaynak kod okunarak yeniden sınandı — kanıtlar
`yanitlar-proje/DOGRULAMA-RAPORU.md` içinde uzun hâliyle duruyor.

Karantina: `05-dagitim-tur2*.GECERSIZ` sahte ikinci turdur (birinci turun birebir kopyası),
kaynak sayılmadı. 05 başlığı bu sentezde tek turluk kanıtla temsil ediliyor.

---

## Yönetici özeti

Co-Pronoia'nın çekirdeği araştırmanın beklediğinden **sağlam** çıktı. Olay kaynaklı model
tutarlı: main yazıları tek bir `applyCommit` üzerinden, dal inişi ayrı ama aynı bölge guard'ını
çağıran ikinci yol üzerinden geçiyor; `rebuildCheck` gerçek bir oracle; `nextSeq` satır kilidi çok
süreçli güvenliği fiilen kuruyor. Araştırmanın "kritik" diye pazarladığı çekirdek riskler
ölçüldüğünde küçüldü: çift-merge zararsız no-op çıktı, düşen `move_node`'lar kullanıcıya
bildiriliyor, `services` kayıt defteri "sızıntısı" kanvas başına birkaç yüz bayt.

Gerçek açık başka yerde ve tek: **`/api/auth/login` üzerinde hiç oran sınırı yok, parola alt
sınırı 4 karakter.** Proje kısıtlama desenini biliyor (e-posta kodunda 5 deneme, ajanda 8/dk,
claim'de 30/dk) ama girişe uygulamamış. Bu, doğrulanan bulgular içinde tek kimlik-ele-geçirme
sınıfı bulgudur ve tek başına diğer hepsinden ağırdır.

İkinci ağırlık merkezi ajan yüzeyi: MCP önerileri `aiAllowed:false` bölgelerine dokunabiliyor
(filtre yalnız yerleşik Gemini yolunda), `update_brief` bütün ajanlara açık ve brifing her ajanın
prompt'una giriyor. Bunlar "dış MCP ajanlarına ne kadar güveniyoruz" sorusunun cevabına bağlı;
tek kişilik/güvenilir kurulumda düşük, çok taraflı kurulumda yüksek.

Üçüncü küme dayanıklılık: WS yeniden bağlanmada catch-up yok ve bekleyen değişiklikler yalnız
RAM'de. İkisi de veri bütünlüğünü bozmuyor, ikisi de kullanıcı emeği kaybettiriyor, ikisi de ucuz.

Yönetimsel denetim kaydının hiç olmaması bir "açık" değil ama `CLAUDE.md`'deki bilinçli
"admin içeriği okuyamaz" duruşuyla birleşince operasyonel çıkmaz üretiyor.

Araştırmanın kendi kalitesi: kod okuma tarafı güçlü (atıflar tutuyor), dış kaynak tarafı zayıf —
neredeyse hiç gerçek URL yok. Ayrıntı aşağıda.

---

## Başlıklar arası çelişkiler

**1. CRDT'ye geçiş ↔ ürün vaadi (01 ↔ 04).**
04 (frontend) aynı düğümde eşzamanlı metin düzenleme için CRDT/OT öneriyor; 01 (çekirdek) CRDT'nin
"numaralı commit + yazar + inceleme" vaadini koruyamadığını, canonical kabul sırasını ve onay
semantiğini ayrıca kurmak gerektiğini söylüyor. **Çözüm:** çelişki görünürde; ikisi de melez modeli
işaret ediyor — graf yapısı commit tabanlı kalır, yalnız uzun serbest metin alanları (`description`,
`notes`) CRDT olur. 04'ün "Figma'nın modeline yakın" benzetmesi fazla güçlü, 01'in uyarısı geçerli.
Karar: melez, ve yalnız ölçülmüş bir kullanıcı acısı varsa.

**2. Telemetri ↔ gizlilik duruşu (02 içi, D1 ↔ D2).**
Aynı başlık hem "davranışsal veri sıfır, bu savunulabilir bir duruş" hem "aktif kullanım süresi
ölçülmeli" diyor. Gerçek çelişki. **Çözüm:** ölçüm içerik taşımayan, günlük kovalara toplanmış ve
kişi bazında yöneticiye gösterilmeyen biçimde tasarlanırsa duruş korunur; bu bir ürün kararıdır,
teknik değil (bkz. açık sorular).

**3. Denetim kaydı ↔ "veri toplamıyoruz" (02 ↔ 02).**
Audit log önerisi ile minimum-veri duruşu yüzeyde çatışıyor. **Çözüm:** ayrım "içerik" ile
"eylem" arasında. Kim-ne-ne zaman kaydı içerik kopyalamaz; asıl gerilim graf içeriğinde değil,
KVKK silme talebinde append-only commit tablosuyla yaşanıyor — o gerçek ve çözülmemiş.

**4. Snapshot/checkpoint ↔ `rebuildCheck` oracle'ı (01 içi).**
Snapshot eklemek replay maliyetini düşürür ama oracle'ın gücünü aşındırır. **Çözüm:** 01'in ikinci
turu bunu doğru çözmüş — snapshot authority değil cache; `rebuildCheck` iki modlu olur ve tam
replay yolu korunur. Çelişki değil, disiplin şartı.

**5. Çok kopyalı ölçekleme ↔ bellekteki durum (03 ↔ 05).**
03 oran sınırlayıcıların süreç-yerel olmasını güvenlik zaafı sayıyor; 05 tek kopya varsayımını
mimarinin kabul edilmiş sınırı sayıyor. **Çözüm:** ikisi de doğru, farklı varsayım altında.
Belgelenmemiş olan şey varsayımın kendisi: bugün proje tek kopyaya bağımlı (`wsClients`,
`CanvasEvents`, sayaçlar, `services`) ve bu `CLAUDE.md`'de bir kısıt olarak yazılı değil.

**Gerçek çelişki olmayan yer:** 5 başlığın hiçbiri bir diğerinin kod bulgusunu çürütmedi.
Çelişkiler öncelik ve ürün duruşu düzeyinde, olgu düzeyinde değil.

---

## Doğrulanmış bulgular

Şiddet kalibrasyonu bu turda yeniden yapıldı: "gerçekte ne olur" sütunu lane raporlarının risk
etiketini değil, kod okunarak çıkarılan fiilî sonucu yazıyor.

| # | Bulgu | Kanıt | Gerçekte ne olur | Şiddet | Efor |
|---|---|---|---|---|---|
| 1 | Login'de oran sınırı yok; parola alt sınırı 4 karakter | `server/src/authRoutes.ts:136-144`, `:46` | Sınırsız hızda parola denemesi. Zayıf parolalı hesap pratikte ele geçirilebilir. Tek kimlik-ele-geçirme sınıfı bulgu. | **Yüksek** | S |
| 2 | MCP önerileri `aiAllowed:false` bölgesine yazabiliyor | `server/src/agent.ts:497` (filtre burada), `server/src/proposalService.ts:260` (filtresiz `commit`) | Bölge sahibinin "AI buraya dokunmasın" ayarı dış ajanlara uygulanmıyor. Kullanıcıya verilen açık söz tutulmuyor. | **Yüksek** (çok taraflı kurulumda) / orta (tek kullanıcı) | S |
| 3 | WS yeniden bağlanmada catch-up yok | `web/src/store/graphStore.ts:316-322`, `:331` | Kesinti sonrası istemci bir sonraki commit'e kadar bayat kalır. Veri kaybı yok (commit mesajı tam durum taşıyor, `shared/src/wsMessages.ts:15`), ama kullanıcı yanlış grafa bakıp beklemediği bir dal üretir. | Orta | S |
| 4 | Bekleyen değişiklikler yalnız RAM'de | `web/src/store/graphStore.ts:33,247,402`; kalıcılık yalnız `themeStore.ts:11` | Sekme kapanınca/yenilenince staged iş sessizce gider. Sessiz kullanıcı emeği kaybı. | Orta | S |
| 5 | `update_brief` tüm MCP ajanlarına açık | `server/src/mcp/mcpServer.ts:398-415`, prompt'a giriş `:228` | Bir ajanın yazdığı metin diğer tüm ajanların talimat bağlamı olur → kalıcı bağlam zehirleme kanalı. Hafifletici: her yazma revizyon olarak izleniyor. | Orta | S |
| 6 | `approve_proposal` durum geçişinde CAS yok | `server/src/proposalService.ts:243-250` (oku) → `:273` (koşulsuz yaz) | İki süpervizör yarışırsa aynı öneri iki kez uygulanır (ikincisi büyük olasılıkla dala düşer). İçerik çoğalır, kayıp olmaz. | Orta-düşük | S |
| 7 | Yönetimsel denetim kaydı yok | `server/prisma/schema.prisma` (29 model, `AuditLog` yok); `adminService.ts` mutasyonları iz bırakmıyor | Kötüye kullanım şikâyeti/yasal talep geldiğinde gösterilecek kayıt yok. "Admin içeriği okuyamaz" duruşuyla birleşince yönetim savunulamaz hâle gelir. | Orta (operasyonel) | M |
| 8 | `actor` opsiyonel → bölge kontrolü fail-open | `server/src/commitService.ts:33`, `:439`; tek aktörsüz çağrı `canvasService.ts:96-100` | Bugün istismar edilebilir örnek **yok** (seed'de bölge yok). Risk gelecekte: yeni yazma yolu `actor` geçmeyi unutursa derleyici uyarmaz. | Düşük bugün / orta borç | S-M |
| 9 | `!gm.roleDef → 'editor'` geri düşüşü | `server/src/canvasService.ts:124` | Rolü atanmamış onaylı grup üyesi otomatik editör olur. Kasıtlı geriye uyum ("eski davranış korunur"), ama eksik yapılandırma sessizce yetki yükseltmesine dönüşüyor. | Orta | S |
| 10 | Oran sınırlayıcılar + WS + olay yayını süreç-yerel | `server/src/routes.ts:40-55`, `claimService.ts:23-33`, `app.ts:72,114,115` | Bugün doğru çalışıyor; ikinci kopya eklendiği an sınırlar N katına çıkar, WS yayını bölünür. Tek kopya bağımlılığı belgelenmemiş bir varsayım. | Orta (ölçeklenirse) | M-L |
| 11 | `claim_region` yakalamasında oku-sonra-yaz yarışı | `server/src/claimService.ts:148-163` | Çok kopyalı dağıtımda iki ajan aynı bölgeyi alabilir. Claim zaten yumuşak kiralama olduğu için sonuç koordinasyon gürültüsü. | Düşük | S |
| 12 | Merge commit'i ile dal kapanışı ayrı transaction'larda | `server/src/commitService.ts:210-212` | Arada çökme olursa dal `open` kalır; ikinci merge boş diff üretip (`:203-209`) durumu kendiliğinden düzeltir. **Veri kaybı yok.** Yalnız geçici tutarsızlık. | Düşük | S |
| 13 | `services` kayıt defteri hiç temizlenmiyor | `server/src/app.ts:72-80` | Kanvas başına birkaç yüz baytlık kalıcı nesne. "Bellek sızıntısı" teknik olarak doğru, pratikte önemsiz. | İhmal edilebilir | S |
| 14 | Görünüm sekmesi etiketleri ters *(bu tur kapatıldı)* | `web/src/components/Chrome.tsx:10-16` — şu an doğru, `git status` `M` | Kullanıcıya görünen tek correctness hatasıydı; eşzamanlı düzeltici tarafından onarıldı, henüz commit edilmedi. | — (kapandı) | — |
| 15 | CI'da yalnız Docker imajı derleniyor | `.github/workflows/` tek dosya: `docker.yml` | Test yok, tip kontrolü yok, `localBundle.test.ts` (yerel imaj eleme bekçisi) CI'da hiç koşmuyor. Bir kez fiilen kırılan `APP_MODE` zinciri sınıfı hata yine yakalanmaz. | Orta | S |

---

## Öncelik sırası

**Şimdi (bu hafta, hepsi S):**

1. **Login oran sınırı + parola alt sınırının yükseltilmesi.** Tek kimlik-ele-geçirme yolu; mevcut
   `agentRateLimited` deseni kopyalanabilir. Parola alt sınırı 4 → en az 8 (mevcut hesaplar
   etkilenmez). Gerekçe: diğer her bulgu sızıntı ya da rahatsızlık, bu hesap kaybı.
2. **`filterAiClosedRegions`'ın öneri onay yoluna taşınması.** `proposalService.ts:260` çağrısı
   filtresiz. Kullanıcıya verilmiş açık bir sözün tutulmaması, ve düzeltmesi tek fonksiyon çağrısı.
   Gerekçe: 1'den sonra en yüksek "söz ↔ davranış" farkı.
3. **`approve_proposal` durum güncellemesinin koşullu yapılması** (`where: { id, status: { in:
   OPEN_STATUSES } }`). Beş satırlık düzeltme, gerçek bir çift-uygulama penceresini kapatıyor.

**Sonra (bu ay, S):**

4. **Bekleyen değişikliklerin yerel kalıcılığı.** `pending` zaten düz JSON; IndexedDB ya da
   `localStorage` taslağı yeterli. Gerekçe: en sık yaşanacak sessiz kayıp.
5. **WS yeniden bağlanmada catch-up.** `onopen` içinde `load()` (ya da `getState()` + `headSeq`
   karşılaştırması) + üstel geri çekilme + jitter. Gerekçe: 4 ile aynı oturumu koruyor, aynı dosya.
6. **CI kapıları.** `npm run test` + `npm run build` (tip kontrolü) + `localBundle.test.ts`.
   Gerekçe: 15 numaralı bulgu bir kez fiilen üretimde kırıldı (`DOCKER-DENETIM.md`); ucuz sigorta.
7. **`!gm.roleDef → editor` geri düşüşünün kapatılması** ya da en azından bilinçli olduğunun
   `CLAUDE.md`'ye yazılması. Bugün ikisi de yok: davranış var, gerekçesi yok.

**Karar gerektiren (ölçüm/ürün kararı önce):**

8. **Denetim kaydı (M).** Önce hangi eylemlerin kaydedileceği ve saklama süresi kararlaştırılmalı;
   içerik kopyalamayan minimum küme. Bunu "admin içeriği okuyamaz" duruşunun operasyonel bedeli
   olarak yazın.
9. **Tek kopya varsayımının belgelenmesi (S) ya da dışarı taşınması (L).** Bugün doğru cevap
   büyük olasılıkla "belgele"; Redis/LISTEN-NOTIFY yatırımı gerçek çok kopyalı ihtiyaç
   ölçülmeden yapılmamalı.
10. **`actor` zorunlu principal tipine geçiş (S-M).** Bugün açık üretmiyor; refactor'ün değeri
    gelecekteki yolları güvenceye almak. Çekirdeğe dokunduğu için 1-7 bittikten sonra.

**Yapılmaması gerekenler (araştırma önerdi, ölçüm çürüttü):** çift-merge için transaction
birleştirme aciliyeti (bulgu 12), `services` Map temizliği (13), `move_node` düşme bildirimi
(zaten var), CRDT'ye toptan geçiş.

---

## Reddedilen / abartılmış iddialar

| Lane iddiası | Hüküm | Neden |
|---|---|---|
| "Merge/dal kapanışı ayrı transaction → kritik çift merge riski" (01 tur2) | **Abartılmış** | İkinci merge boş diff üretip no-op'a düşüyor (`commitService.ts:203-209`). Veri kaybı yok, yalnız geçici durum tutarsızlığı. |
| "Kullanıcının konum değişikliği sessizce düşüyor" (01/04) | **YANLIŞ** | `droppedMoves` sunucudan dönüyor (`commitService.ts:270,278`), tipte taşınıyor (`web/src/api/client.ts:75`) ve Türkçe bildirim yazılıyor (`graphStore.ts:179-181`). |
| "FlowView/MindMapView export son ekleri de ters" (04) | **YANLIŞ** | `views/FlowView.tsx:26` ve `views/MindMapView.tsx:10` doğru adlandırılmış. Lane'in "iki correctness hatası" iddiası tek hataya iniyor. |
| "`actor` opsiyonelliği fail-open region bypass üretiyor" (02) | **Kısmen** | Mekanizma doğru (`commitService.ts:439`), ama tüm yazma yolları denetlendi: aktörsüz tek çağrı seed ve o anda bölge yok. Bugün bypass yok; tasarım borcu. |
| "Tek choke point" (02, birden çok yerde) | **Fazla güçlü** | İki yazma yolu var — `applyCommit` (`:445`) ve dal inişi (`:315-325`) — ama ikisi de `assertRegions` çağırıyor. İfade yanıltıcı, sonuç değil. |
| "`serviceFor` kanvas başına örnek tutuyor → bellek sızıntısı" (05) | **Abartılmış** | `CommitService` yalnız prisma referansı + id taşıyor; kanvas başına birkaç yüz bayt. |
| "`db/prisma/schema.prisma:...`" (01, 02, 05'te tekrar tekrar) | **Yol hatası** | Gerçek yol `server/prisma/schema.prisma`. Satır numaraları tutuyor — bundle düzleştirmesi kaynaklı, uydurma değil. |
| "`hostPrefixedCookies: true` kullanın" (02) | **Uygulanamaz** | Kurulu `@fastify/oauth2` 8.2.0'da böyle bir seçenek yok; doğru yol `cookie: { secure: true }`. |
| "10k mantıksal eleman desteklenebilir" (04) | **Ölçülmemiş hipotez** | Hiçbir benchmark koşulmadı; kapasite taahhüdü olarak kullanılamaz. |
| "MCP'de push yok" öncülü (03 tur1) | **Güncelliğini yitirmiş** | Tur 2 güncel spesifikasyonda client-açılmış notification stream bulunduğunu ekliyor; mevcut long-poll tasarımı yine de geçerli, ama "tek seçenek" değil. |

---

## Kaynak kalitesi notu

**Kod atıfları: güvenilir.** Bu turda sentezde kullanılan her `dosya:satır` atfı gerçek repoda
arandı ve satır içeriğiyle eşleştirildi; "DOĞRULANAMADI" işaretlenen atıf çıkmadı. Tek sistematik
kusur yol düzleştirmesi (7 kalıp, tam listesi `yanitlar-proje/DOGRULAMA-RAPORU.md` sonunda).
Satır numaraları şaşırtıcı derecede isabetli — modeller kod okumuş, uydurmamış.

**Dış kaynaklar: zayıf, doğrulanabilir değil.** Dosya başına gerçek URL sayımı:

| Dosya | Gerçek URL |
|---|---|
| `yanitlar-standalone/01..05` | 1, 3, 1, 1, 1 — ve bunların hepsi ChatGPT sohbet linkinin kendisi |
| `yanitlar-proje/01-cekirdek.md` | 1 (sohbet linki) |
| `yanitlar-proje/02-yetki-guvenlik.md` | 1 (sohbet linki) |
| `yanitlar-proje/03-ai-mcp.md` | 4 |
| `yanitlar-proje/03-ai-mcp-tur2.md` | **0** |
| `yanitlar-proje/04-frontend.md` | 1 (sohbet linki) |
| `yanitlar-proje/05-dagitim.md` | 1 (sohbet linki) |
| `yanitlar-proje/01-cekirdek-tur2.md` | **12** — tek istisna |

Yani "OWASP diyor", "NIST Pages", "EUR-Lex", "Figma Help Center", "Automerge", "docs.axoniq.io"
biçiminde **etiket** var, bağlantı ve tarih yok. Bu ChatGPT web arayüzünün alıntı rozetlerinin
Markdown'a kopyalanırken düşmesinden kaynaklanıyor; modelin uydurduğu anlamına gelmez ama
bağımsız denetlenemez olduğu anlamına gelir.

**Pratik sonuç:** bu araştırmanın **kod bulguları karar kaydı olarak kullanılabilir**; **dış
standart/emsal iddiaları kullanılamaz.** Bir güvenlik ya da hukuk kararı ("KVKK şunu gerektirir",
"RFC 8252 şunu söyler") bu belgelere dayandırılmadan önce birincil kaynaktan tekrar
doğrulanmalıdır. Yalnız `01-cekirdek-tur2.md` bu şartı karşılıyor.

**Kapsam boşluğu:** 02 (yetki/güvenlik) ve 04 (frontend) yalnız birer tur aldı ve ilk denemelerde
web arayüzü boş yanıt döndürdüğü için proje turu gecikmeli geldi. 05 (dağıtım) ikinci turu sahte
çıktı (`.GECERSIZ`), yani gerçekte tek turluk. En zayıf kanıt tabanı 05'te.

---

## Açık sorular

Bunlar kod okuyarak cevaplanamaz; ürün, hukuk ya da ölçüm kararı gerektirir.

1. **Dış MCP ajanlarına ne kadar güveniyoruz?** Bulgu 2 ve 5'in şiddeti tümüyle buna bağlı.
   Ajanlar "kullanıcının kendi araçları" mı, yoksa "üçüncü taraf" mı? İkinci cevap ise brief
   yazma, öneri boyutu ve claim adaleti için ayrı bir tehdit modeli gerekiyor.
2. **Aktif kullanım süresi kişi bazında görünecek mi?** Yalnız grup/gün toplamı ise gizlilik
   duruşu korunur; kişi bazında ise bu bir çalışan izleme aracıdır ve KVKK aydınlatma
   yükümlülüğü doğar. Ölçüm tasarımı bu cevaba göre değişiyor, tersi değil.
3. **KVKK silme talebi append-only commit tablosunda nasıl karşılanacak?** Bugün cevap yok.
   Seçenekler (redaction, rewrite + history epoch, anahtar imhası) araştırmada tarif edildi ama
   hangisinin seçileceği hukuki bir karar. Bu, event sourcing sözleşmesine dokunan tek gerçek
   dış kısıt.
4. **Çok kopyalı dağıtım gerçekten hedef mi?** Değilse bulgu 10 ve 11 belgelenip kapatılır ve
   Redis/LISTEN-NOTIFY yatırımı hiç yapılmaz. Hedefse sıralama değişir. Bu karar verilmeden
   ölçek çalışmasına para harcanmamalı.
5. **Admin'in içerik körlüğü şikâyet/yasal talep geldiğinde nasıl aşılacak?** Bugün hiçbir yol
   yok — bilinçli. Denetim kaydı bunu kısmen karşılar ama içeriğe erişim sorusunu çözmez.
   Sürdürülebilir cevap muhtemelen "kanvas sahibinin onayıyla geçici erişim + kayıt".
6. **Yerel modda veri sahipliği ve yedek kimin sorumluluğunda?** `deploy/docker-compose.yml`
   Postgres'i `127.0.0.1`e bağlıyor; sistem düzeyi yedek/geri yükleme politikası yok. Kullanıcıya
   ne söz veriliyor?
7. **Gerçek ölçek nedir?** 1000+ düğüm bir tasarım hedefi mi yoksa gözlenmiş bir kullanım mı?
   04'ün bütün render önerileri ve 01'in snapshot planı bu sayıya bağlı; sayı ölçülmeden ikisi de
   spekülatif yatırım.
8. **Op şeması sürümlenmesi ne zaman zorunlu olacak?** `linkedCanvasId` normalizasyonu bu sorunun
   ilk patlamasıydı ve nokta çözümle kapatıldı. İkinci alan eklendiğinde aynı nokta çözüm mü
   tekrarlanacak, yoksa op düzeyi `v` alanına mı geçilecek? Karar ertelendikçe geriye dönük
   düzeltme maliyeti artıyor.
