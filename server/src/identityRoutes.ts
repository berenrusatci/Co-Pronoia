import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient, User } from '@prisma/client';
import { activatedUser } from './activationService.js';

/**
 * Her iki modun da paylaştığı kimlik yüzeyi.
 *
 * Bilerek `authRoutes.ts`ten AYRI bir modül: yerel imaj bundle'ında `authRoutes.ts`
 * (kayıt, e-posta doğrulama, giriş/çıkış, şifre değiştirme, scrypt) tümüyle elenir,
 * ama "ben kimim" ve profil düzenleme yerelde de gerekir. Aynı dosyada dursalardı
 * ölü kod elemesi kayıt/giriş kodunu da imajda tutmak zorunda kalırdı.
 */
export function toAuthUser(user: User) {
  return {
    id: user.id, username: user.username, email: user.email,
    displayName: user.displayName, avatarUrl: user.avatarUrl, isAdmin: user.isAdmin,
  };
}

/** Display name + avatar URL (dashboard user settings). Kimliği çözme yolu moda göre değişir. */
export function registerProfileRoute(
  app: FastifyInstance,
  prisma: PrismaClient,
  currentUser: (req: FastifyRequest) => Promise<{ id: string } | null>,
): void {
  app.patch<{ Body: { displayName?: string | null; avatarUrl?: string | null } }>(
    '/api/auth/profile',
    async (req, reply) => {
      const user = await currentUser(req);
      if (!user) return reply.code(401).send({ error: 'oturum yok' });
      const data: { displayName?: string | null; avatarUrl?: string | null } = {};
      if (req.body?.displayName !== undefined) {
        const displayName = (req.body.displayName ?? '').trim();
        if (displayName.length > 60) return reply.code(400).send({ error: 'görünen ad en fazla 60 karakter olabilir' });
        data.displayName = displayName || null;
      }
      if (req.body?.avatarUrl !== undefined) {
        const avatarUrl = (req.body.avatarUrl ?? '').trim();
        if (avatarUrl.length > 2000) return reply.code(400).send({ error: 'profil fotoğrafı URL\'si çok uzun' });
        if (avatarUrl && !/^https?:\/\//.test(avatarUrl))
          return reply.code(400).send({ error: 'profil fotoğrafı için geçerli bir http(s) URL girin' });
        data.avatarUrl = avatarUrl || null;
      }
      const updated = await prisma.user.update({ where: { id: user.id }, data });
      return { user: toAuthUser(updated) };
    },
  );
}

/**
 * Yerel modun tüm kimlik yüzeyi: hesap yönetimi yoktur, kimlik bir kerelik bulut
 * aktivasyonundan gelir. Kayıt/doğrulama/giriş/çıkış/şifre uçları hiç oluşturulmaz.
 */
export function registerLocalIdentityRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get('/api/auth/me', async (_req, reply) => {
    const user = await activatedUser(prisma);
    if (!user) return reply.code(401).send({ error: 'kurulum etkinleştirilmemiş' });
    return { user };
  });
  registerProfileRoute(app, prisma, () => activatedUser(prisma));
}
