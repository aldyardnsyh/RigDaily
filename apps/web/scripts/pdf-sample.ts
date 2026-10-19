/**
 * Script verifikasi generator PDF (CLI).
 *
 * Jalankan dari root repo:
 *   npx tsx apps/web/scripts/pdf-sample.ts
 *
 * Env dev (PGlite):
 *   $env:DATABASE_URL=""; $env:RIGDAILY_DRIVER="pglite"
 *   $env:PGLITE_DIR="D:\...\rimbase-rebuild\.pglite-data"
 *
 * Yang dilakukan:
 *   1. Ambil DDR #145 dari repository.
 *   2. Generate ddr.pdf & iadc.pdf ke folder `artifacts/`.
 *   3. Print path + ukuran byte + jumlah halaman.
 *   4. Assert total durasi (durationMin) = 1440 menit (24.00h).
 *
 * Catatan tsx: alias "@/..." tidak aktif di sini, jadi impor pakai path relatif.
 * Script ini BUKAN server component, jadi tidak memakai `server-only`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listReports, getReportById } from '../lib/repo/index';
import { generateDdrPdf, generateIadcPdf } from '../lib/pdf/index';
import type { ReportDetail } from '../lib/repo/types';

/** Root repo = naik 3 level dari apps/web/scripts. */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const artifactsDir = path.join(repoRoot, 'artifacts');

/** Hitung jumlah halaman dari objek PDF minim (hitung "/Type /Page" tanpa /Pages). */
function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

async function findReportNo(reportNo: number): Promise<ReportDetail> {
  // Dataset demo kecil; ambil sekumpulan lalu cari nomor yang diminta.
  const { items } = await listReports({ limit: 500 });
  const target = items.find((r) => r.reportNo === reportNo);
  if (!target) {
    throw new Error(`Laporan DDR #${reportNo} tidak ditemukan di database (total ${items.length} laporan).`);
  }
  const detail = await getReportById(target.id);
  if (!detail) {
    throw new Error(`Detail laporan #${reportNo} (id ${target.id}) tidak dapat dimuat.`);
  }
  return detail;
}

async function main(): Promise<void> {
  const report = await findReportNo(145);

  const sumMinutes = report.timeRows.reduce((acc, r) => acc + r.durationMin, 0);

  await mkdir(artifactsDir, { recursive: true });

  const ddrBuf = await generateDdrPdf(report);
  const iadcBuf = await generateIadcPdf(report);

  const ddrPath = path.join(artifactsDir, `ddr-${report.wellName}-${report.reportNo}.pdf`);
  const iadcPath = path.join(artifactsDir, `iadc-${report.wellName}-${report.reportNo}.pdf`);

  await writeFile(ddrPath, ddrBuf);
  await writeFile(iadcPath, iadcBuf);

  const ddrPages = countPdfPages(ddrBuf);
  const iadcPages = countPdfPages(iadcBuf);

  /* ---- Laporan ke stdout ---- */
  console.log('=== RigDaily PDF sample ===');
  console.log(`Report       : DDR #${report.reportNo} - ${report.wellName} (${report.reportDate})`);
  console.log(`Rig          : ${report.rigName ?? '-'}`);
  console.log(`Time rows    : ${report.timeRows.length}`);
  console.log('');
  console.log(`DDR  -> ${ddrPath}`);
  console.log(`        ${ddrBuf.length} bytes, ${ddrPages} page(s)`);
  console.log(`IADC -> ${iadcPath}`);
  console.log(`        ${iadcBuf.length} bytes, ${iadcPages} page(s)`);
  console.log('');

  /* ---- Assertions ---- */
  const errors: string[] = [];

  if (sumMinutes !== 1440) {
    errors.push(`Total durasi HARUS 1440 menit, dapat ${sumMinutes} menit.`);
  }
  if (ddrBuf.length <= 5 * 1024) {
    errors.push(`ddr.pdf terlalu kecil (${ddrBuf.length} bytes), harus > 5 KB.`);
  }
  if (iadcBuf.length <= 5 * 1024) {
    errors.push(`iadc.pdf terlalu kecil (${iadcBuf.length} bytes), harus > 5 KB.`);
  }
  if (!ddrBuf.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
    errors.push('ddr.pdf tidak diawali magic %PDF-.');
  }
  if (!iadcBuf.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
    errors.push('iadc.pdf tidak diawali magic %PDF-.');
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`FAIL: ${e}`);
    process.exitCode = 1;
    return;
  }

  console.log(`TOTAL ${sumMinutes} menit OK (sum durationMin = ${sumMinutes} = 24.00h)`);
  console.log('Semua verifikasi lolos.');
}

main().catch((err) => {
  console.error('ERROR:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
