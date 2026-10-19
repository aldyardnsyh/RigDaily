/**
 * GET   /api/reports/[id]  → detail DDR lengkap (header + anak + validation)
 * PATCH /api/reports/[id]  → ubah header DDR (HANYA saat status draft)
 *
 * PATCH menolak laporan submitted/approved dengan 409 `REPORT_LOCKED` -
 * perubahan setelah submit WAJIB lewat amendment (jejak audit revisi utuh).
 *
 * VALIDASI KEDALAMAN (P1-1)
 *   Sebelum menyimpan, kedalaman baru divalidasi dengan `validateDepth()` dari
 *   `@rigdaily/shared` terhadap kedalaman akhir laporan SEBELUMNYA di sumur yang
 *   sama (`reportDate` lebih kecil). Aturan tidak diduplikasi di route ini.
 *   - Ada issue `severity: 'error'` (DEPTH_REGRESS / DEPTH_CHAIN / DEPTH_INVALID)
 *     → 422 `VALIDATION_FAILED` + `details: issues`, tidak ada yang disimpan.
 *   - Hanya warning (DEPTH_LARGE) → tetap disimpan, warning dikembalikan di
 *     respons sebagai `warnings: []`.
 */
import { z } from 'zod';
import { validateDepth, zHm, type ValidationIssue } from '@rigdaily/shared';
import { ApiError, fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { recordAudit, requirePermission } from '@/lib/auth';
import { getPreviousReport, getReportById, updateReportHeader, type ReportDetail } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Subset kolom header yang boleh diubah user (semua opsional). */
const zHeaderPatch = z
  .object({
    depthMdStart: z.number().min(0).max(15000).optional(),
    depthMdEnd: z.number().min(0).max(15000).optional(),
    depthTvd: z.number().min(0).max(15000).nullable().optional(),
    summary: z.string().max(8000).nullable().optional(),
    planNext: z.string().max(4000).nullable().optional(),
    geologyNotes: z.string().max(4000).nullable().optional(),
    equipmentStatus: z.record(z.string(), z.string()).nullable().optional(),
    periodFrom: zHm.optional(),
    periodTo: zHm.optional(),
  })
  .strict();

/** Snapshot kolom header yang bisa di-PATCH (untuk oldJson audit). */
function headerSnapshot(report: ReportDetail): Record<string, unknown> {
  return {
    depthMdStart: report.depthMdStart,
    depthMdEnd: report.depthMdEnd,
    depthTvd: report.depthTvd,
    summary: report.summary,
    planNext: report.planNext,
    geologyNotes: report.geologyNotes,
    equipmentStatus: report.equipmentStatus,
    periodFrom: report.periodFrom,
    periodTo: report.periodTo,
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    await requirePermission('report:read');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    return ok(report);
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requirePermission('report:edit-draft');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Laporan ${params.id} tidak ditemukan.`);
    }

    if (report.status !== 'draft') {
      throw new ApiError(
        409,
        'REPORT_LOCKED',
        'Laporan yang sudah submitted/approved hanya bisa diubah lewat amendment.',
      );
    }

    // Hanya perhitungan progres (derivasi dari depth) yang diambil dari DTO;
    // nilai lama kolom header PATCH dibaca ulang dari DB agar audit jujur.
    const parse = parseBody(zHeaderPatch, await readJson(req));

    if (Object.keys(parse).length === 0) {
      throw new ApiError(400, 'EMPTY_PATCH', 'Tidak ada kolom header yang dikirim untuk diubah.');
    }

    // Validasi kedalaman lewat SATU sumber aturan: `validateDepth()` shared.
    // Kedalaman akhir laporan sebelumnya di sumur yang sama = batas bawah rantai.
    const nextStart = parse.depthMdStart ?? report.depthMdStart;
    const nextEnd = parse.depthMdEnd ?? report.depthMdEnd;

    const previous = await getPreviousReport(report.wellId, report.reportDate);
    const prevEnd = previous ? previous.depthMdEnd : null;

    const issues: ValidationIssue[] = validateDepth(nextStart, nextEnd, prevEnd);
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      throw new ApiError(
        422,
        'VALIDATION_FAILED',
        errors.map((e) => e.message).join(' '),
        { issues },
      );
    }

    // Warning (mis. DEPTH_LARGE) tidak memblokir penyimpanan, tapi dikembalikan.
    const warnings = issues.filter((i) => i.severity === 'warning');

    const oldJson = headerSnapshot(report);
    const newJson: Record<string, unknown> = {};
    for (const key of Object.keys(parse) as Array<keyof typeof parse>) {
      newJson[key] = parse[key] ?? null;
    }

    await updateReportHeader(params.id, parse);

    await recordAudit({
      entity: 'daily_report',
      entityId: params.id,
      action: 'update',
      actor: user,
      ip: getClientIp(req),
      oldJson,
      newJson: { ...newJson, depthChainPrevEnd: prevEnd, depthIssueCodes: issues.map((i) => i.code) },
    });

    const updated = await getReportById(params.id);
    // `warnings` kosong = tidak ada issue non-blocking; bentuk tetap konsisten.
    return ok({ ...updated, warnings });
  } catch (err) {
    return fail(err);
  }
}
