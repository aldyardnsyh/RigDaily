'use client';
import { Badge, type StatusKind } from '@rigdaily/ui';
import { REPORT_STATUS_LABEL } from '@rigdaily/shared';

/**
 * Status DDR (`draft|submitted|approved|distributed|locked`) → Badge @rigdaily/ui.
 * Map tetap eksplisit supaya status tak dikenal tidak diam-diam jadi hijau.
 */
const STATUS_KIND: Record<string, StatusKind> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  distributed: 'Distributed',
  locked: 'Locked',
};

export function StatusBadge({ status }: { status: string }) {
  const kind: StatusKind = STATUS_KIND[status] ?? 'Draft';
  const label = (REPORT_STATUS_LABEL[status] ?? status).toUpperCase();
  return <Badge kind={kind}>{label}</Badge>;
}

/**
 * Klasifikasi waktu IADC (PRD/NPT/WOW/FM/STBY/DSPT/GAP) → varian Badge.
 * Pemetaan mengikuti brief UI-1:
 *   PRD  → Productive (hijau)
 *   NPT  → NPT (merah)
 *   WOW  → Submitted (amber)
 *   FM   → Locked (netral gelap)
 *   STBY → Draft (netral terang)
 *   DSPT → NPT (merah)
 *   GAP  → NPT (merah)
 */
const TIME_CLASS_KIND: Record<string, StatusKind> = {
  PRD: 'Productive',
  NPT: 'NPT',
  WOW: 'Submitted',
  FM: 'Locked',
  STBY: 'Draft',
  DSPT: 'NPT',
  GAP: 'NPT',
};

export function TimeClassBadge({ timeClass }: { timeClass: string }) {
  const kind: StatusKind = TIME_CLASS_KIND[timeClass] ?? 'Draft';
  return <Badge kind={kind}>{timeClass}</Badge>;
}
