import type { FastifyInstance } from 'fastify';
import type { EmailMessage, EmailSender } from './email.js';

/** Test yardımcısı: gönderilen mailleri yakalayan bir EmailSender. */
export function captureEmails(): { sender: EmailSender; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { sender: async (m) => { sent.push(m); }, sent };
}

/**
 * register + verify-email akışını tek adımda çalıştırır (yakalanan koddan doğrular).
 * verify yanıtını (`res`: cookie + user içerir) ve hazır `cookies` nesnesini döndürür.
 */
export async function registerVerified(
  app: FastifyInstance,
  sent: EmailMessage[],
  creds: { username: string; password: string; email: string; displayName?: string },
) {
  await app.inject({ method: 'POST', url: '/api/auth/register', payload: creds });
  const code = sent[sent.length - 1].text.match(/\b(\d{6})\b/)![1];
  const res = await app.inject({
    method: 'POST', url: '/api/auth/verify-email', payload: { email: creds.email, code },
  });
  return { res, cookies: { tm_session: res.cookies.find((c) => c.name === 'tm_session')!.value } };
}
