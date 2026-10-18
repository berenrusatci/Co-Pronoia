---
tags:
  - arastirma/yontem
kaynak: DURUM.md
---
> [!info] Turların ham durum kaydı

# Araştırma durumu — 14 Ağustos 2026 (FINAL)

## ChatGPT Project (koda erişimli sohbetler)
- Proje: **Co-Pronoia Araştırma** → (özel ChatGPT sohbeti)/project
- Sources'a yüklenen kod bundle'ları: `arastirma/bundles/copronoia-{shared,server,web,db,docs}.zip`

## Dosya haritası (repoda kalıcı)
- `yanitlar-standalone/` — **5 başlığın tamamı**, ilk tur (web-kaynaklı; NIST/IETF/KVKK/Figma/
  Automerge vb. atıflı, koda atıfsız). Her biri ~30-39KB, tam.
- `yanitlar-proje/` — Project turu (Sources'taki gerçek koda `dosya:satır` atıflı): 01 çekirdek,
  03 AI/MCP, 05 dağıtım + `01-...-DEGERLENDIRME.md` (codex hükmü 8/10).
- `SENTEZ.md` — 8 yanıtı birleştiren nihai sentez (codex tarafından yazıldı).
- `SEMASI` kaynağı: `../ARASTIRMA-SEMASI.md`; prompt'lar: `00-ortak-baglam.md` + `01..05-*.md`.

## Başlık başına kapsama

| Başlık | Standalone (kaynak) | Proje (kod) |
|---|---|---|
| 01 Çekirdek/eşzamanlılık | ✅ | ✅ (4312 kel) |
| 02 Yetki/güvenlik/gizlilik | ✅ (39KB, güçlü) | ✖ web UI 3 denemede boş döndü |
| 03 AI/MCP çok-ajanlı | ✅ | ✅ (4979 kel) |
| 04 Frontend/ölçek/erişilebilirlik | ✅ | ✖ web UI 3 denemede boş döndü |
| 05 Dağıtım/veri/ürün | ✅ | ✅ (3872 kel) |

> **02 ve 04'ün Project-içi (kod-dayalı) sürümü alınamadı**: sohbet oluştu ama ChatGPT web'i
> yanıtı üretmeden koptu (0 karakter), sıralı 3 denemede de. Araştırmanın kendisi eksik değil —
> tam standalone yanıtları var. Kod-dayalı sürüm istenirse bu iki sohbet elle açılıp yeniden
> gönderilebilir:
> - 02: (özel ChatGPT sohbeti)/c/6a7f18b0-3ce4-83eb-9d21-b5b14bda80c5
> - 04: (özel ChatGPT sohbeti)/c/6a7f1aa6-b658-83eb-8391-e3bdd7051017

## Yöntem notu (skill'e de kaydedildi)
- Aynı hesaptan 3+ eşzamanlı gönderim throttle yiyor → sıralı gönderim.
- Ağır yanıt okuma/değerlendirme codex lane'lerine devredildi (token tasarrufu).
- `gpt-web-research` skill'i bu turun tüm dersleriyle güncellendi.
