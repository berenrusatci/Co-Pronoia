import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { CanvasType, GroupType } from '@co-pronoia/shared';
import type { AuthUser } from './auth.js';
import type { CloudClient } from './cloudClient.js';
import { createGroup } from './groupService.js';
import { createAgentRole } from './agentRoleService.js';
import { importBundle } from './canvasImportService.js';
import { deleteCanvas, type ServiceFor } from './canvasService.js';
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

/**
 * Aktivasyonu geri alır: kurulum "etkinleştirilmemiş" durumuna döner, web yeniden
 * aktivasyon ekranını çizer ve başka (ya da aynı) bir bulut hesabıyla bağlanılabilir.
 * Yerel modun "çıkış yap"ıdır — oturum diye bir şey olmadığı için tek kaldıraç budur.
 *
 * `wipe: false` (öntanımlı): yalnız `Activation` satırı silinir, yerel veri (kullanıcı,
 * gruplar, kanvaslar, commitler) durur. AYNI hesapla yeniden bağlanmak eski veriye geri
 * döner. **Farklı** bir hesapla bağlanılırsa yeni bir yerel `User` kurulur ve eski verinin
 * sahibi o kullanıcı olmadığı için erişilemez hale gelir — bu yüzden çağıran taraf
 * kullanıcıyı uyarmalıdır.
 *
 * `wipe: true`: yerel veriyi de siler (kanvaslar `deleteCanvas` yolundan, sonra gruplar ve
 * kullanıcı) ve bulut eşleme tablolarını boşaltır — böylece yeni hesabın kanvasları
 * sıfırdan çekilir.
 */
export async function resetActivation(
  prisma: PrismaClient,
  opts: { wipe?: boolean } = {},
): Promise<{ ok: true } | { error: string }> {
  // HTTP'den buraya aktive olmayan bir kurulumla gelinemez (global hook önce 401 verir);
  // bu kontrol servisi doğrudan çağıran yollar için savunma amaçlıdır.
  const row = await getActivation(prisma);
  if (!row?.activatedAt) return { error: 'kurulum zaten etkinleştirilmemiş' };

  if (opts.wipe) {
    // Yerel kurulum tek kullanıcılı: temiz sayfa = her şey. Kanvaslar `deleteCanvas`ten
    // geçmeli (ajan anahtarları/öneriler onun transaction'ında siliniyor ve `Canvas.ownerId`
    // FK'si restrict — kullanıcıyı doğrudan silmek kısıt ihlali verir).
    for (const c of await prisma.canvas.findMany({ select: { id: true } })) {
      await deleteCanvas(prisma, c.id);
    }
    await prisma.group.deleteMany({});
    // Eşleme tabloları: kalırlarsa yeni hesabın kanvasları "zaten alınmış" sayılır.
    await prisma.cloudImport.deleteMany({});
    await prisma.cloudGroupImport.deleteMany({});
    if (row.localUserId) await prisma.user.deleteMany({ where: { id: row.localUserId } });
  }
  await prisma.activation.deleteMany({ where: { id: SINGLETON } });
  return { ok: true };
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

  // Bu kimlik yerelde zaten var mı? "Bağlantıyı kaldır" (resetActivation) veriyi silmeden
  // aktivasyonu geri alabildiği için AYNI hesapla yeniden bağlanmak olağan bir akıştır —
  // körü körüne `create` etmek e-posta benzersizliğine takılıp 500 verirdi. Var olan
  // kullanıcı yeniden kullanılır, böylece eski kanvaslar/gruplar sahibine geri bağlanır.
  const existing = exchanged.user.email
    ? await prisma.user.findUnique({ where: { email: exchanged.user.email } })
    : await prisma.user.findUnique({ where: { username: exchanged.user.username } });

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { displayName: exchanged.user.displayName, avatarUrl: exchanged.user.avatarUrl },
      })
    : await prisma.user.create({
        data: {
          username: await freeUsername(prisma, exchanged.user.username),
          // E-posta yerelde benzersiz; bulut hesabının adresi bilgi amaçlı taşınır.
          email: exchanged.user.email,
          displayName: exchanged.user.displayName,
          avatarUrl: exchanged.user.avatarUrl,
        },
      });
  // Çalışma alanı yalnız yeni kullanıcıya kurulur; yeniden bağlanmada zaten vardır.
  if (!existing) await createGroup(prisma, 'Yerel çalışma alanı', user.id);
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
  /** Bu çekmede yerelde kurulan bulut grupları (ad listesi). */
  groups: string[];
}

/**
 * Bulut gruplarını yerele yansıtır ve `cloudGroupId → localGroupId` eşlemesini döndürür.
 *
 * Neden ayrı bir eşleme tablosu (`CloudGroupImport`): kanvasların doğru gruba inmesi
 * yalnız isim benzerliğine bırakılamaz, ve tekrar çekmede aynı grup ikinci kez
 * kurulmamalı — `CloudImport`in kanvaslar için yaptığının aynısı.
 *
 * Grup TÜRÜ de taşınır: co-pronoia kanvası ancak co-pronoia grubunda açılabildiği için
 * tür kaybolursa MCP tarafı yerelde hiç çalışmaz. Grup kapsamlı ajan rolleri de kurulur
 * (adı zaten var olan rol atlanır) — yerelde MCP anahtarı bir role bağlanarak üretilir.
 */
async function syncCloudGroups(
  prisma: PrismaClient,
  cloud: CloudClient,
  instanceToken: string,
  ownerId: string,
): Promise<{ map: Map<string, string>; created: string[] }> {
  const map = new Map<string, string>();
  const created: string[] = [];
  let groups: Awaited<ReturnType<CloudClient['listGroups']>>;
  try {
    groups = await cloud.listGroups(instanceToken);
  } catch {
    // Eski bulut sürümü bu ucu tanımıyor: gruplar olmadan (eski davranış) devam et.
    return { map, created };
  }

  for (const g of groups) {
    const existing = await prisma.cloudGroupImport.findUnique({ where: { cloudGroupId: g.id } });
    if (existing) {
      // Yerel grup elle silinmiş olabilir; öyleyse eşlemeyi bırakıp yeniden kur.
      if (await prisma.group.findUnique({ where: { id: existing.localGroupId } })) {
        map.set(g.id, existing.localGroupId);
        continue;
      }
      await prisma.cloudGroupImport.delete({ where: { cloudGroupId: g.id } });
    }
    const name = (g.name || 'Grup').slice(0, 80);
    const type: GroupType = g.type === 'co-pronoia' ? 'co-pronoia' : 'plan';
    const local = await createGroup(prisma, name, ownerId, [], type);
    await prisma.cloudGroupImport.create({
      data: { cloudGroupId: g.id, localGroupId: local.id, name },
    });
    for (const role of g.agentRoles ?? []) {
      await createAgentRole(prisma, local.id, {
        name: role.name,
        persona: role.persona,
        isSupervisor: role.isSupervisor,
      });
    }
    map.set(g.id, local.id);
    created.push(name);
  }
  return { map, created };
}

/**
 * Bulut kanvaslarını yerele çeker. Aynı kanvas iki kez alınmaz (`CloudImport`),
 * ve içe aktarım `POST /api/canvases/import` ile birebir aynı yoldan (importBundle) iner.
 *
 * Kanvas grubu ve türü korunur: grubu bilinmeyen (ya da eski bulut sürümünden gelen)
 * kanvaslar eskisi gibi aktivasyonda açılan "Yerel çalışma alanı"na düşer.
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

  const { map: groupMap, created: createdGroups } = await syncCloudGroups(
    prisma, cloud, row.instanceToken, row.localUserId,
  );

  const result: PullResult = { imported: 0, skipped: 0, names: [], groups: createdGroups };
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
    // Grubu bilinen kanvas kendi grubuna, bilinmeyen eski davranışla çalışma alanına iner.
    const groupId = (ref.groupId && groupMap.get(ref.groupId)) || membership?.groupId;
    // co-pronoia türü ancak co-pronoia grubunda anlamlı (kanvas route'undaki kuralın eşi):
    // grup türü taşınamadıysa kanvası normal plan kanvası olarak indir, hata verme.
    const groupType = groupId
      ? (await prisma.group.findUnique({ where: { id: groupId }, select: { type: true } }))?.type
      : undefined;
    const type: CanvasType =
      ref.type === 'co-pronoia' && groupType === 'co-pronoia' ? 'co-pronoia' : 'plan';
    const canvas = await importBundle(prisma, serviceFor, bundle, {
      name,
      ownerId: row.localUserId,
      groupId,
      type,
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
