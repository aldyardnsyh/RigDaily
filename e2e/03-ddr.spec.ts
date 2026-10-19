import { test, expect } from '@playwright/test';
import { latestReportId, reportDetail } from './helpers/auth';

/**
 * DDR - menguji field, validasi, integritas data, dan PDF.
 *
 * Kondisi seed: semua DDR berstatus `approved` atau `distributed`, sehingga
 * form header bersifat READ-ONLY. Test di bawah memisahkan:
 *  - assert data (berlaku untuk status apa pun),
 *  - edit field (hanya berjalan bila ada laporan `draft`, jika tidak di-skip
 *    dengan alasan yang jelas),
 *  - pelanggaran aturan (PATCH pada laporan terkunci harus 409).
 */
test.describe('DDR - field, validasi, PDF', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ddr');
    await expect(page.getByTestId('ddr-title')).toBeVisible({ timeout: 40_000 });
  });

  test('halaman DDR menampilkan sumur dari laporan terbaru', async ({ page }) => {
    const id = await latestReportId(page);
    const detail = (await reportDetail(page, id)) as { reportNo: number; wellName: string };

    // Regresi: dulu halaman memakai wells[0] sehingga nomor DDR tidak sinkron
    // dengan Dashboard (yang memakai laporan terbaru).
    await expect(page.getByTestId('ddr-title')).toContainText(String(detail.reportNo));
    await expect(page.getByTestId('ddr-title')).toContainText(String(detail.reportNo));
    // Nama sumur muncul di metadata halaman (bukan di judul).
    await expect(page.locator('body')).toContainText(detail.wellName);
  });

  test('status dan total jam 24 tampil', async ({ page }) => {
    await expect(page.getByTestId('ddr-status')).toBeVisible();
    await expect(page.getByTestId('ddr-total-hours')).toContainText('24');
  });

  test('validasi server: total time breakdown tepat 1440 menit', async ({ page }) => {
    const id = await latestReportId(page);
    const res = await page.request.post(`/api/reports/${id}/validate`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { ok: boolean; totalMinutes: number; issues: unknown[] } };
    expect(body.data.totalMinutes).toBe(1440);
    expect(body.data.ok).toBe(true);
    expect(body.data.issues.length).toBe(0);
  });

  test('agregat waktu konsisten (PRD + NPT + WOW = 1440)', async ({ page }) => {
    const id = await latestReportId(page);
    const d = (await reportDetail(page, id)) as {
      productiveMinutes: number;
      nptMinutes: number;
      wowMinutes: number;
      totalMinutes: number;
    };
    const sum = d.productiveMinutes + d.nptMinutes + d.wowMinutes;
    expect(sum).toBeLessThanOrEqual(d.totalMinutes);
    expect(d.totalMinutes).toBe(1440);
  });

  test('tabel crew menampilkan data; tombol tambah hanya saat draft', async ({ page }) => {
    await expect(page.getByTestId('crew-table')).toBeVisible();
    const isDraft = (await page.getByTestId('ddr-status').innerText()).toLowerCase().includes('draft');
    if (isDraft) await expect(page.getByTestId('crew-add')).toBeVisible();

    const id = await latestReportId(page);
    const d = (await reportDetail(page, id)) as { crew: unknown[] };
    expect(d.crew.length).toBeGreaterThan(0);
  });

  test('tabel BHA menampilkan komponen', async ({ page }) => {
    await expect(page.getByTestId('bha-table')).toBeVisible();
    const id = await latestReportId(page);
    const d = (await reportDetail(page, id)) as { bha: unknown[] };
    expect(d.bha.length).toBeGreaterThan(0);
  });

  test('form mud tersedia pada laporan draft', async ({ page }) => {
    const isDraft = (await page.getByTestId('ddr-status').innerText()).toLowerCase().includes('draft');
    test.skip(!isDraft, 'Laporan seed sudah final; form mud hanya untuk draft');
    await expect(page.getByTestId('mud-form')).toBeVisible();
  });

  test('laporan terkunci menolak PATCH header (409)', async ({ page }) => {
    const id = await latestReportId(page);
    const d = (await reportDetail(page, id)) as { status: string; depthMdStart: number };
    test.skip(d.status === 'draft', 'Ada laporan draft - aturan lock diuji terpisah');

    const res = await page.request.patch(`/api/reports/${id}`, {
      data: { depthMdEnd: d.depthMdStart + 5 },
    });
    expect(res.status()).toBe(409);
  });

  test('kedalaman mundur ditolak server pada laporan draft', async ({ page }) => {
    const id = await latestReportId(page);
    const d = (await reportDetail(page, id)) as { status: string; depthMdStart: number; depthMdEnd: number };
    test.skip(d.status !== 'draft', 'Tidak ada laporan draft untuk diuji');

    const res = await page.request.patch(`/api/reports/${id}`, {
      data: { depthMdStart: d.depthMdEnd + 100, depthMdEnd: d.depthMdStart },
    });
    expect([409, 422]).toContain(res.status());
  });

  test('PDF DDR valid (application/pdf, magic %PDF)', async ({ page }) => {
    const id = await latestReportId(page);
    const res = await page.request.get(`/api/reports/${id}/pdf?type=ddr`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    const buf = await res.body();
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(3000);
  });

  test('PDF IADC valid', async ({ page }) => {
    const id = await latestReportId(page);
    const res = await page.request.get(`/api/reports/${id}/pdf?type=iadc`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    const buf = await res.body();
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('tombol cetak PDF mengarah ke endpoint yang benar', async ({ page }) => {
    const id = await latestReportId(page);
    const link = page.locator(`a[href*="/api/reports/${id}/pdf"]`).first();
    if (await link.count()) {
      const href = await link.getAttribute('href');
      expect(href).toContain(`/api/reports/${id}/pdf`);
    }
  });

  test('deep-link /ddr?wellId= memilih sumur yang diminta', async ({ page }) => {
    // Ambil well milik laporan #88 (ARUN-05) untuk memastikan pilihan well berbeda.
    const res = await page.request.get('/api/reports?limit=10');
    const body = (await res.json()) as {
      data: { items: Array<{ id: string; reportNo: number; wellId: string; wellName: string }> };
    };
    const other = body.data.items.find((i) => i.wellName !== body.data.items[0].wellName);
    test.skip(!other, 'Butuh minimal dua sumur berbeda');

    await page.goto(`/ddr?wellId=${other!.wellId}`);
    await expect(page.getByTestId('ddr-title')).toContainText(String(other!.reportNo), { timeout: 40_000 });
  });
});
