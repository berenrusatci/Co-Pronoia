# Co-Pronoia

Ağaç tabanlı, **çok kullanıcılı** geliştirme planlama uygulaması. Planınızı düğümler halinde kurar; aynı veriyi üç görünümde sunar, her değişikliği yazarıyla birlikte numaralı bir commit olarak kaydeder ve eşzamanlı çakışmaları dallara ayırır.

## Giriş ekranı

İki panelli tasarım: solda karanlık marka paneli (logo, slogan ve site yöneticisinin yüklediği önizleme görseli — yoksa örnek bir çizim gösterilir), sağda giriş/kayıt formu. 900px altında panel altlı üstlü sıralanır.

- **Kayıt e-posta doğrulaması gerektirir**: kayıt formu hemen hesap açmaz, e-postanıza 6 haneli bir kod gönderilir (10 dakika geçerli, en fazla 5 deneme); "Kodu tekrar gönder" ile yeniden istenebilir. Google ile girişte bu adım atlanır (Google e-postayı zaten doğrulamıştır).
- `?davet=TOKEN` (kanvas daveti) veya `?grupDavet=TOKEN` (grup daveti) linkiyle gelindiyse giriş/kayıt sonrası ilgili davet otomatik işlenir.

## Pano, kanvaslar ve gruplar

Giriş yaptıktan sonra **pano** açılır: kanvaslarınızı listeler, yeni kanvas oluşturur. Yeni hesap boş başlar — ilk kanvası kullanıcı kendisi oluşturur (kanvas, adını taşıyan bir kök düğümle açılır).

- Her kanvasın verisi (düğümler, bağlantılar, commit geçmişi, dallar) tamamen ayrıdır; commit numaraları kanvas başına 1'den başlar.
- Bir kanvasa başkasını eklemenin **tek yolu davet linkidir**: karttaki (veya kanvas içindeki araç çubuğundaki) **🔗 Davet linki** butonu `…/?davet=TOKEN` linkini panoya kopyalar. Linki açan kişi giriş/kayıt sonrası kanvasa otomatik üye olur ve doğrudan kanvasa düşer.
- Üye olmayan kullanıcı kanvası göremez (API 404 döner).
- Panoda **⚙ Kullanıcı ayarları** bölümünden şifre değiştirilir (diğer oturumlar kapatılır); sahibi olduğunuz kanvası **Sil** ile kalıcı olarak silersiniz — kanvası açık olan herkes anında panoya düşürülür.
- **Gruplar**: kanvasların üzerinde isteğe bağlı bir organizasyon katmanı. Herhangi bir kullanıcı grup kurabilir (kurucu = grup admini), davet linkiyle üye çağırabilir; katılan kişi grup adminince onaylanana kadar **beklemede** (`pending`) kalır ve katılırken kısa bir unvan (`jobTitle`) girer. Grup adminleri özel roller tanımlayıp bu rollere üye yönetimi/rol yönetimi/kanvas oluşturma yetkisi ve varsayılan kanvas erişimi (`yok`/`görüntüle`/`düzenle`) atayabilir. Yeni kanvas oluştururken bir grup seçilirse kanvas panoda o grubun altında klasörlenir.

## Roller, üyeler ve bölgeler

- **Roller**: kanvas sahibi (**sahip**) her şeyi yapar; **editör** (davetle katılan varsayılan) grafiği düzenler; **görüntüleyici** salt okunurdur. Üyeler panelinden sahip rol atar ve üye çıkarır; çıkarılan kullanıcının erişimi (ve WS bağlantısı) anında kesilir.
- **Kimler aktif**: araç çubuğundaki baş harf çipleri ve Üyeler panelindeki yeşil noktalar kanvasa o an bağlı herkesi gösterir.
- **Bölgeler**: sahip, akış görünümünde ad ve açıklama verip dikdörtgen bölgeler tanımlar (sürükleyip boyutlandırır) ve her bölgeye üye atar. Bölgenin **içindeki** düğümleri yalnızca o bölgeye atanan üyeler (ve sahip) değiştirebilir — düğüm ekleme/taşıma/silme, bir ucu bölgede olan **kenarların** eklenmesi/silinmesi/düzenlenmesi (silme kaskadları dahil) ve bölgeye dokunan commit'lerin geri alınması/geri yüklenmesi/dal birleştirmesi dahil; ihlal daha düzenleme anında ve sunucuda Türkçe hatayla engellenir. Bölge dışı düğümler her editöre açıktır. Her bölge ayrıca "ajan bu bölgeye dokunabilir mi" (`aiAllowed`) anahtarını taşır.

## Push (değişiklikleri biriktirme)

Düzenlemeler artık anında veritabanına yazılmaz: yaptığınız her şey yerelde birikir (kartlarda `yeni•` rozeti), araç çubuğundaki **⬆ Push (N)** butonu bekleyen değişiklik sayısını gösterir. Push'a basınca hepsi **tek numaralı commit** olarak gönderilir ve ancak o zaman geçmişe/zaman çizelgesine yazılır; **Vazgeç** bekleyenleri atar. Push sırasında araya başka commit girmişse bilinen kurallar işler: ayrıksa otomatik merge, çakışıyorsa dal.

## Görünümler

- **Zihin Haritası** — `parentId` hiyerarşisinden otomatik yerleştirilen ağaç (d3-hierarchy). Düğüm üzerine gelince çıkan **+** ile alt düğüm eklenir.
- **Akış Diyagramı** — serbest konumlandırma; düğümleri sürükleyin, kenar noktalarından ok çekerek bağlantı kurun. Bölgeler burada dikdörtgen olarak görünür.
- **Zaman Çizelgesi** — commit geçmişi akışı + kaydırıcı (scrubber) ile geçmişte gezinme.

Her görünümde **⬇ PDF indir** butonu o anki ekranı (düğümler, açıklamalar ve varsa bölgeler) PNG karolara bölüp tek bir PDF'e dizerek indirir — büyük kanvaslarda görüntü bulanıklaşmadan birden çok sayfaya yayılır.

## Seçim ve bağlantı mekanizmaları

- **Ctrl/Shift+tık** ile birden çok düğüm ve/veya bölge seçilebilir; iki veya daha fazla öğe seçiliyse **seçim bilgi paneli** açılıp her birinin tam açıklamasını listeler (kart üzerine sığmayan metin için).
- Kenar türleri farklı çizgi stilleriyle çizilir: **akış** (düz mavi), **döngü** (turuncu), **bağımlılık** (kesikli mor), **ilişki** (noktalı gri). Ayrıca:
  - **Self-loop** — düğümün kendine bağlanması (düğümün üzerinden kavis)
  - **Çift yönlü** kenarlar (iki uçta ok) ve aynı çift arasında **paralel** kenarlar (yelpaze gibi açılır)
  - **Bağlantılar paneli** — tüm kenarlar madde madde metin olarak: `Kaynak → Hedef (bağımlılık · etiket)`; buradan tür/yön/etiket düzenlenir, silinir, yeni bağlantı eklenir

## Hesaplar ve co-op

- Kullanıcı adı + şifre ile kayıt (e-posta doğrulamalı) / giriş, ya da Google ile giriş. Her commit'te yazar görünür.
- **WebSocket canlı senkron**: biri commit atınca diğer açık oturumlara anında yansır.
- **Çakışma → dal**: iki kişi aynı anda commit atarsa ve değişiklikler ayrıksa otomatik merge edilir; aynı alana dokunuyorlarsa sonraki commit `kullanıcı/cakisma-N` adlı bir dala kaydedilir. Dallar panelinden dal **görüntülenir** (salt okunur), **ana hatta birleştirilir** (tek merge commit'i) veya **silinir** — seçim kullanıcının.

## Commit sistemi

Her ekleme/güncelleme/silme/taşıma otomatik mesajlı, numaralı bir commit olur. Geçmiş panelinden:

- **Görüntüle** — grafiği o commit'teki haliyle salt okunur açar
- **Geri al** — sadece o commit'in tersini yeni bir commit olarak uygular (temiz uygulanamazsa reddedilir)
- **Buna dön** — grafiği o commit'teki haline döndürür (tek yeni commit)

Geçmiş hiçbir zaman yeniden yazılmaz. Ana hat numaralandırmasında dal commit'leri kadar boşluk olabilir (numara sırası globaldir) — bu beklenen davranıştır.

## Gemini ajanı

Sunucuya gömülü doğal dil ajanı: her kanvasta anında kullanılabilir, ayrı bot hesabı veya davet gerekmez. `server/.env` içine `GEMINI_API_KEY` (Google AI Studio anahtarı) yazın ve oturum çerezinizle çağırın. Model seçimi detay düzeyine göredir: prototip `gemini-flash-lite-latest` (geniş ücretsiz kota), detaylı `gemini-flash-latest`; kota/yoğunluk hatasında otomatik diğer modele düşülür. `GEMINI_MODEL_PROTO` / `GEMINI_MODEL` env değişkenleriyle ezilebilir.

```bash
curl -s -X POST http://localhost:3001/api/canvases/<kanvasId>/agent \
  -H 'Content-Type: application/json' -b 'tm_session=<çerez>' \
  -d '{"prompt":"backend bölgesine üç adımlı auth akışı çiz"}'
# → {"reply":"...","committed":true,"commitSeq":42,"opCount":5}
```

Özet istekleri (`"özetle"`, `"listele"`) kanvasa dokunmadan metin döner; değişiklik istekleri tek commit olarak gider ve normal kurallardan geçer: ajan **isteği yapan kullanıcı adına** çalışır, yani viewer'lar yazamaz, bölge kuralları aynen uygulanır (`aiAllowed=false` bölgelere ajan dokunamaz), çakışmada dal açılır (`branched: true`). Ajan kullanıcının yazabildiği bölgeleri bilir ve yazamadıklarına dokunmaz; bir bölge adı verilirse yeni düğümler o dikdörtgenin içine, bölgenin açıklaması dikkate alınarak yerleştirilir. Yeni düğümler varsayılan olarak bağımsızdır (köke bağlanmaz); açıkça "şu düğümü alt adımlara böl" denirse hiyerarşi kurulur.

Panelde iki bağımsız anahtar var:

- **Prototip / Detaylı** — çizim ayrıntısını seçer: `proto` 3-6 düğümlük iskelet, `detailed` açıklamalı ve bağımlılık kenarlı kapsamlı döküm.
- **+ Parça parça** — açıksa ajan işi en fazla 6 parçaya bölüp her parçayı ayrı bir commit olarak (canlı, tek tek ekranda belirecek şekilde) işler; bir parça dal açar veya başarısız olursa süreç Türkçe bir notla durur, önceki parçalar commit'li kalır.

Kanvasta düğüm(leri) ve/veya bölge(leri) seçin (**Ctrl/Shift+tık** ile çoklu) — seçim ajan panelinde kaldırılabilir "Seçili:" rozetleri olarak görünür ve `selectedIds` ile ajana gider; *"bu adımları detaylandır"*, *"şu adımı yeniden adlandır"*, *"bundan sonrasını şöyle çiz"* gibi komutlar seçili öğelere uygulanır (bir bölge seçildiyse açıklaması ve içindeki tüm düğümler de bağlam olarak gider). Kanvas **sahibi** için ajan, çizim isteğine uygun görürse en fazla 4 yeni bölge de önerip oluşturabilir (`aiAllowed` zorla açık gelir); sahip olmayanlarda bu kapalıdır. Anahtar tanımlı değilse uç 503 döner.

Üçüncü bir mod olarak **"zihin haritasını akışa dök"** isteği (`"hiyerarşiyi akış diyagramına aktar"`, `"her bölgeyi ayrı diyagram olarak diz"` gibi) ajanı `layout` moduna geçirir: bu modda LLM sadece isteği sınıflandırır, koordinat/kenar üretmez — yerleşim `shared/src/flowLayout.ts`'teki saf, deterministik bir motorla sunucu tarafında hesaplanır. Yazılabilir ve `aiAllowed` açık her bölgenin düğümleri kendi dikdörtgeni içinde düzenli bir ağaç olarak dizilir, bölge-içi `parentId` bağları akış kenarına dönüşür; bölgeler arası bağ kurulmaz, bölgesiz düğümler ayrı bir kümede toplanır, kapalı/izinsiz bölgelere dokunulmaz.

## Co-Pronoia: MCP ile çoklu-ajan paralel planlama

**Co-Pronoia**, dış yapay zekâ ajanlarının (ör. birden fazla Claude Code oturumu) aynı kanvas üzerinde **paralel plan önerileri** üretip bir **süpervizör ajanın** bu önerileri denetleyerek "en uyumlu planı" oluşturduğu ayrı bir kanvas/grup türüdür. Normal kanvaslar hiçbir şekilde etkilenmez; tüm davranış `co-pronoia` türüyle kapılanır.

**Kurulum akışı:**

1. **Co-Pronoia grubu** kurun (grup oluştururken tür seçimi) — co-pronoia kanvası yalnızca bu türdeki gruplarda açılabilir; aynı grupta normal kanvaslar da olabilir.
2. **Ajan rolleri** tanımlayın — iki düzeyden: site admini **Yönetim → Ajan Rolleri** sekmesinden herkese açık şablonlar, grup adminleri grup kartındaki **🤝 Ajan rolleri** panelinden gruba özel roller. Bir rol = ad + **persona** metni (bağlanan ajana brifing olarak aynen iletilir) + **süpervizör** bayrağı.
3. Kanvas içindeki **🤝 Co-Pronoia** panelinden (yalnızca sahip) rol seçip **ajan anahtarı** basın. Ham anahtar (`tma_…`) yalnızca bir kez gösterilir — sunucu sha256 özetini saklar; panel yapıştırmaya hazır bir `.mcp.json` parçası da verir. Anahtar istendiği an iptal edilebilir (bağlı ajan 401 alır).
4. Ajanı bağlayın — herhangi bir MCP istemcisi çalışır:

```json
{ "mcpServers": { "copronoia": {
    "type": "http", "url": "http://localhost:3001/api/mcp",
    "headers": { "Authorization": "Bearer tma_..." } } } }
```

**Çalışma modeli:** Ajanların doğrudan commit atma yolu **yoktur**. Her ajan `get_brief` (rol brifingi + kadro), `get_state`, `submit_proposal` / `update_proposal` / `withdraw_proposal` ve `list_proposals` araçlarını görür; öneriler gönderilirken güncel duruma karşı denenerek doğrulanır ama uygulanmaz. Süpervizör rolündeki token ek olarak `approve_proposal` / `reject_proposal` / `request_changes` araçlarını görür — bir öneri **yalnızca süpervizör onayıyla** kanvasa iner. Onay anında öneri normal commit hattından geçer ("süpervizör + kod birlikte denetler"): doğrulama, bölge koruması ve çakışma kuralları aynen çalışır; onay ile gönderim arasında kanvas değiştiyse öneri normal mekanizmayla bir **dala** kaydedilir ve Dallar panelinden birleştirilebilir. Uygulanan commit'in yazarı, o ajanın anahtarını basan kullanıcıdır (`ajan önerisi: … (ajan/rol, onay: süpervizör)` mesajıyla geçmişte görünür).

Web tarafında öneriler **🤝 Co-Pronoia** panelinde canlı akar (durumlar: `bekliyor / değişiklik istendi / geri çekildi / reddedildi / uygulandı`); insan üyeler normal push/dal/Gemini-ajan akışını aynen kullanmaya devam eder. Kanvas sahibi takılı bir öneriyi panelden **reddedebilir** ama onaylayamaz — onay bilinçli olarak yalnızca süpervizör ajandadır. Uç stateless çalıştığı için ajanlara sunucudan itme yoktur; brifing, kararları `list_proposals` ile yoklamayı söyler.

## Site yönetimi (admin paneli)

`isAdmin` işaretli hesaplar Dashboard araç çubuğundaki **🛡** butonuyla site geneli bir yönetim paneli açar (kanvas/grup üyeliğinden bağımsız):

- **Genel Bakış** — kullanıcı/kanvas/grup/commit sayıları, aktif oturumlar, son 7 gündeki yeni kullanıcılar
- **Kullanıcılar** — arama, admin yap/al, şifre belirleme (hedefin tüm oturumlarını kapatır), oturum iptali, kullanıcı silme (sahip olduğu kanvaslar kademeli silinir, ana hat commit'leri "sistem" yazarıyla geçmişte kalır)
- **Kanvaslar** — arama, üye rolü değiştirme, davet iptali, kanvas silme — admin kanvas **içeriğini** göremez/açamaz, sadece meta veriyi yönetir
- **Gruplar** — arama, bekleyen katılım isteklerini onaylama/reddetme, üye rolü değiştirme, grup silme (kanvasları silinmez, sahiplerinin kişisel kanvası olarak kalır)
- **Görünüm** — giriş ekranındaki önizleme görselini yükler/URL ile ayarlar/sıfırlar (PNG/JPEG/WebP/GIF, 2MB sınırı; SVG güvenlik nedeniyle reddedilir)

Site admini `ADMIN_USERNAME`/`ADMIN_PASSWORD` env değişkenleriyle sunucu açılışında oluşturulur/yükseltilir (idempotent, mevcut şifreyi ezmez).

## Çalıştırma

Node 22+ gerekir. Önce Postgres'i ayağa kaldırın (5432 çoğu zaman meşgul olduğu için 5433'te dinler):

```bash
docker compose up -d
```

`server/.env` dosyasını `server/.env.example`'dan türetip `DATABASE_URL`'i (varsayılan `postgresql://treemapper:treemapper@localhost:5433/treemapper?schema=public`) ve isterseniz `GEMINI_API_KEY`/`SMTP_*`/`ADMIN_USERNAME`/`ADMIN_PASSWORD` değerlerini doldurun.

```bash
npm install
npm run dev     # API :3001 + web :5173 (prisma db push şemayı otomatik uygular)
```

Tarayıcıda http://localhost:5173.

```bash
npm run test           # op motoru + branching + auth + API testleri (shared, sonra server)
npm run build           # prisma generate + tip kontrolü (tüm workspace'ler) + üretim derlemesi
npm run db:seed -w server   # örnek veri (ayse/bora, sifre123) — boş DB'ye karşı, tek seferlik
```

## Manuel duman testi

1. İki tarayıcıda (normal + gizli) iki hesap açın; A panodan bir kanvas oluşturup **Davet linki**ni kopyalasın, B linki açıp kayıt olsun (e-posta doğrulama kodunu girsin) → kanvasa otomatik düşmeli
2. A bir düğüm eklesin → B'de anında görünmeli; geçmişte yazar adı görünmeli
3. Bağlantılar panelinden bir bağımlılık, bir self-loop, bir de paralel ilişki kenarı ekleyin → akış görünümünde farklı stiller
4. Aynı düğümün başlığını iki tarafta da (biri bayat baseSeq ile) değiştirin → dal oluşmalı, iki tarafta da bildirim
5. Dalı görüntüleyip birleştirin → merge commit'i iki tarayıcıda da görünmeli
6. Bir commit'i geri alın, birine dönün, sayfayı yenileyin — state aynı kalmalı
7. Birkaç düğümü Ctrl+tık ile seçin → seçim bilgi paneli açıklamalarıyla açılmalı; **⬇ PDF indir** ile görünümü indirin
