// Sederhanakan action bar DDR: 1 aksi utama + dropdown sekunder.
const fs = require('fs');

const f = 'apps/web/app/(app)/ddr/page.tsx';
let t = fs.readFileSync(f, 'utf8');

const startMarker = '        <span style={{ marginLeft: \'auto\', display: \'flex\', gap: 8, flexWrap: \'wrap\' }}>\n          <Button\n            data-testid="ddr-btn-save"';
const start = t.indexOf(startMarker);
if (start === -1) {
  console.log('GAGAL: action bar tidak ditemukan');
  process.exit(1);
}

// akhir blok: penutup span sebelum <p> deskripsi
const endMarker = '          )}\n        </span>\n      </div>\n      <p style={{ margin: 0, fontSize: 13, color: \'var(--text-secondary)\' }}>';
const end = t.indexOf(endMarker, start);
if (end === -1) {
  console.log('GAGAL: akhir action bar tidak ditemukan');
  process.exit(1);
}
const endPos = end + endMarker.indexOf('</span>') + '</span>'.length;

const replacement = `        <span
          style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}
        >
          {/*
            HIERARKI AKSI (mengurangi kebingungan):
            - 1 aksi UTAMA berwarna ( Submit / Setujui ) sesuai status laporan.
            - Aksi SEKUNDER dikelompokkan menjadi satu baris ringkas.
            - Aksi TERSIER (cetak) masuk dropdown agar tidak memenuhi header.
          */}
          {report && isDraft && (
            <Button
              data-testid="ddr-btn-save"
              variant="secondary"
              onClick={saveHeader}
              disabled={saving}
              title="Simpan perubahan header laporan"
            >
              <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}
            </Button>
          )}

          <Button
            data-testid="ddr-btn-validate"
            variant="secondary"
            onClick={runValidate}
            disabled={!report || validating}
            title="Periksa kelengkapan 24 jam dan isian wajib"
          >
            <SlidersHorizontal size={16} /> {validating ? 'Memeriksa...' : 'Periksa'}
          </Button>

          {report && AMENDABLE.has(report.status) && (
            <Button data-testid="ddr-btn-amend" variant="secondary" onClick={() => setAmendOpen(true)} title="Buat revisi baru dari laporan final">
              <PenTool size={16} /> Amendemen
            </Button>
          )}

          {report && (
            <details style={{ position: 'relative', display: 'inline-block' }}>
              <summary
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 'var(--control-h)',
                  padding: '0 12px',
                  borderRadius: 'var(--radius-btn)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-surface)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  listStyle: 'none',
                }}
                title="Unduh laporan sebagai PDF"
              >
                <Printer size={16} /> Cetak
              </summary>
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 4px)',
                  minWidth: 190,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-input)',
                  boxShadow: 'var(--shadow-pop)',
                  zIndex: 40,
                  padding: 4,
                }}
              >
                <a
                  href={apiUrl(\`/api/reports/\${report.id}/pdf?type=ddr\`)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'block', padding: '8px 10px', fontSize: 13, borderRadius: 4, color: 'var(--text-primary)' }}
                >
                  DDR (Daily Drilling Report)
                </a>
                <a
                  href={apiUrl(\`/api/reports/\${report.id}/pdf?type=iadc\`)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'block', padding: '8px 10px', fontSize: 13, borderRadius: 4, color: 'var(--text-primary)' }}
                >
                  IADC Time Sheet
                </a>
              </div>
            </details>
          )}

          {report?.status === 'submitted' && (
            <Button
              data-testid="ddr-btn-approve"
              onClick={() => setApproveOpen(true)}
              disabled={!canApprove}
              title={canApprove ? 'Setujui dan tanda tangani laporan' : roleReason('report:approve')}
            >
              <PenTool size={16} /> Setujui
            </Button>
          )}

          {report && isDraft && (
            <Button
              data-testid="ddr-btn-submit"
              onClick={submit}
              disabled={submitting || !report.validation.ok}
              title={!report.validation.ok ? 'Validasi 24 jam belum lolos. Perbaiki Time Breakdown lebih dulu.' : 'Kirim laporan untuk disetujui'}
            >
              <Send size={16} /> {submitting ? 'Mengirim...' : 'Kirim'}
            </Button>
          )}
        </span>`;

t = t.slice(0, start) + replacement + t.slice(endPos);

fs.writeFileSync(f, t, 'utf8');
console.log('Action bar DDR disederhanakan: hierarki utama/sekunder/tersier');
