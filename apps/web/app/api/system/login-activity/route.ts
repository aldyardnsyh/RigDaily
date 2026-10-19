/**
 * GET /api/system/login-activity
 *
 * Riwayat akses yang aman ditampilkan di halaman LOGIN (sebelum sesi dibuat).
 *
 * KEAMANAN - PENTING
 * Endpoint ini publik. Karena itu data yang dikembalikan SENGAJA dibatasi:
 *  - HANYA nama tampilan + inisial (tanpa email lengkap, tanpa password).
 *  - Email disamarkan: "d***@medco-energi.com".
 *  - Hanya 8 kejadian terakhir dalam 7 hari.
 *  - Tanpa detail operasional (tanpa nomor DDR, biaya, sumur).
 * Tujuannya: memberi konteks "siapa yang baru mengakses sistem", bukan
 * membocorkan data.
 */
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import { ok } from '@/lib/api-response';
import { describeIp } from '@/lib/ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Samarkan email: "dave.miller@medco-energi.com" -> "d***@medco-energi.com". */
function maskEmail(email: string | null): string {
  if (!email) return '-';
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || 'RD';
}

export async function GET(): Promise<Response> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const rows = await db
      .select({
        at: schema.auditLog.at,
        actorName: schema.auditLog.actorName,
        action: schema.auditLog.action,
        ip: schema.auditLog.ip,
        terminal: schema.auditLog.terminal,
        userEmail: schema.users.email,
      })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
      .where(and(eq(schema.auditLog.entity, 'auth'), gte(schema.auditLog.at, since), isNull(schema.users.deletedAt)))
      .orderBy(desc(schema.auditLog.at))
      .limit(8);

    // Sesi aktif (jumlah saja, tanpa identitas) untuk indikator "sedang dipakai".
    const sessions = await db
      .select({ userId: schema.sessions.userId })
      .from(schema.sessions)
      .where(gte(schema.sessions.expiresAt, new Date()));
    const activeSessions = new Set(sessions.map((s) => s.userId)).size;

    const events = rows
      .filter((r) => r.action === 'login' || r.action === 'logout')
      .map((r) => {
        const name = r.actorName ?? 'Pengguna';
        const ipInfo = describeIp(r.ip ?? 'unknown');
        return {
          at: r.at.toISOString(),
          action: r.action as 'login' | 'logout',
          name,
          initials: initials(name),
          maskedEmail: maskEmail(r.userEmail),
          ip: ipInfo.ip,
          network: ipInfo.network,
          terminal: r.terminal ? r.terminal.slice(0, 80) : null,
        };
      });

    return ok({ events, activeSessions, windowDays: 7 });
  } catch {
    return ok({ events: [], activeSessions: 0, windowDays: 7 });
  }
}
