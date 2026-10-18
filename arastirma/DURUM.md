# Araştırma durumu — 16 Ağustos 2026

## Aşama 1: bulgu durumu tazelendi (16 Ağustos, yönetici turu)

15 Ağustos'tan sonra iki commit geldi ve `SENTEZ.md`'deki 15 bulgunun bir kısmını kapattı.
Her bulgu **canlı kodda** tek tek yeniden sınandı (commit mesajı kanıt sayılmadı):

| Durum | Bulgular |
|---|---|
| **KAPANDI** | 2 (`aiAllowed` kalkanı → `shared/src/regionGuard.ts:77` + `commitService.ts:460`), 12 (atomik merge → `commitService.ts:469-494` `alsoInTx`), 14 (sekme etiketleri → `Chrome.tsx:10-14`) |
| **KISMEN** | 1 — login oran sınırı geldi (`authRoutes.ts:30-51`, kapı `:177`), parola alt sınırı hâlâ 4 (`:81`, `:209`) |
| **DURUYOR** | 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15 |

Şiddeti bu turda **yükselen** üç bulgu:
- **15 (CI kapısı yok)** — son iki commit'in doğruluğu tamamen elle koşulan 170 teste bağlı ve
  `e3f006a` çekirdek choke point'e dokundu.
- **10 (süreç-yerel durum)** — `e3f006a` login oran sınırını da süreç-yerel sayaç olarak ekledi;
  artık bir **güvenlik kontrolü** tek-kopya varsayımına bağımlı.
- **8 (`actor` opsiyonel)** — `actor.ai` artık AI kalkanını da taşıyor; `actor` geçmeyi unutan yeni
  bir yazma yolu iki guard'ı birden atlar.

Ek (kozmetik): `server/src/proposalService.ts:264-269` — `ai: true` gerekçe yorumu iki kez
kopyalanmış. Bulgu 6 düzeltilirken aynı dokunuşta temizlenmeli.

Güncellenen öncelik sırası `SENTEZ.md` → "Öncelik sırası" bölümünde.

## ChatGPT Project (koda erişimli sohbetler)
- Proje: **Co-Pronoia Araştırma** → (özel ChatGPT sohbeti)/project
- Sources bundle'ları: `arastirma/bundles/copronoia-{shared,server,web,db,docs}.zip`
  — **16 Ağustos'ta yeniden paketlendi** (iki yeni commit + güncellenmiş SENTEZ dahil).

## Aşama 2: yeni araştırma turu (16 Ağustos) — konular

| # | Konu | Neden |
|---|---|---|
| 06 | Op şeması sürümleme | `linkedCanvasId` nokta çözümü; ikinci alanda ne olacak? Event-sourced şema evrimi emsalleri |
| 07 | MCP dış ajan tehdit modeli | Co-Pronoia'nın farklılaştırıcısı; `update_brief` açık, öneri boyut sınırı yok, claim adaleti tanımsız |
| 08 | Ajan maliyeti / fiyatlandırma | Kanvas başına Gemini token maliyeti hiç ölçülmedi; `stepwise` tek istekte 6 çağrıya çıkıyor |
| 09 | İlk kullanım / boş durum (onboarding) | Hiç araştırılmadı; MVP'de benimseme burada kazanılıyor |
| 10 | Kapsam boşluğu kapatma (02 + 04 + 05) | En zayıf kanıt tabanı: 02/04 kod turu hiç alınamadı, 05'in ikinci turu sahte çıktı |

Kalite şartı (önceki turun en büyük kusuru): **her dış iddia için tam URL + erişim tarihi.**
URL'siz iddialar düzenleyici-1 tarafından işaretlenir ve karar kaydına giremez.

## Web araştırmasına GÖNDERİLMEYEN iş (yerelde ölçülecek)

**Ölçek benchmark'ı.** ChatGPT'ye sorulmaz çünkü bu bir ölçüm, bir emsal sorusu değil; önceki tur
"10k mantıksal eleman desteklenebilir" diye ölçülmemiş bir hipotez üretti ve sentez bunu
reddetti. Yerelde koşulacak:
- **FlowView FPS** 200 / 1000 / 5000 düğümde (pan+zoom sırasında, React Flow profiler).
- **`rebuildCheck` süresi** aynı üç boyutta (commit sayısı da değişkendir — 100 / 1000 commit).
- **Replay süresi** (`stateAt`, `branchState`) aynı boyutlarda.
Çıktı: `arastirma/OLCUM-OLCEK.md`. **Bu turda koşturulmadı**; ayrı bir iş olarak açık duruyor.
Bu sayı ölçülmeden 04'ün bütün render önerileri ve 01'in snapshot planı spekülatif yatırımdır.

## Dosya haritası (repoda kalıcı)
- `yanitlar-standalone/` — 1. tur, 5 başlık, web-kaynaklı (koda atıfsız).
- `yanitlar-proje/` — 1. tur Project turu (koda `dosya:satır` atıflı): 01, 03, 05 + doğrulama raporu.
- `SENTEZ.md` — birleşik sentez + 16 Ağustos durum güncellemesi.
- `vault/` — dört rollü hattın tam kaydı (`7 Log/ham` birebir, `7 Log/duzenli` düzenlenmiş).
- Şema kaynağı: `../ARASTIRMA-SEMASI.md`; 1. tur prompt'ları: `00-ortak-baglam.md` + `01..05-*.md`.

## Yöntem notu
- Aynı hesaptan 3+ eşzamanlı gönderim throttle yiyor → **en çok 2 eşzamanlı**.
- Lane dizinleri **repo dışında** tutulur: `chatgpt_cookies.json` repoya girerse `gptpro` sır
  taraması export'u haklı olarak durduruyor (16 Ağustos'ta fiilen oldu).
- Ağır yanıt okuma/değerlendirme codex lane'lerine devredilir (token tasarrufu).
