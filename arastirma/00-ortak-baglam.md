# Ortak bağlam bloğu (5 prompt'un hepsinin başına konur)

Co-Pronoia adlı bir işbirlikçi planlama uygulaması geliştiriyorum. Aşağıdaki bağlam, sorularımı
değerlendirebilmen için gerekli — kod deposuna erişimin yok, o yüzden mimariyi burada özetliyorum.

**Ürün:** Ekiplerin geliştirme planlarını bir kanvas üzerinde graf olarak (düğümler + kenarlar,
ayrıca `parentId` ile zihin haritası hiyerarşisi) birlikte kurduğu bir uygulama. Üç görünüm:
akış diyagramı, zihin haritası, zaman çizelgesi.

**Ayırt edici tasarım — uygulama içi commit sistemi (gerçek git değil):**
- Her mutasyon, yazarı ve kanvas başına artan sıra numarası (`seq`) olan bir **commit**.
- `Commit` tablosu (append-only JSON op dizileri) main dalın **tek doğruluk kaynağı**;
  `Node`/`Edge` tabloları yalnız main commit'lerinin oynatılmasıyla (replay) üretilen materyalize önbellek.
  Bir `rebuildCheck()` fonksiyonu ikisinin asla ayrışmadığını doğruluyor ve testlerde oracle olarak kullanılıyor.
- Op sözlüğü: `add_node`, `update_node`, `move_node`, `delete_node`, `add_edge`, `delete_edge`.
  Op'lar before+after anlık görüntüleri taşıyor → zaman yolculuğu, geri alma, fark (diff) hesabı.
  Değişmez: `apply(invert(apply(g, op))) ≡ identity`, test ediliyor. `update_edge` op'u bilerek yok
  (kenar düzenlemesi = aynı id ile `delete_edge`+`add_edge`).
- Niyet (intent) → op genişletmesi saf ve paylaşımlı: sunucu ve web önizlemesi aynı kodu kullanıyor.

**Eşzamanlılık ve çatışma:**
- İstemci her commit'le birlikte gördüğü head'i (`baseSeq`) gönderiyor.
- Head ilerlemişse: niyetler güncel duruma karşı yeniden genişletiliyor ve hedef kümeleri aradaki
  commit'lerin op'larıyla karşılaştırılıyor (düğüm ekleme/silme joker, güncelleme/taşıma alan bazında,
  kenarlar id bazında). **Ayrık ise** otomatik main'e birleşiyor. **Örtüşüyorsa** bir **dal** açılıp
  commit oraya iniyor; kullanıcı sonra "dalı bütünüyle al" biçiminde birleştiriyor.
- Yazma yolları kanvas başına bir mutex ile serileştiriliyor; `seq` ataması yazma transaction'ı içinde
  kanvas satırına `FOR UPDATE` kilidi alınarak yapılıyor (çok süreçli güvenlik).
- İstemcide "staging" var: mutasyonlar hemen sunucuya gitmiyor, biriktirilip tek commit olarak
  "Push" ediliyor.

**Yetki modeli (üç katman iç içe):**
- Kanvas rolleri: `owner | editor | viewer`. Gruplar ve grup içi iş rolleri ayrı.
- **Bölgeler**: kanvas üzerinde sahip tarafından çizilen dikdörtgenler; bölge içindeki düğümlere
  yalnız o bölgenin üyeleri dokunabiliyor. Bu kontrol tek bir choke point'te (commit uygulama anında)
  çalışıyor, böylece commit/otomatik-birleştirme/geri-alma/dal-birleştirme yollarının hepsini kapsıyor.
- Bölgelerin ayrıca `aiAllowed` bayrağı var: kapalıysa yapay zekâ o bölgeye dokunamıyor.

**Yapay zekâ katmanı — iki ayrı sistem:**
1. **Yerleşik ajan**: kullanıcı doğal dille istiyor, sunucu bir LLM'e (Gemini) durum+bölgeleri
   verip JSON diyagram yanıtı alıyor ve op'ları **tek commit** olarak normal commit yolundan indiriyor
   (yani viewer reddi, bölge kontrolü, çatışma dallanması aynen geçerli). İsteği yapan kullanıcı aktör
   sayılıyor. "Parça parça" modunda her parça ayrı commit.
2. **Çok ajanlı planlama (MCP üzerinden)**: dış ajanlar Model Context Protocol ile bağlanıyor
   (kanvas kapsamlı API anahtarları, ajan rolleri + persona metinleri, bir anahtar birden çok rol
   taşıyabiliyor). Ajanların **commit yetkisi yok** — yalnız "öneri" (proposal) gönderiyorlar.
   Bir **supervisor ajan** onaylayınca öneri normal commit yolundan iniyor. Ajanlar düğüm/bölge
   "claim" edip iş bölüşüyor; değişiklikleri uzun-yoklama (long-poll) bir araçla bekliyorlar.

**Dağıtım — tek kod tabanı, iki mod:**
- **Bulut**: tam kimlik yönetimi (oturum çerezi, e-posta doğrulama, Google girişi, site yöneticisi paneli).
- **Yerel (Docker imajı)**: tek kullanıcı. Kimlik/davet/üyelik/yönetim kodu **derleme anında** bundle'dan
  eleniyor (esbuild `define` ile bir bayrak sabitlenip dallar ölü koda dönüyor), yani o kod imajda hiç yok.
  Bir test bunu her koşuda ölçüyor. Yerel kurulum, bulut hesabına PKCE benzeri bir el sıkışmayla
  bağlanıp verisini çekiyor (tek yönlü içe aktarma).

**Teknoloji:** TypeScript monorepo (npm workspaces). Sunucu: Fastify + Prisma + PostgreSQL.
Web: Vite + React + React Flow + zustand. Paylaşımlı katman sıfır çalışma-zamanı bağımlılığı taşıyor.
Gerçek zamanlı: WebSocket, yalnız yayın (broadcast) amaçlı — mutasyonlar HTTP'de. Migration dosyası yok,
şema `prisma db push` ile uygulanıyor. Arayüz dili Türkçe.

**Ölçek varsayımı:** bugün küçük; hedef, kanvas başına 10k+ commit ve 1000+ düğüm, ekip başına
onlarca kullanıcı, kanvas başına birkaç eşzamanlı ajan.
