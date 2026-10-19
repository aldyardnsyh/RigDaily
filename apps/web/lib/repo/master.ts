/**
 * Repository - Master data (IADC codes, distribusi, KPI, device, user).
 *
 * Catatan keamanan: `createUser` menerima `passwordHash` yang SUDAH di-hash
 * pemanggil (lib/auth / route handler). Repo tidak boleh tahu password plain.
 */
import 'server-only';
import { and, asc, count, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { db, randomToken, schema, sha256Hex } from '@rigdaily/database';
import { ApiError } from '@/lib/api-response';
import type {
  DeliveryLogDto,
  DistributionRuleDto,
  IadcCodeDto,
  KpiDefinitionDto,
  RecentAuditDto,
  SyncDeviceDto,
  SystemOverviewDto,
  UserDto,
} from './types';
import { toIso, toNumOrNull } from './shared';

export async function listIadcCodes(): Promise<IadcCodeDto[]> {
  const rows = await db
    .select()
    .from(schema.iadcCodes)
    .where(isNull(schema.iadcCodes.deletedAt))
    .orderBy(asc(schema.iadcCodes.sortOrder), asc(schema.iadcCodes.code));

  return rows.map((c) => ({
    code: c.code,
    num: c.num,
    name: c.name,
    category: c.category,
    productive: c.productive,
    nptDefault: c.nptDefault,
    subCodeRequired: c.subCodeRequired,
    active: c.active,
  }));
}

export type IadcCodePatch = {
  name?: string;
  category?: string;
  productive?: boolean;
  subCodeRequired?: boolean;
  active?: boolean;
  nptDefault?: boolean;
};

/**
 * Patch satu kode IADC. `undefined` = biarkan nilai lama.
 *
 * `num`, `code` dan `sortOrder` sengaja tidak bisa diubah: `num` adalah nomor
 * resmi IADC dan `sortOrder` hanya urutan tampilan seed.
 */
export async function updateIadcCode(code: string, patch: IadcCodePatch): Promise<void> {
  const set: Partial<typeof schema.iadcCodes.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.productive !== undefined) set.productive = patch.productive;
  if (patch.subCodeRequired !== undefined) set.subCodeRequired = patch.subCodeRequired;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.nptDefault !== undefined) set.nptDefault = patch.nptDefault;

  await db.update(schema.iadcCodes).set(set).where(eq(schema.iadcCodes.code, code));
}

export async function listDistributionRules(): Promise<DistributionRuleDto[]> {
  const rows = await db
    .select()
    .from(schema.distributionRules)
    .where(isNull(schema.distributionRules.deletedAt))
    .orderBy(asc(schema.distributionRules.name));

  return rows.map(toDistributionRuleDto);
}

export type DistributionRulePatch = {
  active?: boolean;
  scheduleCron?: string;
  recipientGroup?: string[];
  name?: string;
  reportType?: string;
  templateId?: string;
};

/**
 * Patch satu aturan distribusi. Mengembalikan `{ before, after }` (null bila
 * rule tidak ada) supaya route bisa audit oldJson/newJson tanpa query kedua.
 *
 * `reportType` dan `templateId` ikut bisa diubah (dipakai form admin saat
 * membuat/menyunting rule). `updatedAt` selalu diperbarui.
 */
export async function updateDistributionRule(
  id: string,
  patch: DistributionRulePatch,
): Promise<{ before: DistributionRuleDto | null; after: DistributionRuleDto | null }> {
  const existingRows = await db
    .select()
    .from(schema.distributionRules)
    .where(and(eq(schema.distributionRules.id, id), isNull(schema.distributionRules.deletedAt)))
    .limit(1);

  const existing = existingRows[0];
  if (!existing) return { before: null, after: null };

  const before = toDistributionRuleDto(existing);

  const set: Partial<typeof schema.distributionRules.$inferInsert> = { updatedAt: new Date() };
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.scheduleCron !== undefined) set.scheduleCron = patch.scheduleCron;
  if (patch.recipientGroup !== undefined) set.recipientGroup = patch.recipientGroup;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.reportType !== undefined) set.reportType = patch.reportType;
  if (patch.templateId !== undefined) set.templateId = patch.templateId;

  const updatedRows = await db
    .update(schema.distributionRules)
    .set(set)
    .where(eq(schema.distributionRules.id, id))
    .returning();

  const updated = updatedRows[0];
  return { before, after: updated ? toDistributionRuleDto(updated) : null };
}

/**
 * Buat aturan distribusi baru.
 *
 * Pemanggil (route) WAJIB memvalidasi `scheduleCron` 5 field dan ukuran
 * `recipientGroup` sebelum memanggil - repo hanya menyimpan nilai bersih.
 */
export async function createDistributionRule(input: {
  name: string;
  reportType: string;
  recipientGroup: string[];
  scheduleCron: string;
  templateId: string;
  active: boolean;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.distributionRules)
    .values({
      name: input.name.trim(),
      reportType: input.reportType.trim(),
      recipientGroup: input.recipientGroup,
      scheduleCron: input.scheduleCron.trim(),
      templateId: input.templateId.trim(),
      active: input.active,
    })
    .returning({ id: schema.distributionRules.id });

  return { id: row.id };
}

/**
 * Soft delete satu aturan distribusi (baris tetap ada untuk riwayat delivery log).
 * Mengembalikan DTO sebelum dihapus, atau `null` bila rule tidak ada / sudah terhapus.
 */
export async function softDeleteDistributionRule(id: string): Promise<DistributionRuleDto | null> {
  const rows = await db
    .update(schema.distributionRules)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.distributionRules.id, id), isNull(schema.distributionRules.deletedAt)))
    .returning();

  return rows[0] ? toDistributionRuleDto(rows[0]) : null;
}

/** Baris `distribution_rules` → DTO (`recipientGroup` jsonb bisa null). */
function toDistributionRuleDto(r: typeof schema.distributionRules.$inferSelect): DistributionRuleDto {
  return {
    id: r.id,
    name: r.name,
    reportType: r.reportType,
    recipientGroup: r.recipientGroup ?? [],
    scheduleCron: r.scheduleCron,
    templateId: r.templateId,
    active: r.active,
    lastRunAt: toIso(r.lastRunAt),
  };
}

export async function listDeliveryLog(limit = 50): Promise<DeliveryLogDto[]> {  const take = Math.min(Math.max(limit, 1), 500);
  const rows = await db
    .select()
    .from(schema.deliveryLog)
    .orderBy(desc(schema.deliveryLog.createdAt))
    .limit(take);

  return rows.map((d) => ({
    id: d.id,
    toAddresses: d.toAddresses ?? [],
    subject: d.subject,
    status: d.status,
    attempts: d.attempts,
    lastError: d.lastError,
    sentAt: toIso(d.sentAt),
    createdAt: toIso(d.createdAt) ?? new Date(0).toISOString(),
  }));
}

export async function listKpiDefinitions(): Promise<KpiDefinitionDto[]> {
  const rows = await db
    .select()
    .from(schema.kpiDefinitions)
    .where(and(isNull(schema.kpiDefinitions.deletedAt), eq(schema.kpiDefinitions.active, true)))
    .orderBy(asc(schema.kpiDefinitions.category), asc(schema.kpiDefinitions.name));

  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    formula: k.formula,
    category: k.category,
    baseline: toNumOrNull(k.baseline),
    unit: k.unit,
  }));
}

export async function listSyncDevices(): Promise<SyncDeviceDto[]> {
  const rows = await db
    .select({ device: schema.syncDevices, rigName: schema.rigs.name })
    .from(schema.syncDevices)
    .leftJoin(schema.rigs, eq(schema.syncDevices.rigId, schema.rigs.id))
    .where(isNull(schema.syncDevices.deletedAt))
    .orderBy(desc(schema.syncDevices.lastSeenAt), asc(schema.syncDevices.name));

  return rows.map(({ device: d, rigName }) => ({
    id: d.id,
    deviceId: d.deviceId,
    name: d.name,
    kind: d.kind,
    rigId: d.rigId,
    rigName,
    lastSeenAt: toIso(d.lastSeenAt),
    pendingCount: d.pendingCount,
    active: d.active,
  }));
}

/* ------------------------------------------------------------------ */
/* Sync devices & API key (P0-5)                                       */
/* ------------------------------------------------------------------ */

/**
 * Buat device sync + API key baru.
 *
 * API key di-generate di server (`randomToken(32)`) dan HANYA di-hash yang
 * disimpan (`sync_devices.api_key_hash`) - plaintext dikembalikan SEKALI di sini
 * dan tidak pernah bisa dibaca lagi (lihat verifikasi `x-device-key` di
 * `/api/sync/push`). `deviceId` = id unik device yang dipakai klien di body push;
 * bila tidak diisi, diturunkan dari id baris.
 */
export async function createDeviceApiKey(input: {
  deviceId: string;
  name: string;
  rigId?: string | null;
  kind?: string;
}): Promise<{ id: string; apiKey: string }> {
  const apiKey = randomToken(32);

  const [row] = await db
    .insert(schema.syncDevices)
    .values({
      deviceId: input.deviceId.trim(),
      name: input.name.trim(),
      rigId: input.rigId ?? null,
      kind: input.kind ?? 'electron',
      apiKeyHash: sha256Hex(apiKey),
      active: true,
    })
    .returning({ id: schema.syncDevices.id });

  return { id: row.id, apiKey };
}

/**
 * Rotasi API key device: hash baru disimpan, plaintext dikembalikan sekali.
 * Key lama otomatis tidak berlaku (hash lama ditimpa).
 */
export async function rotateDeviceApiKey(id: string): Promise<{ apiKey: string }> {
  const apiKey = randomToken(32);

  const rows = await db
    .update(schema.syncDevices)
    .set({ apiKeyHash: sha256Hex(apiKey), updatedAt: new Date() })
    .where(and(eq(schema.syncDevices.id, id), isNull(schema.syncDevices.deletedAt)))
    .returning({ id: schema.syncDevices.id });

  if (!rows[0]) {
    throw new Error(`Device ${id} tidak ditemukan - tidak bisa merotasi API key.`);
  }

  return { apiKey };
}

/** Aktif/nonaktifkan device. Device nonaktif ditolak oleh `POST /api/sync/push`. */
export async function setDeviceActive(id: string, active: boolean): Promise<void> {
  await db
    .update(schema.syncDevices)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(schema.syncDevices.id, id), isNull(schema.syncDevices.deletedAt)));
}

/**
 * Soft delete device sync + nonaktifkan sekaligus.
 *
 * `active=false` penting: verifikasi `x-device-key` di `/api/sync/push` hanya
 * memeriksa `active`, jadi device terhapus tidak boleh tetap bisa push.
 * Mengembalikan baris sebelum dihapus (untuk audit), `null` bila tidak ada.
 */
export async function softDeleteDevice(id: string): Promise<SyncDeviceDto | null> {
  const rows = await db
    .update(schema.syncDevices)
    .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
    .where(and(eq(schema.syncDevices.id, id), isNull(schema.syncDevices.deletedAt)))
    .returning();

  const device = rows[0];
  if (!device) return null;

  return {
    id: device.id,
    deviceId: device.deviceId,
    name: device.name,
    kind: device.kind,
    rigId: device.rigId,
    rigName: null,
    lastSeenAt: toIso(device.lastSeenAt),
    pendingCount: device.pendingCount,
    active: device.active,
  };
}

export async function listUsers(): Promise<UserDto[]> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(isNull(schema.users.deletedAt))
    .orderBy(asc(schema.users.name));

  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    rigScope: u.rigScope ?? [],
    mfaEnabled: u.mfaEnabled,
    active: u.active,
    lastLoginAt: toIso(u.lastLoginAt),
  }));
}

/**
 * Buat user baru. `passwordHash` HARUS sudah di-hash pemanggil
 * (`hashPassword()` di @rigdaily/database). Email dinormalisasi lowercase.
 *
 * Unique index `users_email_uq` menjaga duplikasi: pelanggaran constraint akan
 * dilempar sebagai error Postgres (kode 23505) untuk diterjemahkan route handler.
 */
export async function createUser(input: {
  name: string;
  email: string;
  role: string;
  rigScope?: string[];
  passwordHash: string;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.users)
    .values({
      name: input.name,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      rigScope: input.rigScope ?? [],
      passwordHash: input.passwordHash,
      mfaEnabled: false,
      active: true,
    })
    .returning({ id: schema.users.id });

  return { id: row.id };
}

/* ------------------------------------------------------------------ */
/* User admin CRUD (PATCH/DELETE /api/admin/users)                     */
/* ------------------------------------------------------------------ */

/** Satu user (tanpa passwordHash). `null` bila tidak ada / sudah dihapus. */
export async function getUserById(id: string): Promise<UserDto | null> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
    .limit(1);

  const u = rows[0];
  if (!u) return null;

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    rigScope: u.rigScope ?? [],
    mfaEnabled: u.mfaEnabled,
    active: u.active,
    lastLoginAt: toIso(u.lastLoginAt),
  };
}

/**
 * Jumlah user Admin yang masih aktif (belum dihapus).
 *
 * Dipakai route untuk menjaga sistem tidak kehilangan admin terakhir.
 * `excludeId` = user yang sedang dihapus/dinonaktifkan, supaya pemeriksaan
 * menghitung sisa admin SETELAH aksi tersebut.
 */
export async function countActiveAdmins(excludeId?: string): Promise<number> {
  const parts = [
    isNull(schema.users.deletedAt),
    eq(schema.users.active, true),
    eq(schema.users.role, 'Admin'),
  ];
  if (excludeId) parts.push(ne(schema.users.id, excludeId));

  const rows = await db
    .select({ n: count() })
    .from(schema.users)
    .where(and(...parts));

  return Number(rows[0]?.n ?? 0);
}

export type UserPatch = {
  name?: string;
  email?: string;
  role?: string;
  rigScope?: string[];
  active?: boolean;
};

/**
 * Ubah data user (admin console). `passwordHash` TIDAK bisa disentuh di sini -
 * password hanya berubah lewat `/api/auth/password` (user sendiri).
 *
 * Mengembalikan `{ before, after }`; `before` null bila user tidak ditemukan.
 * Duplikasi email dilempar sebagai ApiError 409 `EMAIL_TAKEN`.
 */
export async function updateUser(
  id: string,
  patch: UserPatch,
): Promise<{ before: UserDto | null; after: UserDto | null }> {
  const before = await getUserById(id);
  if (!before) return { before: null, after: null };

  const set: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };

  if (patch.name !== undefined) set.name = patch.name.trim();

  if (patch.email !== undefined) {
    const email = patch.email.trim().toLowerCase();

    const taken = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.email, email), ne(schema.users.id, id)))
      .limit(1);
    if (taken.length > 0) {
      throw new ApiError(409, 'EMAIL_TAKEN', 'Email tersebut sudah dipakai pengguna lain.');
    }

    set.email = email;
  }

  if (patch.role !== undefined) set.role = patch.role;
  if (patch.rigScope !== undefined) set.rigScope = patch.rigScope;
  if (patch.active !== undefined) set.active = patch.active;

  try {
    await db.update(schema.users).set(set).where(eq(schema.users.id, id));
  } catch (err) {
    // 23505 = unique_violation pada users_email_uq (balapan dua request).
    if ((err as { code?: string } | null)?.code === '23505') {
      throw new ApiError(409, 'EMAIL_TAKEN', 'Email tersebut sudah dipakai pengguna lain.');
    }
    throw err;
  }

  return { before, after: await getUserById(id) };
}

/**
 * Soft delete user (`deletedAt` diisi + `active=false`).
 *
 * Pemanggil WAJIB mencabut sesi (`revokeAllUserSessions`) - fungsi ini hanya
 * menyentuh baris `users`. Mengembalikan data sebelum dihapus, `null` bila
 * user tidak ada / sudah terhapus.
 */
export async function softDeleteUser(id: string): Promise<UserDto | null> {
  const before = await getUserById(id);
  if (!before) return null;

  await db
    .update(schema.users)
    .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
    .where(eq(schema.users.id, id));

  return before;
}

/**
 * Hapus PERMANEN semua sesi milik user (hard delete - sesi memang data fana).
 * Dipakai saat user dihapus/dinonaktifkan agar token lama tidak berlaku lagi.
 * Mengembalikan jumlah sesi yang dicabut.
 */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const deleted = await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .returning({ id: schema.sessions.id });

  return deleted.length;
}

/* ------------------------------------------------------------------ */
/* Monitoring admin (GET /api/admin/overview)                          */
/* ------------------------------------------------------------------ */

/**
 * Ringkasan sistem untuk layar monitor admin - SEMUA angka dari query DB
 * langsung (tidak ada dummy). Dijalankan paralel dalam satu gelombang.
 *
 * `db.sizeApproxMb` hanya tersedia di PostgreSQL (`pg_database_size`);
 * PGlite mengembalikan `null` karena tidak punya katalog ukuran basis data.
 */
export async function getSystemOverview(): Promise<SystemOverviewDto> {
  const [
    wellsRows,
    rigsRows,
    usersRows,
    reportsRows,
    incidentsRows,
    devicesRows,
    rateCardsRows,
    statusRows,
    auditRows,
    sessionRows,
    dbInfo,
  ] = await Promise.all([
    db.select({ n: count() }).from(schema.wells).where(isNull(schema.wells.deletedAt)),
    db.select({ n: count() }).from(schema.rigs).where(isNull(schema.rigs.deletedAt)),
    db.select({ n: count() }).from(schema.users).where(isNull(schema.users.deletedAt)),
    db.select({ n: count() }).from(schema.dailyReports).where(isNull(schema.dailyReports.deletedAt)),
    db.select({ n: count() }).from(schema.safetyIncidents).where(isNull(schema.safetyIncidents.deletedAt)),
    db.select({ n: count() }).from(schema.syncDevices).where(isNull(schema.syncDevices.deletedAt)),
    db.select({ n: count() }).from(schema.rateCards).where(isNull(schema.rateCards.deletedAt)),
    db
      .select({ status: schema.dailyReports.status, n: count() })
      .from(schema.dailyReports)
      .where(isNull(schema.dailyReports.deletedAt))
      .groupBy(schema.dailyReports.status),
    db
      .select({
        at: schema.auditLog.at,
        actorName: schema.auditLog.actorName,
        entity: schema.auditLog.entity,
        action: schema.auditLog.action,
      })
      .from(schema.auditLog)
      .orderBy(desc(schema.auditLog.at))
      .limit(10),
    db
      .select({
        id: schema.sessions.id,
        userName: schema.users.name,
        ip: schema.sessions.ip,
        userAgent: schema.sessions.userAgent,
        createdAt: schema.sessions.createdAt,
      })
      .from(schema.sessions)
      .leftJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
      .where(gt(schema.sessions.expiresAt, new Date()))
      .orderBy(desc(schema.sessions.createdAt))
      .limit(10),
    databaseInfo(),
  ]);

  const recentAudit: RecentAuditDto[] = auditRows.map((a) => ({
    at: toIso(a.at) ?? new Date(0).toISOString(),
    actorName: a.actorName,
    entity: a.entity,
    action: a.action,
  }));

  return {
    counts: {
      wells: Number(wellsRows[0]?.n ?? 0),
      rigs: Number(rigsRows[0]?.n ?? 0),
      users: Number(usersRows[0]?.n ?? 0),
      reports: Number(reportsRows[0]?.n ?? 0),
      incidents: Number(incidentsRows[0]?.n ?? 0),
      devices: Number(devicesRows[0]?.n ?? 0),
      rateCards: Number(rateCardsRows[0]?.n ?? 0),
    },
    reportsByStatus: statusRows
      .map((r) => ({ status: r.status, count: Number(r.n) }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    recentAudit,
    activeSessions: sessionRows.map((s) => ({
      id: s.id,
      userName: s.userName,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: toIso(s.createdAt) ?? new Date(0).toISOString(),
    })),
    db: dbInfo,
    serverTime: new Date().toISOString(),
  };
}

/**
 * Status & ukuran DB untuk panel monitor.
 *
 * `SELECT 1` membuktikan koneksi hidup; ukuran hanya diambil di PostgreSQL
 * (`pg_database_size(current_database())`). Kegagalan ukuran TIDAK membuat
 * `ok=false` - koneksi tetap dianggap sehat.
 */
async function databaseInfo(): Promise<SystemOverviewDto['db']> {
  const driver: 'postgres' | 'pglite' = isPgliteDriver() ? 'pglite' : 'postgres';

  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    console.error('[repo/master] DB health check gagal:', err);
    return { driver, ok: false, sizeApproxMb: null };
  }

  if (driver === 'pglite') return { driver, ok: true, sizeApproxMb: null };

  try {
    const res = (await db.execute(sql`SELECT pg_database_size(current_database()) AS bytes`)) as unknown as {
      rows?: Array<{ bytes: string | number | null }>;
    };
    const bytes = toNumOrNull(res.rows?.[0]?.bytes ?? null);
    return { driver, ok: true, sizeApproxMb: bytes === null ? null : Math.round((bytes / (1024 * 1024)) * 10) / 10 };
  } catch {
    return { driver, ok: true, sizeApproxMb: null };
  }
}

/** True bila runtime memakai PGlite (dev/test) - sama dengan `isPglite` client. */
function isPgliteDriver(): boolean {
  return !process.env.DATABASE_URL || process.env.RIGDAILY_DRIVER === 'pglite';
}
