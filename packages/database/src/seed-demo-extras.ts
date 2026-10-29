/**
 * Data pelengkap agar SEMUA fitur demo punya isi sejak pertama dibuka.
 *
 * Seed utama mengisi master, DDR, biaya, dan safety. File ini menambahkan
 * data yang tidak dibuat seed utama tetapi dipakai halaman tertentu:
 *  - marine_daily + mac_activities  -> halaman Marine & MAC
 *  - billing_flags                  -> halaman Billing
 *  - sync_conflicts                 -> Sync Center (resolusi konflik)
 *  - delivery_log                   -> riwayat distribusi laporan
 *  - audit_log (non-auth)           -> Admin > Jejak Audit & dashboard
 *  - import_batches                 -> riwayat impor data
 *
 * Idempotent: setiap blok hanya mengisi tabel yang masih kosong.
 */
import { randomUUID } from 'node:crypto';
import { desc, isNull, ne, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from './client';
import * as s from './schema';

async function empty(table: PgTable): Promise<boolean> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return (rows[0]?.n ?? 0) === 0;
}

export async function seedDemoExtras(): Promise<void> {
  const users = await db
    .select({ id: s.users.id, email: s.users.email, name: s.users.name, role: s.users.role })
    .from(s.users)
    .where(isNull(s.users.deletedAt));

  const userByRole = new Map(users.map((u) => [u.role, u]));

  const reports = await db
    .select({
      id: s.dailyReports.id,
      wellId: s.dailyReports.wellId,
      rigId: s.dailyReports.rigId,
      reportDate: s.dailyReports.reportDate,
      reportNo: s.dailyReports.reportNo,
    })
    .from(s.dailyReports)
    .where(isNull(s.dailyReports.deletedAt))
    .orderBy(desc(s.dailyReports.reportDate))
    .limit(12);

  const rigs = await db
    .select({ id: s.rigs.id, type: s.rigs.type, name: s.rigs.name })
    .from(s.rigs)
    .where(isNull(s.rigs.deletedAt));
  const rigType = new Map(rigs.map((r) => [r.id, r.type]));

  /* ---------------- marine_daily ---------------- */
  if (await empty(s.marineDaily)) {
    const variants = ['jackup', 'anchored_floater', 'dpp_floater'] as const;
    type Variant = (typeof variants)[number];
    const isVariant = (v: string | null): v is Variant => variants.includes(v as Variant);

    const rows = reports.map((r, i) => {
      const variant: Variant = isVariant(r.rigId ? rigType.get(r.rigId) ?? null : null)
        ? (rigType.get(r.rigId as string) as Variant)
        : 'dpp_floater';
      const base = 2 + (i % 4) * 0.15;
      const fields: Record<string, unknown> = {
        draftForeM: Number((7.4 + base).toFixed(2)),
        draftAftM: Number((7.8 + base).toFixed(2)),
        ballastT: 1850 + i * 45,
        windKn: 8 + (i % 5) * 2,
        waveHsM: Number((1.1 + (i % 3) * 0.25).toFixed(2)),
        currentKn: Number((0.6 + (i % 4) * 0.15).toFixed(2)),
        fuelRobT: 420 - i * 8,
        waterRobT: 310 - i * 4,
        windDir: i % 2 === 0 ? 'NW' : 'SE',
        currentDir: i % 2 === 0 ? 'S' : 'N',
      };
      if (variant === 'dpp_floater') {
        fields.thrusters = {
          t1: 'ok',
          t2: 'ok',
          t3: i % 5 === 0 ? 'degraded' : 'ok',
          t4: 'ok',
          t5: 'ok',
          t6: 'ok',
        };
      }
      return { reportId: r.id, variant, fieldsJson: fields };
    });

    if (rows.length > 0) {
      await db.insert(s.marineDaily).values(rows);
      console.log(`[seed-demo] marine_daily: ${rows.length} baris.`);
    }
  }

  /* ---------------- mac_activities ---------------- */
  if (await empty(s.macActivities)) {
    const rows = reports.slice(0, 8).flatMap((r, i) => [
      {
        reportId: r.id,
        activityCenter: 'Main',
        operation: i % 3 === 0 ? 'Rotary drilling 8.5in section' : 'Tripping out BHA',
        hours: '18.00',
        billable: true,
      },
      {
        reportId: r.id,
        activityCenter: 'Offline',
        operation: 'Rig up BHA & pressure test',
        hours: '6.00',
        billable: false,
      },
    ]);
    if (rows.length > 0) {
      await db.insert(s.macActivities).values(rows);
      console.log(`[seed-demo] mac_activities: ${rows.length} baris.`);
    }
  }

  /* ---------------- billing_flags ---------------- */
  if (await empty(s.billingFlags)) {
    const timeRows = await db
      .select({ id: s.timeBreakdown.id, reportId: s.timeBreakdown.reportId })
      .from(s.timeBreakdown)
      .orderBy(desc(s.timeBreakdown.createdAt))
      .limit(4);

    const notes = [
      { forceMajeure: true, disputed: false, rebillable: false, note: 'Force majeure: badai tropis, operasi dihentikan 6 jam (klausul 14.2).' },
      { forceMajeure: false, disputed: true, rebillable: false, note: 'Rate NPT dipersengketakan kontraktor; menunggu klarifikasi Company Man.' },
      { forceMajeure: false, disputed: false, rebillable: true, note: 'Biaya dapat ditagihkan ulang ke operator (rebillable).' },
      { forceMajeure: false, disputed: false, rebillable: false, note: 'Terverifikasi terhadap rate card aktif.' },
    ];

    const rows = timeRows.map((t, i) => ({ reportId: t.reportId, timeRowId: t.id, ...notes[i % notes.length] }));
    if (rows.length > 0) {
      await db.insert(s.billingFlags).values(rows);
      console.log(`[seed-demo] billing_flags: ${rows.length} baris.`);
    }
  }

  /* ---------------- sync_conflicts ---------------- */
  if (await empty(s.syncConflicts)) {
    const deviceRows = await db
      .select({ deviceId: s.syncDevices.deviceId })
      .from(s.syncDevices)
      .where(isNull(s.syncDevices.deletedAt))
      .limit(2);
    const deviceId = deviceRows[0]?.deviceId ?? 'RIG-12-LAPTOP';
    const latest = reports[0];

    const rows = [
      {
        deviceId,
        entity: 'daily_report',
        entityServerId: latest?.id ?? null,
        entityLocalId: null,
        clientMutationId: randomUUID(),
        rigPayload: {
          reportDate: latest?.reportDate ?? '2026-09-09',
          nptMinutes: 120,
          summary: 'Rig mengirim versi lokal: pompa lumpur diperbaiki 2 jam, NPT 120 menit.',
          revision: 2,
        },
        serverPayload: {
          reportDate: latest?.reportDate ?? '2026-09-09',
          nptMinutes: 60,
          summary: 'Versi server: NPT 60 menit dari laporan kantor.',
          revision: 2,
        },
        reason: 'Laporan yang sama diubah di rig dan kantor pada jam yang berdekatan.',
        status: 'open' as const,
      },
      {
        deviceId: 'OFFICE-SRV-JKT',
        entity: 'well',
        entityServerId: latest?.wellId ?? null,
        entityLocalId: null,
        clientMutationId: randomUUID(),
        rigPayload: { field: 'afeBudgetUsd', rigValue: '1600000.00', updatedAt: '2026-09-09T04:12:00Z' },
        serverPayload: { field: 'afeBudgetUsd', serverValue: '1450000.00', updatedAt: '2026-09-09T05:01:00Z' },
        reason: 'AFE budget berbeda: rig memakai revisi kontrak terbaru, server belum disinkronkan.',
        status: 'open' as const,
      },
    ];

    await db.insert(s.syncConflicts).values(rows);
    console.log(`[seed-demo] sync_conflicts: ${rows.length} baris.`);
  }

  /* ---------------- delivery_log ---------------- */
  if (await empty(s.deliveryLog)) {
    const rules = await db
      .select({ id: s.distributionRules.id, name: s.distributionRules.name })
      .from(s.distributionRules)
      .limit(3);

    const recipients = [
      'dave.miller@medco-energi.com',
      's.jenkins@medco-energi.com',
      'a.arifin@partner-jv.com',
    ];

    const rows = reports.slice(0, 4).map((r, i) => {
      const failed = i === 2;
      return {
        ruleId: rules[i % Math.max(1, rules.length)]?.id ?? null,
        reportId: r.id,
        toAddresses: recipients,
        ccAddresses: ['cost.control@medco-energi.com'],
        subject: `DDR #${r.reportNo} - ${r.reportDate} - ARUN Field`,
        status: failed ? 'failed' : 'sent',
        attempts: failed ? 3 : 1,
        lastError: failed ? 'SMTP 550: mailbox cost.control@medco-energi.com menolak pesan (kuota penuh).' : null,
        sentAt: failed ? null : new Date(Date.now() - (i + 1) * 3600_000),
        createdAt: new Date(Date.now() - (i + 1) * 3600_000),
      };
    });

    if (rows.length > 0) {
      await db.insert(s.deliveryLog).values(rows);
      console.log(`[seed-demo] delivery_log: ${rows.length} baris.`);
    }
  }

  /* ---------------- audit_log (non-auth) ---------------- */
  const nonAuthAudit = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.auditLog)
    .where(ne(s.auditLog.entity, 'auth'));

  if ((nonAuthAudit[0]?.n ?? 0) === 0) {
    const companyMan = userByRole.get('CompanyMan');
    const clerk = userByRole.get('RigClerk');
    const engineer = userByRole.get('DrillingEngineer');
    const cost = userByRole.get('CostController');
    const hse = userByRole.get('HSE');
    const admin = userByRole.get('Admin');
    const latest = reports[0];

    const ago = (hours: number) => new Date(Date.now() - hours * 3600_000);

    const rows = [
      {
        entity: 'daily_report',
        entityId: latest?.id ?? null,
        actorId: companyMan?.id ?? null,
        actorName: companyMan?.name ?? 'Dave Miller',
        action: 'approve',
        oldJson: { status: 'submitted' },
        newJson: { status: 'approved', reportNo: latest?.reportNo ?? 143 },
        ip: '10.142.8.204',
        terminal: 'LT-10-142-8-204',
        at: ago(5),
      },
      {
        entity: 'cost',
        entityId: latest?.id ?? null,
        actorId: cost?.id ?? null,
        actorName: cost?.name ?? 'Rina Wibowo',
        action: 'cost_update',
        oldJson: { amountUsd: 42000 },
        newJson: { amountUsd: 48250, category: 'Cementing' },
        ip: '10.142.8.117',
        terminal: 'LT-10-142-8-117',
        at: ago(8),
      },
      {
        entity: 'billing',
        entityId: latest?.id ?? null,
        actorId: cost?.id ?? null,
        actorName: cost?.name ?? 'Rina Wibowo',
        action: 'billing_generate',
        newJson: { period: '2026-09', totalUsd: 184320.5, flags: 4 },
        ip: '10.142.8.117',
        terminal: 'LT-10-142-8-117',
        at: ago(14),
      },
      {
        entity: 'sync',
        entityId: 'RIG-12-LAPTOP',
        actorId: clerk?.id ?? null,
        actorName: clerk?.name ?? 'Sarah Jenkins',
        action: 'sync_pull',
        newJson: { deviceId: 'RIG-12-LAPTOP', changes: 34, conflicts: 1 },
        ip: '10.142.8.204',
        terminal: 'LT-10-142-8-204',
        at: ago(18),
      },
      {
        entity: 'safety',
        entityId: null,
        actorId: hse?.id ?? null,
        actorName: hse?.name ?? 'Budi Santoso',
        action: 'incident_create',
        newJson: { refNo: 'IR-2026-014', severity: 'medium', status: 'open' },
        ip: '10.142.8.88',
        terminal: 'LT-10-142-8-88',
        at: ago(26),
      },
      {
        entity: 'daily_report',
        entityId: latest?.id ?? null,
        actorId: clerk?.id ?? null,
        actorName: clerk?.name ?? 'Sarah Jenkins',
        action: 'submit',
        oldJson: { status: 'draft' },
        newJson: { status: 'submitted', reportNo: latest?.reportNo ?? 143 },
        ip: '10.142.8.204',
        terminal: 'LT-10-142-8-204',
        at: ago(30),
      },
      {
        entity: 'well',
        entityId: latest?.wellId ?? null,
        actorId: engineer?.id ?? null,
        actorName: engineer?.name ?? 'Dr. A. Arifin',
        action: 'well_amend',
        oldJson: { tdPlannedM: 3100 },
        newJson: { tdPlannedM: 3200, reason: 'Revisi target kedalaman setelah log akhir.' },
        ip: '10.142.8.56',
        terminal: 'LT-10-142-8-56',
        at: ago(34),
      },
      {
        entity: 'admin',
        entityId: null,
        actorId: admin?.id ?? null,
        actorName: admin?.name ?? 'System Administrator',
        action: 'rate_card_update',
        oldJson: { ratePerHour: 1125 },
        newJson: { ratePerHour: 1187.5, activityCode: '01' },
        ip: '10.142.8.10',
        terminal: 'LT-10-142-8-10',
        at: ago(48),
      },
    ];

    await db.insert(s.auditLog).values(rows);
    console.log(`[seed-demo] audit_log: ${rows.length} entri non-auth.`);
  }

  /* ---------------- import_batches ---------------- */
  if (await empty(s.importBatches)) {
    const admin = userByRole.get('Admin');
    await db.insert(s.importBatches).values([
      {
        source: 'Legacy DDR Excel',
        fileName: 'DDR_ARUN-07_2026-09.xlsx',
        rowCount: 96,
        errorCount: 2,
        errors: [
          { row: 41, message: 'Kode IADC "99" tidak dikenal - baris dilewati.' },
          { row: 72, message: 'Durasi negatif (06:00 -> 05:30) - dikoreksi menjadi 23.5 jam.' },
        ],
        status: 'completed',
        createdBy: admin?.id ?? null,
        createdAt: new Date(Date.now() - 72 * 3600_000),
      },
      {
        source: 'AFE Master CSV',
        fileName: 'afe_master_2026.csv',
        rowCount: 24,
        errorCount: 0,
        errors: [],
        status: 'completed',
        createdBy: admin?.id ?? null,
        createdAt: new Date(Date.now() - 120 * 3600_000),
      },
    ]);
    console.log('[seed-demo] import_batches: 2 baris.');
  }
}
