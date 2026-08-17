# 3 — Yapay zekâ katmanı: yerleşik ajan + çok ajanlı planlama (MCP)

Yukarıdaki mimarinin **yapay zekâ** katmanını araştırmanı istiyorum: hem tek yerleşik LLM ajanı hem de
Model Context Protocol (MCP) üzerinden çalışan çok ajanlı planlama + supervisor onay modeli.

## Araştırma soruları

**MCP protokol yüzeyi ve olgunluğu**
1. Model Context Protocol'ün bugünkü (2025-2026) durumu: Streamable HTTP taşıması, durumsuz
   (stateless) sunucu deseni, oturum yönetimi. Benim tasarımım "her istekte taze sunucu örneği,
   oturum id yok" — bu deseni öneren/uyaran güncel MCP kaynakları neler?
2. MCP'de sunucudan istemciye push yok; ben bunu **in-request long-poll** (25 sn'ye kadar bekleyen
   `wait_for_changes` aracı) ile çözüyorum. Bu deseni kullanan başka MCP sunucuları var mı? Vekil/proxy
   zaman aşımı, kopan bağlantı, kaçırılan sinyal gibi bilinen tuzaklar? 25 sn seçimi makul mü?
3. Kanvas kapsamlı, göster-bir-kez Bearer anahtarlarıyla MCP kimlik doğrulama: MCP yetkilendirme
   spesifikasyonunun güncel hâliyle uyum. OAuth zorunlu mu, statik Bearer kabul ediliyor mu?

**Çok ajanlı koordinasyon**
4. Birden çok LLM ajanının paylaşılan bir çalışma alanında paralel plan üretip bir "supervisor"
   tarafından onaylandığı mimariler (AutoGen, CrewAI, LangGraph, OpenAI Swarm, Anthropic'in
   multi-agent araştırması) nasıl kurgulanıyor? Onay/veto/rol deseni karşılaştırması.
5. Benim modelim: ajanların **commit yetkisi yok**, yalnız "öneri" gönderiyorlar; bir supervisor
   ajan onaylayınca öneri normal kod kontrollerinden (yetki, bölge, çatışma) geçerek iniyor
   ("supervisor + kod kontrolü birlikte"). Bu "insan/kod kapısı + ajan önerisi" ayrımının literatürdeki
   karşılığı (human-in-the-loop, agent sandboxing, capability-based agent security) ne? Güçlü/zayıf yanları.
6. Ajanların iş bölüşümü için "claim" (düğüm/bölge kilitleme) mekanizması: dağıtık kilit, kira (lease),
   terk edilmiş claim temizliği desenleri. İki ajan aynı alanı aynı anda planlarsa kilitlenme / aç
   kalma (starvation) nasıl önlenir?

**Ajan güvenliği**
7. **Prompt injection**: kullanıcıların yazdığı düğüm metinleri ve bölge açıklamaları doğrudan ajan
   prompt'una giriyor. Bir düğüm başlığına gömülmüş talimat ajana ne yaptırabilir? Paylaşılan
   çalışma alanında çalışan ajanlar için injection savunma desenleri (2025-2026 literatürü:
   OWASP LLM Top 10, Simon Willison'ın yazıları, "lethal trifecta").
8. Kötü niyetli/bozuk ajan senaryoları: süresiz döngü, devasa öneri, supervisor'ı kandırma.
   Kaynak sınırlama, öneri boyut sınırı, oran sınırlama için endüstri pratiği.
9. Benim "kapalı bölge" mekanizmam (ajanın dokunamayacağı alanları sunucu tarafında eleme) yeterli
   bir savunma katmanı mı, yoksa yalnız bir katman mı olmalı?

**Yerleşik LLM ajanı**
10. Doğal dil → yapılandırılmış diyagram (JSON: özet + düğümler + kenarlar + yerleşim) üretiminde
    çıktı güvenilirliği: yapılandırılmış çıktı (structured output / JSON mode / tool calling / grammar
    kısıtı) kullanmanın serbest-metin JSON'a göre kazandırdıkları. Bozuk/kısmi yanıt yönetimi desenleri.
11. Model bağımsızlığı: `Llm` fonksiyonunu enjekte edilebilir tutuyorum. Çok sağlayıcılı (Gemini /
    Claude / OpenAI / yerel model) soyutlama için pratik desenler, sağlayıcılar arası yapılandırılmış
    çıktı farkları, fallback stratejisi.
12. **Değerlendirme (eval)**: "iyi diyagram/plan" çıktısının kalitesini nasıl ölçerim? Altın örnek
    kümesi, LLM-as-judge, regresyon eval'i, graf çıktısı için otomatik metrikler (bağlılık, döngü,
    kapsama). Diyagram/plan üretimi değerlendiren mevcut çalışma var mı?

## Çıktı formatı
- **Yönetici özeti** (≤15 satır).
- **Bulgular**: iddia + kaynak (bağlantı, tarih/sürüm) + mimarime etkisi.
- **Çok ajanlı çerçeve karşılaştırma tablosu**: AutoGen/CrewAI/LangGraph/Swarm — onay modeli,
  koordinasyon, güvenlik, olgunluk.
- **Prompt injection risk tablosu**: senaryo → etki → savunma katmanı → benim tasarımımda durum.
- **Öneriler**: S/M/L + "yapılmazsa ne olur".
- **Açık sorular** ayrı.

Kaynaklarda tarih/sürüm belirt. MCP hızlı değişiyor — 2025 sonrası kaynakları önceliklendir ve
tarihini açıkça yaz.
