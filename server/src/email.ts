/**
 * E-posta gönderimi (Brevo HTTP API / SMTP-nodemailer). agent.ts'teki injectable
 * `Llm` + `geminiConfigured()` desenini yansıtır: `EmailSender` enjekte edilebilir
 * (test için sahte gönderici geçilir), üretimde `defaultEmailSender` kullanılır.
 */
export type EmailMessage = { to: string; subject: string; text: string; html?: string };
export type EmailSender = (msg: EmailMessage) => Promise<void>;

/** E-posta gönderimi yapılandırılmış mı? (Brevo anahtarı ya da SMTP host). */
export const emailConfigured = (): boolean =>
  Boolean(process.env.BREVO_API_KEY || process.env.SMTP_HOST);

export const isProd = (): boolean => process.env.NODE_ENV === 'production';

/** Gönderen: MAIL_FROM `Ad <adres>` ya da düz `adres` biçiminde; adres Brevo'da doğrulanmış olmalı. */
function fromSender(): { name?: string; email: string } {
  const raw = process.env.MAIL_FROM ?? process.env.SMTP_FROM ?? '';
  const m = raw.match(/^(.*?)\s*<(.+)>$/);
  if (m) return { name: m[1] || undefined, email: m[2] };
  return { name: 'Co-pronoia', email: raw };
}

/** Brevo HTTP API ile gönderim — SMTP çıkışı kapalı PaaS'larda (ör. Render free) da çalışır. */
async function sendViaBrevo(msg: EmailMessage): Promise<void> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: fromSender(),
      to: [{ email: msg.to }],
      subject: msg.subject,
      textContent: msg.text,
      htmlContent: msg.html,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

async function sendViaSmtp(msg: EmailMessage): Promise<void> {
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    // SMTP çıkışı engellenen ortamlarda (ör. bazı PaaS'lar) bağlantı sessizce
    // asılı kalır; nodemailer'ın 2 dk'lık varsayılanı yerine hızlı pes et.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  const sender = fromSender();
  await transport.sendMail({
    from: sender.name ? `${sender.name} <${sender.email}>` : sender.email,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}

/**
 * Varsayılan gönderici:
 * - BREVO_API_KEY tanımlıysa Brevo HTTP API ile gönderir (öncelikli).
 * - Yoksa SMTP yapılandırılmışsa nodemailer ile gönderir.
 * - Hiçbiri yoksa ve prod DEĞİLSE kodu/mesajı konsola yazar (dev fallback).
 * - Hiçbiri yoksa ve prod ise hata fırlatır — kodu ASLA konsola yazmaz.
 *   (Route zaten prod-yapılandırmasız durumu 503 ile daha erken yakalar.)
 */
export const defaultEmailSender: EmailSender = async (msg) => {
  if (process.env.BREVO_API_KEY) return sendViaBrevo(msg);
  if (process.env.SMTP_HOST) return sendViaSmtp(msg);
  if (!isProd()) {
    // Yalnızca geliştirmede: doğrulama kodu sunucu konsolunda görünür.
    console.log(`[dev-mail] → ${msg.to} | ${msg.subject}\n${msg.text}`);
    return;
  }
  throw new Error('e-posta gönderimi yapılandırılmamış (BREVO_API_KEY / SMTP_HOST yok)');
};
