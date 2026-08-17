# 2 — Yetki modeli, güvenlik, kimlik ve gizlilik

Yukarıdaki mimarinin **yetki, kimlik ve gizlilik** katmanını araştırmanı istiyorum. Kod denetimi değil,
alan araştırması ve en iyi pratiklerle karşılaştırma bekliyorum.

## Araştırma soruları

**Çok katmanlı yetkilendirme**
1. Kanvas rolü + grup/iş rolü + bölge üyeliği gibi iç içe geçmiş üç yetki katmanını olan işbirlikçi
   ürünler (Figma, Notion, Miro, Linear) yetkiyi nasıl modelliyor? Yaygın hatalar ve "confused deputy"
   sınıfı açıklar neler?
2. Tek choke point'te yetki kontrolü (benim modelim: tüm yazma yolları tek bir "commit uygulama"
   fonksiyonundan geçip orada kontrol ediliyor) deseninin güçlü ve zayıf yanları. Yeni bir kod yolu
   yazan geliştiricinin choke point'i yanlışlıkla atlamasını **tip sistemiyle** engelleyen desenler
   (ör. yalnız yetki kontrolünden dönen bir token tipiyle mutasyona izin verme) var mı? Örnekler.

**Sır yönetimi**
3. Farklı sır ailelerini farklı saklama yöntemleriyle tutmak (oturum id'si ham, uzun ömürlü API
   anahtarı sha256, e-posta kodu scrypt) — bu tutarsızlık ne zaman kabul edilebilir, ne zaman risk?
   Her biri için doğru saklama, rotasyon ve iptal deseni nedir?
4. Göster-bir-kez API anahtarları (benim MCP ajan anahtarlarım gibi) için endüstri standardı:
   önek/etiketleme, sızıntı tarama (GitHub secret scanning), otomatik rotasyon, kapsam daraltma.

**Hesap devri / aktivasyon el sıkışması**
5. PKCE ve benzeri "yerel istemciyi bulut hesabına bağlama" akışlarında dönüş adresi (redirect URI)
   doğrulaması neden kritik? Açık yönlendirme (open redirect) + PKCE kombinasyonuyla hesap devri
   senaryoları literatürde nasıl anlatılıyor? Benim savunmam "dönüş adresini yalnız yerel ağ
   adreslerine (loopback/RFC1918/link-local/.local) kilitlemek" — bu yeterli mi, DNS rebinding ve
   SSRF ile aşılır mı?
6. Loopback redirect kullanan OAuth istemcileri için güncel IETF önerileri (RFC 8252 ve sonrası)
   ne diyor? Benim yaklaşımım bunlarla uyumlu mu?

**Kimlik ve oturum**
7. 30 gün sabit ömürlü, yenilemesiz, cihaz listesiz oturum çerezi bugünün standardına göre nerede
   duruyor? Oturum yenileme (rotation), "oturumlarım" ekranı, şüpheli giriş tespiti için minimum
   uygulanabilir set ne?
8. `@fastify/oauth2` gibi kütüphanelerin CSRF state çerezine `secure` bayrağı geçilmemesi pratikte
   ne kadar önemli? Bu sınıf ihmalin gerçek istismarı var mı?

**Gizlilik duruşu ve telemetri**
9. Bugün kullanıcı davranışına dair **kalıcı hiçbir veri** tutmuyorum (IP yok, user-agent yok, oturum
   satırında yalnız süre sonu var). Bu radikal-minimal duruşu koruyan ürünler var mı, ticari olarak
   sürdürülebilir mi? "Privacy by default" pazarlama ve uyum (KVKK/GDPR) açısından ne kazandırır?
10. **Aktif kullanım süresi ölçmek istiyorum** (kim ne kadar süre aktif kullandı, yönetim panelinde
    göstermek için). "Sekme açık" ile "aktif kullanım" farkını ölçen doğru yöntem nedir? İstemci
    tarafı boşta-kalma tespiti (visibility API + girdi olayları), beat/heartbeat toplama, çok sekme
    tekilleştirme, günlük kova (bucket) toplama desenleri. Boşta eşiğinin (30 sn / 60 sn / 3 dk)
    ölçülen rakamın anlamını nasıl değiştirdiğine dair analitik literatürü (ör. "engaged time"
    tanımları, Parse.ly/Medium yaklaşımları).
11. Bu tür davranışsal ölçüm KVKK/GDPR açısından ne gerektirir (aydınlatma, hukuki dayanak, saklama
    süresi, anonimleştirme)? Ham beat yerine günlük toplama tutmanın uyum avantajı.

**Yönetimsel denetim kaydı (audit log)**
12. Yönetici kanvas içeriğini okuyamıyor (bilinçli körlük). Bu duruşu koruyan sistemlerde kötüye
    kullanım şikâyeti / yasal talep / destek talebi nasıl karşılanıyor? Denetim kaydı olmadan yönetim
    ne kadar savunulabilir, minimum audit log tasarımı ne olmalı?

## Çıktı formatı
- **Yönetici özeti** (≤15 satır).
- **Bulgular**: iddia + kaynak (bağlantı, tarih) + mimarime etkisi.
- **Risk sıralaması**: her biri için istismar senaryosu + istismar edilebilirlik × etki.
- **Öneriler**: S/M/L + "yapılmazsa ne olur".
- **Uyum notu**: KVKK/GDPR açısından telemetri ve audit log için somut gereklilik listesi.
- **Açık sorular** ayrı.

Kaynaklarda tarih/sürüm belirt; güvenlik önerilerinde OWASP/IETF/NIST gibi otoriteye dayan.
