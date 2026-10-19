/**
 * Reporter - auto-distribution DDR (rules → delivery log → email).
 *
 * ALUR
 *   1. Ambil `distribution_rules` aktif bertipe `ddr`.
 *   2. Laporan `approved` yang `distributedAt IS NULL` (opsional: satu `reportId`).
 *   3. Penerima rule = RoleId (dicari email user aktif ber-role tsb) atau email
 *      langsung (item yang mengandung `@`).
 *   4. ANTI-DUPLIKAT (P1-6): bila `delivery_log` sudah punya baris `(ruleId,
 *      reportId)` berstatus `queued`/`sent`, kiriman itu DILEWATI - tidak ada
 *      baris baru. Baris yang ada diperbarui, bukan disisipi ulang.
 *   5. Tulis/lengkapi baris `delivery_log` (`queued`, subject
 *      `DDR #{no} - {well} - {date}`), lalu **selalu update** baris itu:
 *      `status`, `attempts`, `lastError`, `sentAt`.
 *   6. Bila ada yang benar-benar terkirim → `daily_reports.distributedAt` +
 *      `status = 'distributed'`.
 *   7. Audit `distribute_run` + update `distribution_rules.lastRunAt`.
 *
 * KIRIM ULANG MANUAL (P1-6)
 *   `retryDeliveryLog(id)` mengirim ulang SATU baris log memakai transport yang
 *   sama, menaikkan `attempts`, dan memperbarui status. Dipakai route
 *   `POST /api/master/rules/delivery/[id]/retry` + tombol "Kirim ulang" di UI.
 *
 * MODE EMAIL (tanpa dependency baru)
 *   - `SMTP_URL` kosong → **queue-only**: baris tetap `queued`, `lastError`
 *     menjelaskan bahwa SMTP belum dikonfigurasi, `distributedAt` TIDAK disentuh.
 *     Email bisa dikirim manual dari Delivery Log setelah konfigurasi terpasang.
 *   - `SMTP_URL` terisi → `nodemailer` dimuat dinamis (`require`). Modul itu
 *     SENGAJA tidak ada di package.json (opsional, jaga VPS kecil tetap ringan);
 *     bila belum terpasang kita jatuh ke queue-only dengan pesan yang jelas.
 */
import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { recordAudit } from '@/lib/auth';

export type DispatchDetail = {
  ruleId: string;
  ruleName: string;
  reportId: string;
  recipients: string[];
  status: 'sent' | 'queued' | 'failed' | 'skipped';
  message?: string;
};

export type DispatchResult = {
  queued: number;
  sent: number;
  failed: number;
  /** Jumlah (rule × laporan) yang dilewati karena sudah pernah queued/sent. */
  skipped: number;
  details: DispatchDetail[];
};

/** Pesan standar mode queue-only (dipakai juga oleh UI Delivery Log). */
export const SMTP_NOT_CONFIGURED_MESSAGE =
  'Email belum bisa dikirim: server email belum dikonfigurasi administrator. Email tetap tersimpan dalam antrean dan dapat dikirim ulang dari Log Pengiriman setelah konfigurasi selesai.';

/** Pesan bila SMTP_URL ada tetapi modul nodemailer belum terpasang. */
export const SMTP_TRANSPORT_MISSING_MESSAGE =
  'Server email sudah dikonfigurasi, tetapi komponen pengirim belum terpasang di server. Email tetap tersimpan dalam antrean dan dapat dikirim ulang dari Log Pengiriman setelah komponen tersebut dipasang administrator.';

/** Ringkasan minimal laporan untuk subject email. */
type ReportForMail = { id: string; reportNo: number; wellName: string; reportDate: string };

/* ------------------------------------------------------------------ */
/* Transport email (opsional)                                          */
/* ------------------------------------------------------------------ */

type MailTransport = {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
};

type NodemailerModule = {
  createTransport(url: string): MailTransport;
};

type ResolvedTransport =
  | { kind: 'disabled' }
  | { kind: 'missing' }
  | { kind: 'ready'; transport: MailTransport; from: string };

/**
 * Ambil transport email.
 * - `{ kind: 'disabled' }` bila SMTP_URL kosong (mode queue-only).
 * - `{ kind: 'missing' }` bila SMTP_URL ada tapi `nodemailer` belum terpasang.
 * - `{ kind: 'ready', transport }` bila siap kirim.
 */
async function resolveTransport(): Promise<ResolvedTransport> {
  const smtpUrl = process.env.SMTP_URL?.trim();
  if (!smtpUrl) return { kind: 'disabled' };

  // `require` dinamis: tidak boleh di-resolve saat bundling (modul opsional).
  const dynamicRequire = eval('require') as (id: string) => unknown;
  let mod: NodemailerModule | null = null;
  try {
    mod = dynamicRequire('nodemailer') as NodemailerModule;
  } catch {
    mod = null;
  }

  if (!mod || typeof mod.createTransport !== 'function') return { kind: 'missing' };

  const from = process.env.SMTP_FROM?.trim() || 'RigDaily <no-reply@rigdaily.local>';
  return { kind: 'ready', transport: mod.createTransport(smtpUrl), from };
}

/** Pesan alasan transport tidak siap (null bila siap kirim). */
function transportNotReadyMessage(transport: ResolvedTransport): string | null {
  if (transport.kind === 'disabled') return SMTP_NOT_CONFIGURED_MESSAGE;
  if (transport.kind === 'missing') return SMTP_TRANSPORT_MISSING_MESSAGE;
  return null;
}

/* ------------------------------------------------------------------ */
/* Resolusi penerima                                                   */
/* ------------------------------------------------------------------ */

/**
 * Rule `recipientGroup` berisi RoleId (mis. `CompanyMan`) atau email langsung.
 * Item yang mengandung `@` dipakai apa adanya (lowercase, trim).
 */
async function resolveRecipients(group: string[]): Promise<string[]> {
  const items = group.map((g) => g.trim()).filter((g) => g.length > 0);
  const emails = new Set<string>();
  const roleIds = new Set<string>();

  for (const item of items) {
    if (item.includes('@')) emails.add(item.toLowerCase());
    else roleIds.add(item);
  }

  if (roleIds.size > 0) {
    const users = await db
      .select({ email: schema.users.email, role: schema.users.role })
      .from(schema.users)
      .where(and(eq(schema.users.active, true), isNull(schema.users.deletedAt)));

    for (const u of users) {
      if (roleIds.has(u.role)) emails.add(u.email.trim().toLowerCase());
    }
  }

  return [...emails];
}

/* ------------------------------------------------------------------ */
/* Subject & body                                                      */
/* ------------------------------------------------------------------ */

function subjectOf(report: ReportForMail): string {
  return `DDR #${report.reportNo} - ${report.wellName} - ${report.reportDate}`;
}

function bodyOf(report: ReportForMail): string {
  return [
    `Daily Drilling Report #${report.reportNo}`,
    `Sumur: ${report.wellName}`,
    `Tanggal laporan: ${report.reportDate}`,
    '',
    'Lampiran PDF DDR dapat diunduh dari aplikasi RigDaily.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Helper baris delivery_log                                           */
/* ------------------------------------------------------------------ */

/** Status yang dianggap "sudah dikirim / sedang antre" → jangan diduplikasi. */
const ACTIVE_DELIVERY_STATUSES = ['queued', 'sent'] as const;

/**
 * Baris log aktif untuk pasangan (ruleId, reportId): `queued` atau `sent`.
 * Bila ada, distribusi berikutnya harus MELEWATI pasangan ini.
 */
async function findActiveDeliveryLog(
  ruleId: string,
  reportId: string,
): Promise<{ id: string; status: string } | null> {
  const rows = await db
    .select({ id: schema.deliveryLog.id, status: schema.deliveryLog.status })
    .from(schema.deliveryLog)
    .where(
      and(
        eq(schema.deliveryLog.ruleId, ruleId),
        eq(schema.deliveryLog.reportId, reportId),
        inArray(schema.deliveryLog.status, [...ACTIVE_DELIVERY_STATUSES]),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Catat hasil satu percobaan kirim ke `delivery_log`.
 *
 * `existingId` diisi bila baris sudah ada (mis. retry dari status `failed`):
 * baris itu di-UPDATE, bukan disisipi baru. Tanpa `existingId` dibuat baris baru.
 */
async function recordDelivery(params: {
  existingId?: string | null;
  ruleId: string | null;
  reportId: string | null;
  recipients: string[];
  subject: string;
  status: 'sent' | 'queued' | 'failed';
  attempts: number;
  lastError: string | null;
}): Promise<string> {
  const sentAt = params.status === 'sent' ? new Date() : null;

  if (params.existingId) {
    await db
      .update(schema.deliveryLog)
      .set({
        toAddresses: params.recipients,
        subject: params.subject,
        status: params.status,
        attempts: params.attempts,
        lastError: params.lastError,
        sentAt,
      })
      .where(eq(schema.deliveryLog.id, params.existingId));
    return params.existingId;
  }

  const [row] = await db
    .insert(schema.deliveryLog)
    .values({
      ruleId: params.ruleId,
      reportId: params.reportId,
      toAddresses: params.recipients,
      ccAddresses: [],
      subject: params.subject,
      status: params.status,
      attempts: params.attempts,
      lastError: params.lastError,
      sentAt,
    })
    .returning({ id: schema.deliveryLog.id });
  return row.id;
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

/**
 * Jalankan distribusi.
 * `dryRun: true` → tidak menulis apa pun (delivery log, distributedAt, audit,
 * lastRunAt); hasil hanya berisi rencana pengiriman.
 */
export async function runDistribution(opts: { dryRun?: boolean; reportId?: string } = {}): Promise<DispatchResult> {
  const dryRun = opts.dryRun === true;

  /* 1. Rule aktif bertipe ddr */
  const rules = await db
    .select()
    .from(schema.distributionRules)
    .where(
      and(
        isNull(schema.distributionRules.deletedAt),
        eq(schema.distributionRules.active, true),
        eq(schema.distributionRules.reportType, 'ddr'),
      ),
    );

  /* 2. Laporan approved yang belum terdistribusi */
  const reportParts = [
    isNull(schema.dailyReports.deletedAt),
    eq(schema.dailyReports.status, 'approved'),
    isNull(schema.dailyReports.distributedAt),
  ];
  if (opts.reportId) reportParts.push(eq(schema.dailyReports.id, opts.reportId));

  const reportRows: ReportForMail[] = (
    await db
      .select({
        id: schema.dailyReports.id,
        reportNo: schema.dailyReports.reportNo,
        reportDate: schema.dailyReports.reportDate,
        wellName: schema.wells.name,
      })
      .from(schema.dailyReports)
      .innerJoin(schema.wells, eq(schema.dailyReports.wellId, schema.wells.id))
      .where(and(...reportParts))
      .orderBy(schema.dailyReports.reportDate)
  ).map((r) => ({ ...r, wellName: r.wellName ?? '' }));

  const result: DispatchResult = { queued: 0, sent: 0, failed: 0, skipped: 0, details: [] };

  if (rules.length === 0 || reportRows.length === 0) {
    // Tidak ada yang perlu dikerjakan: tetap catat audit (kecuali dryRun).
    if (!dryRun) {
      await recordAudit({
        entity: 'distribution_rule',
        entityId: null,
        action: 'distribute_run',
        newJson: { dryRun, reportId: opts.reportId ?? null, rules: rules.length, reports: reportRows.length, queued: 0, sent: 0, failed: 0, skipped: 0 },
      });
    }
    return result;
  }

  const transport = await resolveTransport();
  const notReadyMessage = transportNotReadyMessage(transport);
  const sentReportIds = new Set<string>();

  for (const rule of rules) {
    const recipients = await resolveRecipients(rule.recipientGroup ?? []);

    for (const report of reportRows) {
      const subject = subjectOf(report);
      const base = { ruleId: rule.id, ruleName: rule.name, reportId: report.id, recipients };

      /* Anti-duplikat (P1-6): pasangan rule+laporan yang masih queued/sent dilewati. */
      const existingActive = await findActiveDeliveryLog(rule.id, report.id);
      if (existingActive) {
        const message = `Sudah ada kiriman berstatus "${existingActive.status}" untuk rule ini - tidak diduplikasi.`;
        result.skipped += 1;
        result.details.push({ ...base, status: 'skipped', message });
        if (existingActive.status === 'sent') sentReportIds.add(report.id);
        continue;
      }

      /* Dry-run: hanya rencana, tanpa menulis apa pun. */
      if (dryRun) {
        result.queued += 1;
        result.details.push({ ...base, status: 'queued', message: 'Simulasi (dry run) - tidak ada email yang dikirim.' });
        continue;
      }

      if (recipients.length === 0) {
        const message = 'Tidak ada penerima valid: role pada aturan distribusi belum punya pengguna aktif, atau alamat email kosong. Periksa penerima aturan lalu jalankan ulang.';
        await recordDelivery({
          ruleId: rule.id,
          reportId: report.id,
          recipients: [],
          subject,
          status: 'queued',
          attempts: 0,
          lastError: message,
        });
        result.queued += 1;
        result.details.push({ ...base, status: 'queued', message });
        continue;
      }

      /* Transport belum siap → queue-only, distributedAt TIDAK berubah. */
      if (transport.kind !== 'ready' || notReadyMessage) {
        const message = notReadyMessage ?? SMTP_NOT_CONFIGURED_MESSAGE;
        await recordDelivery({
          ruleId: rule.id,
          reportId: report.id,
          recipients,
          subject,
          status: 'queued',
          attempts: 0,
          lastError: message,
        });
        result.queued += 1;
        result.details.push({ ...base, status: 'queued', message });
        continue;
      }

      try {
        await transport.transport.sendMail({
          from: transport.from,
          to: recipients.join(', '),
          subject,
          text: bodyOf(report),
        });

        await recordDelivery({
          ruleId: rule.id,
          reportId: report.id,
          recipients,
          subject,
          status: 'sent',
          attempts: 1,
          lastError: null,
        });

        sentReportIds.add(report.id);
        result.sent += 1;
        result.details.push({ ...base, status: 'sent' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordDelivery({
          ruleId: rule.id,
          reportId: report.id,
          recipients,
          subject,
          status: 'failed',
          attempts: 1,
          lastError: message.slice(0, 500),
        });
        result.failed += 1;
        result.details.push({ ...base, status: 'failed', message });
      }
    }
  }

  /* 7. Status laporan hanya untuk yang benar-benar terkirim. */
  if (sentReportIds.size > 0) {
    const now = new Date();
    for (const id of sentReportIds) {
      await db
        .update(schema.dailyReports)
        .set({ distributedAt: now, status: 'distributed', updatedAt: now })
        .where(eq(schema.dailyReports.id, id));
    }
  }

  /* 9. Tandai rule sudah dijalankan. */
  const ranAt = new Date();
  for (const rule of rules) {
    await db
      .update(schema.distributionRules)
      .set({ lastRunAt: ranAt })
      .where(eq(schema.distributionRules.id, rule.id));
  }

  /* 8. Audit. */
  await recordAudit({
    entity: 'distribution_rule',
    entityId: null,
    action: 'distribute_run',
    newJson: {
      dryRun: false,
      reportId: opts.reportId ?? null,
      rules: rules.length,
      reports: reportRows.length,
      queued: result.queued,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
    },
  });

  return result;
}

/* ------------------------------------------------------------------ */
/* Kirim ulang manual satu baris Delivery Log (P1-6)                   */
/* ------------------------------------------------------------------ */

export type RetryDeliveryResult = { status: 'sent' | 'queued' | 'failed'; message?: string };

/**
 * Kirim ulang satu baris `delivery_log`.
 *
 * - Baris yang sudah `sent` tidak dikirim ulang (tidak masuk akal & berisiko
 *   dobel) → `status: 'sent'` dengan pesan penjelasan, tanpa menyentuh baris.
 * - Transport belum siap → baris tetap/berubah ke `queued`, `attempts` TIDAK
 *   dinaikkan (tidak ada percobaan kirim nyata), `lastError` diisi alasannya.
 * - Gagal kirim → `failed`, `attempts + 1`, `lastError` = pesan error.
 * - Berhasil → `sent`, `attempts + 1`, `sentAt = now`, `lastError = null`, dan
 *   laporan induk ditandai `distributed`.
 */
export async function retryDeliveryLog(id: string): Promise<RetryDeliveryResult> {
  const rows = await db
    .select({
      id: schema.deliveryLog.id,
      reportId: schema.deliveryLog.reportId,
      toAddresses: schema.deliveryLog.toAddresses,
      subject: schema.deliveryLog.subject,
      status: schema.deliveryLog.status,
      attempts: schema.deliveryLog.attempts,
    })
    .from(schema.deliveryLog)
    .where(eq(schema.deliveryLog.id, id))
    .limit(1);

  const entry = rows[0];
  if (!entry) throw new Error(`Baris Delivery Log ${id} tidak ditemukan.`);

  const recipients = (entry.toAddresses ?? []).filter((a) => a.trim().length > 0);

  if (entry.status === 'sent') {
    return { status: 'sent', message: 'Email sudah terkirim sebelumnya - tidak dikirim ulang.' };
  }

  if (recipients.length === 0) {
    const message = 'Tidak ada alamat penerima pada baris ini - lengkapi rule penerima lalu jalankan distribusi.';
    await recordDelivery({
      existingId: entry.id,
      ruleId: null,
      reportId: entry.reportId,
      recipients,
      subject: entry.subject ?? '',
      status: 'queued',
      attempts: entry.attempts,
      lastError: message,
    });
    return { status: 'queued', message };
  }

  const transport = await resolveTransport();
  const notReadyMessage = transportNotReadyMessage(transport);

  if (transport.kind !== 'ready' || notReadyMessage) {
    const message = notReadyMessage ?? SMTP_NOT_CONFIGURED_MESSAGE;
    await recordDelivery({
      existingId: entry.id,
      ruleId: null,
      reportId: entry.reportId,
      recipients,
      subject: entry.subject ?? '',
      status: 'queued',
      attempts: entry.attempts,
      lastError: message,
    });
    return { status: 'queued', message };
  }

  try {
    await transport.transport.sendMail({
      from: transport.from,
      to: recipients.join(', '),
      subject: entry.subject ?? '(tanpa subjek)',
      text: entry.subject ?? 'DDR RigDaily',
    });

    await recordDelivery({
      existingId: entry.id,
      ruleId: null,
      reportId: entry.reportId,
      recipients,
      subject: entry.subject ?? '',
      status: 'sent',
      attempts: entry.attempts + 1,
      lastError: null,
    });

    if (entry.reportId) {
      const now = new Date();
      await db
        .update(schema.dailyReports)
        .set({ distributedAt: now, status: 'distributed', updatedAt: now })
        .where(eq(schema.dailyReports.id, entry.reportId));
    }

    return { status: 'sent' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordDelivery({
      existingId: entry.id,
      ruleId: null,
      reportId: entry.reportId,
      recipients,
      subject: entry.subject ?? '',
      status: 'failed',
      attempts: entry.attempts + 1,
      lastError: message.slice(0, 500),
    });
    return { status: 'failed', message };
  }
}
