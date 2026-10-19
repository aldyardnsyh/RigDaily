/**
 * Generator PDF DAILY DRILLING REPORT (DDR) - SERVER ONLY.
 *
 * Urutan seksi WAJIB sama dengan form di UI (01..09 + sign-off).
 * Semua angka diturunkan dari `report` (DTO repo) yang sudah memakai
 * `@rigdaily/shared` di layer data, sehingga identik dengan layar.
 */
import 'server-only';
import { formatUsd } from '@rigdaily/shared';
import type { ReportDetail, TimeRowDto } from '../repo/types';
import {
  COLORS,
  createDoc,
  docToBuffer,
  footerSignature,
  header,
  kvGrid,
  note,
  paragraph,
  sectionTitle,
  setFootnote,
  table,
  type Doc,
} from './layout';

/* ------------------------------------------------------------------ */
/* Helper angka                                                        */
/* ------------------------------------------------------------------ */

const hoursFmt = (minutes: number): string => `${(minutes / 60).toFixed(2)}h`;
const num = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined ? '-' : v.toFixed(digits));

type ClassTotals = {
  totalMin: number;
  prd: number;
  npt: number;
  wow: number;
  fm: number;
  stby: number;
  dspt: number;
};

/**
 * Agregat kelas waktu LANGSUNG dari `durationMin` per baris (bukan dihitung ulang
 * dari string jam) agar identik dengan layar. Kelas diambil dari `timeClass`
 * tersimpan; `nptFlag` mengalahkan kelas (kebijakan perusahaan) - parcaya dengan
 * `totalsFromTimeRows()` di repo.
 */
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

/* ------------------------------------------------------------------ */
/* Baris tabel                                                         */
/* ------------------------------------------------------------------ */

type Row = Record<string, string>;

function depthRows(report: ReportDetail): Array<{ k: string; v: string }> {
  return [
    { k: 'Depth Start (MD)', v: `${num(report.depthMdStart)} m` },
    { k: 'Depth End (MD)', v: `${num(report.depthMdEnd)} m` },
    { k: 'Depth (TVD)', v: report.depthTvd !== null ? `${num(report.depthTvd)} m` : '-' },
    { k: 'Progress 24h', v: `${report.progress24h >= 0 ? '+' : ''}${num(report.progress24h)} m` },
    { k: 'Status', v: report.status.toUpperCase() },
  ];
}

function timeRowToRow(r: TimeRowDto): Row {
  return {
    start: r.start,
    end: r.end,
    hours: (r.durationMin / 60).toFixed(2),
    iadc: r.iadcCode,
    cls: r.nptFlag ? 'NPT' : r.timeClass,
    remarks: r.remarks ?? '',
  };
}

function equipmentRows(report: ReportDetail): Row[] {
  const eq = report.equipmentStatus ?? {};
  const entries = Object.entries(eq);
  if (entries.length === 0) return [];
  return entries.map(([key, value]) => {
    const raw = String(value ?? '');
    const status = /deg|fail|down|leak|pulsat|rusak|trouble/i.test(raw) ? 'Degraded' : 'OK';
    // Nilai mentah sering berformat "OK - detail"; buang prefix status bila ada.
    const detail = raw.replace(/^\s*(OK|Degraded)\s*[--:]*\s*/i, '');
    return { equipment: key, status, detail };
  });
}

/* ------------------------------------------------------------------ */
/* Generator                                                           */
/* ------------------------------------------------------------------ */

export async function generateDdrPdf(report: ReportDetail): Promise<Buffer> {
  const doc: Doc = createDoc();

  setFootnote(doc, `DDR #${report.reportNo} - ${report.wellName}`);

  /* Header ---------------------------------------------------------- */
  header(doc, {
    title: 'DAILY DRILLING REPORT',
    subtitle: 'RigDaily - Daily Operations & Cost Report',
    reportNo: report.reportNo,
    reportDate: report.reportDate,
    wellName: report.wellName,
    rigName: report.rigName ?? '-',
    period: `${report.periodFrom}-${report.periodTo}`,
  });

  const totals = totalsFromRows(report.timeRows);

  /* 01 General Information & Progress ------------------------------- */
  sectionTitle(doc, '01  General Information & Progress');
  kvGrid(doc, depthRows(report), 5);

  /* 02 Rig Crew & POB ----------------------------------------------- */
  sectionTitle(doc, '02  Rig Crew & POB');
  if (report.crew.length === 0) {
    paragraph(doc, 'No crew recorded for this report.', { color: COLORS.muted });
  } else {
    const crewRows: Row[] = report.crew.map((c) => ({
      name: c.name,
      position: c.position,
      company: c.company ?? '-',
      shift: c.shift,
      hours: c.hours.toFixed(2),
    }));
    const totalCrewHours = report.crew.reduce((acc, c) => acc + c.hours, 0);
    const totalManMinutes = totalCrewHours * 60;
    crewRows.push({
      name: 'TOTAL',
      position: `${report.crew.length} persons`,
      company: '',
      shift: '',
      hours: totalCrewHours.toFixed(2),
    });
    const cw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    table(doc, {
      columns: [
        { header: 'Name', width: cw * 0.26, key: 'name' },
        { header: 'Position', width: cw * 0.24, key: 'position' },
        { header: 'Company', width: cw * 0.26, key: 'company' },
        { header: 'Shift', width: cw * 0.1, key: 'shift' },
        { header: 'Hours', width: cw * 0.14, key: 'hours', align: 'right' },
      ],
      rows: crewRows,
      tint: (row) => (row.name === 'TOTAL' ? COLORS.fill : null),
    });
    paragraph(doc, `Total man-hours: ${hoursFmt(totalManMinutes)} (${totalManMinutes.toFixed(0)} min)`, { bold: true });
  }

  /* 03 Drilling Progress & Mud -------------------------------------- */
  sectionTitle(doc, '03  Drilling Progress & Mud');
  if (report.summary && report.summary.trim().length > 0) {
    paragraph(doc, report.summary, { size: 8.5 });
  }

  // Bit / pump parameters yang tersedia dari data BHA & mud.
  const bhaBit = report.bha.find((b) => /bit/i.test(b.component));
  if (report.bha.length > 0) {
    paragraph(doc, 'Bottom Hole Assembly (BHA)', { size: 8, bold: true, color: COLORS.muted });
    const bw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    table(doc, {
      columns: [
        { header: '#', width: bw * 0.06, key: 'no', align: 'center' },
        { header: 'Component', width: bw * 0.5, key: 'component' },
        { header: 'OD (in)', width: bw * 0.12, key: 'od', align: 'right' },
        { header: 'Length (m)', width: bw * 0.16, key: 'length', align: 'right' },
        { header: 'Hours', width: bw * 0.16, key: 'hours', align: 'right' },
      ],
      rows: report.bha.map((b) => ({
        no: String(b.sortOrder),
        component: b.component,
        od: b.odIn !== null ? b.odIn.toFixed(2) : '-',
        length: b.lengthM !== null ? b.lengthM.toFixed(2) : '-',
        hours: b.hours !== null ? b.hours.toFixed(2) : '-',
      })),
    });
    if (bhaBit) paragraph(doc, `Active bit: ${bhaBit.component}`, { size: 8, color: COLORS.muted });
  }

  if (report.mud) {
    const m = report.mud;
    paragraph(doc, 'Mud Record', { size: 8, bold: true, color: COLORS.muted });
    const mw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    table(doc, {
      columns: [
        { header: 'MW (ppg)', width: mw * 0.11, key: 'mw', align: 'right' },
        { header: 'Visc (s/qt)', width: mw * 0.12, key: 'visc', align: 'right' },
        { header: 'pH', width: mw * 0.08, key: 'ph', align: 'right' },
        { header: 'PV', width: mw * 0.09, key: 'pv', align: 'right' },
        { header: 'YP', width: mw * 0.09, key: 'yp', align: 'right' },
        { header: 'Chemicals', width: mw * 0.34, key: 'chem' },
        { header: 'Cost (USD)', width: mw * 0.17, key: 'cost', align: 'right' },
      ],
      rows: [
        {
          mw: num(m.weightPpg, 2),
          visc: num(m.viscositySecQt, 0),
          ph: num(m.ph, 1),
          pv: num(m.pv, 0),
          yp: num(m.yp, 0),
          chem: m.chemicalsAdded ?? '-',
          cost: formatUsd(m.costUsd ?? 0),
        },
      ],
    });
  }

  /* 04 Geology ------------------------------------------------------ */
  sectionTitle(doc, '04  Geology');
  paragraph(doc, report.geologyNotes && report.geologyNotes.trim() ? report.geologyNotes : 'No geology notes recorded.', {
    size: 8.5,
    color: report.geologyNotes && report.geologyNotes.trim() ? COLORS.ink : COLORS.muted,
  });

  /* 05 Time Breakdown 24h ------------------------------------------- */
  sectionTitle(doc, '05  Time Breakdown 24h');

  if (report.validation.ok === false) {
    const issues = report.validation.issues.length
      ? report.validation.issues.map((i) => `[${i.severity.toUpperCase()}] ${i.code}: ${i.message}`).join('\n')
      : 'Time breakdown belum valid 24.00h.';
    note(doc, `VALIDATION ISSUES\n${issues}`, 'error');
  } else {
    note(doc, `Total ${(totals.totalMin / 60).toFixed(2)}h - VALID (24.00h complete)`, 'info');
  }

  {
    const tw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const rows: Row[] = report.timeRows.map(timeRowToRow);
    rows.push({
      start: '',
      end: '',
      hours: (totals.totalMin / 60).toFixed(2),
      iadc: '',
      cls: 'TOTAL',
      remarks: `PRD ${hoursFmt(totals.prd)} | NPT ${hoursFmt(totals.npt)} | WOW ${hoursFmt(totals.wow)}`,
    });
    table(doc, {
      columns: [
        { header: 'Start', width: tw * 0.08, key: 'start', align: 'center' },
        { header: 'End', width: tw * 0.08, key: 'end', align: 'center' },
        { header: 'Hours', width: tw * 0.08, key: 'hours', align: 'right' },
        { header: 'IADC', width: tw * 0.07, key: 'iadc', align: 'center' },
        { header: 'Class', width: tw * 0.1, key: 'cls', align: 'center' },
        { header: 'Remarks', width: tw * 0.59, key: 'remarks' },
      ],
      rows,
      tint: (row) => {
        if (row.cls === 'TOTAL') return COLORS.fill;
        if (row.cls === 'NPT') return '#FBEAEA';
        return null;
      },
    });
  }

  /* 06 Operations Summary & Equipment ------------------------------- */
  sectionTitle(doc, '06  Operations Summary & Equipment');
  paragraph(doc, report.summary && report.summary.trim() ? report.summary : 'No summary recorded.', {
    size: 8.5,
    color: report.summary && report.summary.trim() ? COLORS.ink : COLORS.muted,
  });

  {
    const eqRows = equipmentRows(report);
    if (eqRows.length === 0) {
      paragraph(doc, 'No equipment status recorded.', { size: 8.5, color: COLORS.muted });
    } else {
      const ew = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      table(doc, {
        columns: [
          { header: 'Equipment', width: ew * 0.34, key: 'equipment' },
          { header: 'Status', width: ew * 0.14, key: 'status', align: 'center' },
          { header: 'Detail', width: ew * 0.52, key: 'detail' },
        ],
        rows: eqRows,
        tint: (row) => (row.status === 'Degraded' ? '#FBEAEA' : null),
      });
    }
  }

  /* 07 Cost --------------------------------------------------------- */
  sectionTitle(doc, '07  Cost');
  {
    const cw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const rows: Row[] = report.costLines.map((l) => ({
      category: l.category,
      description: l.description,
      vendor: l.vendor ?? '-',
      afe: l.afeCode ?? '-',
      amount: formatUsd(l.amount),
    }));
    const dailyTotal = report.costLines.reduce((acc, l) => acc + l.amount, 0);
    rows.push({ category: 'SUBTOTAL DAILY', description: '', vendor: '', afe: '', amount: formatUsd(dailyTotal) });
    rows.push({ category: 'CUMULATIVE', description: '', vendor: '', afe: '', amount: formatUsd(report.costCumulativeUsd) });

    table(doc, {
      columns: [
        { header: 'Category', width: cw * 0.18, key: 'category' },
        { header: 'Description', width: cw * 0.34, key: 'description' },
        { header: 'Vendor', width: cw * 0.24, key: 'vendor' },
        { header: 'AFE', width: cw * 0.11, key: 'afe' },
        { header: 'Amount (USD)', width: cw * 0.13, key: 'amount', align: 'right' },
      ],
      rows,
      tint: (row) => (row.category === 'SUBTOTAL DAILY' || row.category === 'CUMULATIVE' ? COLORS.fill : null),
    });

    paragraph(doc, `Subtotal daily: ${formatUsd(dailyTotal)}    Cumulative: ${formatUsd(report.costCumulativeUsd)}`, { bold: true });
  }

  /* 08 Plans for Next 24h ------------------------------------------- */
  sectionTitle(doc, '08  Plans for Next 24h');
  paragraph(doc, report.planNext && report.planNext.trim() ? report.planNext : 'No plan recorded.', {
    size: 8.5,
    color: report.planNext && report.planNext.trim() ? COLORS.ink : COLORS.muted,
  });

  /* 09 Safety ------------------------------------------------------- */
  sectionTitle(doc, '09  Safety');
  if (report.incidents.length === 0) {
    note(doc, 'No incidents recorded', 'info');
  } else {
    const iw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    table(doc, {
      columns: [
        { header: 'Ref No', width: iw * 0.12, key: 'ref' },
        { header: 'Type', width: iw * 0.18, key: 'type' },
        { header: 'Severity', width: iw * 0.1, key: 'severity', align: 'center' },
        { header: 'Status', width: iw * 0.1, key: 'status', align: 'center' },
        { header: 'Corrective Action', width: iw * 0.5, key: 'corrective' },
      ],
      rows: report.incidents.map((i) => ({
        ref: i.refNo ?? '-',
        type: i.type,
        severity: i.severity,
        status: i.status,
        corrective: i.correctiveAction ?? i.description ?? '-',
      })),
    });
  }

  /* Sign-off -------------------------------------------------------- */
  sectionTitle(doc, 'Sign-off');
  const companyMan = report.crew.find((c) => /company\s*man/i.test(c.position));
  const toolpusher = report.crew.find((c) => /toolpusher/i.test(c.position));

  footerSignature(doc, {
    leftName: report.signatureName ?? companyMan?.name ?? '',
    leftRole: 'Operator Representative (Company Man)',
    rightName: toolpusher?.name ?? '',
    rightRole: 'Contractor Rig Manager (Toolpusher)',
    signedAt: report.submittedAt,
  });

  return docToBuffer(doc);
}
