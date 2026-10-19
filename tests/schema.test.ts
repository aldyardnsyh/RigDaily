/**
 * Integritas schema DB (PGlite in-memory).
 *
 * Regresi yang dicegah: migrasi tidak idempotent (CI/dev restart gagal) atau
 * tabel kontrak hilang sehingga repo/dashboard/billing error di runtime.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoData, setupTestDb, teardownTestDb } from './helpers/db';

/** Tabel yang WAJIB ada menurut docs/KONTRAK-FROZEN.md §3. */
const REQUIRED_TABLES = [
  'companies',
  'users',
  'sessions',
  'fields',
  'rigs',
  'wells',
  'iadc_codes',
  'daily_reports',
  'time_breakdown',
  'crew_members',
  'mud_records',
  'bha_components',
  'cost_lines',
  'safety_incidents',
  'marine_daily',
  'mac_activities',
  'survey_stations',
  'rate_cards',
  'billing_flags',
  'distribution_rules',
  'delivery_log',
  'sync_devices',
  'sync_conflicts',
  'sync_mutation_log',
  'audit_log',
  'kpi_definitions',
  'import_batches',
] as const;

type PreparedStatementResult = { rows: unknown[] };

async function listPublicTables(): Promise<string[]> {
  const { db } = await import('@rigdaily/database');
  const { sql } = await import('drizzle-orm');
  const res = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  return (res as unknown as PreparedStatementResult).rows.map((r) => (r as { table_name: string }).table_name);
}

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

describe('migrate() - idempotent', () => {
  it('dijalankan dua kali berturut-turut tanpa error', async () => {
    const { migrate } = await import('@rigdaily/database');

    await expect(migrate()).resolves.toBeUndefined();
    await expect(migrate()).resolves.toBeUndefined();
  });

  it('jangan menghapus data yang sudah ada saat migrasi diulang', async () => {
    const { db, schema, migrate } = await import('@rigdaily/database');
    const { eq } = await import('drizzle-orm');

    const name = `Idempotency Probe ${Date.now()}`;
    const [inserted] = await db.insert(schema.companies).values({ name, type: 'operator' }).returning({ id: schema.companies.id });

    await migrate();
    await migrate();

    const rows = await db.select().from(schema.companies).where(eq(schema.companies.id, inserted.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(name);
  });
});

describe('tabel kontrak', () => {
  it('semua tabel kontrak ada di information_schema.tables', async () => {
    const tables = new Set(await listPublicTables());

    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    expect(missing).toEqual([]);
  });

  it.each(REQUIRED_TABLES.map((t) => [t] as const))('tabel %s ada', async (table) => {
    const tables = await listPublicTables();
    expect(tables).toContain(table);
  });
});

describe('index & constraint kunci', () => {
  it('unique index laporan (well_id, report_date, revision) ada', async () => {
    const { db } = await import('@rigdaily/database');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'daily_reports'`,
    );
    const names = (res as unknown as PreparedStatementResult).rows.map((r) => (r as { indexname: string }).indexname);
    expect(names).toContain('daily_reports_well_date_uq');
  });

  it('iadc_codes memakai code sebagai primary key', async () => {
    const { db } = await import('@rigdaily/database');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute<{ column_name: string }>(
      sql`SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
          WHERE tc.table_name = 'iadc_codes' AND tc.constraint_type = 'PRIMARY KEY'`,
    );
    const cols = (res as unknown as PreparedStatementResult).rows.map((r) => (r as { column_name: string }).column_name);
    expect(cols).toEqual(['code']);
  });

  it('kolom uang memakai numeric(14,2) (cost_lines.amount_usd)', async () => {
    const { db } = await import('@rigdaily/database');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute<{ numeric_precision: number; numeric_scale: number }>(
      sql`SELECT numeric_precision, numeric_scale
          FROM information_schema.columns
          WHERE table_name = 'cost_lines' AND column_name = 'amount_usd'`,
    );
    const rows = (res as unknown as PreparedStatementResult).rows as Array<{ numeric_precision: number; numeric_scale: number }>;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].numeric_precision)).toBe(14);
    expect(Number(rows[0].numeric_scale)).toBe(2);
  });

  it('tabel operasional memiliki kolom sync standar (revision, deleted_at)', async () => {
    const { db } = await import('@rigdaily/database');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'daily_reports'
            AND column_name IN ('origin_device_id','revision','deleted_at','updated_at')`,
    );
    const cols = (res as unknown as PreparedStatementResult).rows.map((r) => (r as { column_name: string }).column_name);
    expect(cols.sort()).toEqual(['deleted_at', 'origin_device_id', 'revision', 'updated_at']);
  });
});

describe('seed() - data demo tersedia', () => {
  it('34 kode IADC ter-seed', async () => {
    const { db, schema } = await import('@rigdaily/database');
    const rows = await db.select({ code: schema.iadcCodes.code }).from(schema.iadcCodes);
    expect(rows).toHaveLength(34);
  });

  it('seed() idempotent: dijalankan ulang tidak menggandakan company/well/rate card', async () => {
    const { db, schema } = await import('@rigdaily/database');
    const before = {
      companies: (await db.select({ id: schema.companies.id }).from(schema.companies)).length,
      wells: (await db.select({ id: schema.wells.id }).from(schema.wells)).length,
      reports: (await db.select({ id: schema.dailyReports.id }).from(schema.dailyReports)).length,
      rateCards: (await db.select({ id: schema.rateCards.id }).from(schema.rateCards)).length,
    };

    await seedDemoData();

    expect((await db.select({ id: schema.companies.id }).from(schema.companies)).length).toBe(before.companies);
    expect((await db.select({ id: schema.wells.id }).from(schema.wells)).length).toBe(before.wells);
    expect((await db.select({ id: schema.dailyReports.id }).from(schema.dailyReports)).length).toBe(before.reports);
    expect((await db.select({ id: schema.rateCards.id }).from(schema.rateCards)).length).toBe(before.rateCards);
  });
});
