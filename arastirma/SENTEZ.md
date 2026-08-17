# Co-Pronoia Araştırması — Nihai Sentez

Tarih: 15 Ağustos 2026 · **Durum güncellemesi: 16 Ağustos 2026 (yönetici turu)**
Yazan: düzenleyici turu · Girdi: 5 başlık × 2 kanal (web-kaynaklı standalone + koda atıflı proje
turu), 2 başlıkta ikinci tur, 5 değerlendirme dosyası.
Bu belgedeki her iddia ham yanıttan alınmadı; kaynak kod okunarak yeniden sınandı — kanıtlar
`yanitlar-proje/DOGRULAMA-RAPORU.md` içinde uzun hâliyle duruyor.

> **16 Ağustos güncellemesi.** 15 Ağustos'tan bu yana iki commit (`5b6146b`, `e3f006a`) bulguların
> bir kısmını kapattı. 15 bulgunun her biri bugünkü kodda tek tek yeniden sınandı (commit
> mesajlarına değil, canlı koda bakılarak); satır atıfları bugünkü satır numaralarına çekildi.
> Sonuç: **3 kapandı, 1 kısmen kapandı, 11 duruyor.** Ayrıntı aşağıdaki tabloda "Bugünkü durum"
> sütununda; öncelik sırası buna göre yeniden yazıldı. Yönetici özetinin "gerçek açık tek:
> login'de oran sınırı yok" cümlesi **artık geçersiz** — oran sınırı `e3f006a` ile geldi; geriye
> kalan yarım iş parola alt sınırıdır (hâlâ 4 karakter).

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

~~Gerçek açık başka yerde ve tek: `/api/auth/login` üzerinde hiç oran sınırı yok, parola alt
sınırı 4 karakter.~~ **(16 Ağu: oran sınırı `e3f006a` ile kapandı.)** Geriye kalan: parola alt
sınırı hâlâ 4 karakter (`authRoutes.ts:81`, `:209`) — aynı öncelik maddesinin yapılmamış yarısı.
Artık kimlik-ele-geçirme sınıfı **açık bir bulgu kalmadı**; en ağır kalan kümeler dayanıklılık,
ajan yüzeyi ve süreç kapıları.

İkinci ağırlık merkezi ajan yüzeyi. `aiAllowed:false` sızıntısı `e3f006a` ile kapandı (kalkan
`shared/src/regionGuard.ts`'e taşındı, `applyCommit` choke point'inde uygulanıyor), ama
**`update_brief` bütün ajanlara açık kalmaya devam ediyor** ve brifing her ajanın prompt'una
giriyor. Bu, "dış MCP ajanlarına ne kadar güveniyoruz" sorusunun cevabına bağlı; tek
kişilik/güvenilir kurulumda düşük, çok taraflı kurulumda yüksek — ve bu soru hâlâ yanıtsız
(bkz. yeni turun 2 numaralı konusu: MCP dış ajan tehdit modeli).

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

| # | Bulgu | **Bugünkü durum (16 Ağu)** | Kanıt (bugünkü satırlar) | Gerçekte ne olur | Şiddet | Efor |
|---|---|---|---|---|---|---|
| 1 | Login'de oran sınırı yok; parola alt sınırı 4 karakter | **KISMEN KAPANDI** (`e3f006a`) | Oran sınırı geldi: `server/src/authRoutes.ts:30-51` (15 dk pencere, kullanıcı 10 / IP 30) ve kapı `:177`, scrypt'ten önce. **Parola alt sınırı hâlâ 4**: `:81` (kayıt) ve `:209` (değiştirme). | Kaba kuvvet artık pahalı. Ama 4 karakterlik parola hâlâ kabul ediliyor; sözlük saldırısı için 15 dk'da 10 deneme yavaş olsa da zayıf parola uzun vadede düşer. | Düşük-orta (kalan kısım) | S |
| 2 | MCP önerileri `aiAllowed:false` bölgesine yazabiliyor | **KAPANDI** (`e3f006a`) | Kalkan `shared/src/regionGuard.ts:77` `aiClosedViolation`'a taşındı; `server/src/commitService.ts:460` choke point'inde `actor.ai` ile uygulanıyor (owner bypass'ı **yok**, `:453`). Öneri onayı `proposalService.ts:270` artık `ai: true` geçiyor. | — | — | — |
| 3 | WS yeniden bağlanmada catch-up yok | **DURUYOR** | `web/src/store/graphStore.ts:316` — `ws.onopen = () => set({ wsConnected: true })`, başka hiçbir şey. Kopuş `:317-319`. | Kesinti sonrası istemci bir sonraki commit'e kadar bayat kalır. Veri kaybı yok, ama kullanıcı yanlış grafa bakıp beklemediği bir dal üretir. | Orta | S |
| 4 | Bekleyen değişiklikler yalnız RAM'de | **DURUYOR** | `web/src/store/graphStore.ts:33` (`pending: OpInput[]`), `:152-155`. Bütün `web/src/` içinde kalıcılık yalnız `store/themeStore.ts:11,25`. | Sekme kapanınca/yenilenince staged iş sessizce gider. Sessiz kullanıcı emeği kaybı. | Orta | S |
| 5 | `update_brief` tüm MCP ajanlarına açık | **DURUYOR** | `server/src/mcp/mcpServer.ts:398-402` — araç tanımı kendi metninde "Tüm ajanlara açıktır" diyor; brief prompt'a giriyor `:228`. | Bir ajanın yazdığı metin diğer tüm ajanların talimat bağlamı olur → kalıcı bağlam zehirleme kanalı. Hafifletici: her yazma revizyon olarak izleniyor. | Orta | S |
| 6 | `approve_proposal` durum geçişinde CAS yok | **DURUYOR** | `server/src/proposalService.ts:244-250` (oku) → `:279` `prisma.planProposal.update({ where: { id } })` koşulsuz. Ayrıca `:264-269`'da `ai: true` gerekçe yorumu **iki kez kopyalanmış** (kozmetik, ayrı düzeltme). | İki süpervizör yarışırsa aynı öneri iki kez uygulanır (ikincisi büyük olasılıkla dala düşer). İçerik çoğalır, kayıp olmaz. | Orta-düşük | S |
| 7 | Yönetimsel denetim kaydı yok | **DURUYOR** | `server/prisma/schema.prisma`: 29 model, `AuditLog` yok. | Kötüye kullanım şikâyeti/yasal talep geldiğinde gösterilecek kayıt yok. "Admin içeriği okuyamaz" duruşuyla birleşince yönetim savunulamaz hâle gelir. | Orta (operasyonel) | M |
| 8 | `actor` opsiyonel → bölge kontrolü fail-open | **DURUYOR** | `server/src/commitService.ts:40` (`actor?: Actor`), `:447-449` (`if (!actor) return`). Tek aktörsüz çağrı `canvasService.ts:96-100`. | Bugün istismar edilebilir örnek **yok** (seed'de bölge yok). Risk gelecekte: yeni yazma yolu `actor` geçmeyi unutursa derleyici uyarmaz. **`e3f006a` bu yolu genişletti** — `actor.ai` artık AI kalkanını da taşıyor, yani fail-open'ın bedeli arttı. | Düşük bugün / **orta-yüksek borç** | S-M |
| 9 | `!gm.roleDef → 'editor'` geri düşüşü | **DURUYOR** | `server/src/canvasService.ts:124`; kardeşi `:46` (`!gm.roleDef` → `'edit'`). | Rolü atanmamış onaylı grup üyesi otomatik editör olur. Kasıtlı geriye uyum, ama eksik yapılandırma sessizce yetki yükseltmesine dönüşüyor. `CLAUDE.md`'de hâlâ yazılı değil. | Orta | S |
| 10 | Oran sınırlayıcılar + WS + olay yayını süreç-yerel | **DURUYOR ve büyüdü** | `server/src/routes.ts:39-58` (ajan), `claimService.ts:28` (claim), **yeni**: `authRoutes.ts:30-51` (login) — `e3f006a` süreç-yerel sayaç sayısını 2'den 3'e çıkardı. `app.ts:72` (`services`), `:114` (`wsClients`), `:115` (`CanvasEvents`). | Bugün doğru çalışıyor; ikinci kopya eklendiği an sınırlar N katına çıkar, WS yayını bölünür. **Login sınırı da N katına çıkacağı için artık bir güvenlik kontrolü tek-kopya varsayımına bağımlı.** Tek kopya bağımlılığı `CLAUDE.md`'de bir kısıt olarak yazılı değil. | Orta (ölçeklenirse) | M-L |
| 11 | `claim_region` yakalamasında oku-sonra-yaz yarışı | **DURUYOR** | `server/src/claimService.ts:150` (`liveClaims` okuması) → `:167` (`nodeClaim.create`), arada transaction yok. | Çok kopyalı dağıtımda iki ajan aynı bölgeyi alabilir. Claim zaten yumuşak kiralama olduğu için sonuç koordinasyon gürültüsü. | Düşük | S |
| 12 | Merge commit'i ile dal kapanışı ayrı transaction'larda | **KAPANDI** (`e3f006a`) | `server/src/commitService.ts:469-476` `alsoInTx?: (tx: Tx) => Promise<void>` parametresi, `:494` aynı transaction içinde çağrılıyor; `mergeBranch` bunu kullanıyor. | — | — | — |
| 13 | `services` kayıt defteri hiç temizlenmiyor | **DURUYOR** (bilerek) | `server/src/app.ts:71-80`; `services.delete` hiç yok. | Kanvas başına birkaç yüz baytlık kalıcı nesne. "Bellek sızıntısı" teknik olarak doğru, pratikte önemsiz. | İhmal edilebilir | S |
| 14 | Görünüm sekmesi etiketleri ters | **KAPANDI** (`e3f006a`) | `web/src/components/Chrome.tsx:10-14` — `flow` → "Akış Diyagramı", `mindmap` → "Zihin Haritası"; üstünde gerekçe yorumu var. | — | — | — |
| 15 | CI'da yalnız Docker imajı derleniyor | **DURUYOR** | `.github/workflows/` hâlâ tek dosya: `docker.yml`. | Test yok, tip kontrolü yok, `localBundle.test.ts` (yerel imaj eleme bekçisi) CI'da hiç koşmuyor. Bir kez fiilen kırılan `APP_MODE` zinciri sınıfı hata yine yakalanmaz. **Son iki commit 170 testi elle koşarak doğruladı — bu insan disiplinine bağımlılık, kapı değil.** | **Orta → yükseldi** | S |

### Doğrulama yöntemi (16 Ağustos)

Her satır `grep`/`sed` ile canlı dosyadan okundu; commit diff'i **kanıt sayılmadı**. Kapandı denen üç
bulgunun her biri için düzeltmenin fiilen bağlı olduğu çağrı yeri de görüldü (ör. bulgu 2 için yalnız
`aiClosedViolation`'ın varlığı değil, `assertRegions` içinden `actor.ai` ile çağrıldığı;
bulgu 12 için yalnız `alsoInTx` parametresinin varlığı değil, `$transaction` gövdesinde `:494`
çağrıldığı). Bulgu 1'in "kapandı" iddiası bu yüzden **kısmen**e düştü: oran sınırı gerçek, ama aynı
öncelik maddesinin ikinci yarısı olan parola alt sınırı hiç dokunulmamış.

---

## Öncelik sırası

**16 Ağustos sürümü.** Kapanan bulgular listeden düştü; kalanlar bugünkü şiddetlerine göre yeniden
sıralandı. Eski sıralamanın 1-3'ü (login oran sınırı, aiAllowed kalkanı, CAS) üç maddeydi; ikisi
tamamen, biri yarısıyla kapandı — CAS hâlâ açık ve artık listenin başında.

**Şimdi (hepsi S, hepsi tek oturumluk):**

1. **`approve_proposal` durum güncellemesinin koşullu yapılması** (`where: { id, status: { in:
   OPEN_STATUSES } }`, `proposalService.ts:279`). Eski listenin 3. maddesiydi, dokunulmadı. Beş
   satırlık düzeltme, gerçek bir çift-uygulama penceresini kapatıyor. Aynı dokunuşta
   `:264-269`'daki çift kopyalanmış yorum bloğu da temizlenmeli.
2. **CI kapıları** (`npm run test` + `npm run build` + `localBundle.test.ts`). Şiddeti bu turda
   **yükseldi**: son iki commit'in doğruluğu tamamen elle koşulan 170 teste bağlı ve `e3f006a`
   çekirdek choke point'e (`applyCommit`) dokundu. Bir kez fiilen üretimde kırılan `APP_MODE`
   zinciri sınıfı hata hâlâ yakalanmaz.
3. **Parola alt sınırı 4 → 8** (`authRoutes.ts:81`, `:209`). Öncelik 1'in yapılmamış yarısı;
   mevcut hesaplar etkilenmez, iki satır.

**Sonra (bu ay, S):**

4. **Bekleyen değişikliklerin yerel kalıcılığı.** `pending` zaten düz JSON; `localStorage` taslağı
   yeterli. Gerekçe: en sık yaşanacak sessiz kullanıcı emeği kaybı.
5. **WS yeniden bağlanmada catch-up.** `graphStore.ts:316` `onopen` içinde `load()` (ya da
   `getState()` + `headSeq` karşılaştırması) + üstel geri çekilme + jitter. 4 ile aynı dosya, aynı
   oturumu koruyor — birlikte yapılmalı.
6. **`!gm.roleDef → editor` geri düşüşünün kapatılması** ya da en azından bilinçli olduğunun
   `CLAUDE.md`'ye yazılması (`canvasService.ts:124` ve `:46`). Bugün ikisi de yok.

**Karar gerektiren (ölçüm/ürün kararı önce):**

7. **MCP dış ajan tehdit modeli** — `update_brief`'in tüm ajanlara açık olması (bulgu 5), öneri
   boyut sınırının olmaması ve claim adaletinin tanımsızlığı tek bir yanıtsız soruya bağlı:
   ajanlar kullanıcının kendi araçları mı, üçüncü taraf mı? **Bu turun 2 numaralı araştırma
   konusu.** Model yazılmadan bu üç maddeye kod yazılmamalı.
8. **Op şeması sürümleme kararı** — `linkedCanvasId` nokta çözümü tekrarlanacak mı, op düzeyi `v`
   alanına mı geçilecek? **Bu turun 1 numaralı konusu.** Ertelendikçe geriye dönük düzeltme
   maliyeti artıyor.
9. **Denetim kaydı (M).** Hangi eylemler, ne kadar saklama; içerik kopyalamayan minimum küme.
10. **Tek kopya varsayımının belgelenmesi (S) ya da dışarı taşınması (L).** Bu turda ağırlığı
    arttı: `e3f006a` login oran sınırını da süreç-yerel sayaç olarak ekledi, yani artık bir
    **güvenlik kontrolü** tek-kopya varsayımına bağımlı. En az `CLAUDE.md`'ye yazılmalı.
11. **`actor` zorunlu principal tipine geçiş (S-M).** Bu turda ağırlığı arttı: `actor.ai` artık
    AI kalkanını da taşıyor, yani `actor` geçmeyi unutan yeni bir yazma yolu iki guard'ı birden
    atlar. Çekirdeğe dokunduğu için 1-6 bittikten sonra.

**Yapılmaması gerekenler (araştırma önerdi, ölçüm çürüttü):** `services` Map temizliği (bulgu 13),
`move_node` düşme bildirimi (zaten var), CRDT'ye toptan geçiş. *(Çift-merge transaction birleştirmesi
bu listeden çıktı — `e3f006a` yaptı; "acil değil" hükmü doğruydu, ama ucuz olduğu için yapıldı.)*

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
