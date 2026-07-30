import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { AuthUser } from './auth.js';
import type { CloudClient } from './cloudClient.js';
import { createGroup } from './groupService.js';
import { importBundle } from './canvasImportService.js';
import type { ServiceFor } from './canvasService.js';
import { cloudUrl } from './mode.js';

/** Yerel Activation satırı tektir; id sabit tutulur ki upsert basit olsun. */
const SINGLETON = 'singleton';

/** Bulutun verdiği kalıcı kurulum anahtarı (AgentToken'ın `tma_` deseninin eşi). */
const INSTANCE_PREFIX = 'tmi_';

/** Onay kodunun geçerlilik süresi: el sıkışma tarayıcı üzerinden sürdüğü için kısa. */
const CODE_TTL_MS = 10 * 60_000;

const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('hex');

// ---------- Yerel taraf ----------

export interface ActivationStatus {
  activated: boolean;
  cloudUsername: string | null;
  activatedAt: string | null;
}

export async function getActivation(prisma: PrismaClient) {
  return prisma.activation.findUnique({ where: { id: SINGLETON } });
}

export async function activationStatus(prisma: PrismaClient): Promise<ActivationStatus> {
  const row = await getActivation(prisma);
  return {
    activated: !!row?.activatedAt,
    cloudUsername: row?.cloudUsername ?? null,
    activatedAt: row?.activatedAt?.toISOString() ?? null,
  };
}

/** Aktive edilmiş yerel kullanıcı; yerel modda her isteğin kimliği budur. */
export async function activatedUser(prisma: PrismaClient): Promise<AuthUser | null> {
  const row = await getActivation(prisma);
  if (!row?.activatedAt || !row.localUserId) return null;
  const user = await prisma.user.findUnique({ where: { id: row.localUserId } });
  if (!user) return null;
  return {
    id: user.id, username: user.username, email: user.email,
    displayName: user.displayName, avatarUrl: user.avatarUrl, isAdmin: user.isAdmin,
  };
}

/**
 * Aktivasyonu başlat: state + verifier üret, bekleyen satırı yaz ve tarayıcının
 * yönlendirileceği bulut adresini döndür. Şifre asla yerele girilmez — bulut
 * kullanıcıyı kendi oturumuyla doğrular, yerel taraf yalnızca `verifier`ı bilir.
 */
export async function startActivation(
  prisma: PrismaClient,
  localOrigin: string,
): Promise<{ redirectTo: string }> {
  const state = nanoid(24);
  const verifier = randomBytes(32).toString('hex');
  const data = {
    state, verifier,
    cloudUserId: null, cloudUsername: null, instanceToken: null, localUserId: null, activatedAt: null,
  };
  await prisma.activation.upsert({ where: { id: SINGLETON }, create: { id: SINGLETON, ...data }, update: data });
  const params = new URLSearchParams({ aktivasyon: state, donus: localOrigin, kanit: sha256(verifier) });
  return { redirectTo: `${cloudUrl()}/?${params.toString()}` };
}

export type ActivationResult = { ok: true; username: string } | { error: string };

/**
 * Bulutun geri gönderdiği tek kullanımlık kodu kalıcı kimliğe çevirir: kodu buluta
 * `verifier` ile takas eder, bulut kimliğini yansıtan yerel `User`ı ve kanvas
 * oluşturulabilsin diye öntanımlı grubu kurar.
 */
export async function completeActivation(
  prisma: PrismaClient,
  cloud: CloudClient,
  input: { state: string; code: string },
): Promise<ActivationResult> {
  const pending = await getActivation(prisma);
  if (!pending?.state || !pending.verifier) return { error: 'bekleyen aktivasyon yok' };
  if (pending.activatedAt) return { error: 'bu kurulum zaten etkinleştirilmiş' };
  if (pending.state !== input.state) return { error: 'aktivasyon durumu eşleşmedi' };

  const exchanged = await cloud.exchange({ state: input.state, code: input.code, verifier: pending.verifier });
  if ('error' in exchanged) return { error: exchanged.error };

  const user = await prisma.user.create({
    data: {
      username: await freeUsername(prisma, exchanged.user.username),
      // E-posta yerelde benzersiz; bulut hesabının adresi bilgi amaçlı taşınır.
      email: exchanged.user.email,
      displayName: exchanged.user.displayName,
      avatarUrl: exchanged.user.avatarUrl,
    },
  });
  await createGroup(prisma, 'Yerel çalışma alanı', user.id);
  await prisma.activation.update({
    where: { id: SINGLETON },
    data: {
      state: null,
      verifier: null,
      cloudUserId: exchanged.user.id,
      cloudUsername: exchanged.user.username,
      instanceToken: exchanged.instanceToken,
      localUserId: user.id,
      activatedAt: new Date(),
    },
  });
  return { ok: true, username: user.username };
}

async function freeUsername(prisma: PrismaClient, wanted: string): Promise<string> {
  const base = wanted.trim() || 'kullanici';
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await prisma.user.findUnique({ where: { username: candidate } }))) return candidate;
  }
}

export interface PullResult {
  imported: number;
  skipped: number;
  names: string[];
}

/**
 * Bulut kanvaslarını yerele çeker. Aynı kanvas iki kez alınmaz (`CloudImport`),
 * ve içe aktarım `POST /api/canvases/import` ile birebir aynı yoldan (importBundle) iner.
 */
export async function pullCloudCanvases(
  prisma: PrismaClient,
  serviceFor: ServiceFor,
  cloud: CloudClient,
): Promise<PullResult | { error: string }> {
  const row = await getActivation(prisma);
  if (!row?.activatedAt || !row.instanceToken || !row.localUserId)
    return { error: 'kurulum henüz etkinleştirilmemiş' };

  let refs;
  try {
    refs = await cloud.listCanvases(row.instanceToken);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'buluta ulaşılamadı' };
  }

  // Kanvas oluşturabilmek için bir grup gerekiyor: aktivasyonda açılan yerel çalışma alanı.
  // Kullanıcı sonradan başka gruplar kursa da en eskisi (o çalışma alanı) seçilir.
  const membership = await prisma.groupMember.findFirst({
    where: { userId: row.localUserId, status: 'approved', role: 'admin' },
    orderBy: { group: { createdAt: 'asc' } },
  });

  const result: PullResult = { imported: 0, skipped: 0, names: [] };
  for (const ref of refs) {
    if (await prisma.cloudImport.findUnique({ where: { cloudCanvasId: ref.id } })) {
      result.skipped++;
      continue;
    }
    let bundle;
    try {
      bundle = await cloud.exportCanvas(row.instanceToken, ref.id);
    } catch {
      // Tek kanvasın hatası çekmeyi durdurmasın; kalanlar alınmaya devam eder.
      continue;
    }
    const name = (ref.name || bundle.name || 'Kanvas').slice(0, 80);
    const canvas = await importBundle(prisma, serviceFor, bundle, {
      name,
      ownerId: row.localUserId,
      groupId: membership?.groupId,
    });
    await prisma.cloudImport.create({
      data: { cloudCanvasId: ref.id, localCanvasId: canvas.id, name },
    });
    result.imported++;
    result.names.push(name);
  }
  return result;
}

// ---------- Bulut taraf ----------

/**
 * Onay: oturum açmış kullanıcı yerel kuruluma kimliğini verir. Tek kullanımlık kod
 * döner; kod yalnızca `verifier`ı bilen yerel kurulum tarafından takas edilebilir.
 */
export async function approveInstance(
  prisma: PrismaClient,
  userId: string,
  input: { state: string; redirect: string; proof: string },
): Promise<{ code: string; redirectTo: string } | { error: string }> {
  const state = (input.state ?? '').trim();
  const proof = (input.proof ?? '').trim();
  const redirect = (input.redirect ?? '').trim();
  if (!state || !proof) return { error: 'aktivasyon isteği eksik' };
  // Yerel kurulumlar localhost'ta çalışır; yine de yalnızca http(s) adreslerine dönülür.
  if (!/^https?:\/\//.test(redirect)) return { error: 'geçersiz dönüş adresi' };
  if (await prisma.instance.findUnique({ where: { state } }))
    return { error: 'bu aktivasyon isteği zaten kullanılmış' };

  const code = nanoid(32);
  await prisma.instance.create({
    data: {
      userId,
      state,
      codeHash: sha256(code),
      proofHash: proof,
      redirect,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  const params = new URLSearchParams({ state, code });
  return { code, redirectTo: `${redirect.replace(/\/+$/, '')}/api/activation/callback?${params.toString()}` };
}

/** Takas: kod tek kullanımlıktır, `verifier` onay anındaki kanıtla eşleşmelidir. */
export async function exchangeInstance(
  prisma: PrismaClient,
  input: { state: string; code: string; verifier: string },
): Promise<{ user: { id: string; username: string; email: string | null; displayName: string | null; avatarUrl: string | null }; instanceToken: string } | { error: string }> {
  const row = await prisma.instance.findUnique({ where: { state: input.state ?? '' }, include: { user: true } });
  if (!row) return { error: 'aktivasyon isteği bulunamadı' };
  if (row.usedAt) return { error: 'bu kod zaten kullanılmış' };
  if (row.expiresAt < new Date()) return { error: 'aktivasyon kodunun süresi doldu' };
  if (sha256(input.code ?? '') !== row.codeHash) return { error: 'aktivasyon kodu hatalı' };
  if (sha256(input.verifier ?? '') !== row.proofHash) return { error: 'aktivasyon kanıtı eşleşmedi' };

  const secret = INSTANCE_PREFIX + nanoid(32);
  await prisma.instance.update({
    where: { id: row.id },
    data: { usedAt: new Date(), tokenHash: sha256(secret) },
  });
  return {
    user: {
      id: row.user.id, username: row.user.username, email: row.user.email,
      displayName: row.user.displayName, avatarUrl: row.user.avatarUrl,
    },
    instanceToken: secret,
  };
}

/** Bearer `tmi_...` → kurulumu açan kullanıcı; iptal/bilinmeyen → null. */
export async function resolveInstanceToken(prisma: PrismaClient, raw: string) {
  if (!raw.startsWith(INSTANCE_PREFIX)) return null;
  const row = await prisma.instance.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
  if (!row || row.revokedAt) return null;
  // AgentToken deseni: presence göstergesi için yeterli, 60 sn'de bir tazelenir.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.instance.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return row;
}
