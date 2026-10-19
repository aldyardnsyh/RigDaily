'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Layers,
  RefreshCw,
  Search,
  Send,
  Shield,
  Ship,
  Timer,
  UploadCloud,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card } from '@rigdaily/ui';
import { formatMeters, formatUsd } from '@rigdaily/shared';
import { StatusBadge } from '@/components/StatusBadge';
import { Labeled, Modal, Note, inStyle } from '@/components/controls';
import { apiSend, apiUrl } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import type {
  DeliveryLogDto,
  DistributionRuleDto,
  ReportListItem,
  WellDto,
} from '@/lib/repo/types';

type ReportsList = { items: ReportListItem[]; total: number };
type RulesPayload = { rules: DistributionRuleDto[]; deliveryLog: DeliveryLogDto[] };
type MePayload = { permissions: string[] };

/** Respons `POST /api/reports/distribute`. */
type DispatchResult = {
  queued: number;
  sent: number;
  failed: number;
  /** Pasangan rule+laporan yang dilewati karena sudah queued/sent (anti-duplikat). */
  skipped: number;
  details: Array<{ ruleId: string; ruleName: string; reportId: string; recipients: string[]; status: string; message?: string }>;
};

/** Respons `POST /api/master/rules/delivery/[id]/retry`. */
type RetryResult = { status: 'sent' | 'queued' | 'failed'; message?: string };

/** Respons `POST /api/reports/import`. */
type ImportResult = {
  batchId: string;
  rowCount: number;
  inserted: number;
  errorCount: number;
  errors: Array<{ row: number; message: string }>;
  /** Jumlah DDR yang cost-nya terisi dari kolom cost CSV. */
  costFilled: number;
  /** Pesan jujur bila cost tidak terisi dari CSV (null = terisi). */
  costNotice: string | null;
};

/**
 * Kolom wajib CSV impor legacy (cermin `apps/web/lib/reports/importer.ts`).
 * Alias nama kolom umum juga diterima: Date/Tanggal, Start Depth/From,
 * End Depth/To, From Time, IADC, Report No, Remarks/Description, dll.
 */
const IMPORT_HEADER = 'report_date,depth_md_start,depth_md_end,start,end,iadc_code,remarks';

type FilterId = 'all' | 'drilling' | 'cost' | 'downtime';

/**
 * Chip filter = turunan dari ANGKA laporan yang memang ada di `ReportListItem`
 * (bukan tebakan manual):
 *   - `drilling` selalu ada (setiap laporan punya kedalaman);
 *   - `cost` bila ada biaya harian;
 *   - `downtime` bila NPT + WOW > 0.
 *
 * P1-8 - chip `Safety` DIHAPUS dengan sengaja.
 *   Versi lama menguji `/\b(hse|safety|incident|...)\b/` terhadap `r.status`,
 *   padahal `status` hanya berisi `draft|submitted|approved|distributed|locked`
 *   → hasil filter SELALU kosong (tombol yang tidak bekerja = menipu user).
 *   `ReportListItem` tidak membawa data insiden, jadi filter berbasis insiden
 *   baru bisa disediakan setelah repo/API mendukung `hasIncident` (di luar
 *   lingkup perbaikan ini). Daripada chip palsu, chip dihapus. Register insiden
 *   tetap bisa dibuka dari template "Safety Incidents" di bawah.
 */
const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'drilling', label: 'Pemboran' },
  { id: 'cost', label: 'Biaya' },
  { id: 'downtime', label: 'Downtime (NPT)' },
];

function categoriesOf(r: ReportListItem): FilterId[] {
  const out: FilterId[] = ['drilling'];
  if (r.costDailyUsd > 0) out.push('cost');
  if (r.nptPercent > 0) out.push('downtime');
  return out;
}

type TemplateCard = {
  title: string;
  href: string;
  icon: React.ReactNode;
  note: string;
  /** `null` bila dokumen belum bisa digenerate langsung (bukan klaim palsu). */
  pdfType: 'ddr' | 'iadc' | null;
};

const TEMPLATES: TemplateCard[] = [
  {
    title: 'Operasi Pemboran Harian',
    href: '/ddr',
    icon: <FileText size={18} aria-hidden />,
    note: 'Buka DDR aktif, lalu cetak dari halaman DDR.',
    pdfType: 'ddr',
  },
  {
    title: 'Biaya Harian',
    href: '/cost',
    icon: <FileSpreadsheet size={18} aria-hidden />,
    note: 'Ledger biaya harian + AFE.',
    pdfType: null,
  },
  {
    title: 'Analisis NPT',
    href: '/time',
    icon: <AlertTriangle size={18} aria-hidden />,
    note: 'Rincian IADC 24 jam (PRD/NPT/WOW).',
    pdfType: 'iadc',
  },
  {
    title: 'Ringkasan Sumur',
    href: '/well-file',
    icon: <Layers size={18} aria-hidden />,
    note: 'Dossier sumur, casing, dan litologi.',
    pdfType: null,
  },
  {
    title: 'Analisis Biaya',
    href: '/cost',
    icon: <Banknote size={18} aria-hidden />,
    note: 'Tren belanja vs AFE.',
    pdfType: null,
  },
  {
    title: 'Analisis Downtime',
    href: '/time',
    icon: <Timer size={18} aria-hidden />,
    note: 'Analisis downtime & NPT per kejadian.',
    pdfType: null,
  },
  {
    title: 'Insiden Keselamatan',
    href: '/safety-survey',
    icon: <Shield size={18} aria-hidden />,
    note: 'Register insiden HSE & survey.',
    pdfType: null,
  },
  {
    title: 'POB',
    href: '/safety-survey',
    icon: <ArrowLeftRight size={18} aria-hidden />,
    note: 'Personel di rig (POB) per tor.',
    pdfType: null,
  },
  {
    title: 'Ringkasan Billing',
    href: '/billing',
    icon: <FileSpreadsheet size={18} aria-hidden />,
    note: 'Billing bulanan rate card bertingkat.',
    pdfType: null,
  },
  {
    title: 'Lembar Waktu IADC',
    href: '/time',
    icon: <Ship size={18} aria-hidden />,
    note: 'Lembar waktu IADC-compatible untuk diunduh.',
    pdfType: 'iadc',
  },
];

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function SkeletonBlock({ h, w = '100%' }: { h: number; w?: number | string }) {
  return (
    <div aria-hidden style={{ height: h, width: w, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
  );
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger-deep)' }}>
        {message}
      </p>
      <p style={{ margin: '10px 0 0' }}>
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden /> Coba lagi
        </Button>
      </p>
    </Card>
  );
}

const DELIVERY_STYLE: Record<string, { background: string; color: string }> = {
  sent: { background: 'var(--success-soft)', color: 'var(--success)' },
  failed: { background: 'var(--danger-soft)', color: 'var(--danger)' },
  queued: { background: 'var(--warning-soft)', color: 'var(--warning)' },
};

function deliveryStyle(status: string): React.CSSProperties {
  const key = status.trim().toLowerCase();
  const style = DELIVERY_STYLE[key];
  if (style) return style;
  return { background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' };
}

function formatIso(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function ReportsPage() {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<FilterId>('all');

  const reports = useApi<ReportsList>('/api/reports?limit=50');
  const rules = useApi<RulesPayload>('/api/master/rules');  const me = useApi<MePayload>('/api/auth/me');

  /* ---------- Run Distribution & Impor CSV Legacy ---------- */
  const canDistribute = me.data?.permissions.includes('report:distribute') ?? false;
  const canImport = (me.data?.permissions.includes('report:create') ?? false) && (me.data?.permissions.includes('master:manage') ?? false);

  const [distBusy, setDistBusy] = useState(false);
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);
  const [distResult, setDistResult] = useState<DispatchResult | null>(null);
  /** Baris Delivery Log yang sedang dikirim ulang (disable tombol + spinner). */
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importWellId, setImportWellId] = useState('');
  const [importCsv, setImportCsv] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const wells = useApi<WellDto[]>(importOpen ? '/api/wells' : null);

  const items = useMemo(() => reports.data?.items ?? [], [reports.data]);
  const latest = items[0] ?? null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      const cats = categoriesOf(r);
      if (cat !== 'all' && !cats.includes(cat)) return false;
      if (!q) return true;
      return (
        r.wellName.toLowerCase().includes(q) ||
        (r.rigName ?? '').toLowerCase().includes(q) ||
        String(r.reportNo).includes(q) ||
        r.reportDate.includes(q)
      );
    });
  }, [items, cat, query]);

  const ruleList = rules.data?.rules ?? [];
  const deliveryLog = rules.data?.deliveryLog ?? [];
  const activeRules = ruleList.filter((r) => r.active).length;

  function refreshAll() {
    reports.reload();
    rules.reload();
    toast.success('Daftar laporan dan status distribusi dimuat ulang.');
  }

  function openTemplatePdf(template: TemplateCard) {
    if (!template.pdfType) {
      toast.info(`"${template.title}" belum punya generator PDF; buka modul terkait dari hasil klik tombol "Buka modul".`);
      return;
    }
    if (!latest) {
      toast.info('Belum ada laporan untuk dijadikan dasar file PDF. Buat DDR terlebih dahulu.');
      return;
    }
    window.open(
      apiUrl(`/api/reports/${latest.id}/pdf?type=${template.pdfType}`),
      '_blank',
      'noopener',
    );
  }

  /* ---------- Run Distribution ---------- */
  async function runDistribution() {
    setDistBusy(true);
    setDistResult(null);
    try {
      const result = await apiSend<DispatchResult>('/api/reports/distribute', 'POST', { dryRun: false });
      setDistResult(result);
      const summary =
        `Distribusi: ${result.sent} terkirim · ${result.queued} dalam antrean · ${result.failed} gagal` +
        (result.skipped > 0 ? ` · ${result.skipped} dilewati (sudah ada)` : '');
      if (result.failed > 0) toast.warning(summary);
      else if (result.queued > 0 || result.skipped > 0) toast.info(summary);
      else toast.success(summary);
      rules.reload();
      reports.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menjalankan distribusi. Periksa aturan distribusi lalu coba lagi.');
    } finally {
      setDistBusy(false);
    }
  }

  /* ---------- Kirim ulang satu baris Delivery Log (P1-6) ---------- */
  async function retryDelivery(entry: DeliveryLogDto) {
    setRetryingId(entry.id);
    try {
      const result = await apiSend<RetryResult>(
        `/api/master/rules/delivery/${entry.id}/retry`,
        'POST',
      );
      const detail = result.message ? ` ${result.message}` : '';
      if (result.status === 'sent') toast.success(`Email terkirim ulang.${detail}`);
      else if (result.status === 'failed') toast.error(`Email gagal dikirim ulang.${detail}`);
      else toast.info(`Email masih dalam antrean.${detail}`);
      // Muat ulang log supaya status/attempts yang tampil berasal dari server.
      rules.reload();
      reports.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengirim ulang email. Periksa konfigurasi email lalu coba lagi.');
    } finally {
      setRetryingId(null);
    }
  }

  /* ---------- Impor CSV Legacy ---------- */
  async function submitImport() {
    if (!importWellId) {
      toast.error('Sumur tujuan belum dipilih. Pilih sumur lalu ulangi impor.');
      return;
    }
    if (!importCsv.trim()) {
      toast.error('Isi CSV masih kosong. Tempelkan isi CSV lalu ulangi impor.');
      return;
    }
    setImportBusy(true);
    setImportResult(null);
    try {
      const result = await apiSend<ImportResult>('/api/reports/import', 'POST', {
        csv: importCsv,
        wellId: importWellId,
      });
      setImportResult(result);
      const summary = `Impor selesai: ${result.inserted} DDR dibuat, ${result.errorCount} baris error.`;
      if (result.inserted > 0) toast.success(summary);
      else toast.warning(summary);
      reports.reload();
      rules.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengimpor CSV. Periksa format kolom wajib lalu coba lagi.');
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, display: 'flex', gap: 8, alignItems: 'center' }}>
          <FileText size={20} color="var(--accent-teal)" aria-hidden /> Perpustakaan Laporan
        </h1>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={refreshAll} aria-label="Muat ulang daftar laporan dan distribusi">
            <RefreshCw size={16} aria-hidden /> Muat Ulang
          </Button>
          <Link href="/ddr" style={{ textDecoration: 'none' }}>
            <Button aria-label="Buka Daily Drilling Report">Buat DDR Baru</Button>
          </Link>
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
        {reports.data ? `${reports.data.total} laporan tersimpan` : 'Memuat daftar laporan...'}
        {' · '}
        {activeRules} distribusi aktif dari {ruleList.length} aturan
      </p>

      {/* ---------- Search & filter chips ---------- */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="report-search" className="sr-only">
          Cari laporan
        </label>
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <Search
            size={16}
            aria-hidden
            style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }}
          />
          <input
            id="report-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nomor DDR, sumur, rig, atau tanggal"
            style={{
              height: 'var(--control-h)',
              width: 300,
              maxWidth: '100%',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-input)',
              padding: '0 12px 0 32px',
              fontFamily: 'inherit',
              fontSize: 14,
              background: '#fff',
              color: 'var(--text-primary)',
            }}
          />
        </span>

        <div role="group" aria-label="Filter kategori laporan" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const active = f.id === cat;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => setCat(f.id)}
                style={{
                  height: 'var(--control-h)',
                  padding: '0 14px',
                  borderRadius: 999,
                  border: `1px solid ${active ? 'var(--bg-sidebar)' : 'var(--border-default)'}`,
                  background: active ? 'var(--bg-sidebar)' : '#fff',
                  color: active ? '#fff' : 'var(--text-primary)',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* ---------- Left: report grid + templates ---------- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {reports.error && <ErrorNotice message={reports.error} onRetry={() => reports.reload()} />}

          {reports.loading && items.length === 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <Card key={i}>
                  <SkeletonBlock h={16} w="70%" />
                  <div style={{ height: 10 }} />
                  <SkeletonBlock h={12} />
                  <div style={{ height: 8 }} />
                  <SkeletonBlock h={12} w="50%" />
                  <div style={{ height: 14 }} />
                  <SkeletonBlock h={32} w="60%" />
                </Card>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignContent: 'start' }}>
              {visible.map((r) => (
                <Card key={r.id}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14, minWidth: 0 }}>
                      DDR #{r.reportNo} - {r.wellName}
                    </strong>
                    <span style={{ marginLeft: 'auto' }}>
                      <StatusBadge status={r.status} />
                    </span>
                  </div>
                  <p
                    className="tnum"
                    style={{ margin: '6px 0 2px', fontSize: 12, color: 'var(--text-secondary)' }}
                  >
                    {r.reportDate} · {r.rigName ?? 'Rig tidak tercatat'}
                  </p>
                  <p className="tnum" style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                    Kedalaman {formatMeters(r.depthMdEnd)} · NPT {r.nptPercent.toFixed(2)}% ·{' '}
                    {formatUsd(r.costDailyUsd)}
                  </p>
                  <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 0' }}>
                    {/*
                      P1-7: sebelumnya `<Link href="/ddr">` tanpa `?id=` → membuka DDR
                      TERBARU, bukan laporan yang diklik (target salah). Karena DDR
                      belum membaca `?id=`, tombol ini mengarah ke PDF laporan yang
                      DIKLIK (`/api/reports/{id}/pdf?type=ddr`) - hasilnya pasti benar.
                      Deep-link `/ddr?id=<id>` perlu ditambahkan di sisi halaman DDR.
                    */}
                    <a
                      href={apiUrl(`/api/reports/${r.id}/pdf?type=ddr`)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: 'none' }}
                      aria-label={`Lihat PDF DDR ${r.reportNo} ${r.wellName}`}
                    >
                      <Button variant="secondary">
                        <Eye size={16} aria-hidden /> Lihat PDF
                      </Button>
                    </a>
                    <a
                      href={apiUrl(`/api/reports/${r.id}/pdf?type=ddr`)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: 'none' }}
                      aria-label={`Unduh PDF DDR ${r.reportNo} ${r.wellName}`}
                    >
                      <Button variant="secondary">
                        <Download size={16} aria-hidden /> Unduh PDF
                      </Button>
                    </a>
                  </p>
                </Card>
              ))}

              {visible.length === 0 && !reports.loading && (
                <Card>
                  <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                    Tidak ada laporan pada filter ini. Ubah kategori atau hapus kata kunci.
                  </p>
                </Card>
              )}
            </div>
          )}

          {/* ---------- Static template cards ---------- */}
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Pintasan Modul</h2>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-secondary)' }}>
              Setiap pintasan mengarah ke modul yang memproduksi data terkait - tombol mengarah ke modul yang
              memproduksi data terkait. Tombol pratinjau PDF hanya aktif bila laporan sumbernya ada.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {TEMPLATES.map((t) => (
                <Card key={t.title}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span
                      aria-hidden
                      style={{
                        display: 'flex',
                        width: 32,
                        height: 32,
                        borderRadius: 4,
                        background: 'var(--bg-surface-2)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: 'var(--info)',
                      }}
                    >
                      {t.icon}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 14 }}>{t.title}</strong>
                      <div style={{ marginTop: 4 }}>
                        <span
                          style={{
                            background: 'var(--accent-mint)',
                            color: 'var(--accent-teal)',
                            borderRadius: 999,
                            padding: '2px 8px',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          Template
                        </span>
                      </div>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.note}</p>
                  <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 0' }}>
                    <Link href={t.href} style={{ textDecoration: 'none' }}>
                      <Button variant="secondary">Buka modul</Button>
                    </Link>
                    <Button
                      variant="secondary"
                      onClick={() => openTemplatePdf(t)}
                      disabled={t.pdfType === null}
                      title={t.pdfType === null ? 'Pintasan ini belum punya generator PDF' : 'Pratinjau PDF laporan terbaru'}
                      aria-label={`Pratinjau PDF ${t.title}`}
                    >
                      <Eye size={16} aria-hidden /> Pratinjau PDF
                    </Button>
                  </p>
                </Card>
              ))}
            </div>
          </div>
        </div>

        {/* ---------- Right rail: distributions & delivery log ---------- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Distribusi Terjadwal</h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
              Aturan pengiriman otomatis dari master data ({activeRules} aktif).
            </p>

            {/* Aksi manual: distribusi sekarang + impor legacy CSV */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 10px' }}>
              <Button
                variant="secondary"
                onClick={runDistribution}
                disabled={distBusy || !canDistribute}
                title={canDistribute ? 'Kirim semua DDR yang sudah disetujui namun belum terdistribusi' : 'Role Anda tidak punya izin report:distribute'}
                aria-label="Jalankan distribusi sekarang"
              >
                <Send size={16} aria-hidden /> {distBusy ? 'Mengirim...' : 'Jalankan Distribusi'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setImportResult(null);
                  setImportOpen(true);
                }}
                disabled={!canImport}
                title={canImport ? 'Impor time breakdown dari CSV legacy (rig lama)' : 'Role Anda tidak punya izin report:create + master:manage'}
                aria-label="Impor CSV Legacy"
              >
                <UploadCloud size={16} aria-hidden /> Impor CSV Legacy
              </Button>
            </div>

            {distResult && (
              <Note kind={distResult.failed > 0 ? 'warn' : distResult.queued > 0 && distResult.sent === 0 ? 'info' : 'success'}>
                <span className="tnum">
                  Antrean {distResult.queued} · Terkirim {distResult.sent} · Gagal {distResult.failed}
                </span>
                {distResult.details.some((d) => d.message) && (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {[...new Set(distResult.details.map((d) => d.message).filter((m): m is string => !!m))].map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </Note>
            )}

            {rules.loading && ruleList.length === 0 ? (
              <>
                <SkeletonBlock h={14} />
                <div style={{ height: 8 }} />
                <SkeletonBlock h={14} />
                <div style={{ height: 8 }} />
                <SkeletonBlock h={14} />
              </>
            ) : rules.error ? (
              <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger-deep)' }}>
                {rules.error}
              </p>
            ) : ruleList.length === 0 ? (
              <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Belum ada aturan distribusi.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {ruleList.map((rule) => (
                  <li
                    key={rule.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-start',
                      padding: '10px 0',
                      borderTop: '1px solid var(--border-default)',
                      opacity: rule.active ? 1 : 0.7,
                    }}
                  >
                    <span style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                      <strong>{rule.name}</strong>
                      <br />
                      <span
                        className="tnum"
                        style={{ fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-word' }}
                      >
                        {rule.scheduleCron} · {rule.reportType}
                      </span>
                      <br />
                      <span
                        className="tnum"
                        style={{ fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-word' }}
                      >
                        Penerima: {rule.recipientGroup.length > 0 ? rule.recipientGroup.join(', ') : '-'}
                      </span>
                      <br />
                      <span
                        style={
                          rule.active
                            ? {
                                background: 'var(--success-soft)',
                                color: 'var(--success)',
                                borderRadius: 999,
                                padding: '2px 8px',
                                fontSize: 11,
                                fontWeight: 700,
                              }
                            : {
                                background: 'var(--bg-surface-2)',
                                color: 'var(--text-secondary)',
                                borderRadius: 999,
                                padding: '2px 8px',
                                fontSize: 11,
                                fontWeight: 700,
                              }
                        }
                      >
                        {rule.active ? 'AKTIF' : 'DIJEDA'}
                      </span>
                      <span className="tnum" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {' '}
                        Terakhir dijalankan: {formatIso(rule.lastRunAt)}
                      </span>
                    </span>

                    {/* Toggle status distribusi - PATCH /api/master/rules/[id] */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.active}
                      aria-label={`Status distribusi ${rule.name}`}
                      disabled={togglingRuleId === rule.id}
                      onClick={async () => {
                        setTogglingRuleId(rule.id);
                        try {
                          await apiSend(`/api/master/rules/${rule.id}`, 'PATCH', { active: !rule.active });
                          toast.success(
                            `Distribusi "${rule.name}" ${rule.active ? 'dinonaktifkan' : 'diaktifkan'}.`,
                          );
                          rules.reload();
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : 'Gagal mengubah status distribusi.',
                          );
                        } finally {
                          setTogglingRuleId(null);
                        }
                      }}
                      style={{
                        width: 44,
                        height: 24,
                        borderRadius: 999,
                        border: '1px solid var(--border-default)',
                        background: rule.active ? 'var(--accent-teal)' : 'var(--border-strong)',
                        position: 'relative',
                        cursor: togglingRuleId === rule.id ? 'wait' : 'pointer',
                        opacity: togglingRuleId === rule.id ? 0.6 : 1,
                        transition: 'background 150ms',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          position: 'absolute',
                          top: 2,
                          left: rule.active ? 22 : 2,
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: '#fff',
                          transition: 'left 150ms',
                        }}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>Log Pengiriman</h2>
              <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
                {deliveryLog.length} entri
              </span>
            </div>
            {rules.loading && deliveryLog.length === 0 ? (
              <>
                <div style={{ height: 8 }} />
                <SkeletonBlock h={14} />
                <div style={{ height: 8 }} />
                <SkeletonBlock h={14} />
              </>
            ) : deliveryLog.length === 0 ? (
              <p role="status" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                Belum ada riwayat pengiriman. Jalankan distribusi untuk mengisi log ini.
              </p>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '6px 4px' }}>Penerima</th>
                      <th style={{ padding: '6px 4px' }}>Subjek</th>
                      <th style={{ padding: '6px 4px' }}>Status</th>
                      <th style={{ padding: '6px 4px', textAlign: 'right' }} title="Jumlah percobaan kirim">
                        Percobaan
                      </th>
                      <th style={{ padding: '6px 4px', textAlign: 'right' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryLog.map((entry) => {
                      const canRetry =
                        entry.status.trim().toLowerCase() === 'queued' ||
                        entry.status.trim().toLowerCase() === 'failed';
                      const busy = retryingId === entry.id;
                      return (
                        <tr key={entry.id} style={{ borderTop: '1px solid var(--border-default)' }}>
                          <td style={{ padding: '6px 4px', wordBreak: 'break-word' }}>
                            {entry.toAddresses.join(', ') || '-'}
                          </td>
                          <td style={{ padding: '6px 4px', wordBreak: 'break-word' }}>
                            {entry.subject ?? '-'}
                            {entry.lastError && (
                              <div style={{ color: 'var(--danger-deep)', fontSize: 11 }}>
                                {entry.lastError}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '6px 4px' }}>
                            <span
                              style={{
                                ...deliveryStyle(entry.status),
                                borderRadius: 999,
                                padding: '2px 8px',
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                              }}
                            >
                              {entry.status}
                            </span>
                          </td>
                          <td className="tnum" style={{ padding: '6px 4px', textAlign: 'right' }}>
                            {entry.attempts}
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                            {canRetry ? (
                              <button
                                type="button"
                                onClick={() => void retryDelivery(entry)}
                                disabled={busy || !canDistribute}
                                title={
                                  canDistribute
                                    ? 'Kirim ulang email ini'
                                    : 'Role Anda tidak punya izin report:distribute'
                                }
                                aria-label={`Kirim ulang email ${entry.subject ?? entry.id}`}
                                style={{
                                  background: 'none',
                                  border: 0,
                                  padding: 0,
                                  color: 'var(--accent-teal)',
                                  fontFamily: 'inherit',
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: busy ? 'wait' : 'pointer',
                                  opacity: busy || !canDistribute ? 0.6 : 1,
                                }}
                              >
                                {busy ? 'Mengirim...' : 'Kirim ulang'}
                              </button>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ---------- Impor CSV Legacy ---------- */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Impor CSV Legacy">
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)' }}>
          Satu baris CSV = satu baris time breakdown. Baris dengan <code>report_date</code> sama digabung menjadi satu DDR.
          Kolom wajib: <code>{IMPORT_HEADER}</code>. Alias umum juga diterima (mis.{' '}
          <code>Date</code>, <code>Start Depth</code>, <code>End Depth</code>, <code>From Time</code>,{' '}
          <code>IADC</code>). Tanggal yang sudah punya DDR untuk sumur ini dilewati; baris ke-2 pada tanggal
          yang sama yang berbeda <code>report_no</code>/<code>depth_md_end</code> dicatat sebagai error.
        </p>

        <Labeled label="Sumur tujuan">
          {wells.loading ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Memuat sumur...</span>
          ) : wells.error ? (
            <span role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>{wells.error}</span>
          ) : (
            <select
              style={inStyle()}
              value={importWellId}
              onChange={(e) => setImportWellId(e.target.value)}
              aria-label="Pilih sumur tujuan impor"
            >
              <option value="">- pilih sumur -</option>
              {(wells.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
        </Labeled>

        <div style={{ marginTop: 12 }}>
          <Labeled label="Isi CSV">
            <textarea
              className="tnum"
              style={{ ...inStyle(), height: 'auto', padding: 8, minHeight: 160 }}
              rows={8}
              value={importCsv}
              onChange={(e) => setImportCsv(e.target.value)}
              placeholder={`${IMPORT_HEADER}\n2026-09-11,2845.00,2857.00,06:00,18:00,01,Drilling 8-1/2in`}
              aria-label="Isi CSV"
            />
          </Labeled>
        </div>

        {importResult && (
          <div style={{ marginTop: 12 }}>
            <Note kind={importResult.inserted > 0 ? (importResult.errorCount > 0 ? 'warn' : 'success') : 'error'}>
              <span className="tnum">
                {importResult.inserted} DDR dibuat · {importResult.rowCount} baris diproses · {importResult.errorCount} kesalahan
              </span>
              <br />
              <span className="tnum" style={{ fontSize: 11 }}>Batch: {importResult.batchId}</span>
              {importResult.costNotice && (
                <>
                  <br />
                  {/* Jujur: cost 0 karena CSV tidak membawa kolom cost. */}
                  <span className="tnum" style={{ fontSize: 11 }}>Cost: {importResult.costNotice}</span>
                </>
              )}
            </Note>
            {importResult.errors.length > 0 && (
              <div style={{ maxHeight: 180, overflow: 'auto', marginTop: 8 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '4px 6px', width: 70 }}>Baris</th>
                      <th style={{ padding: '4px 6px' }}>Pesan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.errors.map((e, i) => (
                      <tr key={`${e.row}-${i}`} style={{ borderTop: '1px solid var(--border-default)' }}>
                        <td className="tnum" style={{ padding: '4px 6px' }}>{e.row}</td>
                        <td style={{ padding: '4px 6px', color: 'var(--danger-deep)' }}>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <p style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button onClick={submitImport} disabled={importBusy}>
            {importBusy ? 'Mengimpor...' : 'Impor CSV'}
          </Button>
          <Button variant="secondary" onClick={() => setImportOpen(false)} disabled={importBusy}>
            Tutup
          </Button>
        </p>
      </Modal>
    </div>
  );
}
