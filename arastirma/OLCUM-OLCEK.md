# Ölçek ölçümü — yerelde koşulacak iş (web araştırmasına GÖNDERİLMEZ)

Tarih: 16 Ağustos 2026 · Yazan: yönetici (araştırma hattı) · **Durum: koşturulmadı, açık iş**

## Neden bu iş ChatGPT'ye sorulmaz

Bu bir **emsal** sorusu değil, bir **ölçüm**. 1. turda 04 başlığı "10k mantıksal eleman
desteklenebilir" dedi; sentez bunu "ölçülmemiş hipotez — kapasite taahhüdü olarak kullanılamaz"
diye reddetti (`SENTEZ.md`, reddedilen iddialar tablosu). Aynı soruyu bir kez daha web'e sormak
aynı cinsten bir cevap üretir: makul görünen, kaynaksız, kararlaştırılamayan bir sayı.

Bu turda 10 numaralı konunun (04 bölümü) prompt'una **açık bir yasak** kondu: "FPS/benchmark
SAYISI İSTEME; kodu okuyup hangi işlemin ölçeklenmediğini göster ve neyin ölçülmesi gerektiğini
söyle." Yani web araştırması bu ölçümün **tasarımına** katkı verir, **sonucuna** değil.

Bu sayı ölçülmeden şunlar spekülatif yatırımdır: 04'ün bütün render önerileri (sanallaştırma,
memoizasyon, kenar batching) ve 01'in snapshot/checkpoint planı.

## Ölçülecek üç şey

### 1. FlowView etkileşim akıcılığı (istemci)

**Boyutlar:** 200 / 1000 / 5000 düğüm. Kenar sayısı düğümün ~1.3 katı (bugünkü tipik graf oranı;
kök düğüm ağacı + serbest bağlantılar).

**Ölçüt:** pan ve zoom sırasında kare süresi — ortalama değil **p95 ve en kötü kare**. Ortalama
FPS yanıltıcıdır: kullanıcı takılmayı ortalamada değil en kötü karede hisseder.

**Yöntem:** Chrome DevTools Performance kaydı ya da `requestAnimationFrame` tabanlı bir sayaç;
React Profiler ile ayrıca hangi bileşenin yeniden render edildiği (`NodeCard`, `CurvedEdge`,
`RegionNode`).

**Ayrıca ölçülecek — kodda şüpheli görünen üç yer:**
- `web/src/store/applyIntents.ts` — `applyIntents` her `pending` değişiminde **bütün grafı**
  yeniden hesaplıyor (`graphStore.ts:152-155` `withPreview`). Bekleyen 1 intent varken bile
  maliyet graf boyutuyla lineer; 5000 düğümde her tuş vuruşunda mı koşuyor?
- `web/src/components/CurvedEdge.tsx` — paralel kenar offset'i, düğüm çifti içindeki indeksle
  hesaplanıyor. Bu indeks her render'da mı çıkarılıyor, yoksa memoize mi?
- `SubCanvasPreview` — bağlı alt kanvası olan **her düğüm için ayrı** `canvasApi.preview`
  isteği. 50 bağlı düğümlü bir kanvasta 50 HTTP isteği mi gidiyor? (N+1 riski.)

### 2. `rebuildCheck` süresi (sunucu)

**Boyutlar:** düğüm sayısı 200/1000/5000 **× commit sayısı 100/1000**. İki değişken bağımsız:
`rebuildCheck` maliyeti düğüm sayısıyla değil **commit sayısıyla** büyür
(`commitService.ts:543-544` → `stateAt(headSeq)` → bütün main commit'lerinin replay'i).

**Neden önemli:** `rebuildCheck` testlerin oracle'ı. Yavaşlarsa test süiti bozulur, ve
"snapshot ekleyelim mi" sorusunun cevabı buna bağlı. Snapshot tartışması (`SENTEZ.md` çelişki 4)
bu sayı olmadan karara bağlanamaz.

### 3. Replay süresi: `stateAt` / `branchState` (sunucu)

Aynı boyutlarda. Bunlar kullanıcı yolunda: zaman yolculuğu (`viewingSeq`), dal görüntüleme,
`diffStates` ile merge. `stateAt` yavaşsa zaman çizelgesi kaydırıcısı kullanılamaz hâle gelir.

`branchState` ayrıca ölçülmeli çünkü dal commit'leri materialized tabloya hiç yazılmaz — dal
durumu **daima** replay ile hesaplanır (`CLAUDE.md`, event sourcing bölümü).

## Nasıl koşulur

Veri üretimi mevcut `createCanvas`/`CommitService` yolundan gitmeli (`npm run db:seed -w server`
deseninin genişletilmişi) — doğrudan `Node`/`Edge` yazmak olay kaynaklı sözleşmeyi bozar ve
`rebuildCheck`'i anlamsızlaştırır. Yani ölçüm harness'i **commit üreterek** graf büyütmeli.

Test DB izolasyonu için `server/src/testDb.ts` `testDbFactory().fresh()` kullanılabilir.

## Kabul kriteri (ölçümden ÖNCE yazıldı — sonuca göre uydurulmasın)

| Ölçüm | Kabul | Eylem eşiği |
|---|---|---|
| FlowView p95 kare süresi, 1000 düğüm | < 33 ms (30 FPS) | > 50 ms ise render optimizasyonu gerçek bir iş |
| FlowView p95 kare süresi, 5000 düğüm | — (hedef yok) | Kullanılamaz çıkarsa "desteklenen üst sınır 1000" diye **yazılı** bir kısıt olur |
| `rebuildCheck`, 1000 commit | < 2 sn | > 5 sn ise snapshot tartışması açılır |
| `stateAt`, 1000 commit | < 500 ms | > 1 sn ise zaman çizelgesi kaydırıcısı debounce/önbellek ister |

**En değerli çıktı bir sayı değil, bir cümledir:** "Co-Pronoia N düğüm ve M commit'e kadar
akıcıdır." Bugün bu cümle yazılamıyor, ve ürün vaadi bu boşluğun üstünde duruyor.

## Bu iş ne zaman yapılmalı

`SENTEZ.md` öncelik sırasındaki "Şimdi" maddelerinden sonra, ama 9-11 numaralı karar maddelerinden
**önce** — çünkü snapshot ve ölçek kararlarının girdisi bu ölçümdür.
