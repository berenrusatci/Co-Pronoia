# https://chatgpt.com/g/g-p-6a7f040339d481918c9b17531913072f-co-pronoia-arastirma/c/6a80b58b-6790-83eb-8982-387d87d95950

Yönetici özeti

Zustand’ı değiştirmeyin; graphStore’u yeniden sınırlandırın. Sorun kütüphane değil, aynı store’da belge + preview + staging + WebSocket/presence + UI + agent durumlarının farklı değişim frekanslarıyla yaşaması.

Mevcut preview yolu her staged değişiklikte kanonik grafı tekrar Map’lere çevirip tüm sonucu tekrar array’e dönüştürüyor; 1k düğüm civarında ilk gerçek ölçek darboğazlarından biri bu olacak (web/src/store/graphStore.ts:152-165; web/src/store/applyIntents.ts:6-30).

Ancak metin editörü sanıldığı gibi her tuşta graf preview hesaplamıyor: title/description/notes yerel state’te, blur’da stage ediliyor (NodeEditorPanel.tsx:182-224,241-259).

React Flow’un güncel upstream’i 12.11.3; 12.11.2 özellikle viewport/MiniMap/render performansına iyileştirmeler getirdi. 
React Flow
+1

Şu an NodeCard/CurvedEdge memo değil ve onlyRenderVisibleElements kullanılmıyor; resmi React Flow rehberindeki iki önemli optimizasyon eksik (NodeCard.tsx:140-186; CurvedEdge.tsx:21-70; FlowView.tsx:124-152). 
React Flow
+1

10k graf ≠ 10k eşzamanlı DOM düğümü. 10k mantıksal eleman desteklenebilir; görünür altkümenin collapse/LOD/viewport culling ile sınırlanması gerekir.

Mevcut conflict modeli alan-düzeyinde zaten iyi: farklı node alanları birleşiyor; aynı alan branch oluyor; aynı düğümün eşzamanlı move’u ise branch değil, kullanıcının move’u düşürülüyor (server/src/commitService.ts:245-276,520-590).

Bunun UX eksikliği presence: bugün yalnız kullanıcı adı var; “X bu başlığı düzenliyor” + seçim/imleç presence eklenmeli (Chrome.tsx:170-177).

En kritik dayanıklılık açığı: WebSocket reconnect sonrası kaçırılmış commit’ler için catch-up yok. Kısa kesinti istemciyi sessizce bayat bırakabilir (graphStore.ts:310-388; server/src/app.ts:221-241).

Staged değişiklikler RAM’de; sekme kapanırsa kayboluyor. IndexedDB draft persistence öncelikli.

d3-hierarchy mevcut zihin haritası için uygun ve algoritması lineer; asıl sorun selection değişince layout’un tekrar hesaplanması ve sabit node-size varsayımının dinamik NodeCard ile uyuşmaması.

A11y için React Flow iyi bir taban sağlıyor ama genel amaçlı “graph editor” ARIA pattern’i yok; zihin haritası için paralel tree/treegrid, serbest graf için erişilebilir outline/list görünümü gerekiyor. 
React Flow
+1

Mobilde tam desktop editörünü küçültmek yerine view-first + açık “Düzenle” modu öneriyorum; Miro’nun mobil yaklaşımı da bu yönde.

i18n’i şimdi başlatmak mantıklı; hard-coded Türkçe şimdiden iki gerçek isimlendirme hatası üretmiş: Flow/Zihin Haritası tab etiketleri ters (Chrome.tsx:10-13; App.tsx:160-164).

Sürüm durumu

Kaynak bundle’larında package.json, package-lock.json, pnpm-lock.yaml veya yarn.lock bulunmuyor. Bu yüzden Co-Pronoia’nın gerçekten pinlediği sürümleri bundle’dan doğrulayamıyorum. Aşağıdakiler 15 Ağustos 2026 itibarıyla güncel upstream sürümlerdir:

Kütüphane	Güncel upstream	Not
React Flow / @xyflow/react	12.11.3	12 Ağustos 2026. 
React Flow

Zustand	5.0.15	Upstream repo 13 Ağustos 2026 sürüm bump’ı. 
GitHub

d3-hierarchy	3.1.2	Güncel paket; çekirdek tree algoritması Reingold–Tilford/Buchheim. 
GitHub
+1

Dolayısıyla “12.11.3 kullanıyorsunuz” demiyorum; “bugün hedeflenmesi gereken sürüm 12.11.3” diyorum.

Bulgular
1. Store mimarisi: sorun “tek Zustand store” değil, volatility sınırları

Kod aslında tek global store değil; auth/canvas/group/theme vb. ayrılmış. Fakat graphStore içinde şu şeyler birlikte:

kanonik serverNodes/serverEdges,

preview nodes/edges,

pending,

commit/branch/member/region,

proposals/claims/brief,

presence,

selection/view/side panel,

agent sohbeti,

exporting,

clientId/wsConnected.

Doğrudan: web/src/store/graphStore.ts:25-78.

Zustand açısından bunun “1000 node’dan sonra bozulur” gibi sabit bir sınırı yok. Gerçek maliyet selector fan-out + değişen referans sayısı + derived-array allocation. Zustand atomik selector’ları strict equality ile verimli çalıştırıyor; bütün store’u okumak ise her state değişiminde render tetikliyor. Zustand ayrıca store slicing’i resmi best practice olarak gösteriyor. 
GitHub

Önerdiğim ayrım:

document → canonical graph/head
staging → pending/preview overlay
realtime → WS/status/presence
ui → view/selection/panels/exporting
agent → proposals/claims/chat/brief

Bunların mutlaka beş farklı Zustand store olması gerekmiyor. Önce slice + seçici abonelik + normalizasyon yapın; sadece birbirinden tamamen bağımsız yaşam döngüsü olan realtime/UI gibi alanları ayrı store’a taşımak anlamlı.

Jotai’ye şimdi geçmeyin. Jotai atom başına subscription açısından cazip olsa da mevcut problem Zustand’ın yetersizliği değil. Normalize edilmiş node kayıtları ve doğru selector’lar sonrasında hâlâ node-başına granular subscription ihtiyacı varsa değerlendirin. Recoil’ü yeni mimari için seçmeyin; repo 2025’te arşivlendi. 
GitHub

2. React Flow ve 1k+ graf

React Flow’un güncel performans rehberi üç şeyi özellikle söylüyor:

custom node/edge componentlerini React.memo ile memoize edin,

callback/array/object prop referanslarını stabil tutun,

sık değişen tüm nodes/edges array’lerine gereksiz abonelikten kaçının. 
React Flow

Co-Pronoia:

nodeTypes/edgeTypes component dışında tanımlanmış: iyi (FlowView.tsx:15-16).

drag sırasında server/staging mutasyonu yapılmıyor, onNodeDragStop’ta move stage ediliyor: iyi (FlowView.tsx:101-122).

NodeCard memo değil: NodeCard.tsx:140.

CurvedEdge memo değil: CurvedEdge.tsx:21.

bazı React Flow callbackleri inline: FlowView.tsx:124-152.

onlyRenderVisibleElements yok: aynı aralık.

selectedNodeIds.includes(...) node map içinde kullanılıyor; selection büyüdükçe Set daha doğru: FlowView.tsx:39-61, benzeri MindMapView.tsx:17-24.

onlyRenderVisibleElements varsayılan olarak false; resmi API özellikle çok düğüm/kenarda faydalı olabileceğini ama kendisine ait hesaplama overhead’i bulunduğunu söylüyor. Dolayısıyla körlemesine açmak yerine 1k gerçek Co-Pronoia kartıyla benchmark edin. 
React Flow

12.11.2’de MiniMap’in her store update’inde render edilmesinin kaldırılması, viewport transform’unun imperative hale gelmesi ve pinch/pan sırasında synchronous layout maliyetinin cache’lenmesi gibi optimizasyonlar geldi. Bu nedenle 12.11.x’e yükseltmek eski 12.x sürümlerine göre ayrıca anlamlı. 
React Flow

3. Staging preview: bugünkü gerçek maliyet

Her preview değişiminde:

withPreview() → applyIntents(serverNodes, serverEdges, pending)

çalışıyor (graphStore.ts:152-165).

applyIntents de canonical array’lerden yeniden graph map’leri oluşturuyor, tüm staged intent’leri uyguluyor ve yeniden array çıkarıyor (web/src/store/applyIntents.ts:6-30).

Yani yaklaşık olarak:

O(N + E + staged-op expansion)

ve daha önemlisi birçok obje/array referansı yeniden üretiliyor.

Buna rağmen kullanıcı metin yazarken her tuşta bu yol çalışmıyor. NodeEditorPanel title/description/notes’u lokal state’te tutuyor ve yalnız onBlur ile updateNode çağırıyor (NodeEditorPanel.tsx:182-224,241-259). Bu iyi bir tasarım kararı; koruyun.

Önerilen evrim:

1k için: preview’ı serverRevision + pendingRevision üzerinden cache’leyin ve değişmeyen entity referanslarını koruyun.

Daha sonra: canonical graph üzerine addedById / patchById / movedById / deletedIds şeklinde overlay tutun. Yeni staged intent geldiğinde yalnız ilgili entity’yi değiştirin.

Worker: ilk çözüm olmamalı. 1000 node’luk grafı her değişimde worker’a structured-clone etmek de maliyetlidir. Worker’ı daha çok ELK/layout, büyük replay veya ağır export için kullanın.

Ek bir hot spot: descendant hesabı NodeEditorPanel.tsx:205-216 içinde çocuk bulmak için tüm node array’ini tekrar tekrar tarıyor; derin ağaçta O(N²)’ye yaklaşabilir. parentId → children[] adjacency index ile tek DFS/BFS yapın.

4. Aynı düğümün aynı alanını iki kişi yazarsa

Burada backend tasarımınız düşündüğünüzden daha iyi.

targetsOf() update_node için Object.keys(op.after) kullanıyor. Böylece:

A title, B status değiştirirse → çakışmaz.

A title, B title değiştirirse → çakışır.

node add/delete → wildcard.

edge → edge id.

server/src/commitService.ts:520-590.

Hard content conflict branch’e gidiyor (commitService.ts:276+). Fakat move/move özel: aynı node konumunu başkası değiştirmişse stale move düşürülüyor ve main kazanıyor (commitService.ts:258-273,554-574).

Bu Figma’nın klasik modeline epey yakın bir granülarite: Figma nesneyi object → property → value mantığında ele alıyor; farklı property değişiklikleri çatışmıyor, aynı property’de server ordering kullanıyor. Figma ayrıca bu yöntemin uzun eşzamanlı metin için uygun olmadığını açıkça söylüyor. 
Figma

Co-Pronoia’da esas problem algoritma değil geç fark edilen conflict:

Kullanıcı title yazıyor → blur’da staged oluyor → Push’a kadar diğer kişinin de title yazdığını bilmiyor.

Bunun için hard lock yerine ephemeral presence öneriyorum:

userId + nodeId + field + editingSince + expiresAt

Örnek UI: “Ayşe başlığı düzenliyor”.

Ayrıca selected node/cursor/viewport paylaşılabilir. tldraw’ın document state ile kısa ömürlü presence state’i ayırması bu yaklaşım için iyi precedent.

Uzun notes alanında gerçek Google-Docs tipi ortak yazım ürün özelliği haline gelirse yalnız o alan için CRDT/OT düşünülebilir. Tüm grafı CRDT’ye çevirmek şu mimaride gereksiz.

Bir ince ayrıntı: custom data şu anda tek conflict alanı gibi stage ediliyor (NodeEditorPanel.tsx:107-129). data.foo ve data.bar bağımsız düzenlenecekse gelecekte conflict target’ını key bazına indirmeniz gerekebilir.

5. HTTP mutation + WebSocket broadcast

Mevcut tasarım kodda gerçekten uygulanmış:

HTTP:

POST /commit → permission → service.commit() → sonucu HTTP ile döndür → sonra WS broadcast
server/src/routes.ts:187-205.

WS endpoint ise client mutation mesajı dinlemiyor; hello, presence ve sunucudan event gönderiyor. Yalnız pong ve close listener var (server/src/app.ts:221-241).

Bu ayrımı korurdum.

Avantajları:

commit’in sonucu committed | branch request/response içinde kesin;

permission/region/transaction tek HTTP choke point’inde;

staging’in “Push” modeliyle doğal uyumlu;

retry/idempotency/HTTP observability daha kolay.

Dezavantajları:

HTTP sonucu ile WS event ordering/dedup yönetmeniz gerekir;

reconnect catch-up ayrıca tasarlanmalıdır;

cursor/editing presence için client→server realtime kanalı gerekir.

Figma bunun ters ucunda document mutation’larını çift yönlü WebSocket üzerinden senkronize ediyor ve reconnect’te fresh document indirip offline editleri tekrar uyguluyor. 
Figma

Dolayısıyla “tüm mutation’ı WS’ye taşıyın” demiyorum. HTTP = durable mutation, WS = broadcast + ephemeral presence gayet sağlıklı bir sınır.

6. Zihin haritası / d3-hierarchy

Kod:

d3-hierarchy → hierarchy() → tree().nodeSize(...)
web/src/layout/mindmapLayout.ts:1-51.

D3’nin tidy-tree algoritması Buchheim iyileştirmesiyle lineer zamanlıdır. 
D3.js

Dolayısıyla 1k node’da “d3 hesaplaması kesin ana problem” demem. Fakat mevcut React memo sınırı yanlış:

MindMapView.tsx:17-38 içinde layout useMemo’su selectedNodeIds bağımlılığına sahip. Sadece selection değişince bile layout tekrar çalışıyor.

Bunu ikiye bölün:

layoutPositions = useMemo(... [hierarchyRevision, exporting])
rfNodes = useMemo(... [layoutPositions, selection])

İkinci problem daha önemli: layout sabit nodeH/nodeW kullanıyor (mindmapLayout.ts:37-40), fakat NodeCard içerik nedeniyle değişken boyda olabiliyor; linked canvas/url preview gibi pahalı ve değişken içerikler de var (NodeCard.tsx:158-170).

React Flow’un güncel layout rehberinin değerlendirmesi:

d3-hierarchy: strict single-root ağaç + benzer node boyları için iyi.

Dagre: hızlı ve basit tree/directed graph layout; React Flow ağaçlar için özellikle öneriyor.

ELK: daha karmaşık, fakat daha gelişmiş yönlendirme/konfigürasyon için uygun. 
React Flow
+1

Benim seçimim:

Bugün: d3-hierarchy kalır.
Dinamik boyut nedeniyle overlap başlarsa: Dagre.
Compound/subflow + ciddi edge routing gerekiyorsa: ELK, tercihen worker.

Büyük mindmap’te en yüksek getirili özellik layout engine değiştirmek değil branch collapse. React Flow da büyük ağaçlarda yalnız görünür bölümü render etmeyi öneriyor. 
React Flow
+1

Performans tablosu

Bunlar React Flow’un resmi FPS garantileri değildir; Co-Pronoia’nın mevcut NodeCard karmaşıklığına göre tasarım hedefleridir.

Ölçek	Beklenen durum	Co-Pronoia’daki ana risk	Önerilen teknik
100 node	Rahat	Gereksiz rerender/layout	React.memo, useCallback, Set selection; mevcut d3 yeterli
1k node	Optimizasyon gerekli ama gerçekçi	full-array preview, tüm node map’leri, selection-triggered layout, ağır card previews	onlyRenderVisibleElements A/B benchmark; stable entity refs; normalized graph; incremental preview; memo node/edge; collapse; iframe/subcanvas LOD
10k logical node	Ancak görünür subset sınırlıysa makul	DOM/SVG node sayısı + O(N) dönüşümler + layout + MiniMap/data transforms	viewport culling, collapse/clustering, LOD, visible graph subset, worker layout, chunked computations
10k aynı anda görünür node	React DOM/SVG yaklaşımı için riskli hedef	binlerce custom DOM card + edges	Renderer mimarisini yeniden değerlendirin; Canvas/WebGL/hibrit katman araştırın

React Flow onlyRenderVisibleElements için doğrudan “large number of nodes and edges” durumunda fayda sağlayabileceğini, fakat ek overhead yarattığını belirtiyor. 
React Flow

Önemli nokta: bugün React Flow prop’una 10k node vermeden önce uygulamanın kendi map()/preview/layout kodları zaten 10k’yı dolaşıyor. Yani yalnız onlyRenderVisibleElements uygulama seviyesindeki O(N) maliyetleri çözmez.

Erişilebilirlik

React Flow 12.11.x temelinde durum eskisine göre oldukça iyi: node/edge’ler varsayılan olarak keyboard-focusable, Tab, Enter/Space, node için arrow-key movement, auto-pan ve ariaLabelConfig desteği var. 
React Flow

Fakat ARIA APG’de generic node-link graph editor pattern’i bulunmuyor; Tree View ve Treegrid bulunuyor. Bu nedenle serbest grafı sahte bir tree olarak sunmak doğru değil. 
W3C
+1

Uygulanabilir denetim listesi

 Her node için anlamlı accessible name: “API Tasarımı, görev, devam ediyor”.

 Her edge için “API Tasarımı → Backend, bağımlılık” benzeri accessible name.

 React Flow ariaLabelConfig içindeki built-in mesajları Türkçeleştir; şu an FlowView/MindMapView bunu vermiyor.

 Zihin haritasına aynı state’i kullanan Tree/Treegrid veya Outline görünümü ekle; yön tuşlarıyla parent/child/sibling gezilebilsin.

 Serbest akış grafı için node listesi + “gelen bağlantılar / giden bağlantılar” semantik alternatif görünümü sun.

 Drag’in tek operasyon yolu olmasına izin verme. “Taşı” kontrolleri/keyboard movement/position action sağla. WCAG 2.5.7 Dragging Movements (AA) bunu gerektiriyor. 
W3C
+1

 Handle ve icon-button hit-target’ları en az 24×24 CSS px veya WCAG spacing istisnasını karşılasın; mobilde daha büyük hedefle. WCAG 2.5.8 AA. 
W3C

 React Flow’un mobil iki-handle-tap bağlantısını kullanacaksan handle boyutunu büyüt; resmi touch örneği de bunu yapıyor. 
React Flow

 Klavye focus görünür olsun ve açılan side panel tarafından tamamen kapatılmasın: WCAG 2.4.7 / 2.4.11.

 Node/edge/focus gibi önemli graphical öğeler için çevreye karşı en az 3:1 non-text contrast hedefle. 
W3C

 Edge türünü yalnız renkle anlatma. WCAG 1.4.1 Use of Color renk dışında ikinci ipucu ister. 
W3C

 flow ve loop bugün ikisi de solid: CurvedEdge.tsx:14-18. Döngüye farklı dash/marker/glyph ver; örneğin ↻, dependency’ye ⇢, relation’a noktalı + ikon.

 Edge label’larını yalnız hover’a bırakma. flow bugün özel label yoksa text göstermiyor (CurvedEdge.tsx:58-65); erişilebilir isim yine bulunmalı.

 strokeWidth: 1.8 (CurvedEdge.tsx:56) düşük kontrastta ince kalabilir; dark/light temada ölç.

 TimelineView range input’una <label> veya aria-label + uygun aria-valuetext ekle (TimelineView.tsx:13-28).

 “Çevrimdışı / taslak kaydedildi / yeniden eşitleniyor / branch oluştu” mesajlarını yalnız görsel dot değil role=status / polite live region ile bildir.

 Node editör paneli açılınca kontrollü focus aktar; kapanınca focus’u ilgili node’a geri getir.

 Silinen node focus’taysa focus’u öngörülebilir bir sibling/parent/action’a taşı.

 prefers-reduced-motion tüm canvas animasyonları, animated edge, presence cursor ve panel transition’larına yayılsın. Mevcut CSS’te reduced-motion yalnız login animasyonunu kapsıyor (web/src/styles.css:469+).

 Keyboard-only, NVDA+Chrome/Firefox ve VoiceOver+Safari gerçek testleri CI öncesi release checklist’e girsin.

Figma da çok oyunculu cursor hareketinin motion-sensitive kullanıcılar için rahatsız edici olabileceğini kabul edip gizlenebilir presence yaklaşımı kullanıyor; cursor presence eklerseniz “işbirlikçi imleçleri gizle” kontrolü mantıklı.

Mobil / dokunmatik

Kodda editöre özgü gerçek responsive strateji neredeyse yok; bulduğum max-width:900px media rule login ekranıyla ilgili (web/src/styles.css:499-510).

React Flow touch tarafında pinch ve click/tap connection desteğine sahip; resmi touch örneği iki handle’a sırayla dokunarak edge oluşturuyor ve özellikle handle’ları büyütüyor. 12.11.3 ayrıca touch + selection rectangle etkileşiminde bir düzeltme içeriyor. 
React Flow
+1

Co-Pronoia için:

Telefon: varsayılan “incele” modu. Pan/zoom, node seçme, açıklama, timeline, presence.

Düzenle düğmesine basınca: field edit, status, tek node taşıma, iki-tap connection.

Varsayılan telefonda kapalı: lasso, hassas region resize, büyük multi-selection, karmaşık edge manipulation.

Tablet: desktop’a yakın tam editör.

Bu, “mobilde hiçbir şey düzenlenemez” kadar sert değil ama yanlışlıkla grafı bozmayı önler.

Dayanıklılık ve offline

Burada iki ayrı problem var.

1. Staging kaybı

pending yalnız Zustand belleğinde (graphStore.ts:32-34). push() hata alırsa pending’i koruyor — güzel (graphStore.ts:485-496) — fakat sayfa/sekme kapanmasına karşı kalıcılık yok.

Kod taramasında IndexedDB/session draft/beforeunload/offline persistence göremedim. localStorage mevcut ama yalnız theme için kullanılıyor (themeStore.ts:4-27).

IndexedDB’ye yalnız staged draft yazın:

canvasId
baseSeq
intents[]
schemaVersion
updatedAt

Canonical server graph’ı IndexedDB’ye doğruluk kaynağı yapmak zorunda değilsiniz.

Staging değiştikçe debounce ile draft yazın; Push başarıyla sonuçlanınca silin. Browser açılırsa “Bu cihazda gönderilmemiş 7 değişiklik bulundu” diye geri yükleyin.

Zustand’ın persist katmanı custom storage ile kalıcılığı destekliyor; ancak bu yapı için explicit IndexedDB adapter/draft repository de gayet temiz olur. 
GitHub

2. WebSocket reconnect correctness

Şu an:

close
→ wsConnected=false
→ 2000 ms
→ reconnect

graphStore.ts:317-322.

Yeni socket yalnız:

hello(clientId)
presence

alıyor (server/src/app.ts:229-240).

App.tsx ise load() çağrısını yalnız active canvas mount/değişiminde yapıyor (App.tsx:104-113).

Dolayısıyla:

seq=100’de bağlantı kopar,

başkası seq=101 gönderir,

sizin istemci 2 saniye sonra reconnect olur,

seq=101 replay/catch-up edilmez.

Bu gerçek correctness açığıdır.

En basit düzeltme:

hello sonrası GET current state, ardından headSeq güncelle.

Daha ölçekli çözüm:

GET /sync?since=100 → commit 101…N + current head.

Ayrıca retry:

2s sabit yerine exponential backoff + jitter, online event’inde hızlı retry.

UI stateleri de boolean yerine:

connected | reconnecting | syncing | offline | conflict

olmalı.

Bugünkü yalnız yeşil/kırmızı nokta (Chrome.tsx:170) yeterince dürüst değil.

Yerelleştirme

Bunu sonraya atmak yerine M boyutunda şimdi yapardım.

Nedeni yalnız gelecekte İngilizce istemeniz değil. Hard-coded string dağınıklığı şimdiden doğrulanabilir iki hata üretmiş:

TypeScript
{ key: 'flow', label: 'Zihin Haritası' }
{ key: 'mindmap', label: 'Akış Diyagramı' }

web/src/components/Chrome.tsx:10-13

fakat renderer:

TypeScript
view === 'flow'    → FlowView
view === 'mindmap' → MindMapView

web/src/App.tsx:160-164.

Üstelik export suffix’leri de ters: FlowView.tsx:151, MindMapView.tsx:56.

react-i18next bu React uygulaması için daha düşük migrasyon maliyetli seçim. String’leri component component taşıyabilirsiniz. FormatJS ise ICU message syntax ve message-format merkezli translator pipeline önemliyse daha güçlü bir aday.

Türkçe için:

tarih/saat: Intl.DateTimeFormat('tr-TR')

sayı: Intl.NumberFormat('tr-TR')

alfabetik sıralama: Intl.Collator('tr')

plural mesajlarını string concatenation yerine CLDR tabanlı sistemle kurun.

React Flow ariaLabelConfig string’lerini de aynı translation catalog’a koyun.

Türkçe CLDR cardinal plural açısından 1 için one, diğer sayılar için other kategorisini kullanıyor; yani İngilizce’ye kıyasla morfoloji farklı görünse de altyapı standardize edilmeli. 
Unicode

Öneriler: S / M / L
Boyut	Öneri	Yapılmazsa ne olur
S	NodeCard + CurvedEdge → React.memo; inline ReactFlow handler’larını useCallback; selection için Set	1k seviyesinde gereksiz render ve CPU artar
S	onlyRenderVisibleElements gerçek 100/1k benchmark’ında test edilsin	Büyük viewport dışı graflarda DOM maliyeti gereksiz büyür
S	Mindmap layout memo’sundan selectedNodeIds bağımlılığını çıkar	Her seçimde O(N) layout
S	Reconnect sonrası zorunlu catch-up + exponential backoff/jitter	İstemci sessizce stale kalabilir
S	IndexedDB staged draft	Refresh/tab close kullanıcı emeğini kaybettirir
S	Flow/Mindmap ters tab isimleri ve export suffix düzelt	Doğrudan UI correctness hatası devam eder
S	Türkçe ariaLabelConfig, timeline slider name, visible connection status	Mevcut RF a11y kabiliyetinin çoğu kullanılamaz
S	Edge type’a renk dışında shape/dash/icon/text cue	WCAG 1.4.1 riski
M	graphStore: document/staging/realtime/ui/agent slice sınırları + selective subscriptions	Store update fan-out giderek artar
M	Node/edge state’i ID bazında normalize et, değişmeyen entity referanslarını koru	Her graph değişiminde büyük array/object churn
M	Full preview rebuild yerine incremental overlay	Staged işlem maliyeti N ile büyür
M	parentId→children index	descendant hesapları büyük derin tree’de pahalılaşır
M	Field-level editing presence + cursor/selection presence	Aynı alanı düzenleyen iki kişi conflict’i ancak Push’ta öğrenir
M	Mobil “view-first / edit-mode” ve editor responsive CSS	Telefon deneyimi hataya açık ve sıkışık olur
M	react-i18next + string extraction	Her yeni ekran gelecekteki migration maliyetini artırır
L	Dinamik node size sorunu oluşursa d3→Dagre; karmaşık routing/subflow varsa ELK worker	Heterojen mindmap node’larında overlap/okunabilirlik kötüleşir
L	10k logical node için collapse/LOD/clustering/viewport graph subset	React Flow render optimizasyonu tek başına yetmez
L	10k eşzamanlı görünür node gerçek ürün şartıysa Canvas/WebGL renderer PoC	DOM/SVG üst sınırı ürün hedefiyle çatışabilir
L	Yalnız notes için gerektiğinde CRDT/OT	Gerçek eşzamanlı uzun-metin yazımı branch UX’ine dönüşür
Koddan çıkan ek sorunlar

Araştırma sorularının dışında üç küçük ama somut bulgu da var:

Görünüm adları ters: Chrome.tsx:10-13 ↔ App.tsx:160-164.

Export isimleri ters: FlowView.tsx:151 “zihin-haritasi”, MindMapView.tsx:56 “akis-diyagrami”.

WS health state çok kaba: UI sadece bağlantı dot’u gösteriyor (Chrome.tsx:170); reconnect ile state consistency aynı şey değil. “Socket açık” durumunu “canvas güncel” anlamına getirmemek gerekiyor.

Açık sorular

Hedefteki 1000/10k node toplam graf boyutu mu, yoksa aynı anda görünür node sayısı mı? Performans mimarisini en çok bu değiştiriyor.

Gerçek kanvaslarda NodeCard’ların yüzde kaçı URL preview / linked-canvas preview içeriyor? 1k basit kart ile 1k iframe/preview kart aynı problem değil.

Telefonlarda requirement gerçekten tam düzenleme mi, yoksa inceleme + küçük edit yeterli mi?

title/description/notes üzerinde gerçek aynı-anda karakter düzeyi ortak yazım bekleniyor mu? Beklenmiyorsa CRDT gereksiz.

Mindmap’te node yüksekliğinin içerikle değişmesi ürün gereksinimi mi? Evetse mevcut sabit-size d3 layout uzun vadede doğru model değil.

Reconnect catch-up için full GET state kabul edilebilir mi, yoksa 10k+ commit hedefi nedeniyle baştan sinceSeq protokolü mü isteniyor?

Branch çözüm ekranı gelecekte “branch’i bütünüyle al” yerine alan bazlı mine/theirs çözüm sunabilir mi?

Kaynak bundle’larına root package.json/lockfile da eklenebilir mi? Şu an kullanılan gerçek React Flow/Zustand/d3 sürümlerini bu nedenle doğrulayamıyorum.

Öncelik sırası olarak ben ilk önce reconnect correctness + IndexedDB staging’i kapatır, ardından gerçek 100/1k/10k synthetic benchmark kurup store/preview optimizasyonuna geçerdim. React Flow’u değiştirmek veya CRDT/Jotai gibi daha büyük mimari hamleler şu aşamada erken; mevcut yapıda 1k ölçeği için düzeltilebilecek çok daha ucuz ve ölçülebilir darboğazlar var.
