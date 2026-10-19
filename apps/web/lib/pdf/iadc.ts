/**
 * Generator PDF IADC-COMPATIBLE DAILY TIME SHEET - SERVER ONLY.
 *
 * Format landscape A4, satu baris per time breakdown.
 * PENTING: jam (HRS) dan TOTAL dihitung dari `report.timeRows[].durationMin`
 * (angka tersimpan), BUKAN dihitung ulang dari string jam - agar identik dengan
 * layar dan tidak pernah berbeda karena pembulatan/lintas tengah malam.
 */
import 'server-only';
import type { ReportDetail, TimeRowDto } from '../repo/types';
import {
  COLORS,
  createDocLandscape,
  docToBuffer,
  footerSignature,
  header,
  note,
  paragraph,
  sectionTitle,
  setFootnote,
  table,
  type Doc,
} from './layout';

type ClassTotals = {
  totalMin: number;
  prd: number;
  npt: number;
  wow: number;
  fm: number;
  stby: number;
  dspt: number;
};

function totalsFromRows(rows: TimeRowDto[]): ClassTotals {
  const t: ClassTotals = { totalMin: 0, prd: 0, npt: 0, wow: 0, fm: 0, stby: 0, dspt: 0 };
  for (const r of rows) {
    const dur = Number.isFinite(r.durationMin) ? r.durationMin : 0;
    t.totalMin += dur;
    const cls = r.nptFlag ? 'NPT' : r.timeClass;
    switch (cls) {
      case 'PRD':
        t.prd += dur;
        break;
      case 'NPT':
        t.npt += dur;
        break;
      case 'WOW':
        t.wow += dur;
        break;
      case 'FM':
        t.fm += dur;
        break;
      case 'STBY':
        t.stby += dur;
        break;
      case 'DSPT':
        t.dspt += dur;
        break;
      default:
        break;
    }
  }
  return t;
}

const hrs = (minutes: number): string => (minutes / 60).toFixed(2);

function subcodeText(r: TimeRowDto): string {
  const parts = [r.iadcSubcode, r.vendor].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(' / ') : '-';
}

export async function generateIadcPdf(report: ReportDetail): Promise<Buffer> {
  const doc: Doc = createDocLandscape();

  setFootnote(doc, `IADC Time Sheet #${report.reportNo} - ${report.wellName}`);

  header(doc, {
    title: 'IADC-COMPATIBLE DAILY TIME SHEET',
    subtitle: 'RigDaily - 24h Time Breakdown (IADC-compatible format, bukan IADC Certified)',
    reportNo: report.reportNo,
    reportDate: report.reportDate,
    wellName: report.wellName,
    rigName: report.rigName ?? '-',
    period: `${report.periodFrom}-${report.periodTo}`,
  });

  const totals = totalsFromRows(report.timeRows);

  sectionTitle(doc, 'Time Breakdown');

  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rows: Array<Record<string, string>> = report.timeRows.map((r, i) => ({
    no: String(i + 1),
    start: r.start,
    end: r.end,
    hrs: hrs(r.durationMin),
    code: r.iadcCode,
    description: r.iadcName,
    cls: r.nptFlag ? 'NPT' : r.timeClass,
    subcode: subcodeText(r),
    remarks: r.remarks ?? '',
  }));

  rows.push({
    no: '',
    start: '',
    end: '',
    hrs: hrs(totals.totalMin),
    code: '',
    description: 'TOTAL',
    cls: '',
    subcode: '',
    remarks: '',
  });

  table(doc, {
    columns: [
      { header: '#', width: w * 0.035, key: 'no', align: 'center' },
      { header: 'Start', width: w * 0.07, key: 'start', align: 'center' },
      { header: 'End', width: w * 0.07, key: 'end', align: 'center' },
      { header: 'Hrs', width: w * 0.06, key: 'hrs', align: 'right' },
      { header: 'Code', width: w * 0.06, key: 'code', align: 'center' },
      { header: 'Description', width: w * 0.19, key: 'description' },
      { header: 'Class', width: w * 0.07, key: 'cls', align: 'center' },
      { header: 'Sub-code / Equipment / Vendor', width: w * 0.22, key: 'subcode' },
      { header: 'Remarks', width: w * 0.225, key: 'remarks' },
    ],
    rows,
    tint: (row) => {
      if (row.description === 'TOTAL') return COLORS.fill;
      if (row.cls === 'NPT') return '#FBEAEA';
      return null;
    },
  });

  /* Ringkasan kelas waktu ------------------------------------------- */
  sectionTitle(doc, 'Summary by Time Class');
  {
    const sw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const gapMin = Math.max(0, 1440 - totals.totalMin);
    table(doc, {
      columns: [
        { header: 'Productive (PRD)', width: sw * 0.14, key: 'prd', align: 'right' },
        { header: 'NPT', width: sw * 0.14, key: 'npt', align: 'right' },
        { header: 'WOW', width: sw * 0.14, key: 'wow', align: 'right' },
        { header: 'Standby (STBY)', width: sw * 0.15, key: 'stby', align: 'right' },
        { header: 'Disputed (DSPT)', width: sw * 0.15, key: 'dspt', align: 'right' },
        { header: 'Gap', width: sw * 0.13, key: 'gap', align: 'right' },
        { header: 'Total', width: sw * 0.15, key: 'total', align: 'right' },
      ],
      rows: [
        {
          prd: hrs(totals.prd),
          npt: hrs(totals.npt),
          wow: hrs(totals.wow),
          stby: hrs(totals.stby),
          dspt: hrs(totals.dspt),
          gap: hrs(gapMin),
          total: hrs(totals.totalMin),
        },
      ],
      tint: () => COLORS.fill,
    });
  }

  /* Kotak validasi --------------------------------------------------- */
  sectionTitle(doc, 'Validation');
  const isValid = totals.totalMin === 1440 && report.validation.ok;
  if (isValid) {
    note(doc, `Total ${hrs(totals.totalMin)} hrs - VALID`, 'info');
  } else {
    const issues = report.validation.issues.length
      ? report.validation.issues.map((i) => `[${i.severity.toUpperCase()}] ${i.code}: ${i.message}`).join('\n')
      : `Total ${hrs(totals.totalMin)} hrs (harus 24.00 hrs).`;
    note(doc, `NOT VALID\n${issues}`, 'error');
  }

  paragraph(
    doc,
    'Catatan: Formulir ini mengikuti struktur IADC-compatible (34 main code + sub-code). Ini BUKAN sertifikasi IADC resmi.',
    { size: 7.5, color: COLORS.muted },
  );

  /* Legend kode yang dipakai ----------------------------------------- */
  sectionTitle(doc, 'IADC Codes Used (Legend)');
  {
    const usedCodes = new Map<string, { code: string; name: string; cls: string; minutes: number }>();
    for (const r of report.timeRows) {
      const key = r.iadcCode;
      const cls = r.nptFlag ? 'NPT' : r.timeClass;
      const prev = usedCodes.get(key);
      if (prev) prev.minutes += r.durationMin;
      else usedCodes.set(key, { code: r.iadcCode, name: r.iadcName, cls, minutes: r.durationMin });
    }
    const legendRows = [...usedCodes.values()].map((e) => ({
      code: e.code,
      name: e.name,
      cls: e.cls,
      hours: hrs(e.minutes),
    }));
    const lw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    table(doc, {
      columns: [
        { header: 'Code', width: lw * 0.1, key: 'code', align: 'center' },
        { header: 'Description', width: lw * 0.6, key: 'name' },
        { header: 'Class', width: lw * 0.15, key: 'cls', align: 'center' },
        { header: 'Hours', width: lw * 0.15, key: 'hours', align: 'right' },
      ],
      rows: legendRows,
    });
  }

  /* Ringkasan POB & sign-off ---------------------------------------- */
  sectionTitle(doc, 'Personnel on Board & Sign-off');
  const companyMan = report.crew.find((c) => /company\s*man/i.test(c.position));
  const toolpusher = report.crew.find((c) => /toolpusher/i.test(c.position));
  const totalCrewHours = report.crew.reduce((acc, c) => acc + c.hours, 0);
  paragraph(
    doc,
    `POB: ${report.crew.length} persons | Total man-hours: ${totalCrewHours.toFixed(2)}h | Status: ${report.status.toUpperCase()}`,
    { size: 8.5 },
  );

  footerSignature(doc, {
    leftName: report.signatureName ?? companyMan?.name ?? '',
    leftRole: 'Operator Representative (Company Man)',
    rightName: toolpusher?.name ?? '',
    rightRole: 'Contractor Rig Manager (Toolpusher)',
    signedAt: report.submittedAt,
  });

  return docToBuffer(doc);
}
