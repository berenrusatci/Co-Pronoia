#!/usr/bin/env python3
"""arastirma/ altındaki ham araştırma dosyalarından Obsidian vault'u üretir.

Lane'ler yeni yanıt yazdıkça tekrar çalıştırılabilir (idempotent): vault'taki üretilmiş
notları baştan yazar, PANO'yu mevcut dosyalara göre yeniden hesaplar.

Kullanım: python3 arastirma/vault-sync.py
"""
from __future__ import annotations

import datetime as dt
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VAULT = ROOT / "vault"

BASLIKLAR = {
    "01": "Çekirdek ve Eşzamanlılık",
    "02": "Yetki, Güvenlik ve Gizlilik",
    "03": "Yapay Zekâ, MCP ve Çok-Ajanlı",
    "04": "Frontend, Ölçek ve Erişilebilirlik",
    "05": "Dağıtım, Veri ve Ürün",
}

KLASOR = {
    "soru": "1 Sorular",
    "web": "2 Yanıtlar - Web",
    "kod": "3 Yanıtlar - Kod",
    "eval": "4 Değerlendirmeler",
    "sentez": "5 Sentez",
    "yontem": "6 Yöntem",
}

URL_RE = re.compile(r"https://chatgpt\.com/\S+")


def kelime(metin: str) -> int:
    return len(metin.split())


def gövde(yol: Path) -> tuple[str, str | None]:
    """Dosya metnini ve (varsa) ilk satırdaki sohbet URL'ini döndürür."""
    metin = yol.read_text(encoding="utf-8")
    url = None
    satirlar = metin.splitlines()
    if satirlar and satirlar[0].startswith("# https://chatgpt.com"):
        url = satirlar[0][2:].strip()
        metin = "\n".join(satirlar[1:]).lstrip("\n")
    return metin, url


def not_yaz(klasor: str, ad: str, fm: dict, govde: str) -> Path:
    hedef = VAULT / klasor / f"{ad}.md"
    hedef.parent.mkdir(parents=True, exist_ok=True)
    satirlar = ["---"]
    for k, v in fm.items():
        if v is None:
            continue
        if isinstance(v, list):
            satirlar.append(f"{k}:")
            satirlar += [f"  - {x}" for x in v]
        else:
            satirlar.append(f"{k}: {v}")
    satirlar += ["---", ""]
    hedef.write_text("\n".join(satirlar) + govde.rstrip() + "\n", encoding="utf-8")
    return hedef


def kaynak_bul(klasor: Path, no: str, *, ek: str = "") -> Path | None:
    if not klasor.is_dir():
        return None
    for p in sorted(klasor.glob(f"{no}-*.md")):
        ad = p.stem
        if ek:
            # 'tur2' araması '...-tur2-DEGERLENDIRME.md'yi de eşliyor ve alfabetik olarak o
            # önce geliyor — değerlendirmeleri burada elemezsek asıl yanıt hiç bulunmuyor.
            if ek in ad and "DEGERLENDIRME" not in ad:
                return p
        elif "DEGERLENDIRME" not in ad and "tur2" not in ad:
            return p
    return None


def log_ozeti() -> list[str]:
    """7 Log/olaylar.jsonl'i PANO için özetler (yöneticinin denetim görünümü)."""
    import json

    yol = VAULT / "7 Log" / "olaylar.jsonl"
    if not yol.exists():
        return ["*Henüz log yok — dört rollü hat bu vault'ta hiç çalıştırılmadı.*"]
    olaylar = [json.loads(x) for x in yol.read_text(encoding="utf-8").splitlines() if x.strip()]
    if not olaylar:
        return ["*Log dosyası boş.*"]

    roller: dict[str, list[int]] = {}
    for o in olaylar:
        r = roller.setdefault(f"{o.get('rol','?')} ({o.get('model','-')})", [0, 0])
        r[0] += 1
        if o.get("sonuc") not in ("ok", None):
            r[1] += 1

    satir = ["| Rol (model) | Olay | Sorunlu |", "|---|---|---|"]
    satir += [f"| {k} | {v[0]} | {v[1] or '—'} |" for k, v in sorted(roller.items())]
    sorunlu = [o for o in olaylar if o.get("sonuc") not in ("ok", None)]
    satir += ["", f"Son olay: `{olaylar[-1]['zaman']}` — {olaylar[-1]['rol']}/{olaylar[-1]['eylem']} "
                  f"({olaylar[-1]['konu']}) = **{olaylar[-1]['sonuc']}**"]
    if sorunlu:
        satir += ["", "> [!warning] Sorunlu olaylar",
                  *[f"> - `{o['zaman']}` {o['rol']}/{o['eylem']} — {o['konu']}: {o['sonuc']}"
                    for o in sorunlu[-5:]]]
    satir += ["", "Tam kayıt: `7 Log/olaylar.jsonl` · Denetim komutu: "
                  "`python3 ~/.claude/skills/gpt-web-research/scripts/vlog.py ozet --vault "
                  f'"{VAULT}"`']
    return satir


def main() -> None:
    bugun = dt.date.today().isoformat()
    # Üretilmiş klasörleri temizle (elle eklenen notlar '0 Günlük' altında korunur).
    for k in KLASOR.values():
        shutil.rmtree(VAULT / k, ignore_errors=True)
    (VAULT / "0 Günlük").mkdir(parents=True, exist_ok=True)

    durum: dict[str, dict] = {}

    for no, baslik in BASLIKLAR.items():
        d = durum.setdefault(no, {})

        # --- soru (şema prompt'u) ---
        src = kaynak_bul(ROOT, no)
        if src:
            metin, _ = gövde(src)
            not_yaz(
                KLASOR["soru"],
                f"{no} {baslik} - sorular",
                {"tags": ["arastirma/soru", f"baslik/{no}"], "baslik": baslik,
                 "tur": "soru", "kaynak": src.name},
                f"> [!question] Bu başlığın araştırma şeması\n> Yanıtlar: "
                f"[[{no} {baslik} - web]] · [[{no} {baslik} - kod]]\n\n{metin}",
            )

        # --- standalone (web kaynaklı) yanıt ---
        src = kaynak_bul(ROOT / "yanitlar-standalone", no)
        if src:
            metin, url = gövde(src)
            d["web"] = kelime(metin)
            not_yaz(
                KLASOR["web"],
                f"{no} {baslik} - web",
                {"tags": ["arastirma/yanit", "kaynak/web", f"baslik/{no}"],
                 "baslik": baslik, "tur": "web", "tur_no": 1,
                 "kelime": d["web"], "sohbet": url, "kaynak": src.name},
                f"> [!abstract] Web kaynaklı yanıt (koda atıfsız)\n"
                f"> Sorular: [[{no} {baslik} - sorular]]\n\n{metin}",
            )

        # --- proje (koda atıflı) yanıt, 1. tur ---
        src = kaynak_bul(ROOT / "yanitlar-proje", no)
        if src:
            metin, url = gövde(src)
            d["kod"] = kelime(metin)
            d["kod_url"] = url
            not_yaz(
                KLASOR["kod"],
                f"{no} {baslik} - kod",
                {"tags": ["arastirma/yanit", "kaynak/kod", f"baslik/{no}"],
                 "baslik": baslik, "tur": "kod", "tur_no": 1,
                 "kelime": d["kod"], "sohbet": url, "kaynak": src.name},
                f"> [!abstract] ChatGPT Project yanıtı — Sources'taki gerçek koda `dosya:satır` atıflı\n"
                f"> Sorular: [[{no} {baslik} - sorular]] · Web sürümü: [[{no} {baslik} - web]]\n\n{metin}",
            )

        # --- 2. tur derinleştirme ---
        src = kaynak_bul(ROOT / "yanitlar-proje", no, ek="tur2")
        if src and "DEGERLENDIRME" not in src.stem:
            metin, url = gövde(src)
            d["tur2"] = kelime(metin)
            not_yaz(
                KLASOR["kod"],
                f"{no} {baslik} - kod tur2",
                {"tags": ["arastirma/yanit", "kaynak/kod", f"baslik/{no}"],
                 "baslik": baslik, "tur": "kod", "tur_no": 2,
                 "kelime": d["tur2"], "sohbet": url, "kaynak": src.name},
                f"> [!abstract] Aynı sohbette 2. tur derinleştirme\n"
                f"> 1. tur: [[{no} {baslik} - kod]]\n\n{metin}",
            )

        # --- değerlendirmeler ---
        for p in sorted((ROOT / "yanitlar-proje").glob(f"{no}-*DEGERLENDIRME.md")):
            metin, _ = gövde(p)
            turno = 2 if "tur2" in p.stem else 1
            d.setdefault("eval", []).append(turno)
            not_yaz(
                KLASOR["eval"],
                f"{no} {baslik} - degerlendirme tur{turno}",
                {"tags": ["arastirma/degerlendirme", f"baslik/{no}"],
                 "baslik": baslik, "tur": "degerlendirme", "tur_no": turno,
                 "kaynak": p.name},
                f"> [!check] Lane'in kendi hükmü ({turno}. tur)\n"
                f"> Yanıt: [[{no} {baslik} - kod{' tur2' if turno == 2 else ''}]]\n\n{metin}",
            )

    # --- sentez ---
    sentez = ROOT / "SENTEZ.md"
    if sentez.exists():
        metin, _ = gövde(sentez)
        not_yaz(KLASOR["sentez"], "Sentez",
                {"tags": ["arastirma/sentez"], "tur": "sentez"}, metin)

    # --- yöntem notları ---
    SKILL = Path.home() / ".claude/skills/gpt-web-research/SKILL.md"
    for src, ad, baslik_notu in [
        (ROOT / "DURUM.md", "Durum kaydı", "Turların ham durum kaydı"),
        (ROOT / "SOHBET-LINKLERI.md", "Sohbet linkleri", "Gönderilen ChatGPT sohbetleri"),
        (ROOT.parent / "ARASTIRMA-SEMASI.md", "Araştırma şeması", "Bütün araştırmanın kaynak şeması"),
        (SKILL, "Hat tanımı (skill)",
         "Dört rollü araştırma hattının tanımı — `~/.claude/skills/gpt-web-research/SKILL.md` kopyası"),
    ]:
        if src.exists():
            metin, _ = gövde(src)
            not_yaz(KLASOR["yontem"], ad,
                    {"tags": ["arastirma/yontem"], "kaynak": src.name},
                    f"> [!info] {baslik_notu}\n\n{metin}")

    # --- PANO ---
    satirlar = [
        "| # | Başlık | Web | Kod (1. tur) | Kod (2. tur) | Değerlendirme |",
        "|---|---|---|---|---|---|",
    ]
    for no, baslik in BASLIKLAR.items():
        d = durum.get(no, {})
        hucre = lambda v, link: f"[[{link}\\|{v} kel]]" if v else "—"
        ev = d.get("eval", [])
        satirlar.append(
            f"| {no} | [[{no} {baslik} - sorular\\|{baslik}]] "
            f"| {hucre(d.get('web'), f'{no} {baslik} - web')} "
            f"| {hucre(d.get('kod'), f'{no} {baslik} - kod')} "
            f"| {hucre(d.get('tur2'), f'{no} {baslik} - kod tur2')} "
            f"| {' '.join(f'[[{no} {baslik} - degerlendirme tur{t}\\|tur{t}]]' for t in sorted(ev)) or '—'} |"
        )

    eksik = [f"**{no}** {b}: " + ", ".join(
        x for x, k in [("kod 1. tur", "kod"), ("kod 2. tur", "tur2")] if not durum.get(no, {}).get(k)
    ) for no, b in BASLIKLAR.items()
        if not (durum.get(no, {}).get("kod") and durum.get(no, {}).get("tur2"))]

    pano = [
        "> [!tip] Bu not `arastirma/vault-sync.py` tarafından üretiliyor — elle düzenleme, "
        "kaynak dosyalar `arastirma/` altında.",
        "",
        "# Co-Pronoia araştırma panosu",
        "",
        f"*Son senkron: {bugun}*",
        "",
        "## Kapsama",
        "",
        *satirlar,
        "",
        "**Web** = ChatGPT web'inin genel kaynaklarıyla (koda erişimsiz) verdiği yanıt. ",
        "**Kod** = *Co-Pronoia Araştırma* Project'i içinden, Sources'a yüklü gerçek kaynak koda ",
        "`dosya:satır` atıflı yanıt. **2. tur** = aynı sohbette, 1. turun boşluklarına göre yazılmış ",
        "somut takip sorusunun yanıtı.",
        "",
        "## Eksikler",
        "",
        *([f"- {e}" for e in eksik] or ["- Yok — bütün başlıklar iki turu da tamamladı."]),
        "",
        "## Hat ve log denetimi",
        "",
        *log_ozeti(),
        "",
        "Roller: **yönetici** (Claude) konuyu belirler → **düzenleyici-2** (`gpt-5.6-sol`) prompt'u ",
        "yazar → **luna taşıyıcı** (`gpt-5.6-luna`) tarayıcıyı sürüp çıktıyı **birebir** kaydeder → ",
        "**düzenleyici-1** (`gpt-5.6-sol`) düzenler ve iddiaları gerçek repoya karşı doğrular. ",
        "Tanım: [[Hat tanımı (skill)]]. Ham kayıtlar `7 Log/ham/` altında ve **değiştirilemez**.",
        "",
        "## Gezinme",
        "",
        "- [[Sentez]] — başlıklar arası birleştirme" + ("" if sentez.exists() else " *(henüz yok)*"),
        "- [[Araştırma şeması]] — bütün araştırmanın kaynağı",
        "- [[Sohbet linkleri]] · [[Durum kaydı]]",
        "- Etiketler: #arastirma/yanit #arastirma/degerlendirme #arastirma/soru #arastirma/yontem",
        "",
        "## Yöntem özeti",
        "",
        "- Gönderim `gpt-web-research` skill'iyle, kullanıcının kendi giriş yapmış ChatGPT oturumu ",
        "  üzerinden Puppeteer ile yapılıyor (API değil web — Project Sources ve Deep Research için).",
        "- **Aynı hesaptan en çok 2 eşzamanlı akış**: fazlası \"Connection interrupted\" ile yanıtı ",
        "  yarıda kesiyor. Lane'ler bu yüzden kaydırmalı başlatılıyor.",
        "- Ağır okuma/değerlendirme codex lane'lerine devrediliyor; her lane yanıtı kendi bağlamında ",
        "  okuyup bir `-degerlendirme` notu bırakıyor.",
    ]
    (VAULT / "PANO.md").write_text("\n".join(pano) + "\n", encoding="utf-8")

    # --- Obsidian ayarları ---
    cfg = VAULT / ".obsidian"
    cfg.mkdir(exist_ok=True)
    (cfg / "app.json").write_text(
        '{"attachmentFolderPath":"_ekler","alwaysUpdateLinks":true,"newLinkFormat":"shortest",'
        '"useMarkdownLinks":false,"showLineNumber":true,"readableLineLength":true}\n',
        encoding="utf-8")
    (cfg / "appearance.json").write_text('{"accentColor":"","theme":"obsidian"}\n', encoding="utf-8")
    (cfg / "core-plugins.json").write_text(
        '["file-explorer","global-search","switcher","graph","backlink","outgoing-link",'
        '"tag-pane","page-preview","note-composer","command-palette","outline",'
        '"word-count","file-recovery"]\n', encoding="utf-8")

    toplam = sum(len(list((VAULT / k).rglob("*.md"))) for k in KLASOR.values() if (VAULT / k).is_dir())
    print(f"vault hazır: {VAULT}")
    print(f"  not sayısı: {toplam + 1} (PANO dahil)")
    for no, b in BASLIKLAR.items():
        d = durum.get(no, {})
        print(f"  {no} {b}: web={d.get('web','-')} kod={d.get('kod','-')} tur2={d.get('tur2','-')} "
              f"eval={sorted(d.get('eval', [])) or '-'}")


if __name__ == "__main__":
    main()
