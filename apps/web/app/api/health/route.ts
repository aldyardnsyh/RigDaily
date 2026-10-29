/**
 * GET /api/health
 *
 * Probe untuk monitoring / load balancer. TANPA auth (saat DB down, login juga
 * tidak bisa, tapi health harus tetap menjawab).
 *
 * 200 = DB ok, 503 = DB tidak bisa dihubungi.
 *
 * Identitas build (vendor, edition, commit) ikut disertakan supaya instalasi
 * resmi PSHT bisa dibedakan dari salinan yang dihapus atribusinya. Ini BUKAN
 * telemetri: tidak ada data pengguna, tidak ada ping keluar, hanya menjawab
 * saat ditanya.
 */
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, isPglite } from '@rigdaily/database';
import { ok } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = '0.1.0';

/** Identitas build, diisi saat build dari env. Nilai default = build lokal. */
const BUILD_IDENTITY = {
  vendor: 'PogungSoftwareHouseTeam',
  edition: process.env.APP_EDITION ?? 'community',
  commit: process.env.BUILD_COMMIT ?? 'local',
  builtAt: process.env.BUILD_TIME ?? new Date().toISOString(),
} as const;

export async function GET(): Promise<Response> {
  let dbOk = false;

  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch (err) {
    console.error('[health] DB check gagal:', err);
  }

  const body = {
    status: dbOk ? ('ok' as const) : ('degraded' as const),
    db: dbOk,
    driver: (isPglite ? 'pglite' : 'postgres') as 'pglite' | 'postgres',
    uptimeSec: Math.round(process.uptime()),
    version: VERSION,
    time: new Date().toISOString(),
    identity: BUILD_IDENTITY,
  };

  if (!dbOk) {
    return NextResponse.json(
      { error: { code: 'DB_UNAVAILABLE', message: 'Database tidak dapat dihubungi.', details: body } },
      { status: 503 },
    );
  }

  return ok(body);
}
