import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import fastifyOauth2, { type OAuth2Namespace } from '@fastify/oauth2';
import { createSession, setSessionCookie } from './auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    googleOAuth2: OAuth2Namespace;
  }
}

interface GoogleProfile {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
}

async function uniqueUsername(prisma: PrismaClient, seed: string): Promise<string> {
  const base = slugify(seed) || 'kullanici';
  let candidate = base;
  let n = 2;
  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

/** Registered only when GOOGLE_CLIENT_ID/SECRET are configured — the app runs fine without Google set up. */
export async function registerGoogleAuth(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:5173/api/auth/google/callback';

  await app.register(fastifyOauth2, {
    name: 'googleOAuth2',
    scope: ['openid', 'email', 'profile'],
    credentials: {
      client: { id: clientId, secret: clientSecret },
      auth: fastifyOauth2.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: '/api/auth/google/start',
    callbackUri: redirectUri,
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const { token } = await app.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!res.ok) return reply.code(502).send({ error: 'google profili alınamadı' });
    const profile = (await res.json()) as GoogleProfile;

    const email = profile.email?.trim().toLowerCase() || null;
    let user = await prisma.user.findUnique({ where: { googleId: profile.id } });
    if (!user && email) {
      // Same verified email as an existing password account — attach Google as an additional login method.
      const byEmail = await prisma.user.findUnique({ where: { email } });
      if (byEmail) {
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: profile.id,
            displayName: byEmail.displayName ?? profile.name ?? null,
            avatarUrl: byEmail.avatarUrl ?? profile.picture ?? null,
          },
        });
      }
    }
    if (!user) {
      const username = await uniqueUsername(prisma, email?.split('@')[0] ?? profile.name ?? 'kullanici');
      user = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash: null,
          googleId: profile.id,
          displayName: profile.name ?? null,
          avatarUrl: profile.picture ?? null,
        },
      });
    }
    setSessionCookie(reply, await createSession(prisma, user.id));
    reply.redirect('/');
  });
}
