/**
 * GET /api/health
 *
 * Probe untuk monitoring / load balancer. TANPA auth (saat DB down, login juga
 * tidak bisa, tapi health harus tetap menjawab).
 *
 * 200 = DB ok, 503 = DB tidak bisa dihubungi.
 */
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, isPglite } from '@rigdaily/database';
import { ok } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = '0.1.0';

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
  };

  if (!dbOk) {
    return NextResponse.json(
      { error: { code: 'DB_UNAVAILABLE', message: 'Database tidak dapat dihubungi.', details: body } },
      { status: 503 },
    );
  }

  return ok(body);
}
