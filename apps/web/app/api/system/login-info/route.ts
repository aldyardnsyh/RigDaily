/**
 * GET /api/system/login-info
 *
 * Informasi yang boleh tampil di halaman LOGIN sebelum sesi terbentuk:
 *  - Identitas instalasi: nama organisasi, jumlah rig, jumlah sumur aktif.
 *    Diambil dari master data, BUKAN teks karangan seperti "Rig 12 / Arun Blok B".
 *  - Status kesiapan: koneksi database, apakah ada akun aktif.
 *  - Ringkasan sinkronisasi terakhir (dari sync_devices) untuk panel kanan.
 *
 * TIDAK membocorkan data sensitif: tanpa daftar sumur, tanpa nominal biaya,
 * tanpa identitas pengguna lain. Hanya angka agregat + nama organisasi.
 */
import { sql } from 'drizzle-orm';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { ok } from '@/lib/api-response';
import { ensureDemoReady, isDemoMode } from '@/lib/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    // Instance Vercel baru: siapkan schema + data contoh sebelum membaca angka.
    if (isDemoMode()) await ensureDemoReady();

    const companyRows = await db
      .select({ name: schema.companies.name, type: schema.companies.type })
      .from(schema.companies)
      .where(isNull(schema.companies.deletedAt))
      .limit(1);

    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM rigs WHERE deleted_at IS NULL)::int AS rigs,
        (SELECT count(*) FROM wells WHERE deleted_at IS NULL)::int AS wells,
        (SELECT count(*) FROM users WHERE deleted_at IS NULL AND active = true)::int AS users,
        (SELECT count(*) FROM daily_reports WHERE deleted_at IS NULL)::int AS reports
    `);
    const row = (counts as unknown as { rows: Array<{ rigs: number; wells: number; users: number; reports: number }> }).rows[0];

    const devices = await db
      .select({
        deviceId: schema.syncDevices.deviceId,
        name: schema.syncDevices.name,
        lastSeenAt: schema.syncDevices.lastSeenAt,
        active: schema.syncDevices.active,
        pendingCount: schema.syncDevices.pendingCount,
      })
      .from(schema.syncDevices)
      .where(and(isNull(schema.syncDevices.deletedAt), eq(schema.syncDevices.active, true)))
      .orderBy(desc(schema.syncDevices.lastSeenAt))
      .limit(5);

    return ok({
      demo: isDemoMode(),
      organization: {
        name: companyRows[0]?.name ?? 'Instalasi RigDaily',
        type: companyRows[0]?.type ?? 'operator',
      },
      counts: {
        rigs: row?.rigs ?? 0,
        wells: row?.wells ?? 0,
        users: row?.users ?? 0,
        reports: row?.reports ?? 0,
      },
      ready: (row?.users ?? 0) > 0,
      devices: devices.map((d) => ({
        deviceId: d.deviceId,
        name: d.name,
        lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
        pendingCount: d.pendingCount,
      })),
    });
  } catch {
    // Jangan gagalkan halaman login bila master data belum siap.
    return ok({
      demo: isDemoMode(),
      organization: { name: 'Instalasi RigDaily', type: 'operator' },
      counts: { rigs: 0, wells: 0, users: 0, reports: 0 },
      ready: false,
      devices: [],
    });
  }
}
