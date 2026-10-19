/**
 * Repository - Audit trail.
 *
 * `writeAudit` dipanggil setelah mutasi sukses. Kegagalan menulis audit TIDAK
 * boleh membatalkan aksi bisnis user (cukup console.error).
 */
import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@rigdaily/database';
import type { AuditEntryDto } from './types';
import { toIso } from './shared';

/** jsonb kolom menerima objek; nilai skalar dibungkus agar tidak hilang. */
function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

export async function writeAudit(entry: {
  entity: string;
  entityId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  oldJson?: unknown;
  newJson?: unknown;
  ip?: string | null;
  terminal?: string | null;
}): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      actorId: entry.actorId ?? null,
      actorName: entry.actorName ?? null,
      action: entry.action,
      oldJson: toJsonRecord(entry.oldJson),
      newJson: toJsonRecord(entry.newJson),
      ip: entry.ip ?? null,
      terminal: entry.terminal ?? null,
    });
  } catch (err) {
    console.error('[repo/audit] gagal menulis audit log:', err);
  }
}

export async function listAudit(filter?: {
  entity?: string;
  entityId?: string;
  limit?: number;
}): Promise<AuditEntryDto[]> {
  const take = Math.min(Math.max(filter?.limit ?? 100, 1), 1000);

  const parts = [];
  if (filter?.entity) parts.push(eq(schema.auditLog.entity, filter.entity));
  if (filter?.entityId) parts.push(eq(schema.auditLog.entityId, filter.entityId));

  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(parts.length > 0 ? and(...parts) : undefined)
    .orderBy(desc(schema.auditLog.at))
    .limit(take);

  return rows.map((a) => ({
    id: a.id,
    at: toIso(a.at) ?? new Date(0).toISOString(),
    actorName: a.actorName,
    entity: a.entity,
    entityId: a.entityId,
    action: a.action,
    oldJson: a.oldJson ?? null,
    newJson: a.newJson ?? null,
    ip: a.ip,
  }));
}
