# Doğrulama Raporu — lane iddialarının kodla sınanması

Tarih: 15 Ağustos 2026 · Rol: düzenleyici (editör) · Yöntem: iddia → ilgili kaynak dosya okuması →
hüküm + `dosya:satır` kanıtı. Kaynak koda hiç dokunulmadı; yalnız okundu.

Hüküm sözlüğü: **DOĞRU** (iddia kodla birebir doğrulandı) · **KISMEN** (olgu doğru, sonuç/şiddet
abartılı ya da eksik) · **YANLIŞ** (kod tersini söylüyor).

---

## 1. WS yeniden bağlanmada catch-up yok

**Hüküm: DOĞRU (olgu) / KISMEN (sonuç).**

Kanıt:
- `web/src/store/graphStore.ts:317-322` — `onclose` yalnız `wsConnected:false` yazıp 2 sn sonra
  `connectWs` çağırıyor. Sabit gecikme, jitter yok, backoff yok.
- `web/src/store/graphStore.ts:316` — `onopen` yalnız `wsConnected:true` yazıyor; `load()` ya da
  `getState()` çağrısı **yok**. Kesinti sırasında düşen commit'ler istemciye hiç ulaşmıyor.
- `web/src/store/graphStore.ts:331` — `if (msg.state.headSeq <= get().headSeq) break;` kaçırılan
  aralığı kapatmıyor, yalnız gerilemeyi engelliyor.

Sonucu yumuşatan gerçek (lane raporlarında yok): `commit` mesajı **tam durumu** taşıyor
(`shared/src/wsMessages.ts:15` — `{ type: 'commit'; commit; state: GraphState }`), ve
`graphStore.ts:332` bunu `withServerState` ile bütünüyle yerine koyuyor. Yani kesintiden sonraki
**ilk commit** istemciyi kendiliğinden iyileştiriyor. Bayat pencere = kesintinin bitişi ile bir
sonraki commit arası. Kalıcı bozulma değil, sınırsız süreli yanlış görüntü riski.

Gerçek zarar senaryosu: kullanıcı bayat durumu görürken düzenleme yapıp Push'a basar; `baseSeq`
bayat olduğu için sunucu ya otomatik merge eder ya dala park eder — **veri kaybı yok**, ama
kullanıcı beklemediği bir dal görür. Şiddet: orta-düşük, sıklık yüksek.

---

## 2. Bekleyen (pending) değişiklikler yalnız RAM'de

**Hüküm: DOĞRU.**

Kanıt:
- `web/src/store/graphStore.ts:33` — `pending: OpInput[]` düz store alanı.
- `web/src/store/graphStore.ts:247` ve `:402` — başlangıç ve `reset` boş dizi.
- Repo genelinde tek kalıcılık `web/src/store/themeStore.ts:11,25` (`localStorage`, tema).
  `indexedDB` geçen tek satır yok; `persist` middleware kullanılmıyor.
- `web/src/store/graphStore.ts:490` — pending yalnız başarılı `api.commit` sonrası temizleniyor;
  hata durumunda korunuyor (`:492-495`), ama sekme kapanınca hiçbir yere yazılmıyor.

Şiddet: veri kaybı gerçek ve sessiz (sekme kapanışı / yenileme / sekme çökmesi). Kaybedilen iş
kullanıcının o oturumda staged bıraktığı her şey. Efor küçük (IndexedDB ya da `localStorage`
draft yeterli, `pending` zaten serileştirilebilir düz JSON).

---

## 3. `CommitService.actor` opsiyonelliği fail-open

**Hüküm: KISMEN — tip tasarımı riski gerçek, bugün istismar edilebilir örneği yok.**

Kanıt (olgu doğru):
- `server/src/commitService.ts:33` — `actor?: Actor` opsiyonel; `:20` yorumu "omitted for system
  paths (seed) and engine tests → no region check".
- `server/src/commitService.ts:439` — `if (!actor || actor.role === 'owner') return;` — aktörsüz
  çağrıda bölge kontrolü **hiç çalışmıyor** (fail-open).
- `server/src/canvasService.ts:96-100` — seed commit'i `actor` olmadan çağrılıyor.

Sonucu yumuşatan gerçek: her yazma çağrı noktası denetlendi, aktörsüz tek yol seed'dir:
- `server/src/routes.ts:95` — `actorOf(req)` **zorunlu** `Actor` döndürüyor; `:197, :279, :294, :321`
  hepsi geçiriyor.
- `server/src/proposalService.ts:260-264` — aktör geçiyor (token'ı basan kullanıcının güncel rolü).
- `server/src/agent.ts:728, :864` — aktör geçiyor.
- `server/src/canvasImportService.ts:26-29` — aktör geçiyor (`role: 'owner'`).
- `server/src/canvasService.ts:97` — **tek aktörsüz çağrı**; kanvas o an yaratılıyor, henüz bölge
  yok, dolayısıyla atlanan kontrolün koruyacağı bir şey de yok.

Yani bugün fiilî bir bypass yok. Risk **gelecek** riski: yeni bir yazma yolu yazan kişi `actor`
geçmeyi unutursa derleyici uyarmaz ve kontrol sessizce kapanır. Doğru düzeltme lane'in dediği gibi
`HumanPrincipal | SystemPrincipal` ayrık birleşimini **zorunlu** parametre yapmak. Şiddet: bugün
düşük, tasarım borcu olarak orta. Efor S/M.

Yan bulgu (lane'in "tek choke point" iddiasının düzeltmesi): main yazıları `applyCommit`ten
(`commitService.ts:445`) geçiyor, ama **dal inişi ayrı yol**: `commitService.ts:315-325` doğrudan
`tx.commit.create` yapıyor. İkisi de `assertRegions` çağırıyor (`:302` ve `:455`), yani guard
atlanmıyor — ama "tek fonksiyon" değil, "ortak guard'ı paylaşan iki yol".

---

## 4. Login route'unda oran sınırı yok

**Hüküm: DOĞRU.**

Kanıt:
- `server/src/authRoutes.ts:136-144` — `/api/auth/login` gövdesinde tek koşul parola doğrulaması;
  hiçbir sayaç, gecikme, kilit ya da CAPTCHA yok.
- Repodaki tek oran sınırlayıcılar: `server/src/claimService.ts:23-33,121` (MCP claim, 60 sn/30) ve
  `server/src/routes.ts:40-55,233` (ajan, 60 sn/8 kanvas + 20 kullanıcı). İkisi de auth dışı.
- `@fastify/rate-limit` bağımlılık listesinde yok; `Dockerfile`/`render.yaml` içinde proxy düzeyi
  sınır yok.
- Ağırlaştırıcı: `server/src/authRoutes.ts:46` — parola alt sınırı **4 karakter**. 4 karakterlik
  parola + sınırsız deneme birlikte gerçek bir hesap ele geçirme yoludur; ayrı ayrı ele
  alındıklarında ikisi de "küçük" görünür.
- `server/src/authRoutes.ts:85-90` — e-posta doğrulama kodunda 5 deneme sınırı **var**. Yani proje
  kısıtlama desenini biliyor, login'e uygulamamış.

Şiddet: **yüksek**. Bu, doğrulanan iddialar içinde tek "kimlik ele geçirme" sınıfı bulgudur.
Efor: S (tek yol için IP+kullanıcı bazlı sayaç, mevcut `agentRateLimited` deseni kopyalanabilir) —
ama çok kopyalı dağıtımda süreç-yerel sayaç yetersiz kalır (bkz. bulgu 8).

---

## 5. Yönetimsel denetim kaydı (audit log) yok

**Hüküm: DOĞRU.**

Kanıt:
- `server/prisma/schema.prisma` — 29 model var, `AuditLog` (ya da eşdeğeri) yok. Modellerin tam
  listesi: User, Session, EmailVerification, Canvas, CanvasBriefRevision, Group, GroupRoleDef,
  GroupMember, CanvasRoleAccess, RegionRoleAccess, GroupInvite, CanvasMember, Region, RegionMember,
  Invite, Node, Edge, Commit, Branch, AgentRoleDef, AgentToken, AgentTokenRole, NodeClaim,
  PlanProposal, SiteAsset, Activation, CloudImport, CloudGroupImport, Instance.
- `server/src`, `server/prisma`, `shared/src` altında "audit" geçen tek dosya yok (büyük/küçük harf
  duyarsız arama boş döndü).
- `server/src/adminRoutes.ts`/`adminService.ts` mutasyonları (rol değişimi, oturum iptali, kullanıcı
  silme, kanvas silme) hiçbir iz bırakmıyor.

Kısmi ikameler var, hepsi graf içi: `Commit.authorId` (graf değişikliği), `PlanProposal.roleName`/
`decidedByLabel` (öneri kararı), `CanvasBriefRevision` (brifing yazımı), `AgentToken.lastUsedAt`.
Bunların hiçbiri **yönetimsel** eylemi kapsamıyor.

Şiddet: kendi başına bir açık değil, ama `CLAUDE.md`'de bilinçli olarak seçilmiş "admin kanvas
içeriğini okuyamaz" duruşuyla birleşince operasyonel çıkmaz üretiyor: kötüye kullanım şikâyeti ya
da yasal talep geldiğinde ne olduğunu gösterecek hiçbir kayıt yok. İçerik kopyalamayan (yalnız
kim/ne/ne zaman) bir olay tablosu gizlilik duruşunu bozmadan bunu kapatır. Efor: M.

---

## Ek doğrulamalar (bu tur ölçüldü, lane'lerden gelen ama listede olmayan iddialar)

### 6. `approve_proposal` durum geçişinde CAS yok — DOĞRU

`server/src/proposalService.ts:243-250` durumu `findFirst` ile okuyup kontrol ediyor, `:273-275`
sonra koşulsuz `update` yapıyor. Arada `commit()` var. İki süpervizör aynı öneriyi eşzamanlı
onaylarsa ikisi de durum kontrolünü geçer ve intents **iki kez** işlenir. İkinci commit bayat
`baseSeq` yüzünden büyük olasılıkla dala düşer, ama içerik yine de çoğaltılır. Düzeltme ucuz:
`update`'i `where: { id, status: { in: OPEN_STATUSES } }` ile koşullu yapmak. Şiddet: orta-düşük
(iki insan süpervizör aynı saniyede tıklamalı ya da iki ajan yarışmalı), efor S.

### 7. `claim_region` yakalamasında yarış var — DOĞRU, düşük şiddet

`server/src/claimService.ts:148-163` "canlı claim'leri oku → örtüşme kontrol et → insert" sırası
transaction dışında ve tabloda örtüşmeyi engelleyen kısıt yok. Tek süreçte Node'un tek iş
parçacığı sırayı fiilen koruyor; çok kopyalı dağıtımda iki ajan aynı bölgeyi alabilir. Claim zaten
**yumuşak** bir kiralama (yazmayı engellemiyor, koordinasyon sinyali) olduğu için sonuç iki ajanın
aynı alanı planlaması — çirkin, yıkıcı değil. Şiddet: düşük. Efor S.

### 8. Oran sınırlayıcılar süreç-yerel — DOĞRU

`server/src/routes.ts:40-55` ve `server/src/claimService.ts:23-33` modül düzeyi `Map`. N kopyalı
dağıtımda etkin sınır N katına çıkar. `CLAUDE.md` bunu zaten "süreç ömrü" diye kabul ediyor, yani
bilinçli — ama tek kopyaya bağımlılık belgelenmiş bir varsayım değil. Aynı sınıf: `wsClients`
(`app.ts:114`), `CanvasEvents` (`app.ts:115`), `services` kayıt defteri (`app.ts:72`).

### 9. `services` Map'i hiç temizlenmiyor — DOĞRU, önemsiz

`server/src/app.ts:72-80` her kanvas için bir `CommitService` yaratıp saklıyor, silen kod yok
(kanvas silinse bile). Ama `CommitService` yalnız `prisma` referansı + `canvasId` taşıyor — havuz
bağlantısı ya da tampon tutmuyor. Sızıntı kanvas başına birkaç yüz bayt. Lane'in "bellek sızıntısı"
etiketi teknik olarak doğru, pratikte anlamsız. Şiddet: ihmal edilebilir.

### 10. `update_brief` tüm ajanlara açık — DOĞRU

`server/src/mcp/mcpServer.ts:398-415` — süpervizör kapısı yok, açıklaması bunu açıkça söylüyor
("Tüm ajanlara açıktır"). Brifing her ajanın prompt'una giriyor (`mcpServer.ts:228`), yani bir
ajanın yazdığı metin diğer bütün ajanların talimat bağlamı oluyor: kalıcı, ajanlar arası bağlam
zehirleme kanalı. Hafifletici: her yazma `CanvasBriefRevision` olarak kim-yazdı iziyle saklanıyor,
yani geri alınabilir ve izlenebilir. Şiddet: orta (dış MCP ajanlarına güvenmiyorsanız),
efor S (yazmayı süpervizör rolüne kapatmak ya da uzunluk/sıklık sınırı).

---

## Çürütülen / abartılmış iddialar

### Ç1. "Kullanıcının taşıması sessizce düşüyor" (B4, staging kaybı) — YANLIŞ

`server/src/commitService.ts:266-267` çakışan `move_node`'ları düşürüyor, ama sayısını
`droppedMoves` ile geri döndürüyor (`:270, :278`), `web/src/api/client.ts:75` tipte taşıyor ve
`web/src/store/graphStore.ts:179-181` kullanıcıya Türkçe bildirim yazıyor: "N konum değişikliğiniz
uygulanmadı — o düğümler ana hatta zaten taşınmıştı". **Sessiz değil.**

### Ç2. "FlowView/MindMapView export son ekleri de ters" (04 lane) — YANLIŞ

`web/src/views/FlowView.tsx:26` → `export function FlowView()`,
`web/src/views/MindMapView.tsx:10` → `export function MindMapView()`. Doğru adlandırılmışlar.
Lane'in iki correctness hatası bulduğu iddiası fiilen tek hataya iniyor (sekme etiketleri).

### Ç3. "Merge/branch-kapanış ayrı transaction → çift merge riski" — KISMEN, zarar yok

`server/src/commitService.ts:210-212` merge commit'ini attıktan sonra ayrı çağrıda
`branch.update({status:'merged'})` yapıyor. Arada çökme olursa dal `open` kalır. Ama ikinci merge
denemesi `:203` `diffStates` ile boş op üretir → `:206-209` no-op dalı ve durumu düzeltir. Yani
**veri kaybı ya da çift uygulama yok**, yalnız geçici durum tutarsızlığı. Lane'in "kritik" etiketi
fazla; doğru etiket "düzeltilmesi ucuz tutarlılık pürüzü".

### Ç4. "Tek choke point" — fazla güçlü ifade

Bkz. bulgu 3 yan notu: iki yazma yolu var (`applyCommit` ve dal inişi), ikisi de guard'ı çağırıyor.
İddia yanlış değil, ifadesi yanıltıcı.

### Ç5. Sekme etiketleri ters (Chrome.tsx) — GERÇEK HATAYDI, ARTIK DÜZELTİLMİŞ

`web/src/components/Chrome.tsx:10-16` şu an doğru eşleşiyor ve bir gerekçe yorumu taşıyor.
`git status` dosyayı `M` (commit edilmemiş) gösteriyor — eşzamanlı çalışan düzeltici tarafından
bu tur içinde onarılmış. Sentezde "bulundu ve kapatıldı" olarak sayılmalı.

---

## Yol atıfı düzeltmeleri (GÖREV 2)

Lane yanıtları zip bundle'ının düzleştirilmiş dizin yapısını kullandığı için satır numaraları
doğru, yollar yanlış. Bu turda ölçülen eşlemeler:

| Yanıtlarda geçen yol | Gerçek yol | Not |
|---|---|---|
| `db/prisma/schema.prisma` | `server/prisma/schema.prisma` | 01, 02, 05 lane'lerinde tekrar tekrar geçiyor; satırlar tutuyor |
| `web/src/components/FlowView.tsx` | `web/src/views/FlowView.tsx` | `components/` altında FlowView yok |
| `web/src/components/MindMapView.tsx` | `web/src/views/MindMapView.tsx` | aynı |
| `web/src/components/TimelineView.tsx` | `web/src/views/TimelineView.tsx` | aynı |
| `server/src/mcpServer.ts` | `server/src/mcp/mcpServer.ts` | MCP dosyaları alt dizinde |
| `server/src/mcpRoutes.ts` | `server/src/mcp/mcpRoutes.ts` | aynı |
| `server/src/schemas.ts` | `server/src/mcp/schemas.ts` | aynı |

Doğru olduğu teyit edilen yollar (düzeltme gerekmiyor): `server/src/commitService.ts`,
`server/src/canvasService.ts`, `server/src/proposalService.ts`, `server/src/claimService.ts`,
`server/src/agent.ts`, `server/src/authRoutes.ts`, `server/src/auth.ts`, `server/src/app.ts`,
`server/src/routes.ts`, `server/src/activationService.ts`, `server/src/adminService.ts`,
`shared/src/ops.ts`, `shared/src/expand.ts`, `shared/src/types.ts`, `shared/src/regionGuard.ts`,
`web/src/store/graphStore.ts`, `web/src/store/applyIntents.ts`,
`web/src/components/NodeEditorPanel.tsx`, `web/src/components/Chrome.tsx`, `web/src/App.tsx`.

**DOĞRULANAMADI** olarak işaretlenenler: yok — bu turda sentezde kullanılan her atıf gerçek repoda
bulundu ve satır içeriğiyle eşleştirildi.
