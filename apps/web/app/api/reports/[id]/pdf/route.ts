/**
 * GET /api/reports/[id]/pdf?type=ddr|iadc
 *
 * Menghasilkan PDF formal DDR atau IADC-compatible time sheet.
 * - Butuh login + permission `report:read`.
 * - 404 bila report tidak ada.
 * - Menulis audit `pdf_generate`.
 *
 * Respons: application/pdf (inline) dengan nama file DDR-<well>-<reportNo>.pdf.
 */
import { NextResponse } from 'next/server';
import { ApiError, fail } from '@/lib/api-response';
import { auditActor, clientIp, requirePermission, requireUser } from '@/lib/auth';
import { getReportById, writeAudit } from '@/lib/repo';
import { generateDdrPdf, generateIadcPdf } from '@/lib/pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Nama file aman: buang karakter non [A-Za-z0-9._-] dari nama sumur. */
function safeFilenamePart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.length > 0 ? cleaned : 'well';
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const user = await requireUser();
    await requirePermission('report:read');

    const report = await getReportById(params.id);
    if (!report) {
      throw new ApiError(404, 'report_not_found', 'Laporan tidak ditemukan');
    }

    const type = (new URL(req.url).searchParams.get('type') ?? 'ddr').toLowerCase();
    if (type !== 'ddr' && type !== 'iadc') {
      throw new ApiError(400, 'invalid_type', 'Parameter type harus "ddr" atau "iadc"');
    }

    const buffer = type === 'iadc' ? await generateIadcPdf(report) : await generateDdrPdf(report);

    const filename = `DDR-${safeFilenamePart(report.wellName)}-${report.reportNo}.pdf`;

    await writeAudit({
      entity: 'daily_report',
      entityId: report.id,
      action: 'pdf_generate',
      ...auditActor(user),
      ip: clientIp(req) ?? null,
      newJson: { type, reportNo: report.reportNo, well: report.wellName, bytes: buffer.length },
    });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return fail(err);
  }
}
