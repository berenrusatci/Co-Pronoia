/**
 * E-posta gönderimi (SMTP / nodemailer). agent.ts'teki injectable `Llm` +
 * `geminiConfigured()` desenini yansıtır: `EmailSender` enjekte edilebilir (test
 * için sahte gönderici geçilir), üretimde `defaultEmailSender` kullanılır.
 */
export type EmailMessage = { to: string; subject: string; text: string; html?: string };
export type EmailSender = (msg: EmailMessage) => Promise<void>;

/** SMTP yapılandırılmış mı? (en az SMTP_HOST tanımlı). */
export const emailConfigured = (): boolean => Boolean(process.env.SMTP_HOST);

export const isProd = (): boolean => process.env.NODE_ENV === 'production';

/**
 * Varsayılan gönderici:
 * - SMTP yapılandırılmışsa nodemailer ile gönderir.
 * - Yapılandırma yoksa ve prod DEĞİLSE kodu/mesajı konsola yazar (dev fallback).
 * - Yapılandırma yoksa ve prod ise hata fırlatır — kodu ASLA konsola yazmaz.
 *   (Route zaten prod-yapılandırmasız durumu 503 ile daha erken yakalar.)
 */
export const defaultEmailSender: EmailSender = async (msg) => {
  if (emailConfigured()) {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return;
  }
  if (!isProd()) {
    // Yalnızca geliştirmede: doğrulama kodu sunucu konsolunda görünür.
    console.log(`[dev-mail] → ${msg.to} | ${msg.subject}\n${msg.text}`);
    return;
  }
  throw new Error('e-posta gönderimi yapılandırılmamış (SMTP_HOST tanımlı değil)');
};
