---
tags:
  - arastirma/yontem
kaynak: SKILL.md
---
> [!info] Dört rollü araştırma hattının tanımı — `~/.claude/skills/gpt-web-research/SKILL.md` kopyası

---
name: gpt-web-research
description: >-
  Split a broad research topic or schema into N balanced prompts and dispatch each as a
  SEPARATE ChatGPT web conversation, driving chatgpt.com through Puppeteer with the user's
  own already-logged-in browser session (cookies decrypted from the local Chromium/Chrome
  profile — no password, no API key). Verifies every chat actually got created (retries when
  a submit silently fails) and reports the conversation URLs. Use this whenever the user wants
  to "fan out" a research question across several ChatGPT chats, kick off multiple ChatGPT (or
  Deep Research) conversations at once from a topic outline, reuse their logged-in ChatGPT
  session for automation, or send long multi-line prompts into ChatGPT without the browser.
  Also covers the FULL loop: reading each chat's answer (waiting for Deep Research to finish),
  evaluating whether it's good enough, and continuing the research IN THE SAME chat with follow-up
  questions — repeating until the user says stop or the research is genuinely complete. Covers
  ChatGPT Projects too: package the repo with the gptpro skill, create a project, load the zip
  bundles into its Sources so the chats can cite real files, and open the research chats inside that
  project. Can offload the heavy browser-driving + answer-reading to codex subagents (codex-fleet)
  to save the orchestrator's tokens.
  Runs as a FOUR-ROLE, fully logged pipeline: the orchestrator picks topics, a codex `gpt-5.6-sol`
  editor writes the prompts, `gpt-5.6-luna` carriers drive the browser and record ChatGPT's output
  VERBATIM into an Obsidian vault, and a second `gpt-5.6-sol` editor curates + fact-checks those raw
  captures against the real repo. Every prompt, capture and decision is logged so the orchestrator can
  audit the whole chain without reading the raw answers.
  Trigger even when they don't say "Puppeteer" — phrases like "bunu 5 sohbete böl", "her başlığı
  ayrı ChatGPT'ye gönder", "hesabıma girip araştırmayı başlat", "yanıtları değerlendir",
  "o sohbetten devam ettir", "ben dur diyene kadar sürdür" all mean this skill.
---

# ChatGPT web araştırma dağıtıcısı

Kullanıcının **kendi giriş yapmış ChatGPT oturumunu** kullanarak, bir araştırma şemasını N dengeli
prompt'a bölüp her birini **ayrı bir sohbet** olarak gönderir ve gerçekten oluştuklarını doğrular.
Şifre ya da API anahtarı istemez — oturum, yerel Chromium/Chrome profilindeki çerezlerden çözülür.

## Neden bu yol

- **API değil web**: Kullanıcı çoğu zaman ChatGPT Plus/Pro'nun web özelliklerini (Deep Research,
  bağlayıcılar, hafıza) istiyor. `OPENAI_API_KEY` bunları vermez. Web oturumu verir.
- **Tek atış değil, süren bir araştırma**: Amaç sadece prompt göndermek değil; yanıtları **okuyup
  değerlendirmek**, eksikse **aynı sohbetten devam ettirmek** (bağlam korunur) ve bu döngüyü
  kullanıcı **dur** diyene ya da araştırma **gerçekten bitene** kadar sürdürmektir.
- **Çerez env'de değil, tarayıcı profilinde**: Linux'ta oturum tokenı (`__Secure-next-auth.session-token`)
  Chromium'un şifreli çerez deposunda durur; anahtar KWallet/keyring'dedir. Doğru yer burasıdır —
  shell env'ine ya da `.env` dosyalarına bakmak zaman kaybıdır.
- **"Bazen gitmiyor"**: ChatGPT arayüzünde gönderim ara sıra sohbet oluşturmadan takılır. Bu yüzden
  her gönderimden sonra URL'in `/c/<id>`'ye döndüğü **doğrulanır** ve gerekirse tekrar denenir.

## İş akışı

### 1. Oturumu bul ve çöz

Çalışan Chromium profilini ve çerez DB'sini bul (tipik: `~/.config/chromium/Default/Cookies`,
Chrome: `~/.config/google-chrome/Default/Cookies`, Flatpak: `~/.var/app/<id>/config/...`). Birden
çok profil varsa, `__Secure-next-auth.session-token` **içeren** olanı seç:

```bash
python scripts/decrypt_chromium_cookies.py \
  --cookies-db ~/.config/chromium/Default/Cookies \
  --keyring-folder "Chromium Keys" --keyring-entry "Chromium Safe Storage" \
  --domain-like chatgpt --domain-like openai \
  --out /tmp/cookies.json
```

Sır kaynağı varsayılan olarak `kwallet-query` (KDE). GNOME/keyring için `--secret-cmd "..."` ile
sırrı stdout'a yazan kendi komutunu geç. Chrome için `--keyring-folder "Chrome Keys"
--keyring-entry "Chrome Safe Storage"`.

Değerleri **asla** terminale bastırma; script yalnız `--out` dosyasına yazar.

### 2. Oturumun canlı olduğunu doğrula (giriş yapmadan tarayıcı açmadan önce)

Ucuz kontrol — `curl` ile `/api/auth/session` (User-Agent ve Cookie başlığıyla) → dönen JSON'da
`user.email` ve `expires` varsa oturum canlıdır. Ya da:

```bash
cd scripts && npm i puppeteer-core@25 >/dev/null 2>&1
node send_chats.mjs verify --cookies /tmp/cookies.json
```

`LOGIN: <email>` bekliyoruz. Boşsa çerezler eskimiş — kullanıcının bir kez elle giriş yapması gerekir.

### 3. Şemayı dengeli prompt'lara böl

Kaynak (araştırma şeması / geniş konu) → N adet bağımsız, birbirini örtmeyen prompt. Her prompt
**tek başına anlaşılır** olmalı, çünkü sohbetler birbirini görmez. Kritik nokta: **ChatGPT web
kullanıcının özel deposunu göremez.** Kodla ilgili sorular "dosya:satır kanıtı" isteyemez; onları
alan araştırması / desen karşılaştırması / rakip analizi biçimine çevir. Ortak proje bağlamını ayrı
bir `context.md` dosyasına koy; script bunu her prompt'un başına ekler (sohbetler paylaşmadığı için
tekrar şart).

Dosya düzeni önerisi (kullanıcının deposunda, ör. `arastirma/`):
`00-context.md`, `01-...md`, `02-...md`, ... — sayı N kullanıcının istediği kadar (tipik 3-6).

### 4. Gönder ve doğrula

Dedike bir profil kullan (kullanıcının açık tarayıcısıyla aynı profili paylaşma — çalışan Chromium
o profili kilitler). `DISPLAY`/Wayland varsa `headless:false` sorunsuz.

```bash
node scripts/send_chats.mjs send \
  --cookies /tmp/cookies.json \
  --context /path/arastirma/00-context.md \
  --profile ~/.config/chromium-<isim> \
  --out /path/arastirma/SOHBET-LINKLERI.md \
  /path/arastirma/01-*.md /path/arastirma/02-*.md /path/arastirma/03-*.md
```

Script her prompt için: yeni sohbet açar → metni `execCommand insertText` ile yazar (çok satırlı
metinde Enter'a basmaz, yarım gönderim olmaz) → gönderir → `/c/<id>` URL'i için 3 denemeye kadar
bekler → linki `--out` dosyasına yazar. Sonda otomatik **recheck** yapar: her sohbeti tekrar açıp
en az 1 konuşma turu olduğunu doğrular.

Sonradan tek başına tekrar doğrulamak için: `node send_chats.mjs recheck --cookies /tmp/cookies.json
--out /path/SOHBET-LINKLERI.md`.

### 5. İlk raporu ver

Kullanıcıya: her başlığın sohbet URL'i, doğrulama sonucu, ve **Deep Research gerekiyorsa** her
sohbette "Deep research" seçeneğini elle açması gerektiği notu (script normal mesaj gönderir; DR
toggle'ı arayüzden seçilir). Prompt'lar DR'a uygun yazılmışsa bunu belirt.

### 6. Yanıtları oku ve değerlendir

Gönderim tek başına iş değil — asıl değer yanıtları okuyup **yeterli mi** diye değerlendirmekte.
Her sohbetin son asistan yanıtını (akış/Deep Research bitene kadar bekleyerek) topla:

```bash
node scripts/send_chats.mjs read \
  --cookies /tmp/cookies.json --out /path/SOHBET-LINKLERI.md \
  --save-dir /path/arastirma/yanitlar --timeout 900
```

`--timeout` saniye cinsindendir; Deep Research uzun sürer (birkaç dakika), cömert ver. Script akış
bittiğini "durdur" butonu kaybolup metin ~4 sn sabit kalınca anlar; süre dolarsa kısmi metni
kaydedip `ZAMAN AŞIMI(kısmi)` der (o sohbeti sonra tekrar `read` edebilirsin).

Sonra her yanıtı **kendin değerlendir** — kullanıcı adına yargı üret, ham metni ona yığma. Her
başlık için kısa bir hüküm ver:
- **Yeterli mi?** Sorulanları kapsıyor mu, kanıt/kaynak veriyor mu, yüzeysel mi?
- **Eksik/zayıf noktalar** neler (belirli alt sorular cevapsız, kaynak yok, çelişki var).
- **Devam gerekiyor mu?** Gerekiyorsa hangi somut takip sorusuyla.

### 7. Aynı sohbetten devam ettir (döngü)

Eksik kalan başlıkları **yeni sohbet açmadan**, aynı sohbette takip mesajıyla derinleştir — bağlam
orada durduğu için model önceki yanıtının üstüne koyar. Takip sorusunu bir dosyaya yaz (değerlendirmene
dayalı, somut: "3. ve 7. soruları kaynak vermeden geçtin, her biri için 2024+ kaynakla derinleştir"):

```bash
node scripts/send_chats.mjs followup \
  --cookies /tmp/cookies.json \
  --url https://chatgpt.com/c/<id> \
  --message /path/takip-01.md \
  --save /path/arastirma/yanitlar/01-tur2.md --timeout 900
```

Sonra o yanıtı tekrar değerlendir. **Bu döngüyü — oku → değerlendir → devam ettir → tekrar oku —
şu iki koşuldan biri gelene kadar sürdür:**
- **Kullanıcı "dur" diyene kadar**: kullanıcı açıkça durdurana dek kendiliğinden bitmiş sayma. Her
  turdan sonra ilerlemeyi özetle ama sürdür.
- **Araştırma gerçekten bitene kadar**: bir başlık için son iki tur anlamlı yeni bilgi katmıyorsa,
  tüm alt sorular yanıtlanmışsa ve kaynaklar sağlamsa o başlığı "tamamlandı" işaretle. Tüm başlıklar
  tamamlanınca döngü doğal olarak biter.

Uzun döngülerde `/loop` skill'i işe yarar (belirli aralıkla `read` + değerlendirme turu). Her turda
kullanıcıya kısa durum ver (hangi başlık tamam, hangisi devam ediyor, kaç tur oldu); onu her
mesajda ham çıktıya boğma.

### 8. Sonuç değerlendirmesi (bitişte)

Döngü bitince (kullanıcı durdurdu ya da hepsi tamamlandı) tek bir **sentez** üret: başlıklar arası
çelişkiler, en güçlü bulgular, kaynak kalitesi, ve kullanıcının şemasındaki "birleştirme aşaması"
varsa onu doldur. Ham yanıtlar `yanitlar/` altında, sentez ayrı bir özet dosyasında dursun.

## ChatGPT Projects: koda erişen sohbetler

ChatGPT web'i kullanıcının **özel deposunu göremez** — kod-içi sorular için çare, repoyu bir
**Project**'in Sources (Kaynaklar) bölümüne yükleyip sohbetleri **o proje içinden** açmaktır; proje
içindeki her sohbet Sources'taki dosyalara erişir, böylece yanıtlar gerçek `dosya:satır`a atıf yapar.

1. **Repoyu paketle** — `gptpro` skill'iyle repoyu alt sisteme göre bölünmüş, node_modules'suz,
   secret-scan'li zip bundle'lara çıkar (`shared/server/web/db/docs` gibi). Project Sources `.zip`
   kabul ediyor.
2. **Project oluştur** — chatgpt.com sol menü → "New project". Bu bir modal değil, isim alanı
   (placeholder `Copenhagen Trip`) + composer olan bir sayfa açar; ismi yaz, "Create project"e bas.
   Proje URL'i `/g/g-p-<id>/project` biçiminde; kaydet. (Aynı adlı proje varsa "ekle" isteğinde
   ayrı adlı yeni bir tane aç, mevcudu karıştırma.)
3. **Sources'a yükle** — **DİKKAT, en kırılgan adım.** Proje sayfasındaki "Add files and more →
   Upload from computer" menüsünden yükleme çoğu zaman **kalıcı Sources yerine geçici composer ekine**
   düşer: anlık DOM'da dosya görünür ama **sayfa yenileyince kaybolur**. Doğrulaman ŞART:
   sayfayı `networkidle2` ile yeniden yükle, `button[role=tab][id*="-sources"]`e tıkla ve
   `[id*="content-sources"]` panelinde dosya adlarını say. Kalıcı Sources'a otomatik yükleme
   güvenilir çözülemedi — **en sağlamı kullanıcıya bırakmak**: pencereyi açık tut (aşağıdaki
   `keepopen` deseni), dosya yollarını ver, kullanıcı Sources'a sürükle-bırak yapsın, sonra sen
   doğrula. Bundle'ları `/tmp` yerine kalıcı bir yere (ör. repo içinde `arastirma/bundles/`) kopyala.
4. **Proje içinden gönder** — sohbeti proje URL'ine gidip composer'dan aç (bkz. `proj_one.mjs`
   deseni: normal `send` ile aynı, yalnız önce proje URL'ine gider). Oluşan sohbet URL'i proje id'sini
   taşır (`/g/g-p-.../c/<id>`) — bu, sohbetin gerçekten proje içinde açıldığının kanıtıdır. Prompt'a
   "Sources'a kod yüklendi, dosya:satır düzeyinde atıf yap" notunu ekle.

## Dört rollü hat (VARSAYILAN ÇALIŞMA BİÇİMİ)

Tek ajanın hem prompt yazıp hem tarayıcı sürüp hem yanıt değerlendirmesi iki şeyi bozar:
yöneticinin bağlamı 35 KB'lık ham yanıtlarla dolar, ve **taşıma ile yorum aynı elde birleşir** —
yani ChatGPT'nin gerçekte ne dediği ile ajanın ne anladığı ayırt edilemez hale gelir. Hat bu yüzden
dört role ayrılır ve **her rol yaptığı her işi vault'a loglar**.

| Rol | Model | İşi | Yapmadığı |
|---|---|---|---|
| **Yönetici** | Claude (sen) | Araştırma konularını belirler, hattı kurar, **logları denetler** | Ham yanıtları okumaz |
| **Düzenleyici-2 (prompt yazarı)** | codex `gpt-5.6-sol` | Yöneticinin konu brief'ini gerçek prompt'a çevirir, luna'lara dağıtır | Tarayıcıya dokunmaz |
| **Luna taşıyıcı** (konu başına 1) | codex `gpt-5.6-luna` | Puppeteer'ı sürer, ChatGPT çıktısını **BİREBİR** vault'a yazar | Yorumlamaz, özetlemez, düzeltmez |
| **Düzenleyici-1 (editör)** | codex `gpt-5.6-sol` | Ham kayıtları düzenler, iddiaları **gerçek repoya** karşı doğrular, puanlar | Kendi tarayıcı çalıştırmaz |

Akış: **yönetici → D2 (prompt) → luna (taşıma) → D1 (düzenleme) → yönetici (denetim)**.
Her okla birlikte bir log satırı düşer; yönetici hiçbir aşamada ham metne inmek zorunda kalmaz.

### Neden luna taşıyıcı, sol düzenleyici

Taşıma işi düşünmeyi değil **sadakati** ister: komutu çalıştır, çıkan metni tek kelimesini
değiştirmeden kaydet. Ucuz/hızlı model tam olarak buna uygundur ve "yardımcı olmaya çalışıp" metni
düzeltme eğilimi düşüktür. Düzenleme işi ise tersine yargı ister — iddiayı repoya karşı sınamak,
yolu düzeltmek, şiddetini kalibre etmek. `sol`'u oraya koy.

**Ham kayıt kutsaldır.** Luna'nın yazdığı dosya `ham: true` frontmatter'ı ve "BİREBİR KOPYA"
uyarısıyla durur; düzenleyici onu **değiştirmez**, yanına `duzenli/` altında ayrı bir sürüm yazar.
Böylece "model gerçekten bunu mu dedi, yoksa düzenleyici mi ekledi" sorusu her zaman yanıtlanabilir.

### Loglama (pazarlık konusu değil)

Bütün roller `scripts/vlog.py` üzerinden yazar — tek giriş noktası olması, logların tek biçimde
kalmasını ve yöneticinin tek komutla denetlemesini sağlar.

```bash
V=/path/to/vault

# artefakt + olay (luna, birebir kayıt)
python3 vlog.py yaz --vault "$V" --rol luna-tasiyici --model gpt-5.6-luna \
  --tur ham --ham --konu "07-telemetri" --sohbet "https://chatgpt.com/c/<id>" --dosya ./ham/<id>.md

# artefakt + olay (D2, yazdığı prompt)
python3 vlog.py yaz --vault "$V" --rol duzenleyici-2 --model gpt-5.6-sol \
  --tur prompt --konu "07-telemetri" --dosya ./prompt.md

# yalın olay (her rol, her adım)
python3 vlog.py olay --vault "$V" --rol luna-tasiyici --model gpt-5.6-luna \
  --eylem gonderim --konu "07-telemetri" --sonuc ok --sure 412 --not "36k karakter"

# YÖNETİCİNİN DENETİM GÖRÜNÜMÜ — ham metne inmeden hattın ne yaptığını gör
python3 vlog.py ozet --vault "$V" --son 40
```

Vault'ta oluşan yapı:

```
7 Log/olaylar.jsonl      append-only olay kaydı (rol, model, eylem, konu, sonuç, süre, artefakt)
7 Log/promptlar/         D2'nin yazdığı her prompt — yönetici prompt'ları böyle takip eder
7 Log/ham/               luna'nın birebir kayıtları (ham: true, değiştirilmesi yasak)
7 Log/duzenli/           D1'in düzenlenmiş/doğrulanmış sürümleri
7 Log/notlar/            karar kayıtları
```

**Yöneticinin denetim refleksi**: bir tur bittiğinde önce `vlog.py ozet` çalıştır. Sonuçları `ok`
olmayan olaylar, karakter sayısı beklenmedik düşük olan `ham` kayıtlar ve prompt'u olmayan taşımalar
— hepsi buradan görünür. Ham yanıtı ancak bir çelişki varsa aç.

### Rol görev şablonları

`scripts/sablonlar/` altında üç şablon var: `duzenleyici-2-prompt.md`, `luna-tasiyici.md`,
`duzenleyici-1-editor.md`. Şablonlardaki `{{...}}` yer tutucularını doldurup `codex exec`e ver:

```bash
codex exec --skip-git-repo-check -m gpt-5.6-luna -c model_reasoning_effort=medium \
  --dangerously-bypass-approvals-and-sandbox -C <lane-dizini> "$(cat task.md)"
```

Düzenleyiciler için `-m gpt-5.6-sol -c model_reasoning_effort=high`. Her lane kendi dizinini ve
**kendi chromium profilini** alır (`chromium-cp-1..N`); paylaşılan profil kilitlenir.

**Luna'ya verilen görev dar yazılmalı.** Şablon bilerek "YORUM YAPMA / ÖZETLEME / DÜZENLEME / tek
kelimesini bile değiştirme" diye başlar ve adımları tek tek komut olarak verir. Serbest bırakılan
taşıyıcı yardımcı olmaya çalışıp metni "toparlar" — o an ham kayıt değerini kaybeder.

## "Güncelle" — Project Sources'ı tazeleme (ÇÖZÜLDÜ, script hazır)

Kullanıcı **"güncelle"** dediğinde tek akış:

```bash
# 1) yeniden paketle (gptpro skill'i ya da arastirma-hatti/paketleme/paketle.sh)
PROJECT_ROOT=/path/to/repo OUTPUT_DIR=<repo>/arastirma/bundles BUNDLE_PREFIX=<onek> \
  ~/.cb/skills/gptpro/scripts/export.sh

# 2) eski sürümü sil + yenisini yükle + doğrula (tek komut)
cd <lane-dizini>   # chatgpt_cookies.json + project_state.json burada
node kaynak_guncelle.mjs --profile ~/.config/chromium-cp-4 --sil <repo>/arastirma/bundles/*.zip
```

`scripts/kaynak_guncelle.mjs` bunu yapar: Sources sekmesine geçer, mevcut kaynakları listeler,
`--sil` ile aynı taban ada sahip olanları satır menüsünden siler, kalıcı input'a yükler, sonra
**sayfayı baştan yükleyip** listeyi tekrar okuyarak doğrular. Ek kipler: `--kuru` (yalnız listele),
`--kaldir ad1.zip,ad2.zip` (yükleme yapmadan sil).

### Güncellemeyi taşıyıcıya devret (ölçüldü, çalışıyor)

Bu iş bir taşıma işidir, yönetici bağlamında yapılması gereksizdir. Şablon:
`sablonlar/luna-kaynak-guncelle.md` — `{{LANE_DIR}}`, `{{VAULT}}`, `{{PROFIL}}`,
`{{BUNDLE_GLOB}}`, `{{KONU}}` doldurulup `codex exec -m gpt-5.6-luna` ile koşulur.
Taşıyıcı sil-yükle-doğrula turunu yapar, `vlog.py` ile loglar, 5 satır rapor döner; yönetici
`vlog.py ozet` ile denetler.

Ölçüm (15 Ağustos 2026): luna tek denemede 35 saniyede ekle-doğrula-sil turunu tamamladı,
kullanıcının 5 bundle'ına dokunmadı, bağımsız `--kuru` kontrolü listeyi temiz gösterdi.

**Belirleyici olan model değil, görevin sayısallaştırılmasıydı** — aynı model, "makul mü bak"
denen turda 52 karakterlik hata ekranına `ok` demişti. Şablonda bu yüzden her kapı bir
karşılaştırma olarak yazılı ("`SONRA` sayısı ADIM 0'dakinden fazla DEĞİL"), ve kopya eki
(`ad(2).zip`) tuzağı "bu normaldir" diye önceden bildiriliyor — bildirilmezse taşıyıcı bunu
başarısızlık sanıyor. Yazma işi olduğu için şablonda ayrıca bir **kırmızı çizgi** var: göreve dahil
olmayan dosyalar kullanıcının verisidir, şüphede sil değil "hata" bildir.

**Eski "Sources'a otomatik yükleme çözülemedi" notu artık geçersiz.** Sebebi ölçülerek bulundu:
sayfada birden çok `input[type=file]` var ve menüden ("Add files → Upload from computer") ilerleyen
akış **composer'ın** girdisine düşüyordu — o kalıcı Sources değil, o anki mesajın geçici ekidir,
sayfa yenilenince kaybolur.

| Girdi | Nerede | Ne yapar |
|---|---|---|
| `input#upload-files` | bir `<form>` içinde | **composer** — geçici ek. KULLANMA |
| `#upload-photos` / `#upload-camera` | sayfa arka planı | yalnız görsel |
| id'siz input | `[id*="content-sources"] > section > section > div` | **KALICI Sources** — hedef bu |

Kurallar (hepsi ölçüldü):
1. Hedef input **yalnız Sources sekmesi açıkken** DOM'da var → önce `?tab=sources` + sekme tıklaması.
2. Seçici `[id*="content-sources"] input[type=file]` olmalı — radix id'si dinamik
   (`radix-_r_j0_-content-sources`), tam id'ye bağlanma.
3. **Doğrulama = sayfayı `networkidle2` ile baştan yükleyip listeyi tekrar okumak.** Geçici ek bu
   sınavı geçemez; anlık DOM'a bakmak yanıltır.
4. Satır menüsü (`button[aria-label="Source actions"]`) **gerçek fare tıklamasıyla açılmıyor**;
   `page.evaluate(b => b.click(), btn)` ile açılıyor. Menü: `Download` / `Delete`, onay diyaloğu yok.
5. Yükleme **değiştirmez, ekler**: aynı ad `(1)`, `(2)` ekiyle kopyalanır. Gerçek güncelleme için
   önce silmek şart; karşılaştırmalarda kopya ekini normalize et (`taban()`).

## Paralellik ve eşzamanlılık SINIRI (sert ders)

Sohbetleri eşzamanlı sürmek için her tarayıcı kendi `--profile`'ını almalı (**aynı profil
paylaşılırsa kilitlenir**). AMA:

**Aynı hesaptan aynı anda 3+ tarayıcı sohbeti göndermek işi BOZAR.** Ölçülen sonuç: 5 eşzamanlı
gönderimden yalnız 2'si tamamlandı; diğerlerinde ChatGPT web'i "Thinking / Connection interrupted"
verip yanıtı yarıda kesti (aynı hesap+IP'den çok sayıda eşzamanlı akış throttle yiyor). Kural:
**en çok 2 eşzamanlı, tercihen sırayla.** Koptuğunda yanıt ~2-10 kelime kalır (URL oluşur ama içerik
yok) — bunu kelime sayısıyla tespit et ve o başlığı **sırayla** yeniden gönder.

## Token tasarrufu: ağır okuma/değerlendirmeyi codex lane'lerine devret

Asıl token yükü, her biri ~35k karakterlik yanıtları **senin** bağlamına okumaktır. Bunu codex
subagent'larına devret: her lane tek prompt'u gönderir, yanıtı **kendi** bağlamında okur/değerlendirir,
sana yalnız 5 satırlık özet + bir `-eval.md` dosyası döndürür. Desen (`codex-fleet` skill'i):

```bash
codex exec --skip-git-repo-check -m gpt-5.6-sol -c model_reasoning_effort=high \
  --dangerously-bypass-approvals-and-sandbox -C <scratchpad> "<lane görevi>" > laneN.log 2>laneN.err
```

- **codex 0.147'de `--full-auto` YOK** (`exec` altında hata verir); tarayıcı+ağ için
  `--dangerously-bypass-approvals-and-sandbox` kullan (kullanıcı delegasyonu onayladıysa).
- Lane görevi: "`node proj_one.mjs --profile <cpN> --prompt <file> --save <out> --timeout 900` çalıştır
  (SEND_OK bekle, SEND_FAIL'de tekrar dene) → çıktıyı oku, değerlendir, `-eval.md` yaz → 5 satır özet".
- **codex'in kendi backend'i de chatgpt.com'a bağlanır**; 5 codex + 5 tarayıcı = ~10 eşzamanlı bağlantı,
  codex kontrol kanalı da kopabilir (`stream disconnected before completion`). Yukarıdaki eşzamanlılık
  sınırı burada da geçerli — lane'leri gruplara böl ya da sırala.
- Her lane ayrı profil (`chromium-cp-1..N`) alır; script çerezleri o profile enjekte eder.

## Kalıcılaştırma: pencereyi açık tutma (`keepopen` deseni)

Kullanıcının elle iş yapması (Sources'a yükleme, giriş, DR toggle) gerektiğinde tarayıcıyı açık
bırak: puppeteer ile aç, `await new Promise(()=>{})` ile süresiz beklet, `run_in_background: true`
ile arka planda çalıştır. İş bitince süreci `kill` et (profil kilidini serbest bırakır). **Uyarı:**
kullanıcı yüklerken pencereyi kapatma — sunucuya işlenmeden iptal olabilir.

## Kalıcılaştırma (isteğe bağlı, sonraki oturumlar için)

Puppeteer MCP'yi kullanıcının projesine `.mcp.json` ile ekleyebilirsin ki gelecekte araç olarak
kullanılabilsin (dedike, giriş yapılmış profille):

```json
{ "mcpServers": { "puppeteer": { "type": "stdio", "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
  "env": { "PUPPETEER_LAUNCH_OPTIONS": "{\"headless\":false,\"executablePath\":\"/usr/bin/chromium\",\"userDataDir\":\"/home/USER/.config/chromium-<isim>\"}",
           "ALLOW_DANGEROUS": "true" } } } }
```

Uyar: MCP sunucuları **oturum başında** yüklenir. Bu turda eklenen MCP ancak kullanıcı Claude Code'u
**yeniden başlatınca** kullanılabilir; o yüzden mevcut işi bu skill'in script'leriyle doğrudan sür,
MCP'yi yalnız gelecek için ekle.

## Script'in YALAN SÖYLEDİĞİ üç yer (ölçüldü — hepsini doğrula)

Bu üçü aynı turda ölçüldü ve üçü de "iş başarısız" görüntüsü üretirken gerçek başka çıktı. Hattı
kurarken **raporu değil sonucu** doğrula.

1. **`proj_one.mjs` "0 karakter / partial" derken yanıt aslında tamdır.** Akış-bitti tespiti
   (stop butonu + 4 sn sabitlik) uzun yanıtlarda erken kopuyor; tarayıcı kapandıktan sonra yanıt
   tamamlanıyor. Ölçüm: "0 char" raporlanan sohbet tekrar okununca **36.357 karakter** çıktı.
   **Kural: her "boş/kısmi" raporundan sonra sohbeti `read` ile tekrar oku, kararı ona göre ver.**
   Bir başlığı "ChatGPT reddetti / üretemedi" diye yazmadan önce bu adım şart — aksi halde çalışan
   bir başlığa üç tur boşuna deneme harcanır (bir kez fiilen oldu).

2. **`send_chats.mjs read` Project URL'lerini hiç eşleştirmez.** Regex `https://chatgpt.com/c/<id>`
   bekliyor; proje sohbetinin URL'i araya `/g/g-p-<projeId>-<slug>` alıyor ve **sessizce sıfır URL**
   bulunur (hata da vermez, hiç okumaz). **Kural: `read` için link dosyasına daima düz
   `https://chatgpt.com/c/<id>` formunu yaz** — sunucu zaten proje sohbetine yönlendirir.

3. **`followup` gönderimi sessizce başarısız olup ÖNCEKİ turu kaydeder.** Gönderim tutmadığında
   `readLast` hâlâ son asistan mesajını okur — yani bir önceki turun yanıtını "2. tur" diye kaydeder.
   Ölçüm: kaydedilen "tur2" dosyası 33.972 bayt, 1. tur 34.152 bayt — birebir kopya.
   **Kural: tur N'in dosya boyutunu tur N-1 ile karşılaştır; yakınsa tur gitmemiştir.** Byte farkı
   %5'in altındaysa kaydı `.GECERSIZ` olarak karantinaya al, gerçek bir tur gibi vault'a girmesin.

## Zip bundle yolları repo yollarıyla AYNI DEĞİL

Project Sources'a yüklenen bundle'lar dizin yapısını düzleştirdiği için model **satır numarasını
doğru, dosya yolunu yanlış** verir. Ölçülen örnekler: yanıtta `web/src/components/FlowView.tsx`,
repoda `web/src/views/FlowView.tsx`; yanıtta `db/prisma/schema.prisma`, repoda
`server/prisma/schema.prisma`. İki ayrı lane bunu bağımsız olarak yakaladı.

**Bu yüzden düzenleyici rolü (D1) zorunludur**: her `dosya:satır` atfını gerçek repoda doğrular,
yolu düzeltir, doğrulanamayanı işaretler. Bulguların kendisi genelde sağlamdır — yol güvenilmezdir.
Aynı şekilde **şiddet kalibrasyonu da D1'in işidir**: bir tur "çift merge riski" diye raporladı,
kod okununca ikinci merge'ün `diffStates` boş döndüğü için zararsız no-op olduğu, gerçek kusurun
veri kaybı değil durum tutarsızlığı olduğu görüldü. Model doğru yeri gösterir, şiddeti abartır.

## Sık tuzaklar

- **Çerez çözülemiyor**: keyring kilitli ya da yanlış folder/entry adı. `kwallet-query -l` ile
  girdileri listele; VSCodium/Chrome/Chromium ayrı "Safe Storage" girdileri tutar.
- **`v10` etiketi**: keyring yoksa Chromium sabit `peanuts` anahtarı kullanır — script ikisini de dener.
- **Chrome 130+ damgası**: çözülen metnin başındaki 32 bayt domain hash'i script tarafından atılır.
- **Profil kilidi**: "profile already in use" → kullanıcının o profildeki tarayıcısı açık; dedike
  profil kullan ya da kapatmasını iste.
- **Gönderim takılıyor**: script zaten 3 kez dener; ısrarla başarısızsa arayüz güncellenmiş
  olabilir (composer/gönder seçicileri) — `send_chats.mjs` içindeki seçicileri güncelle.
- **Bot koruması**: ChatGPT'yi çerezle otomatize etmek OpenAI kullanım şartlarına aykırı olabilir
  ve Cloudflare buna direnebilir. Hesap kullanıcınındır; kararı bir kez belirt, sonra ısrar etme.

## Bağımlılıklar

`python` + `cryptography` (çerez çözme), `kwallet-query` ya da eşdeğer keyring erişimi, `node` +
`puppeteer-core@25`, sistem `chromium`/`chrome` ikilisi, grafik oturumu (`DISPLAY` veya Wayland).
Codex delegasyonu için `codex` CLI (0.147+; `codex-fleet` skill'i). `gptpro` skill'i repo paketleme
için. `scripts/proj_one.mjs` Project-içi tek gönderim yapar (aynı dizinde `chatgpt_cookies.json` +
`project_state.json` bekler; ortak-bağlam yolu script içinde sabit — kendi kurulumunda uyarlanır).
