---
tags:
  - arastirma/yanit
  - kaynak/web
  - baslik/04
baslik: Frontend, Ölçek ve Erişilebilirlik
tur: web
tur_no: 1
kelime: 3955
sohbet: https://chatgpt.com/c/6a7f0010-06f0-83eb-aeec-2392dc6ddee6
kaynak: 04-frontend.md
---
> [!abstract] Web kaynaklı yanıt (koda atıfsız)
> Sorular: [[04 Frontend, Ölçek ve Erişilebilirlik - sorular]]

Aşağıdaki değerlendirme 14 Ağustos 2026 itibarıyla güncel dokümantasyona göre yapıldı. Referans sürümler: React Flow 12.11.3 (12 Ağustos 2026), Zustand 5.0.15, D3 7.9.0, d3-hierarchy 3.1.2; ELK kullanılırsa güncel elkjs sürümü 0.12.0. 
npm
+4
React Flow
+4
npm
+4

Yönetici özeti

Zustand'ı Jotai/Recoil'e taşıman gerekmiyor. Asıl problem store büyüklüğü değil, geniş abonelikler ve farklı frekanstaki durumların birbirine bağlanması.

canonical + staging aynı mantıksal transaction alanında kalmalı; presence/WS ephemeral state ve panel/UI state ayrılmalı.

React Flow 1k civarında kullanılabilir, ancak bütün nodes/edges dizilerine abonelik ve pahalı node DOM'ları hızla darboğaz olur. 
React Flow
+1

10k React DOM node render etmek hedef olmamalı; 10k veri tutabilirsin ama görünüm semantic zoom/culling/aggregation yapmalı.

Staging preview için bütün grafı her tuşta yeniden replay etmek yerine normalized canonical graph + patch overlay kullanılmalı.

Metin eşzamanlı düzenlemesinde şimdilik CRDT eklemem; presence tabanlı soft edit-lock + mevcut branch conflict sistemi mimarine daha doğal oturuyor.

HTTP mutation + WS broadcast mimarini korurdum; seq sayesinde reconnect/gap recovery özellikle temiz yapılabilir.

Mind-map için saf tree + sabit/benzer node ölçülerinde d3-hierarchy gayet uygun ve tree algoritması lineer zamandır. 
D3.js

Değişken node ölçüsü, compound graph veya gerçek edge routing gerekirse ELK daha doğru araçtır. 
React Flow
+1

React Flow'un a11y desteği iyi bir başlangıç ama genel directed graph için standart bir ARIA pattern yok; alternatif semantik görünüm gerekli.

Kenarlarda desen kullanman doğru; renk + çizgi deseni + mümkünse etiket/ikon ile üçlü kodlama yap.

Mobilde desktop-parity yerine Miro benzeri view-first + explicit edit yaklaşımını öneriyorum. 
Miro Help Center

Staging değişikliklerini IndexedDB'ye sürekli kaydet; sekme kapanışını kurtarma mekanizması olarak görme.

i18n'i ikinci dil çıkmadan önce kurmak şu anda ucuz; uygulama büyüdükten sonra hard-coded metin temizliği çok daha pahalı olur.

En kritik kısa vadeli işler: store subscription audit + staging overlay + IndexedDB draft + presence + a11y keyboard model.

Bulgular
1. Zustand store mimarisi
İddia

Tek Zustand store için anlamlı bir “1.000 node'da bozulur” sınırı yok. Ölçek problemi state'in kaç byte olduğu değil, değişikliklerin kaç subscriber'ı uyandırdığı ve selector'ların ne kadar geniş olduğu.

Zustand subscribeWithSelector ile state'in bir bölümüne selector/equality üzerinden abone olmayı destekliyor; resmi yaklaşım büyük store'ların “slice”lara ayrılmasını da destekliyor. Jotai'nin atom modeli ise bağımsız parçaların yalnız kendi değişikliklerinde render tetiklemesini doğal hale getiriyor. 
Zustand Documentation
+1

React Flow'un kendi performans dokümanı da özellikle şu anti-pattern'i gösteriyor:

TypeScript
useStore(s => s.nodes)

sonra component içinde filter() etmek. nodes dizisi drag gibi operasyonlarda sürekli değiştiği için ilgili olmayan component'ler de render oluyor. React Flow bunun yerine örneğin selectedNodeIds gibi ayrı state tutulmasını öneriyor. 
React Flow

Co-Pronoia'ya etkisi

Ben store'u yalnız feature bazında değil update frequency / persistence semantiğine göre bölerdim:

GraphStore
├── canonical
│   ├── nodesById
│   ├── edgesById
│   └── headSeq
│
├── staging
│   ├── intents
│   ├── affectedNodeIds
│   ├── affectedEdgeIds
│   └── revision
│
CollaborationStore
├── websocket status
├── users
├── cursors
├── editPresence
└── remote selections


ViewStore
├── activeView
├── viewport
├── selection
├── expanded/collapsed
└── timeline filters


UIStore
├── panels
├── dialogs
├── menus
└── transient form UI

Ancak canonical + staging'i birbirinden tamamen bağımsız iki store'a ayırmazdım. Çünkü senin projected state'in:

projectedGraph = canonicalGraph + stagedIntents

ve bunların tutarlı snapshot olarak okunması gerekiyor.

Mantıksal olarak aynı graph store içinde slice olabilirler.

Presence ise başka hikâye: cursor 20 kez/s değişebilir ama commit state'i değişmiyor. tldraw'ın güncel store modelinin doğrudan document | session | presence olarak ayrılması da tam olarak bu ayrımı yapıyor: document persisted/synced, session local, presence ephemeral ve persist edilmiyor. 
tldraw
+1

Sonuç: Jotai migration'ı şu anda gereksiz. Önce normalized state + selector disiplini.

2. React Flow ve 1k+ graf performansı

React Flow 12.11.3 güncel sürüm. 12.11.2 sürümünde ayrıca MiniMap'in her store update'inde render edilmemesi, viewport transform'un imperative uygulanması ve pan/pinch sırasında synchronous layout azaltılması gibi doğrudan performans iyileştirmeleri yapıldı. 
React Flow
+1

Resmi performans rehberinin önerileri:

custom node/edge → React.memo

callback → useCallback

object/array props → useMemo

tam nodes/edges dizisine gereksiz subscription yapmama

büyük ağaçlarda node'ları collapse/hide etme

ağır shadow/gradient/animation'ları azaltma. 
React Flow

Ayrıca:

TypeScript
<ReactFlow onlyRenderVisibleElements />

ile viewport dışında kalan node/edge'lerin render edilmemesi sağlanabiliyor. Fakat resmi API özellikle bunun ek overhead getirdiğini ve her durumda daha hızlı olmadığını söylüyor; default false. 
React Flow

Burada önemli ayrım:

onlyRenderVisibleElements bir sihirli “10k node virtualization engine” değil.

React Flow bunun için resmi 1k/10k performans garantisi veya benchmark sınırı yayınlamıyor. Dolayısıyla aşağıdaki tablo benim mühendislik risk sınıflandırmam, resmi React Flow kapasite tablosu değil.

Performans tablosu
Ölçek	Beklenen davranış	Ana darboğaz	Önerilen teknik
~100 node	Rahat	Genellikle uygulama kodu	React.memo, stable callbacks, normal Zustand selectors
~1.000 node	Uygulanabilir, fakat node karmaşıklığı kritik	React rerender + DOM + edge SVG + layout	normalized store, ID selectors, onlyRenderVisibleElements benchmark'ı, collapse, basit node CSS, incremental preview
~10.000 node	Hepsini eşzamanlı DOM'a koymak riskli	DOM/SVG sayısı, hit-testing, React reconciliation, layout	semantic zoom, aggregation, viewport dataset oluşturma, clustering/collapse, yalnız görünür subset'i RF'ye verme
10k veri / 500 görünür	Makul mimari hedef	projection/indexing	full graph model store'da; React Flow'a yalnız görünür/ilgili subset

React Flow resmi örneği “hundreds of nodes and edges” için stress test sunuyor; 10k için resmi garanti vermiyor. Bu nedenle ürün hedefini:

“10k node destekliyoruz” değil, “10k node dataset'te interaktif viewport'u koruyoruz”

şeklinde tanımlamak daha doğru olur. React Flow'un kendi rehberi de büyük grafı collapse ederek aynı anda render edilen node sayısını azaltmayı öneriyor. 
React Flow

Co-Pronoia için özellikle

Şunu yapma:

TypeScript
const nodes = useGraphStore(s => s.nodes)


const NodeInspector = () => {
  const node = nodes.find(...)
}

Şunu hedefle:

TypeScript
const node = useGraphStore(s => s.nodesById[nodeId])

ve güncellemede:

nodesById[node42] -> yeni reference
nodesById[node43] -> aynı reference

Structural sharing burada çok değerli.

3. Staging preview: her tuş vuruşunda full replay yapma

Senin saf:

intent -> ops
ops + graph -> graph'

katmanın frontend açısından çok iyi bir temel.

Sorun şu yaklaşım olur:

keypress
  ↓
clone canonical graph
  ↓
staged intent 1 apply
staged intent 2 apply
...
staged intent N apply
  ↓
React Flow nodes oluştur
  ↓
mind-map layout tekrar yap

1k node'da metin yazarken gereksiz yere pahalılaşır.

Önerilen model
Canonical
nodesById
edgesById


           +
           │


Staging overlay
updatedNodesById
deletedNodeIds
addedNodesById
...


           ↓


Projected selector

Örneğin:

TypeScript
getProjectedNode(id) =
    stagedNodePatch[id]
 ?? canonicalNode[id]

Bir node label'ında:

"API"
→ "API "
→ "API g"
→ "API ge"
→ "API gateway"

yazılırken 1.000 node yeniden oluşturulmamalı.

Yalnız:

node:abc.label

patch'i değişmeli.

Ayrıca local input state

Metin editing'i iki katmanlı yapabilirsin:

<input local state>
      ↓
debounce
      ↓
staging intent
      ↓
projected graph

Her keypress'te staging güncellemek gerçekten görsel preview için gerekmiyorsa 100–250 ms debounce mantıklı olur.

Layout ise metin değişikliğinde yalnız node ölçüsü gerçekten değişirse tekrar çalışmalı.

Web Worker

Worker'ı ilk çözüm olarak kullanmazdım.

Önce:

full replay → incremental overlay

normalized state

cached projection

structural sharing

Bunlardan sonra profile'da layout/preview ana thread'i bloke ediyorsa Worker.

Worker'lar ayrı execution context'te mesajlaşır; ağır CPU işini ana UI thread'inden ayırmak için uygundur. 
HTML Living Standard

Özellikle ELK worker için anlamlı; her harfte tüm graph JSON'unu worker'a taşıyıp geri almak ise kazancı yiyebilir.

4. İki kişi aynı node text'ini düzenlerse?

Burada mevcut mimarin aslında kötü değil.

Figma'nın açıklanan multiplayer modeli seninkine şaşırtıcı derecede benziyor:

Object A
 ├─ x
 ├─ y
 ├─ fill
 └─ text

Farklı property'ler eşzamanlı değişirse çatışma sayılmıyor. Aynı object + aynı property değiştirilirse son server değerine göre sonuçlanıyor.

Daha önemlisi Figma aynı text property'yi karakter bazında merge etmiyor:

B


User A -> AB
User B -> BC


result:
AB veya BC
değil:
ABC

Figma bunu tasarım aracının text editor olmamasıyla gerekçelendiriyor. 
Figma

Sen ise aynı alan değişikliğinde last-writer-wins yerine branch oluşturuyorsun. Bu veri kaybı açısından daha korumacı.

Co-Pronoia için önerim

CRDT'yi şimdi ekleme.

Önce ephemeral editing presence:

TypeScript
type EditingPresence = {
  userId: string
  nodeId: string
  field: "title" | "description"
  updatedAt: number
}

UI:

┌─────────────────────────────┐
│ API Gateway             👤B │
│                             │
│ Beren bu başlığı düzenliyor │
└─────────────────────────────┘

İkinci kişi tıklarsa:

Beren şu anda bu alanı düzenliyor.
[Yine de düzenle]

Bu bir hard lock olmamalı. Connection düşerse zombie lock problemi çıkar.

Presence:

heartbeat
+ TTL
+ blur/unmount release

ile çalışsın.

Gerçek commit sırasında iki taraf yine aynı field'i değiştirmişse mevcut:

field overlap
→ branch

mekanizman devreye girsin.

CRDT ne zaman?

Ancak şu ürün gereksinimi ortaya çıkarsa:

“Aynı uzun açıklamayı 3 kişi Google Docs gibi aynı anda yazabilmeli.”

O zaman text property özelinde CRDT düşünülebilir.

Fakat bu, senin:

before + after snapshot
invert()
commit diff
branch conflict

modelini ciddi şekilde karmaşıklaştırır.

Title / kısa task açıklaması için maliyetine değmez.

5. Presence: Figma / Miro / tldraw'dan çıkarılacak model

tldraw güncel collaboration sistemi aynı dokümanda birden fazla kullanıcının edit yapmasını, cursor görmesini ve birbirinin viewport'unu takip etmesini sağlıyor; ayrıca store kayıtlarını açıkça persisted document, local session ve ephemeral presence diye ayırıyor. 
tldraw
+1

Miro da collaborator cursor'larını açıp kapatma ve diğer kullanıcıları takip etme davranışlarını sunuyor. 
Miro Help Center

Co-Pronoia presence payload'ını küçük tutardım:

TypeScript
{
  userId,
  cursor?: { x, y },
  selectedNodeIds,
  editing?: {
    nodeId,
    field
  },
  viewport?: {
    x, y, zoom
  },
  lastSeen
}

Persist edilmez. Commit değildir. Audit history değildir.

Bu ayrım çok önemli:

Commit = durable truth
Presence = disposable signal

Presence paketini seq sistemine dahil etme.

6. HTTP mutations + WebSocket broadcast
Mevcut mimarini değiştirir miydim?

Hayır.

Senin için:

HTTP
POST /commits
    ↓
transaction
permission
conflict detection
seq allocation
commit
    ↓
HTTP response

çok doğal.

WS:

"canvas head advanced to 1542"

diyor.

Bu separation şu avantajları veriyor:

mutation request/response semantiği net,

auth/error handling kolay,

HTTP retry/idempotency tasarlamak kolay,

permission/branch sonucunu synchronous response ile kullanıcıya verebiliyorsun,

WebSocket'i doğruluk kaynağı yapmak zorunda kalmıyorsun.

Figma'nın kamuya açık multiplayer mimarisinde ise doküman değişiklikleri iki yönde de WebSocket üzerinden sync ediliyor. tldraw sync de persistent realtime collaboration kanalı kullanıyor. Dolayısıyla yüksek frekanslı canvas editor'larda bidirectional persistent sync yaygın bir mimari, ama bu senin hibrit modelinin yanlış olduğu anlamına gelmiyor. 
Figma
+1

Bunun sektör genelinde ne kadar yaygın olduğuna ilişkin güvenilir nicel bir araştırma bulamadım; buradan yüzde vermek doğru olmaz.

Senin mimaride seq büyük avantaj

WS mesajını mümkün olduğunca şöyle düşün:

JSON
{
  "type": "canvas_head",
  "canvasId": "...",
  "seq": 527
}

Client:

localSeq = 524
incoming = 527


expected = 525


GAP!
↓
GET commits?after=524
↓
525
526
527
↓
apply

WS packet kaybolsa bile sorun yok.

Reconnect:

1. reconnect
2. GET commits after localSeq
3. catch up
4. live WS devam

Bu, append-only commit mimarinin frontend tarafındaki en güçlü özelliklerinden biri.

7. Zihin haritası layout
d3-hierarchy

D3 7.9.0, d3-hierarchy 3.1.2 güncel paket sürümleri. 
npm
+1

D3 tree layout Reingold–Tilford tidy tree algoritmasını, Buchheim iyileştirmesiyle linear time çalıştırıyor. 
D3.js

Bu yüzden:

1.000 node
single rooted tree
known dimensions

durumunda saf layout matematiği tek başına çok korkutucu değil.

Asıl sorun:

layout
+ DOM measure
+ React render
+ edges
+ node dimensions

kombinasyonu.

React Flow'un resmi layout rehberi de d3-hierarchy için:

single-root tree uygun,

dynamic node sizes ❌,

subflows ❌,

edge routing ❌

diyor. 
React Flow

Co-Pronoia'daki parentId

Burada D3 çok mantıklı çünkü sen zaten gerçek bir tree semantiğine sahipsin:

parentId

Ancak bir ayrım yap:

graph edges ≠ mind-map hierarchy

Mind map layout yalnız parentId ağacına göre yapılmalı.

Ek dependency/relationship edges layout'u bozmamalı.

Algoritma karşılaştırması
Algoritma	Co-Pronoia mind map	Değişken node ölçüsü	Edge routing	Compound/subflow	Karmaşıklık
d3-hierarchy tree	Çok iyi	Zayıf	Yok	Yok	Düşük
Dagre	İyi	İyi	Yok	Kısmi	Düşük/Orta
ELK Layered	İyi	Çok iyi	Var	Var	Yüksek
ELK Radial	Alternatif mind-map	Kısmi/iyi	Var	sınırlı	Orta/Yüksek
force layout	Mind-map için genelde kötü	İyi	Yok	Yok	Iterative

React Flow'un güncel karşılaştırması Dagre'yi hızlı/simple directed graph, ELK'yi ise çok daha configurable engine olarak tanımlıyor. ELK Layered ayrıca straight/orthogonal/spline routing, port constraints ve compound graph destekliyor. 
React Flow
+1

Tavsiyem

Şimdilik d3-hierarchy'yi bırak.

Ama layout invalidation kuralı getir:

label content changed
    ↓
node dimensions same?
    ↓ yes
NO RELAYOUT

Şunlarda relayout:

parentId changed
node added/deleted
collapse changed
measured node dimensions changed
orientation changed

ELK'ye ancak node ölçü çeşitliliği gerçekten sorun olmaya başladığında geç.

8. Accessibility: React Flow yeterli mi?

React Flow 12'nin a11y desteği önceki sürümlere göre ciddi.

Varsayılan olarak:

node ve edge'ler keyboard focusable,

Tab navigation,

Enter/Space selection,

Escape deselect,

arrow keys ile node movement,

focuslanan node'a auto-pan,

ARIA descriptions,

ariaLabelConfig,

live announcements

sunuyor. 
React Flow

Ancak burada önemli bir problem var:

ARIA Authoring Practices içinde genel “directed graph editor” pattern'i yok.

W3C'de tree, treegrid, grid, listbox vb. composite widget pattern'leri var; arbitrary cyclic directed graph için standart bir widget pattern'i yok. 
W3C
+1

Dolayısıyla role="tree" deyip flow graph'ı tree ilan etmek yanlış olur.

Benim modelim
Zihin haritası

Gerçek parentId hierarchy var:

tree/treeitem

semantiği uygulanabilir.

Flow diagram

Canvas'a ek olarak ekran okuyucuya:

Düğümler
  API Gateway
    Gelen bağlantılar:
      Client
    Giden bağlantılar:
      Auth Service
      User Service


  Auth Service
    Gelen:
      API Gateway

gibi bir semantik graph explorer sağla.

Timeline için yine list/table semantiği görsel kanvastan daha uygundur.

Bu, WCAG 1.3.1'in görsel olarak sunulan ilişki ve yapının programmatically determinable veya metinsel eşdeğeri olma beklentisine daha iyi cevap verir. 
W3C

9. 1.000 node'da Tab problemi

React Flow'un varsayılanı:

Tab
node
Tab
node
Tab
edge
Tab
edge
...

ve bu erişilebilirlik açısından başlangıçta iyi. 
React Flow

Ama:

1000 node + 1600 edge = 2600 tab stop

kullanışlı değildir.

Büyük graf için canvas'ı composite widget gibi ele alıp:

Tab → graph
Arrow → graph içinde navigate
Enter → node
Tab → node içindeki controls
Escape → graph

gibi roving-focus modeli daha ölçeklenebilir.

WAI-ARIA APG composite widget'larda roving tabindex veya managed focus modelini öneren örnekler sunuyor. 
W3C

Navigasyon kuralı görünüm bazlı olabilir:

Mind map

↑ parent
↓ first child
← previous sibling
→ next sibling

veya geleneksel tree pattern.

Flow

Alt+↑ incoming
Alt+↓ outgoing
Arrow keys spatial nearest-node

Timeline

← previous task
→ next task
↑ previous lane
↓ next lane
10. A11y denetim listesi

 Tüm temel operasyonlar keyboard ile yapılabiliyor. Node seç, taşı, sil, düzenle, parent değiştir, bağlantı oluştur. WCAG 2.1.1 / 2.5.7. Drag'e mutlaka non-drag alternatif getir. W3C 2.5.7 açıkça drag işlemleri için tek-pointer alternatifi istiyor. 
W3C

 Node taşıma için: arrow keys veya “Konumlandır” menüsü bulunuyor.

 Edge oluşturma için: drag handle dışında “Bağlantı ekle → hedef seç” akışı bulunuyor. WCAG 2.5.7. 
W3C

 Focus görünür. Seçili node ile keyboard focus aynı görsel state olarak gösterilmiyor. WCAG 2.4.7. 
W3C

 Focus panel/modal açıldığında kaybolmuyor ve kapanınca mantıklı yere dönüyor.

 1000 elemanı Tab sırasına koymak yerine composite navigation değerlendiriliyor. 
W3C

 Mind-map parent/child ilişkisi semantik olarak sunuluyor. WCAG 1.3.1. 
W3C

 Flow graph için alternatif node/relationship explorer var.

 Edge accessible name örneği: "Bağımlılık: API Gateway → Database".

 Node accessible name yalnız "Node" değil: "API Gateway, durum: devam ediyor, 3 bağlantı".

 ariaLabelConfig tamamen Türkçeleştiriliyor. React Flow bunu doğrudan destekliyor. 
React Flow

 Dynamic commit/branch/conflict olayları uygun aria-live mesajıyla duyuruluyor.

 Renk tek bilgi kanalı değil. WCAG 1.4.1. 
W3C

 Focus border, node sınırları ve anlam taşıyan edge/ikonlar yeterli non-text contrast taşıyor; WCAG 1.4.11 anlamlı UI/grafik objelerde kontrast ister. 
W3C

 Normal metin minimum 4.5:1, büyük metin 3:1 hedefleniyor. WCAG 1.4.3. 
W3C

 Touch target'lar WCAG 2.5.8 minimumlarını sağlıyor; pratikte handle'lar minimumdan daha büyük tasarlanıyor. 
W3C

 Tooltip yalnız hover'a bağlı değil; focus ile de açılıyor ve dismiss edilebiliyor. WCAG 1.4.13. 
W3C

 Zoom yapılınca node text'i bitmap olmuyor; gerçek DOM text kalıyor.

 prefers-reduced-motion açıkken animated edges, smooth auto-layout transitions, collaborator cursor interpolation ve aggressive auto-pan azaltılıyor.

 “Reduce motion” ayarı kullanıcı tarafından ayrıca override edilebiliyor. Miro da accessibility ayarlarında doğrudan Reduce Motion sunuyor. 
Miro Help Center

11. Kenar renkleri

Şimdiki tasarım:

flow        mavi       düz
loop        turuncu    düz?
dependency  mor        kesik
relation    gri        noktalı

Burada zaten önemli bir şeyi doğru yapıyorsun: renk tek başına kullanılmıyor.

WCAG 1.4.1, rengi tek bilgi kanalı olarak kullanmamayı gerektiriyor. 
W3C

Ancak flow ve loop yalnız renk farklıysa hâlâ sorun var.

Ben:

Flow
──────▶


Loop
──↻──▶


Dependency
- - - ◆ - - -▶


Relation
· · · ○ · · ·

gibi stroke + marker/icon + optional label yapardım.

Edge seçildiğinde:

◆ Bağımlılık

etiketi görünür olabilir.

Her edge'e sürekli text label koymak 1k edge'de görsel karmaşa yaratabilir; legend + selection label yeterli olabilir.

Ayrıca zoom-out'ta dotted/dashed ayrımı kaybolacağından semantic zoom'da marker shape daha güvenilir hale gelir.

12. Mobil / dokunmatik

React Flow dokunmatik interaction destekliyor. Güncel resmi örnekte iki handle'a sırayla tap ederek connection kurulabiliyor ve touch için handle boyutları özellikle büyütülüyor. 
React Flow

12.11.3 ayrıca touch panning ile selection rectangle etkileşimine ilişkin bir düzeltme içeriyor. 
React Flow

Fakat “touch destekleniyor” ile “desktop editor mobile'da ergonomik” aynı şey değil.

Miro'nun güncel mobil davranışı çok öğretici:

board view-only mode'da açılıyor,

kullanıcı nesneyi seçip Edit diyor,

double tap text,

long tap move,

pinch zoom,

connector çizilebiliyor. 
Miro Help Center

Co-Pronoia için
Telefon

Default:

NAVIGATION MODE

pan/zoom

inspect

search

comments

simple text/status/date edit

node ekleme

tap→tap edge

Push

Advanced operations:

region drawing
mass selection
complex reparent
branch compare/merge visualization
layout configuration

desktop/tablet odaklı olabilir.

Tablet

Daha yakın full editor.

Bence salt okunur mobile zorunlu değil, ama “desktop UI'ı küçültüp telefona koymak” da yanlış.

Miro yaklaşımı iyi orta yol.

13. Sekme kapanırsa staging

Burada bence mevcut sistemin en önemli UX açığı olabilir.

Çünkü senin ürününde:

editing ≠ saved on server

Push yapılana kadar.

Kullanıcı 20 dakika çalışıp browser'ı kapatırsa bunların kaybolması ciddi güven kaybı oluşturur.

localStorage değil mi?

Küçük preference için evet.

Staged graph intentleri için IndexedDB daha uygun.

IndexedDB browser içinde structured records ve indexes için standart persistent database API'sidir; IndexedDB 3.0 güncel W3C specification'dır. 
W3C

Persist:

TypeScript
type StagingDraft = {
  canvasId: string
  baseSeq: number


  intents: Intent[]


  localRevision: number
  updatedAt: number


  schemaVersion: number
}

Persist etme:

projectedGraph

Çünkü türetilebilir.

On boot:

IndexedDB staging found
        ↓
server head = 145
draft baseSeq = 139
        ↓
fetch 140..145
        ↓
recompute projection
        ↓
"Kaydedilmemiş değişikliklerin geri yüklendi"

Push yapılınca IndexedDB draft temizlenir.

Zustand'ın persist middleware'i de localStorage yanında custom/async storage modellerine uyarlanabilir. 
Zustand Documentation

14. Offline gerçekten desteklenmeli mi?

İki farklı şeyi ayır:

A. Network kopunca çalışmaya devam etmek

Bunu evet yap.

Bağlantı kesildi
↓
local staging devam
↓
IndexedDB
↓
reconnect
↓
catch up
↓
push

Mevcut conflict/branch sistemin bunu zaten kolaylaştırıyor.

B. Tam offline-first uygulama
browser aç
sunucu yok
full canvas snapshot
edit
days later merge

Bunu şimdilik yapmazdım.

Çünkü permission/region membership/AI rules vb. server doğruluğuna bağlı.

15. Bağlantı UI'sı

“Kaydedildi” sözcüğünü dikkatli kullan.

Senin modelinde dört farklı durum var:

✓ Sunucu ile güncel


● 4 yerel değişiklik
  Henüz Push edilmedi


⚠ Bağlantı kesildi
  Değişikliklerin bu cihazda saklanıyor


↻ Yeniden bağlanıyor
  Sunucu değişiklikleri alınıyor


⚠ Çakışma
  Değişikliğin ayrı bir dala kaydedildi

Özellikle:

local persisted ≠ server committed

kullanıcıya dürüstçe ayrılmalı.

16. Reconnect algoritması

Senin seq sistemin sayesinde basit:

WS CLOSED
   ↓
presence -> offline
   ↓
staging devam
   ↓
retry with exponential backoff + jitter
   ↓
WS OPEN
   ↓
GET /commits?after=lastAppliedSeq
   ↓
apply missing commits
   ↓
re-expand staged intents
   ↓
live

Push sırasında baseSeq zaten eskiyse server senin mevcut conflict algoritmanı uygulayacak.

Bu nedenle client'ta ikinci bir conflict engine yazma.

Client yalnız preview verir; server authoritative kalır.

17. i18n: şimdi mi sonra mı?

Şimdi altyapıyı koy, çeviri yapmayı sonra düşün.

Bu ikisi farklı işler.

Bugün:

TypeScript
<Button>Değişiklikleri Gönder</Button>

yerine:

TypeScript
<Button>{t("commit.push")}</Button>

yazmaya başlamak ucuz.

UI 3× büyüdüğünde 1.500 hard-coded string'i çıkarmak pahalı olur.

React Flow'un kendi accessibility mesajları dahi ariaLabelConfig ile lokalize edilebiliyor; yani i18n sadece görünür UI değil ekran okuyucu metinlerini de kapsamalı. 
React Flow

react-i18next vs FormatJS
react-i18next

Co-Pronoia için ilk tercihim olur.

React entegrasyonu, interpolation/plural sistemleri ve incremental migration açısından rahat. Güncel dokümantasyonu plural desteğini Intl.PluralRules ile kullanıyor. 
i18next React Documentation
+1

FormatJS / React Intl

Daha güçlü ICU-message-centric sistem istersen çok iyi. Date, number, plural, relative time ve ICU Message Syntax'i doğrudan merkeze koyuyor. 
formatjs.github.io
+1

Senin ürün için ben:

react-i18next + native Intl

ile başlardım.

18. Türkçe'nin özel meseleleri

Türkçenin çoğul sistemi İngilizce kadar problemli değil; CLDR kuralları zaten kütüphaneler tarafından yönetiliyor. Tarih formatları ise Türkçe locale'e özgü: örneğin uzun tarih yapısı d MMMM y, kısa tarih d.MM.y, saatler 24 saat formuna dayanıyor. 
Unicode
+1

Daha önemli tuzak:

I ↔ ı
İ ↔ i

Unicode doğrudan Turkish-specific case mapping tanımlıyor. 
Unicode
+1

Dolayısıyla arama gibi yerlerde:

TypeScript
value.toLowerCase()

üzerinden ASCII/English mantığına güvenme.

Locale-aware casing/collation kullan:

TypeScript
str.toLocaleLowerCase("tr-TR")

ve sıralama/arama gerektiğinde:

TypeScript
new Intl.Collator("tr-TR")

mantığında ilerle.

Ayrıca domain core'da kullanıcıya gösterilecek cümle saklamam:

TypeScript
throw new Error("Bu bölgeyi düzenleyemezsiniz")

yerine:

TypeScript
errorCode = "REGION_EDIT_FORBIDDEN"

Web:

REGION_EDIT_FORBIDDEN
→ i18n
→ "Bu bölgeyi düzenleyemezsiniz."

Böylece shared zero-dependency katmanı da temiz kalır.

Öneriler: S / M / L
Boyut	Öneri	Neden	Yapılmazsa
S	Zustand subscription audit	En ucuz performans kazancı	Node drag/presence ile gereksiz rerender büyür
S	Node/edge'leri normalized byId yap	Fine-grained update	Her değişiklik array churn yaratır
S	Custom nodes memo, callbacks stable	React Flow resmi önerisi	1k graf erken yavaşlar
S	onlyRenderVisibleElements A/B benchmark	Büyük graf potansiyel kazanç	Gereksiz DOM render; fakat körlemesine açılırsa overhead de gelebilir
S	React Flow ariaLabelConfig Türkçeleştir	Mevcut a11y mesajları İngilizce kalmasın	Screen reader UX karışık olur
S	Edge legend + loop için ikinci visual code	WCAG 1.4.1	Color-blind kullanıcı loop/flow ayıramaz
S	prefers-reduced-motion	Accessibility	Motion-sensitive kullanıcılar zorlanır
M	Canonical/staging incremental overlay	Her keypress full graph replay'i kaldırır	1k node'da editing latency belirginleşir
M	Presence store + edit presence	Concurrent editing anlaşılır olur	Kullanıcılar sürekli branch yaratır
M	IndexedDB staging persistence	Staged çalışma kaybolmaz	Tek tab close büyük veri kaybı hissi yaratır
M	WS seq gap recovery	Broadcast güvenilirliğini artırır	Missed event'te client sessizce stale kalabilir
M	Mobile view/edit modes	Touch ergonomisi	Node'lar yanlışlıkla taşınır, telefon UI'sı kaotik olur
M	i18n infrastructure	Gelecekteki migration'ı ucuzlatır	String extraction borcu büyür
M	Composite keyboard navigation	1k+ graf erişilebilir olur	Binlerce Tab stop oluşur
M	Accessible graph/tree explorer	Ekran okuyucu için gerçek graph semantiği	Canvas teknik olarak focusable olsa da graph anlaşılmaz
L	Semantic zoom / aggregation	10k dataset ölçeği	10k visual node doğrudan DOM sınırlarına çarpar
L	ELK worker pipeline	Karmaşık layout büyürse	Main-thread layout hitch'leri
L	Text CRDT	Yalnız gerçek simultaneous prose editing gerekirse	Şu an yapılırsa mimari karmaşıklık karşılıksız artar
Ben olsam uygulanma sırası

1. Store'u yeniden yazmadan önce ölçüm.

React Profiler + custom counters:

node renders / drag
projection ms
layout ms
React Flow render ms
WS event -> screen latency

2. Store shape:

canonical + staging
presence
view
ui

olarak ayrılır.

3. Canonical graph normalize edilir.

nodesById
edgesById

4. Full staging replay → incremental overlay.

Bu muhtemelen en büyük architectural performance kazancı olur.

5. Presence sistemi.

cursor
selection
editing field

WS üzerinden.

6. IndexedDB.

Staging kaybolmaz.

7. A11y keyboard architecture.

1k node olmadan yapmak daha kolay.

8. Mobile view/edit mode.

9. i18n shell.

Çeviri gerekmiyor; sadece hardcoded string büyümesini durdur.

10. 5k–10k synthetic graph benchmark.

Ancak bundan sonra ELK/worker/Jotai gibi büyük değişikliklere karar ver.

Açık sorular

Bunlar kod deposu olmadan kesin karar veremeyeceğim noktalar:

Node React component'leri ne kadar ağır? Markdown, textarea, icon, tooltip, avatars vb. 1k performansını node sayısından daha çok değiştirebilir.

Zustand'da bugün component'ler ne ölçüde state => state.nodes / state => state gibi geniş subscription kullanıyor?

Staging preview şu an gerçekten her intent'te bütün graph'ı clone/replay mi ediyor, yoksa structural sharing var mı?

Node label değişince mind-map layout her keypress'te mi çalışıyor?

React Flow'a canonical node array mi veriliyor, yoksa ayrı view projection katmanı var mı?

Flow/mind-map/timeline aynı node component'lerini mi kullanıyor?

1.000 node hedefindeki tipik edge sayısı nedir: 1k, 3k, 10k?

Node boyutları fixed mi, content-dependent mi? Bu cevap D3 ↔ ELK kararını ciddi değiştirir.

Presence bugün hiç yok mu, yoksa WebSocket'te kullanıcı/cursor mesajları başlamış durumda mı?

Push edilmemiş staging'in ortalama ömrü ne? Kullanıcılar 10 saniyede bir mi, 30 dakikada bir mi Push ediyor?

“10k+ commit” yalnız history miktarı mı; frontend başlangıçta bunları replay ediyor mu, yoksa server materialized current state gönderiyor mu?

Flow graph'ta keyboard navigation için en önemli semantik “spatial komşu” mu, yoksa edge predecessor/successor mı?

Mobile ürün hedefi gerçek düzenleme mi, yoksa esas kullanım desktop ve mobile yalnız hızlı review/edit mi?

Son karar

Mevcut frontend yönünde temel bir teknoloji değişikliği önermiyorum:

React
+ React Flow
+ Zustand
+ d3-hierarchy

1000+ node hedefi için hâlâ makul.

Asıl dönüşüm şu olmalı:

           BUGÜN
one large reactive state
        ↓
whole graph projection
        ↓
React Flow


             HEDEF
durable canonical ──────┐
staging delta ──────────┼→ cached view projection → React Flow
                        │
presence ───────────────┘  (ayrı subscription domain)
view/UI ─────────────────  (ayrı subscription domain)

Ve özellikle commit/staging modelini frontend optimizasyonu uğruna bozmazdım. Tam tersine, seq, deterministic intent expansion ve staged deltas sana React tarafında incremental projection, reconnect recovery ve offline draft konusunda normal realtime canvas uygulamalarından daha temiz bir temel veriyor. 
React Flow
+2
tldraw
+2
