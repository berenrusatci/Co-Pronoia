> [!tip] Bu not `arastirma/vault-sync.py` tarafından üretiliyor — elle düzenleme, kaynak dosyalar `arastirma/` altında.

# Co-Pronoia araştırma panosu

*Son senkron: 2026-08-15*

## Kapsama

| # | Başlık | Web | Kod (1. tur) | Kod (2. tur) | Değerlendirme |
|---|---|---|---|---|---|
| 01 | [[01 Çekirdek ve Eşzamanlılık - sorular\|Çekirdek ve Eşzamanlılık]] | [[01 Çekirdek ve Eşzamanlılık - web\|3533 kel]] | [[01 Çekirdek ve Eşzamanlılık - kod\|4310 kel]] | [[01 Çekirdek ve Eşzamanlılık - kod tur2\|7467 kel]] | [[01 Çekirdek ve Eşzamanlılık - degerlendirme tur1\|tur1]] [[01 Çekirdek ve Eşzamanlılık - degerlendirme tur2\|tur2]] |
| 02 | [[02 Yetki, Güvenlik ve Gizlilik - sorular\|Yetki, Güvenlik ve Gizlilik]] | [[02 Yetki, Güvenlik ve Gizlilik - web\|4426 kel]] | [[02 Yetki, Güvenlik ve Gizlilik - kod\|4315 kel]] | — | [[02 Yetki, Güvenlik ve Gizlilik - degerlendirme tur1\|tur1]] |
| 03 | [[03 Yapay Zekâ, MCP ve Çok-Ajanlı - sorular\|Yapay Zekâ, MCP ve Çok-Ajanlı]] | [[03 Yapay Zekâ, MCP ve Çok-Ajanlı - web\|4181 kel]] | [[03 Yapay Zekâ, MCP ve Çok-Ajanlı - kod\|4977 kel]] | [[03 Yapay Zekâ, MCP ve Çok-Ajanlı - kod tur2\|3747 kel]] | [[03 Yapay Zekâ, MCP ve Çok-Ajanlı - degerlendirme tur2\|tur2]] |
| 04 | [[04 Frontend, Ölçek ve Erişilebilirlik - sorular\|Frontend, Ölçek ve Erişilebilirlik]] | [[04 Frontend, Ölçek ve Erişilebilirlik - web\|3955 kel]] | [[04 Frontend, Ölçek ve Erişilebilirlik - kod\|2928 kel]] | — | [[04 Frontend, Ölçek ve Erişilebilirlik - degerlendirme tur1\|tur1]] |
| 05 | [[05 Dağıtım, Veri ve Ürün - sorular\|Dağıtım, Veri ve Ürün]] | [[05 Dağıtım, Veri ve Ürün - web\|4469 kel]] | [[05 Dağıtım, Veri ve Ürün - kod\|3870 kel]] | — | — |

**Web** = ChatGPT web'inin genel kaynaklarıyla (koda erişimsiz) verdiği yanıt. 
**Kod** = *Co-Pronoia Araştırma* Project'i içinden, Sources'a yüklü gerçek kaynak koda 
`dosya:satır` atıflı yanıt. **2. tur** = aynı sohbette, 1. turun boşluklarına göre yazılmış 
somut takip sorusunun yanıtı.

## Eksikler

- **02** Yetki, Güvenlik ve Gizlilik: kod 2. tur
- **04** Frontend, Ölçek ve Erişilebilirlik: kod 2. tur
- **05** Dağıtım, Veri ve Ürün: kod 2. tur

## Hat ve log denetimi

| Rol (model) | Olay | Sorunlu |
|---|---|---|
| luna-tasiyici (gpt-5.6-luna) | 4 | — |
| tasiyici (gpt-5.6-luna) | 1 | — |
| yonetici (claude-opus-5) | 1 | — |

Son olay: `2026-08-15T23:27:30` — tasiyici/kaynak-guncelleme (kaynak güncelleme — luna turu) = **ok**

Tam kayıt: `7 Log/olaylar.jsonl` · Denetim komutu: `python3 ~/.claude/skills/gpt-web-research/scripts/vlog.py ozet --vault "arastirma/vault"`

Roller: **yönetici** (Claude) konuyu belirler → **düzenleyici-2** (`gpt-5.6-sol`) prompt'u 
yazar → **luna taşıyıcı** (`gpt-5.6-luna`) tarayıcıyı sürüp çıktıyı **birebir** kaydeder → 
**düzenleyici-1** (`gpt-5.6-sol`) düzenler ve iddiaları gerçek repoya karşı doğrular. 
Tanım: [[Hat tanımı (skill)]]. Ham kayıtlar `7 Log/ham/` altında ve **değiştirilemez**.

## Gezinme

- [[Sentez]] — başlıklar arası birleştirme
- [[Araştırma şeması]] — bütün araştırmanın kaynağı
- [[Sohbet linkleri]] · [[Durum kaydı]]
- Etiketler: #arastirma/yanit #arastirma/degerlendirme #arastirma/soru #arastirma/yontem

## Yöntem özeti

- Gönderim `gpt-web-research` skill'iyle, kullanıcının kendi giriş yapmış ChatGPT oturumu 
  üzerinden Puppeteer ile yapılıyor (API değil web — Project Sources ve Deep Research için).
- **Aynı hesaptan en çok 2 eşzamanlı akış**: fazlası "Connection interrupted" ile yanıtı 
  yarıda kesiyor. Lane'ler bu yüzden kaydırmalı başlatılıyor.
- Ağır okuma/değerlendirme codex lane'lerine devrediliyor; her lane yanıtı kendi bağlamında 
  okuyup bir `-degerlendirme` notu bırakıyor.
