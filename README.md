# 🌳 TreeMapper

Ağaç tabanlı geliştirme planlama uygulaması. Planınızı düğümler halinde kurar; aynı veriyi üç görünümde sunar ve her değişikliği numaralı bir commit olarak kaydeder.

## Görünümler

- **Zihin Haritası** — `parentId` hiyerarşisinden otomatik yerleştirilen ağaç (d3-hierarchy). Düğüm üzerine gelince çıkan **+** ile alt düğüm eklenir.
- **Akış Diyagramı** — serbest konumlandırma; düğümleri sürükleyin, kenar noktalarından ok çekerek bağlantı kurun.
- **Zaman Çizelgesi** — commit geçmişi akışı + kaydırıcı (scrubber) ile geçmişte gezinme.

## Commit sistemi

Her ekleme/güncelleme/silme/taşıma otomatik mesajlı, numaralı bir commit olur (#1, #2, …).

- **Görüntüle** — grafiği o commit'teki haliyle salt okunur açar
- **Geri al** — sadece o commit'in tersini yeni bir commit olarak uygular (temiz uygulanamazsa reddedilir)
- **Buna dön** — grafiği o commit'teki haline döndürür (tek yeni commit)

Geçmiş hiçbir zaman yeniden yazılmaz; her şey ileriye doğru eklenir.

## Çalıştırma

```bash
npm install
npm run dev     # API :3001 + web :5173
```

Tarayıcıda http://localhost:5173 — veri `server/data/treemapper.db` (SQLite) dosyasında tutulur.

```bash
npm run test    # commit motoru testleri (inversiyon, fuzz replay, kaskad, revert/restore, API)
npm run build   # tip kontrolü + üretim derlemesi; Fastify web/dist'i servis eder
```

## Manuel duman testi

1. Zihin haritasında köke iki alt düğüm ekle, birini yeniden adlandır
2. Akış diyagramına geç: düğümleri sürükle, ikisi arasına ok çiz
3. Geçmiş panelini aç: her eylemin ayrı bir commit olduğunu gör
4. Ortadaki bir commit'i "Görüntüle" — tuval salt okunur eski hali gösterir
5. Bir "Geri al" ve bir "Buna dön" yap; sayfayı yenile — state aynı kalır
