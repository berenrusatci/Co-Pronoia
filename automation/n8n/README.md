# n8n + Gemini TreeMapper Ajanı

Webhook ile tetiklenen bir n8n workflow'u: doğal dildeki komutu Gemini'ye verir, gerekirse kanvasa **tek commit** olarak düğüm/kenar yazar.

- **"backend bölgesindeki düğümleri özetle"** → metin yanıt döner, kanvasa dokunmaz.
- **"backend bölgesine üç adımlı auth akışının diyagramını çiz"** → `add_node`/`add_edge` intent'leri üretir, düğümleri bölge dikdörtgeninin içine yerleştirir ve commit atar.

Uygulama koduna hiç dokunmaz; her şey mevcut HTTP API üzerinden çalışır.

## Nasıl çalışır

```
Webhook → Giriş (bot login, tm_session çerezi) → Kanvaslar → Kanvası bul
        → Durum (/state) → Bölgeler (/regions) → Bağlam (düğümlerin bölge üyeliği hesaplanır)
        → Gemini (generateContent, JSON çıktı) → Yanıtı çöz
        → [ops varsa] Commit (baseSeq = headSeq) → Yanıt
        → [ops yoksa] Yanıt (yalnızca metin)
```

- Ajan sunucuya **ham intent** gönderir (`{op:'add_node', title, parentId, x, y, ...}`); genişletme, bölge denetimi ve çakışma kuralları sunucuda, herkes gibi işler.
- Bir düğümün "bölgede" sayılması koordinata bağlıdır: Gemini'ye bölge dikdörtgenleri verilir ve yeni düğümleri o dikdörtgenin içine koyması istenir.
- Çakışma olursa (siz komut verirken kanvas değiştiyse) sunucu normal kurala göre dal açar; yanıt bunu bildirir.

## Kurulum

### 1. Bot kullanıcı

Ajan gerçek bir kullanıcı olarak çalışır (API token desteği yok, oturum çerezi kullanılır):

```bash
curl -s -X POST $TM_BASE_URL/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"ajan","password":"<güçlü-şifre>","email":"ajan@example.com","displayName":"Gemini Ajanı"}'
```

Sonra ajanın çalışacağı her kanvas için:

1. Kanvastan **davet linki** üretin ve bot hesabıyla kabul edin (davet kabulü varsayılan `editor` rolü verir — commit için yeterli).
2. Kanvasta **bölgeler** varsa: ajanın yazacağı bölgelere bot kullanıcıyı **bölge üyesi** olarak ekleyin (Bölgeler paneli). Aksi halde bölge içine yazma denemeleri 403 döner (yanıtta "Değişiklik uygulanamadı" olarak görünür).

### 2. n8n ortam değişkenleri

Workflow tüm sırları `$env`'den okur; n8n'i şu değişkenlerle başlatın:

| Değişken | Açıklama |
|---|---|
| `TM_BASE_URL` | TreeMapper sunucusu, ör. `http://localhost:3001` (sondaki `/` olmadan) |
| `TM_BOT_USERNAME` | Bot kullanıcı adı, ör. `ajan` |
| `TM_BOT_PASSWORD` | Bot şifresi |
| `GEMINI_API_KEY` | Google AI Studio API anahtarı |
| `GEMINI_MODEL` | (isteğe bağlı) varsayılan `gemini-2.5-flash` |

Lokal deneme:

```bash
TM_BASE_URL=http://localhost:3001 TM_BOT_USERNAME=ajan TM_BOT_PASSWORD=... \
GEMINI_API_KEY=... npx n8n
```

Not: kendi n8n kurulumunuzda Code node'larından `$env` erişimi kapalıysa `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` olmalı (varsayılan zaten böyledir).

### 3. Workflow'u içe aktar

n8n arayüzünde **Import from File** ile `treemapper-agent.workflow.json` dosyasını yükleyin ve workflow'u **Active** yapın. Webhook adresi:

```
POST http://<n8n-host>:5678/webhook/treemapper-agent
```

(Test modunda çalıştırıyorsanız `/webhook-test/treemapper-agent`.)

## Kullanım

İstek gövdesi: `{"canvas": "<kanvas adı veya id>", "prompt": "<komut>"}` — kanvas adı büyük/küçük harfe duyarsız, kısmi eşleşme de kabul edilir.

Özet:

```bash
curl -s -X POST http://localhost:5678/webhook/treemapper-agent \
  -H 'Content-Type: application/json' \
  -d '{"canvas":"Projem","prompt":"backend bölgesindeki düğümleri ve durumlarını özetle"}'
# → {"reply":"Backend bölgesinde 4 düğüm var: ...","committed":false}
```

Diyagram:

```bash
curl -s -X POST http://localhost:5678/webhook/treemapper-agent \
  -H 'Content-Type: application/json' \
  -d '{"canvas":"Projem","prompt":"backend bölgesine kayıt-giriş-oturum yenileme adımlarından oluşan bir auth akış diyagramı çiz"}'
# → {"reply":"3 düğüm ve 2 akış kenarı ekledim...","committed":true,"commitSeq":42,"opCount":5}
```

Yanıt alanları: `reply` (Türkçe açıklama), `committed`, başarılı yazmada `commitSeq`/`opCount`, çakışmada `branched: true` + `branch` (dal adı), hata durumunda `error`.

## Sınırlar ve davranış kuralları

- Bot **viewer** rolündeyse yazma istekleri reddedilir (yanıt bunu açıklar); özet yine çalışır.
- Ajan, açık bir silme komutu olmadan `delete_node`/`delete_edge` üretmemesi yönünde yönlendirilmiştir; yine de yazma yetkisini yalnızca güvendiğiniz kanvaslarda verin.
- Tüm istek tek commit olarak gider; commit yanıtı `branched` ise değişiklik ana hatta değil dala yazılmıştır (Dallar panelinden birleştirin/iptal edin).
- Webhook'ta kimlik doğrulama yoktur; n8n'i dışarı açıyorsanız webhook node'una Header Auth ekleyin ya da n8n'in erişimini ağ düzeyinde kısıtlayın.
- Çok büyük kanvaslarda tüm durum tek Gemini isteğine gömülür; bağlam sınırına yaklaşırsanız `GEMINI_MODEL` olarak daha büyük bağlamlı bir model seçin.
