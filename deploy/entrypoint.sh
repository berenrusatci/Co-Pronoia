#!/bin/sh
# Konteyner açılışı: önce şemayı uygula, sonra sunucuyu çalıştır.
#
# `prisma db push` neden yeniden denenir: barındırılan kurulumun veritabanı Supabase'te ve
# ücretsiz katman projeyi 7 gün hareketsizlikten sonra duraklatıyor; ayrıca Render bir deploy
# sırasında konteyneri veritabanı hazır olmadan da başlatabiliyor. Tek denemede vazgeçince
# süreç hemen ölüyor, Render onu yeniden başlatıyor ve kurulum "açılış döngüsüne" giriyor —
# üstelik günlükte tek satırlık bir Prisma hatasından başka bir şey görünmüyor. Birkaç kez,
# artan aralıklarla denemek duraklamış/uyanmakta olan bir veritabanını beklemeye yetiyor.
#
# Sonunda yine başarısızsa BİLE REDDEDİLİR (exit 1): şema uygulanmadan sunucuyu ayağa
# kaldırmak, ilk isteğe kadar sağlıklı görünen ama her sorgusu patlayan bir kurulum demektir.
set -eu

cd /app/server

DENEME=${DB_PUSH_RETRIES:-5}
BEKLE=5
i=1
while [ "$i" -le "$DENEME" ]; do
  if /app/node_modules/.bin/prisma db push; then
    exec node dist/server.mjs
  fi
  if [ "$i" -eq "$DENEME" ]; then
    echo "prisma db push $DENEME denemede başarısız — veritabanına ulaşılamıyor." >&2
    echo "Supabase projesi duraklatılmış olabilir (ücretsiz katman 7 gün hareketsizlikte duraklatır)" >&2
    echo "ya da DATABASE_URL yanlış. Sunucu başlatılmadı." >&2
    exit 1
  fi
  echo "prisma db push başarısız (deneme $i/$DENEME), ${BEKLE}s sonra tekrar denenecek..." >&2
  sleep "$BEKLE"
  BEKLE=$((BEKLE * 2))
  i=$((i + 1))
done
