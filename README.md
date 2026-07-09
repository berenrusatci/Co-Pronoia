# 🌳 TreeMapper

Ağaç tabanlı, **çok kullanıcılı** geliştirme planlama uygulaması. Planınızı düğümler halinde kurar; aynı veriyi üç görünümde sunar, her değişikliği yazarıyla birlikte numaralı bir commit olarak kaydeder ve eşzamanlı çakışmaları dallara ayırır.

## Pano ve kanvaslar

Giriş yaptıktan sonra **pano** açılır: kanvaslarınızı listeler, yeni kanvas oluşturur. Yeni hesap boş başlar — ilk kanvası kullanıcı kendisi oluşturur (kanvas, adını taşıyan bir kök düğümle açılır).

- Her kanvasın verisi (düğümler, bağlantılar, commit geçmişi, dallar) tamamen ayrıdır; commit numaraları kanvas başına 1'den başlar.
- Bir kanvasa başkasını eklemenin **tek yolu davet linkidir**: karttaki (veya kanvas içindeki araç çubuğundaki) **🔗 Davet linki** butonu `…/?davet=TOKEN` linkini panoya kopyalar. Linki açan kişi giriş/kayıt sonrası kanvasa otomatik üye olur ve doğrudan kanvasa düşer.
- Üye olmayan kullanıcı kanvası göremez (API 404 döner).
- Panoda **⚙ Kullanıcı ayarları** bölümünden şifre değiştirilir (diğer oturumlar kapatılır); sahibi olduğunuz kanvası **Sil** ile kalıcı olarak silersiniz — kanvası açık olan herkes anında panoya düşürülür.

## Roller, üyeler ve bölgeler

- **Roller**: kanvas sahibi (**sahip**) her şeyi yapar; **editör** (davetle katılan varsayılan) grafiği düzenler; **görüntüleyici** salt okunurdur. Üyeler panelinden sahip rol atar ve üye çıkarır; çıkarılan kullanıcının erişimi (ve WS bağlantısı) anında kesilir.
- **Kimler aktif**: araç çubuğundaki baş harf çipleri ve Üyeler panelindeki yeşil noktalar kanvasa o an bağlı herkesi gösterir.
- **Bölgeler**: sahip, akış görünümünde ad verip dikdörtgen bölgeler tanımlar (sürükleyip boyutlandırır) ve her bölgeye üye atar. Bölgenin **içindeki** düğümleri yalnızca o bölgeye atanan üyeler (ve sahip) değiştirebilir — düğüm ekleme/taşıma/silme ve o düğümlere kenar bağlama dahil; sunucu ihlalde Türkçe hata döndürür. Bölge dışı düğümler her editöre açıktır.

## Push (değişiklikleri biriktirme)

Düzenlemeler artık anında veritabanına yazılmaz: yaptığınız her şey yerelde birikir (kartlarda `yeni•` rozeti), araç çubuğundaki **⬆ Push (N)** butonu bekleyen değişiklik sayısını gösterir. Push'a basınca hepsi **tek numaralı commit** olarak gönderilir ve ancak o zaman geçmişe/zaman çizelgesine yazılır; **Vazgeç** bekleyenleri atar. Push sırasında araya başka commit girmişse bilinen kurallar işler: ayrıksa otomatik merge, çakışıyorsa dal.

## Görünümler

- **Zihin Haritası** — `parentId` hiyerarşisinden otomatik yerleştirilen ağaç (d3-hierarchy). Düğüm üzerine gelince çıkan **+** ile alt düğüm eklenir.
- **Akış Diyagramı** — serbest konumlandırma; düğümleri sürükleyin, kenar noktalarından ok çekerek bağlantı kurun.
- **Zaman Çizelgesi** — commit geçmişi akışı + kaydırıcı (scrubber) ile geçmişte gezinme.

## Bağlantı mekanizmaları

Kenar türleri farklı çizgi stilleriyle çizilir: **akış** (düz mavi), **döngü** (turuncu), **bağımlılık** (kesikli mor), **ilişki** (noktalı gri). Ayrıca:

- **Self-loop** — düğümün kendine bağlanması (düğümün üzerinden kavis)
- **Çift yönlü** kenarlar (iki uçta ok) ve aynı çift arasında **paralel** kenarlar (yelpaze gibi açılır)
- **Bağlantılar paneli** — tüm kenarlar madde madde metin olarak: `Kaynak → Hedef (bağımlılık · etiket)`; buradan tür/yön/etiket düzenlenir, silinir, yeni bağlantı eklenir

## Hesaplar ve co-op

- Kullanıcı adı + şifre ile kayıt/giriş (scrypt hash, session cookie). Her commit'te yazar görünür.
- **WebSocket canlı senkron**: biri commit atınca diğer açık oturumlara anında yansır.
- **Çakışma → dal**: iki kişi aynı anda commit atarsa ve değişiklikler ayrıksa otomatik merge edilir; aynı alana dokunuyorlarsa sonraki commit `kullanıcı/cakisma-N` adlı bir dala kaydedilir. Dallar panelinden dal **görüntülenir** (salt okunur), **ana hatta birleştirilir** (tek merge commit'i) veya **silinir** — seçim kullanıcının.

## Commit sistemi

Her ekleme/güncelleme/silme/taşıma otomatik mesajlı, numaralı bir commit olur. Geçmiş panelinden:

- **Görüntüle** — grafiği o commit'teki haliyle salt okunur açar
- **Geri al** — sadece o commit'in tersini yeni bir commit olarak uygular (temiz uygulanamazsa reddedilir)
- **Buna dön** — grafiği o commit'teki haline döndürür (tek yeni commit)

Geçmiş hiçbir zaman yeniden yazılmaz. Ana hat numaralandırmasında dal commit'leri kadar boşluk olabilir (numara sırası globaldir) — bu beklenen davranıştır.

## Çalıştırma

```bash
npm install
npm run dev     # API :3001 + web :5173 (şema otomatik uygulanır)
```

Tarayıcıda http://localhost:5173 — veri `server/data/treemapper.db` (SQLite, Prisma) dosyasında tutulur; silerseniz temiz kurulumla açılır.

```bash
npm run test    # op motoru + branching + auth + API testleri
npm run build   # prisma generate + tip kontrolü + üretim derlemesi
```

## Manuel duman testi

1. İki tarayıcıda (normal + gizli) iki hesap açın; A panodan bir kanvas oluşturup **Davet linki**ni kopyalasın, B linki açıp kayıt olsun → kanvasa otomatik düşmeli
2. A bir düğüm eklesin → B'de anında görünmeli; geçmişte yazar adı görünmeli
3. Bağlantılar panelinden bir bağımlılık, bir self-loop, bir de paralel ilişki kenarı ekleyin → akış görünümünde farklı stiller
4. Aynı düğümün başlığını iki tarafta da (biri bayat baseSeq ile) değiştirin → dal oluşmalı, iki tarafta da bildirim
5. Dalı görüntüleyip birleştirin → merge commit'i iki tarayıcıda da görünmeli
6. Bir commit'i geri alın, birine dönün, sayfayı yenileyin — state aynı kalmalı
