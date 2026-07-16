import type { PrismaClient } from '@prisma/client';
import { hashPassword } from './auth.js';

export type BootstrapResult = 'skipped' | 'created' | 'promoted' | 'ok';

/**
 * ADMIN_USERNAME/ADMIN_PASSWORD ile açılışta site yöneticisini idempotent kurar.
 * Kullanıcı yoksa oluşturur; varsa yalnızca terfi ettirir — mevcut şifreye ASLA dokunmaz
 * (gerçek bir hesabın kimlik bilgisini ezmemek için). Env tanımsızsa sessizce atlar.
 * Yanlışlıkla yetkisiz kalan son yönetici için de kurtarma kapısıdır: restart yeniden terfi ettirir.
 */
export async function bootstrapAdmin(prisma: PrismaClient): Promise<BootstrapResult> {
  const username = (process.env.ADMIN_USERNAME ?? '').trim();
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!username || !password) {
    console.log('[admin] ADMIN_USERNAME/ADMIN_PASSWORD tanımlı değil, yönetici kurulumu atlandı');
    return 'skipped';
  }
  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    await prisma.user.create({
      data: { username, passwordHash: await hashPassword(password), isAdmin: true },
    });
    console.log(`[admin] yönetici hesabı oluşturuldu: ${username}`);
    return 'created';
  }
  if (!existing.isAdmin) {
    await prisma.user.update({ where: { id: existing.id }, data: { isAdmin: true } });
    console.log(`[admin] mevcut kullanıcı yönetici yapıldı: ${username}`);
    return 'promoted';
  }
  return 'ok';
}
