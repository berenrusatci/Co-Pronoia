---
tags:
  - log/not
  - rol/yonetici
rol: yonetici
model: claude-opus-5
konu: asama1-bulgu-durumu
tur: not
zaman: 2026-08-16T14:46:00
karakter: 1321
ham: false
---

# Aşama 1 — Bulgu durumu tazelemesi (16 Ağustos 2026, yönetici)

15 Ağustos SENTEZ.md'deki 15 bulgunun her biri bugünkü kodda tek tek sınandı. Commit mesajı
kanıt sayılmadı; her düzeltmenin fiilen bağlı olduğu çağrı yeri okundu.

KAPANDI (3): 2 (aiClosedViolation → regionGuard.ts:77, commitService.ts:460, owner bypass YOK),
12 (alsoInTx → commitService.ts:469-494), 14 (Chrome.tsx:10-14 doğru).
KISMEN (1): 1 — login oran sınırı geldi (authRoutes.ts:30-51, kapı :177 scrypt'ten önce),
parola alt sınırı hâlâ 4 (:81, :209).
DURUYOR (11): 3 (graphStore.ts:316 onopen yalnız wsConnected), 4 (web/src'de localStorage yalnız
themeStore.ts), 5 (mcpServer.ts:398-402 update_brief tüm ajanlara), 6 (proposalService.ts:244→279
koşulsuz update), 7 (schema.prisma 29 model, AuditLog yok), 8 (commitService.ts:40 actor?, :447
fail-open), 9 (canvasService.ts:124 ve :46), 10 (routes.ts:39-58 + claimService.ts:28 +
authRoutes.ts:30-51 + app.ts:72,114,115), 11 (claimService.ts:150→167), 13 (app.ts:71-80),
15 (.github/workflows/ yalnız docker.yml).

Şiddeti YÜKSELEN üç bulgu: 15 (CI), 10 (süreç-yerel durum artık bir güvenlik kontrolü taşıyor),
8 (actor.ai AI kalkanını da taşıyor).
Kozmetik: proposalService.ts:264-269 yorum bloğu iki kez kopyalanmış.

Çıktı: SENTEZ.md tablo + öncelik sırası yeniden yazıldı, DURUM.md yenilendi.
