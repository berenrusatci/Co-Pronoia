---
tags:
  - arastirma/yontem
kaynak: ARASTIRMA-SEMASI.md
---
> [!info] Bütün araştırmanın kaynak şeması

# Co-Pronoia — Araştırma Konu Şeması

Bu dosya **araştırmanın kendisi değil, araştırmanın haritasıdır.** Amaç: her başlığı bağımsız bir
araştırmacıya (insan ya da ajan) paralel dağıtabilmek ve dönen çıktıları çakışmadan birleştirebilmek.

Kapsam iki yönlü:
- **Denetim yönü** — bugün var olanın sağlamlığı, sınırları, gizli maliyetleri.
- **Özellik yönü** — üstüne ne inşa edilebilir, hangi sıraya konur, neyin bedeli ne.

---

## 0. Paralel çalıştırma kuralları

**Bağımsızlık.** Her başlık kendi giriş noktalarıyla birlikte verilmiştir; bir araştırmacının başka bir
başlığın çıktısını beklemesi gerekmez. Aralarındaki bağ `→ bkz.` ile işaretlenir, bu bir bağımlılık
değil, birleştirme aşamasında çapraz okunacak yer demektir.

**Zorunlu ön okuma (her başlık için ortak):** `CLAUDE.md` (mimari sözleşme), `server/prisma/schema.prisma`
(29 model), ilgili başlığın giriş noktaları. `CLAUDE.md` bu projede yalnız belge değil, **tasarım kararlarının
gerekçesiyle birlikte tutulduğu yer** — bir kararı "yanlış" ilan etmeden önce orada bilerek mi öyle
yazıldığına bakılmalı ("deliberately", "bilerek", "do not fix this" ifadeleri).

**Çıktı sözleşmesi.** Her araştırmacı tek bir markdown döndürür, şu başlıklarla:

```
# <başlık kodu> — <başlık adı>
## Özet            (≤10 satır, karar vericinin okuyacağı tek kısım)
## Bulgular        (her biri: iddia + kanıt olarak dosya:satır + neden önemli)
## Riskler         (yüksek/orta/düşük; istismar veya bozulma senaryosu somut)
## Öneriler        (her biri: iş büyüklüğü S/M/L + bedeli + vazgeçilirse ne olur)
## Açık sorular    (kod okuyarak cevaplanamayan, ürün kararı gerektirenler)
## Kaynaklar       (dış referanslar; sürüm/tarih ile)
```

**Kanıt zorunluluğu.** "Şu yavaş olabilir" değil, "`x.ts:120` her istekte N+1 sorgu atıyor, N = üye
sayısı" düzeyinde. Ölçüm yapılabiliyorsa ölçülür; yapılamıyorsa "ölçülmedi" açıkça yazılır.

**Kapsam dışı (hepsi için):** Kod yazmak. Bu tur yalnız araştırma; öneriler uygulanabilir hâlde
tarif edilir, uygulanmaz.

---

## A — Olay kaynaklı çekirdek (event sourcing)

> Projenin taşıyıcı sütunu: `Commit` tablosu main'in tek doğruluk kaynağı, `Node`/`Edge` yalnız
> materyalize önbellek. Buradaki her bulgu diğer her şeyi etkiler.

**Giriş noktaları:** `shared/src/ops.ts`, `shared/src/expand.ts`, `server/src/commitService.ts`,
`shared/src/ops.test.ts`, `commitService.rebuildCheck()`

- **A1 — Op sözlüğünün bütünlüğü ve evrimi.** Mevcut op kümesi hangi kullanıcı niyetlerini ifade
  edemiyor? `apply(invert(apply(g, op))) ≡ identity` değişmezi hangi yeni op tipleri için kırılır?
  Op şemasının sürümlenmesi yok — beş yıl sonra yazılmış bir commit'i bugünkü `applyOp` okuyabilecek mi?
  (`linkedCanvasId` normalizasyonu bu sorunun ilk kez patlamış hâli; başka kaç alan aynı riski taşıyor?)
- **A2 — Replay maliyeti ve anlık görüntü (snapshot) stratejisi.** `stateAt(seq)`, `branchState()`,
  `rebuildCheck()` commit sayısıyla doğrusal. 10k / 100k commit'te ne olur? Snapshot/checkpoint
  tasarımı: hangi aralık, nerede saklanır, `rebuildCheck` oracle'ı bozulmadan nasıl eklenir?
- **A3 — `rebuildCheck` bir oracle olarak ne kadar güçlü.** Neyi yakalar, neyi yakalamaz? Üretimde
  periyodik çalıştırılmalı mı (drift alarmı), yoksa yalnız test aracı mı kalmalı?
- **A4 — Zaman yolculuğu ve geri alma semantiği.** `revert`/`restore` kullanıcıya ne vaat ediyor,
  gerçekte ne yapıyor? Kısmi geri alma (tek düğüm/tek alan) mümkün mü, olmalı mı?
- **A5 — Sıkıştırma/arşivleme.** Commit tablosu asla küçülmüyor. Silinen kanvas dışında bir budama
  yolu olmalı mı? "Geçmişi düzleştir" özelliği event sourcing sözleşmesini nasıl bozar?

---

## B — Eşzamanlılık, dallanma ve çatışma çözümü

> `baseSeq` + `opsConflict()` + otomatik dallanma: alanına göre nadir bir tasarım. Doğru yerde mi
> duruyor, yoksa CRDT/OT tarafına mı kayması gerekir?

**Giriş noktaları:** `server/src/commitService.ts` (`locked()`, `opsConflict`, `uniqueBranchName`),
`server/src/canvasEvents.ts`, `web/src/store/graphStore.ts` (staging/push)

- **B1 — Çatışma kuralının isabeti.** `opsConflict` alan bazlı; hangi gerçek senaryolarda gereksiz dal
  açıyor (yanlış pozitif), hangilerinde sessizce üzerine yazıyor (yanlış negatif)? Somut senaryo tablosu.
- **B2 — Mutex'in ölçek sınırı.** `locked()` kanvas başına serileştiriyor, `nextSeq` satır kilidiyle
  çok süreçli güvenliği sağlıyor. Çok süreçli/çok kopyalı dağıtımda gecikme profili ne? Kuyruk
  doygunluğu nerede başlar?
- **B3 — CRDT/OT alternatifinin dürüst karşılaştırması.** Yjs/Automerge ile bu model yan yana:
  hangisi "numaralı commit + yazar + inceleme" ürün vaadini korur? Melez bir model (metin alanları CRDT,
  graf yapısı commit) mantıklı mı? → bkz. G3
- **B4 — Staging (push) modelinin kullanıcı deneyimi maliyeti.** Bekleyen niyetler WS commit'iyle
  geçersizleşebiliyor ve `applyIntents` bunu "hoşgörülü" yutuyor. Kullanıcı ne zaman sessizce iş
  kaybediyor? Ölçülebilir mi?
- **B5 — Dal yaşam döngüsü.** Dallar birikiyor, terk edilmişler için bir politika yok. Dal üstünde
  dal, dal yeniden temellendirme (rebase), kısmi birleştirme: hangisi bu modele oturur?

---

## C — Yetki modeli ve saldırı yüzeyi

> Üç katman iç içe: kanvas rolü, grup rolü/iş rolleri, bölge üyeliği. Üstüne MCP anahtarları ve
> aktivasyon anahtarları biniyor.

**Giriş noktaları:** `server/src/app.ts` (preHandler zinciri), `canvasService.ts`, `groupService.ts`,
`shared/src/regionGuard.ts`, `server/src/adminRoutes.ts`, `server/src/mcp/`

- **C1 — Yetki matrisinin tam çıkarımı.** Her route × her aktör tipi (owner/editor/viewer, grup admin/
  üye/bekleyen, site admin, MCP anahtarı, aktivasyon anahtarı, oturumsuz) için gerçekte ne oluyor?
  Tablo hâlinde. Boşluklar ve şaşırtıcı hücreler işaretlenir.
- **C2 — Choke point disiplini.** Tasarım tek giriş noktalarına dayanıyor (`applyCommit`→`assertRegions`,
  üyelik preHandler'ı). Bu choke point'leri **atlayan** yol var mı? Yeni bir route yazanın yanlışlıkla
  atlaması ne kadar kolay — tip sistemi bunu engelleyebilir mi?
- **C3 — Sır yönetimi.** Üç ayrı sır ailesi var, üç ayrı saklama deseniyle: `Session.id` ham,
  `AgentToken` sha256, `Instance` sha256, `EmailVerification.codeHash` scrypt. Bu tutarsızlık bilinçli mi,
  riskli mi? Rotasyon/iptal/sızıntı senaryoları.
- **C4 — Aktivasyon el sıkışması.** `donus` kilidi (`isAllowedActivationRedirect`) bir hesap devri
  kapısı olarak yeterli mi? DNS rebinding, SSRF, `CLOUD_ALLOWED_LOCAL_HOSTS` kötüye kullanımı,
  tek kullanımlık kodun yarış koşulları.
- **C5 — Site admin'in bilinçli körlüğü.** Admin kanvas içeriğini okuyamıyor (bilerek). Bu duruş
  operasyonel olarak sürdürülebilir mi — kötüye kullanım şikâyeti, yasal talep, destek talebi geldiğinde
  ne yapılır? Denetim kaydı (audit log) olmadan yönetim ne kadar savunulabilir?
- **C6 — Oran sınırlama ve kaynak tüketimi.** Sayaçlar modül düzeyinde (süreç ömrü) — çok kopyalı
  dağıtımda etkisiz. Hangi uçlar sınırsız? Commit boyutu, op sayısı, düğüm sayısı üst sınırları var mı?

---

## D — Kimlik, oturum, gizlilik ve kullanım telemetrisi

> Şu an davranışsal veri sıfır. Bu bir duruş; korunacaksa gerekçesi, terk edilecekse çerçevesi yazılmalı.

**Giriş noktaları:** `server/src/auth.ts`, `authRoutes.ts`, `googleAuth.ts`, `email.ts`,
`server/src/app.ts` (`wsClients`, presence, heartbeat), `web/src/store/authStore.ts`

- **D1 — Çerez ve saklama envanteri.** `tm_session` (httpOnly/lax/secure/30 gün) ve `@fastify/oauth2`'nin
  `oauth2-redirect-state` çerezi — ikincisine `secure` geçilmiyor. Ayrıca `localStorage: tm-theme`.
  Eksikler, sertleştirmeler, KVKK/GDPR açısından sınıflandırma.
- **D2 — Aktif kullanım süresi ölçümü (özellik).** Presence bugün yalnız bellekte ve kalıcı değil;
  "sekme açık" ≠ "aktif kullanım". İstemci tarafı boşta-kalma tespiti (visibility + girdi olayları),
  taşıma seçimi (mevcut WS'e ilk istemci→sunucu mesajı mı, ayrı HTTP ucu mu), toplama modeli
  (beat sayımı, aralık farkı değil), çok sekme tekilleştirme, günlük kova tablosu, saklama süresi.
  Eşik değerlerinin (boşta 60 sn? 3 dk?) ölçülen rakamın anlamını nasıl değiştirdiği.
- **D3 — Oturum güvenliği yaşam döngüsü.** 30 gün sabit, yenileme yok, cihaz listesi yok, IP/UA
  kaydı yok. "Oturumlarım" ekranı, şüpheli giriş uyarısı, oturum yenileme: hangisi bu gizlilik
  duruşuyla bağdaşır?
- **D4 — Hesap kurtarma ve e-posta akışları.** Şifre sıfırlama akışı var mı, yok mu? E-posta doğrulama
  kodunun sertliği (5 deneme, 10 dk), numaralandırma (enumeration) sızıntıları, SMTP yapılandırılmamış
  üretimde davranış.
- **D5 — Denetim kaydı (audit log) tasarımı.** Commit geçmişi graf için var; **yönetimsel** eylemler
  (rol değişikliği, anahtar mint/iptal, üye atma, admin işlemleri) için hiçbir iz yok. Ne kaydedilmeli,
  nerede, ne kadar süreyle? → bkz. C5

---

## E — Co-Pronoia: çok ajanlı planlama (MCP)

> Projenin ayırt edici iddiası. Protokol yüzeyi genç; burada hem sertleştirme hem özellik alanı var.

**Giriş noktaları:** `server/src/mcp/`, `proposalService.ts`, `agentRoleService.ts`, `claimService.ts`,
`briefService.ts`, `canvasEvents.ts`, `web/src/components/CoPronoiaPanel.tsx`

- **E1 — Protokol yüzeyinin olgunluğu.** Durumsuz Streamable HTTP + `wait_for_changes` long-poll:
  ölçek, zaman aşımı katmanları (25 sn seçimi), vekil/proxy davranışı, kopan bağlantıda kayıp sinyal.
  MCP spesifikasyonunun bugünkü hâline göre eksik/uyumsuz noktalar.
- **E2 — Supervisor onay modeli.** Tek onay noktası doğru mu? Çoklu onay, veto, otomatik onay kuralları,
  supervisor'ın kendi önerisini onaylaması, onaysız "güvenilir rol" kavramı — hangisi güvenliği bozmadan
  eklenir?
- **E3 — Ajan koordinasyonu ve claim mekanizması.** `NodeClaim` + bölge claim'i çakışmayı ne kadar
  önlüyor? İki ajan aynı anda aynı alanı planlarsa ne oluyor? Kilitlenme, aç kalma (starvation), terk
  edilmiş claim temizliği.
- **E4 — Brief/persona mimarisi.** `get_brief` ve `update_brief` ajanın tek bağlam kaynağı. Bağlam
  bütçesi, sürüm karması (`knownVersion`) etkinliği, persona tasarımının çıktı kalitesine etkisi.
- **E5 — Gözlemlenebilirlik ve ajan güveni.** Bir öneri neden reddedildi, hangi ajan ne zaman ne yaptı,
  maliyeti neydi? Panelde ajan etkinlik akışı, provenance zinciri (`agentLabel`/`roleName` denormalize
  edilmiş — yeterli mi?).
- **E6 — Kötü niyetli/bozuk ajan senaryoları.** Süresiz döngüye giren, devasa öneri gönderen, prompt
  injection ile supervisor'ı kandıran ajan. Sınırlar nerede? → bkz. C6, F4

---

## F — LLM entegrasyonu (yerleşik Gemini ajanı)

**Giriş noktaları:** `server/src/agent.ts`, `agent.test.ts`, `shared/src/flowLayout.ts`,
`web/src/components/AgentPanel.tsx`

- **F1 — Prompt mimarisi ve çıktı sözleşmesi.** JSON şeması, `parseModelOutput` sertliği, kısmi/bozuk
  yanıt davranışı. Yapılandırılmış çıktı (structured output / tool calling) kullanmak neyi düzeltir?
- **F2 — Model seçimi ve sağlayıcı bağımsızlığı.** `Llm` enjekte edilebilir — çok sağlayıcılı
  (Claude/OpenAI/yerel model) destek ne kadar uzakta? Detay seviyesi → model eşlemesinin isabeti,
  404/429/503 fallback davranışı.
- **F3 — Maliyet ve gecikme.** `stepwise` parça başına çağrı üretiyor; gerçek maliyet profili nedir?
  Önbellekleme, kısmi yeniden kullanım, akış (streaming) ile algılanan gecikmenin düşürülmesi.
- **F4 — Prompt injection ve içerik güveni.** Kanvas içeriği (kullanıcı metni) doğrudan prompt'a
  giriyor; bölge açıklamaları da. Bir düğüm başlığına yazılmış talimat ajana ne yaptırabilir?
  `filterAiClosedRegions` sunucu tarafı elemesi yeterli savunma mı? → bkz. E6
- **F5 — Değerlendirme (eval) altyapısı.** Ajan çıktısının kalitesi bugün ölçülmüyor. Altın örnek
  kümesi, regresyon eval'i, "iyi diyagram" ölçütü nasıl tanımlanır?
- **F6 — Deterministik yerleştirme motoru.** `buildFlowLayoutOps` modelden yerleştirmeyi almanın
  alternatifi olarak yazılmış. Kapsamı genişletilmeli mi (otomatik düzen, çakışma çözümü, artımlı
  yeniden düzenleme)? Saf ve bağımsız kalması ne kadar değerli?

---

## G — Frontend mimarisi, etkileşim ve erişilebilirlik

**Giriş noktaları:** `web/src/store/graphStore.ts` (en büyük dosya), `applyIntents.ts`,
`web/src/views/*`, `web/src/components/*`, `web/src/layout/mindmapLayout.ts`

- **G1 — Store mimarisinin sınırı.** `graphStore` kanonik durum + WS + staging + panel durumunu
  taşıyor. Bölünmeli mi, hangi eksende? Yeniden çizim (re-render) profili, seçim/sürükleme sırasında
  kare düşüşü.
- **G2 — Ölçek: büyük graf.** 1000+ düğüm/kenarda React Flow davranışı, sanallaştırma, mindmap
  düzeninin (d3-hierarchy) maliyeti, `applyIntents`'in her tuş vuruşunda çalışması.
- **G3 — Metin ve çok kullanıcılı düzenleme deneyimi.** Düğüm metnini iki kişi aynı anda yazarsa ne
  oluyor? İmleç/seçim paylaşımı, "şu an X düzenliyor" göstergesi. → bkz. B3
- **G4 — Erişilebilirlik.** Klavye ile graf gezinme, ekran okuyucu için graf semantiği, renk-kör güvenli
  kenar türü ayrımı (bugün ayrım büyük ölçüde renk+desen), kontrast, odak yönetimi, hareket azaltma.
- **G5 — Mobil ve dokunmatik.** Bugün fiilen masaüstü. Salt-okunur mobil görünüm mü, tam düzenleme mi?
  Bedel tablosu.
- **G6 — Çevrimdışı ve dayanıklılık.** Sekme kapanınca bekleyen niyetler gidiyor. Yerel kalıcılık,
  yeniden bağlanma stratejisi, WS kopukluğunda kullanıcıya dürüst geri bildirim.
- **G7 — Türkçe arayüz ve yerelleştirme.** Diller sabit kodlanmış. i18n'e geçmenin maliyeti ve
  "Türkçe kalsın" kararının gerekçesi hâlâ geçerli mi?

---

## H — Yerel/bulut ikiliği, derleme ve dağıtım

> Nadir ve kırılgan bir tasarım: derleme anında kod eleme ile ikinci bir güvenlik sınırı kuruluyor.

**Giriş noktaları:** `server/src/mode.ts`, `server/build.mjs`, `server/src/localBundle.test.ts`,
`Dockerfile`, `render.yaml`, `deploy/docker-compose.yml`, `DOCKER-DENETIM.md`, `activationService.ts`

- **H1 — Eleme kapısının sağlamlığı.** `globalThis.__LOCAL_BUILD__` + `minifySyntax` ikilisi esbuild
  sürüm yükseltmelerinde kırılabilir mi? `localBundle.test.ts` gerçekten yeterli bir bekçi mi
  (hangi sembolleri kontrol etmiyor)? Yeni bir modül eklendiğinde sessizce sızma senaryosu.
- **H2 — İki imaj, tek Dockerfile.** `APP_MODE` build argümanı zinciri (Render dahil) bir kez fiilen
  kırılmış. Bu sınıf hatayı CI'da yakalayacak kapı var mı? İmaj boyutu, katman önbelleği, tedarik
  zinciri (SBOM, imza, temel imaj güncellemesi).
- **H3 — Senkronizasyon modeli.** Çekme (`pull`) tek yönlü ve yalnız içe aktarma. İki yönlü senkron,
  çakışma çözümü, kısmi çekme, yerelde yapılan değişikliğin buluta dönüşü — hangisi olay kaynaklı
  çekirdeğe oturur? En büyük özellik alanlarından biri.
- **H4 — Migration stratejisi.** Migration dosyası yok, `prisma db push` var. Üretimde şema değişimi
  nasıl yapılıyor, geri alınabilir mi, veri kaybı riski nerede? Gerçek migration'a geçişin maliyeti.
- **H5 — Yedekleme, geri yükleme, felaket senaryosu.** Kanvas dışa aktarımı var; sistem düzeyinde
  yedek/geri yükleme politikası? Yerel kurulumda kullanıcı verisi nerede, nasıl taşınır?

---

## I — Veri katmanı ve ölçek

**Giriş noktaları:** `server/prisma/schema.prisma` (29 model), `server/src/*Service.ts` sorguları,
`server/src/testDb.ts`

- **I1 — İndeks ve sorgu denetimi.** Sık yolların (`stateAt`, `list*`, dashboard yüklemesi, admin
  listeleri) gerçek sorgu planları. N+1'ler. Eksik/gereksiz indeksler. Bileşik PK'ların
  (`@@id([canvasId, id])`) etkisi.
- **I2 — Bağlantı havuzu ve kaynak yönetimi.** `serviceFor` kanvas başına örnek tutuyor ve hiç
  temizlenmiyor gibi görünüyor — bellek sızıntısı mı? Testlerde `max_connections` sorunu üretimde
  hangi biçimde geri gelir?
- **I3 — Veri büyüme profili.** Hangi tablo sınırsız büyüyor (Commit, PlanProposal, Session,
  CanvasBriefRevision)? Beş yıllık projeksiyon ve budama/arşivleme politikası. → bkz. A5
- **I4 — Silme ve cascade semantiği.** Bilinçli FK yokluğu (`linkedCanvasId`), `SetNull`'lar,
  `deleteCanvas`'ın elle sildikleri. Yetim satır üreten yol var mı? Kullanıcı silme kısıtı
  (`Canvas.ownerId` restrict) operasyonel olarak ne kadar sıkıntı çıkarıyor?
- **I5 — Çok kopyalı (multi-instance) çalışma.** Bugün bellekte durum tutan her yer: `wsClients`,
  `CanvasEvents`, oran sınırlayıcılar, `serviceFor`. Yatay ölçeklemede hangisi bozulur, hangisi
  dışarı taşınmalı (Redis/Postgres LISTEN-NOTIFY)?

---

## J — Test, kalite kapıları ve gözlemlenebilirlik

**Giriş noktaları:** `*.test.ts` (server ve shared), `server/vitest.config.ts`, `server/src/testDb.ts`

- **J1 — Kapsam haritası.** Hangi modüller test ediliyor, hangileri hiç değil (`web/` için sıfır test).
  Kritiklik × kapsam matrisi — en riskli boşluklar.
- **J2 — Test altyapısının maliyeti.** Şablon veritabanı deseni, sıralı çalıştırma zorunluluğu,
  toplam süre. Paralelleştirme mümkün mü, bedeli ne?
- **J3 — Değişmez (invariant) testleri.** `rebuildCheck` ve `apply/invert` özellik testleri güçlü bir
  çekirdek. Property-based testing (fast-check) ile genişletilebilecek başka değişmezler neler?
- **J4 — Üretim gözlemlenebilirliği.** Bugün yapılandırılmış log, metrik, hata takibi, trace var mı?
  Minimum uygulanabilir set ne olmalı — ve bu, D'deki gizlilik duruşuyla nasıl bağdaşır?
- **J5 — CI kapıları.** `.github/workflows/` bugün ne çalıştırıyor? Eksik kapılar: tip kontrolü,
  bundle eleme testi, güvenlik taraması, bağımlılık denetimi, göç (migration) kontrolü.

---

## K — Ürün ve özellik keşfi

> Diğer başlıklar "var olan"dan yola çıkar; bu başlık dışarıdan bakar.

- **K1 — Konumlandırma ve rakip haritası.** Miro/FigJam (serbest kanvas), Linear/Jira (iş takibi),
  Obsidian Canvas (düşünce haritası), Notion (belge), git tabanlı planlama araçları. Co-Pronoia'nın
  savunulabilir farkı: **numaralı commit + çok ajanlı öneri + supervisor onayı**. Bu üçlü kime,
  neden lazım?
- **K2 — Kullanıcı akışlarının uçtan uca denetimi.** Kayıt → ilk kanvas → ilk davet → ilk çatışma →
  ilk ajan → ilk MCP bağlantısı. Her adımda terk etme riski ve sürtünme noktaları. En büyük tek
  sürtünme hangisi?
- **K3 — Boş durum ve ilk değer anı.** Yeni kullanıcı ilk 5 dakikada değer görüyor mu? Şablonlar,
  örnek kanvas, rehberli ilk kurulum, MCP kurulumunun (bugün `.mcp.json` yapıştırma) kolaylaştırılması.
- **K4 — Özellik boşlukları (geniş tarama).** Yorum/tartışma, bildirim, arama, etiket/filtre,
  düğüm ekleri ve dosyalar, tarih/takvim ve bağımlılık zamanlaması, ilerleme raporu, şablon kütüphanesi,
  klavye-öncelikli komut paleti, herkese açık salt-okunur paylaşım linki. Her biri için: bu mimariye
  oturuyor mu, hangi choke point'e dokunur, S/M/L.
- **K5 — Dışa aktarım ve entegrasyon ekosistemi.** PDF ve bundle var. Markdown/Mermaid dışa aktarımı,
  GitHub Issues/Projects çift yönlü köprü, webhook, herkese açık okuma API'si, takvim. Hangisi
  MCP yüzeyiyle çakışır, hangisi tamamlar?
- **K6 — Fiyatlandırma ve kota gerçekliği.** LLM maliyeti kullanıcı başına değişken, yerel mod ücretsiz
  dağıtılıyor. Sürdürülebilir model ne, kota nerede uygulanır (C6'daki oran sınırlarıyla ilişkisi)?

---

## L — Bağımlılıklar, lisans ve tedarik zinciri

**Giriş noktaları:** kök ve workspace `package.json`, `package-lock.json`, `Dockerfile`

- **L1 — Bağımlılık sağlığı.** Güncellik, bilinen açıklar, terk edilmiş paketler, ana sürüm
  yükseltmelerinin (Prisma, Fastify, React Flow, MCP SDK) maliyeti.
- **L2 — Kritik bağımlılık riski.** `shared/` bilerek sıfır çalışma-zamanı bağımlılığı taşıyor — bu
  disiplin başka nerelere uygulanabilir? En riskli tekil bağımlılık hangisi ve çıkarsa plan ne?
- **L3 — Lisans uyumu.** Dağıtılan Docker imajındaki her şeyin lisans envanteri; kendi lisans
  seçiminin sonuçları.

---

## M — Birleştirme aşaması (araştırma bitince)

Paralel çıktılar döndükten sonra tek bir kişi/ajan şunları üretir; bu iş **paralelleştirilmez**:

1. **Çapraz çelişki taraması.** Farklı başlıkların birbirine zıt önerileri (klasik eksen: B3 CRDT
   önerisi ↔ A1 op sözleşmesi; D2 telemetri ↔ D1 gizlilik duruşu; H3 senkron ↔ A2 replay maliyeti).
2. **Risk sıralaması.** Tüm başlıkların "Riskler" bölümleri tek listede, istismar edilebilirlik ×
   etki ile sıralı.
3. **Yol haritası taslağı.** Bağımlılık sırasına göre: önce neyin bilinmesi gerekiyor, sonra ne
   yapılıyor. Her madde S/M/L ve "yapılmazsa ne olur".
4. **`CLAUDE.md` güncellemesi.** Araştırmada ortaya çıkan ve belgelenmemiş **bilinçli kararlar**
   oraya yazılır — bu dosyanın kalıcı değeri budur.
