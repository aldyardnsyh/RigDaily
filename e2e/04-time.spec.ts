import { test, expect } from '@playwright/test';
import { latestReportId, reportDetail } from './helpers/auth';

/** Time Breakdown: aturan 24 jam, overlap, gap, vendor (regresi P0-4). */
test.describe('Time Breakdown - validasi 24 jam', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/time');
    await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
  });

  test('halaman time menampilkan total 24 jam', async ({ page }) => {
    const id = await latestReportId(page);
    const d = (await reportDetail(page, id)) as { totalMinutes: number };
    expect(d.totalMinutes).toBe(1440);
    await expect(page.locator('main')).toContainText(/24[.,]0/);
  });

  test('PUT time dengan total kurang dari 24 jam ditolak (422)', async ({ page }) => {
    const id = await latestReportId(page);
    const d = (await reportDetail(page, id)) as { status: string; timeRows: Array<Record<string, unknown>> };
    test.skip(d.status !== 'draft', 'Laporan seed sudah final - endpoint menolak 409 sebelum validasi');

    const rows = d.timeRows.slice(0, 3).map((r) => ({
      start: r.start,
      end: r.end,
      iadcCode: r.iadcCode,
      iadcSubcode: r.iadcSubcode,
      vendor: r.vendor,
      nptFlag: r.nptFlag,
      remarks: r.remarks,
    }));
    const res = await page.request.put(`/api/reports/${id}/time`, { data: { rows } });
    expect([409, 422]).toContain(res.status());
  });

  test('PUT time dengan baris overlap ditolak', async ({ page }) => {
    const id = await latestReportId(page);
    const d = (await reportDetail(page, id)) as { status: string };
    test.skip(d.status !== 'draft', 'Butuh laporan draft');

    const res = await page.request.put(`/api/reports/${id}/time`, {
      data: {
        rows: [
          { start: '06:00', end: '12:00', iadcCode: '01', nptFlag: false },
          { start: '11:00', end: '18:00', iadcCode: '01', nptFlag: false },
          { start: '18:00', end: '06:00', iadcCode: '14', nptFlag: false },
        ],
      },
    });
    expect([409, 422]).toContain(res.status());
  });

  test('data time row menyimpan vendor (regresi P0-4)', async ({ page }) => {
    const id = await latestReportId(page);
    const d = (await reportDetail(page, id)) as { timeRows: Array<{ vendor: string | null; iadcSubcode: string | null }> };
    // Vendor dan sub-code adalah dua kolom terpisah; sub-code tidak boleh
    // menampung nama vendor (bug lama).
    for (const row of d.timeRows) {
      if (row.vendor && row.iadcSubcode) {
        expect(row.iadcSubcode).not.toBe(row.vendor);
      }
    }
    expect(d.timeRows.length).toBeGreaterThan(0);
  });

  test('editor time menampilkan kolom IADC', async ({ page }) => {
    await expect(page.locator('main')).toContainText(/IADC/i);
  });
});
