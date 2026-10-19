'use client';

/**
 * Print Preview - pilih laporan, pilih jenis dokumen, pratinjau PDF, lalu cetak.
 *
 * Sumber data & dokumen (semua nyata, tanpa angka contoh):
 * - `GET /api/reports?limit=50`        -> daftar laporan yang bisa dicetak
 * - `/api/reports/{id}/pdf?type=ddr`   -> PDF Daily Drilling Report formal
 * - `/api/reports/{id}/pdf?type=iadc`  -> PDF IADC time sheet
 *
 * CATATAN PENTING SOAL IFRAME
 * Endpoint PDF memerlukan sesi login (cookie HttpOnly + permission `report:read`).
 * Bila sesi kedaluwarsa, server membalas JSON error alih-alih PDF sehingga
 * iframe tampak kosong. Karena itu panel kanan menyediakan tautan cadangan
 * "Buka di tab baru" dan tombol "Muat ulang pratinjau" yang me-remount iframe.
 */

import { useMemo, useRef, useState } from 'react';
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  Sheet,
} from 'lucide-react';
import { Button, Card } from '@rigdaily/ui';
import { formatMeters, formatUsd } from '@rigdaily/shared';
import { StatusBadge } from '@/components/StatusBadge';
import { Note } from '@/components/controls';
import { apiUrl } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import type { ReportListItem } from '@/lib/repo/types';

type ReportsList = { items: ReportListItem[]; total: number };

type DocType = 'ddr' | 'iadc';

const DOC_OPTIONS: Array<{ id: DocType; label: string; hint: string }> = [
  { id: 'ddr', label: 'DDR', hint: 'Daily Drilling Report formal (header, waktu, crew, biaya)' },
  { id: 'iadc', label: 'IADC Time Sheet', hint: 'Lembar waktu kompatibel IADC per baris aktivitas' },
];

function SkeletonBlock({ h, w = '100%' }: { h: number; w?: number | string }) {
  return <div aria-hidden className="rd-skeleton" style={{ height: h, width: w }} />;
}

function shortDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PrintPage() {
  const reports = useApi<ReportsList>('/api/reports?limit=50');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocType>('ddr');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [showTrouble, setShowTrouble] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const items = useMemo(() => reports.data?.items ?? [], [reports.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) => {
      const haystack = `${r.reportNo} ${r.wellName} ${r.reportDate} ${r.status} ${r.rigName ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  const selected = useMemo(() => items.find((r) => r.id === selectedId) ?? null, [items, selectedId]);

  const pdfPath = selected ? `/api/reports/${selected.id}/pdf?type=${docType}` : null;
  const pdfSrc = pdfPath ? `${apiUrl(pdfPath)}#nonce=${reloadNonce}` : null;

  function pickReport(id: string) {
    setSelectedId(id);
    setFrameLoaded(false);
    setShowTrouble(false);
    setReloadNonce((n) => n + 1);
  }

  function pickDoc(next: DocType) {
    setDocType(next);
    setFrameLoaded(false);
    setShowTrouble(false);
    setReloadNonce((n) => n + 1);
  }

  function reloadPreview() {
    setFrameLoaded(false);
    setShowTrouble(false);
    setReloadNonce((n) => n + 1);
  }

  /**
   * Cetak: panggil `print()` pada dokumen iframe bila satu origin (PDF viewer
   * memakai tab cetak bawaan browser). Bila penjadwalan atau akses lintas
   * dokumen gagal, buka PDF di tab baru - pengguna tetap bisa mencetak dari
   * viewer PDF. Bila semua gagal, tampilkan panduan manual.
   */
  function printPdf() {
    if (!pdfPath) return;
    const frame = frameRef.current;
    try {
      const win = frame?.contentWindow;
      if (frame && win) {
        win.focus();
        win.print();
        return;
      }
    } catch {
      // Akses dokumen ditolak (plugin PDF / kebijakan browser): pakai jalur cadangan.
    }
    window.open(apiUrl(pdfPath), '_blank', 'noopener');
  }

  const loadingList = reports.loading && items.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        DOKUMEN &gt; PRINT PREVIEW
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Print Preview</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Pilih laporan dan jenis dokumen, periksa pratinjau PDF, lalu cetak atau unduh.
          </p>
        </div>
        <span style={{ marginLeft: 'auto' }}>
          <Button
            variant="secondary"
            onClick={() => reports.reload()}
            disabled={reports.loading}
            aria-label="Muat ulang daftar laporan"
          >
            <RefreshCw size={16} aria-hidden /> {reports.loading ? 'Memuat...' : 'Muat Ulang'}
          </Button>
        </span>
      </div>

      {reports.error && (
        <Card>
          <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger-deep)' }}>
            Gagal memuat daftar laporan: {reports.error}
          </p>
          <p style={{ margin: '10px 0 0' }}>
            <Button variant="secondary" onClick={() => reports.reload()} aria-label="Coba muat ulang daftar laporan">
              <RefreshCw size={16} aria-hidden /> Coba lagi
            </Button>
          </p>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 340px) minmax(0, 1fr)', gap: 16 }}>
        {/* ---------- Panel kiri: pilih laporan ---------- */}
        <Card>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Pilih Laporan</h2>

          <label className="field-label" htmlFor="print-search">
            Cari laporan
          </label>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search
              size={15}
              aria-hidden
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              id="print-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nomor, sumur, atau tanggal"
              aria-label="Cari laporan berdasarkan nomor, sumur, atau tanggal"
              style={{
                height: 'var(--control-h)',
                width: '100%',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-input)',
                padding: '0 12px 0 32px',
                fontFamily: 'inherit',
                fontSize: 13,
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {loadingList ? (
            <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <SkeletonBlock key={i} h={54} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              {items.length === 0
                ? 'Belum ada laporan tersimpan. Buat DDR terlebih dahulu di menu Daily Reports.'
                : 'Tidak ada laporan yang cocok dengan pencarian.'}
            </p>
          ) : (
            <ul
              aria-label={`Daftar laporan, ${filtered.length} item`}
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: '58vh',
                overflowY: 'auto',
              }}
            >
              {filtered.map((r) => {
                const isActive = r.id === selectedId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => pickReport(r.id)}
                      aria-pressed={isActive}
                      aria-label={`Pilih laporan ${r.reportNo} ${r.wellName} tanggal ${r.reportDate}`}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-input)',
                        border: `1px solid ${isActive ? 'var(--accent-teal)' : 'var(--border-default)'}`,
                        background: isActive ? 'var(--success-soft)' : 'var(--bg-surface)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>
                        <FileText size={14} aria-hidden style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                        <span className="tnum">#{r.reportNo}</span>
                        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.wellName}
                        </span>
                        <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
                          <StatusBadge status={r.status} />
                        </span>
                      </span>
                      <span
                        className="tnum"
                        style={{ display: 'block', marginTop: 3, fontSize: 12, color: 'var(--text-secondary)' }}
                      >
                        {shortDate(r.reportDate)} - {formatMeters(r.depthMdEnd)} - {formatUsd(r.costDailyUsd)}
                        {r.rigName ? ` - ${r.rigName}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ---------- Panel kanan: jenis dokumen + pratinjau ---------- */}
        <Card>
          {!selected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 0' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span aria-hidden style={{ color: 'var(--accent-teal)', display: 'inline-flex', marginTop: 1 }}>
                  <Printer size={18} />
                </span>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16 }}>Belum ada laporan dipilih</h2>
                  <p role="status" style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                    Pilih salah satu laporan di panel kiri untuk melihat pratinjau PDF. Dokumen yang tersedia: DDR
                    (Daily Drilling Report) dan IADC Time Sheet.
                  </p>
                </div>
              </div>
              <Note kind="info">
                Pratinjau PDF dibuat di server dan memerlukan sesi login. Bila pratinjau tidak muncul, gunakan tombol
                Buka di tab baru pada panel setelah laporan dipilih.
              </Note>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ margin: 0, fontSize: 16 }}>
                    <span className="tnum">#{selected.reportNo}</span> {selected.wellName}
                  </h2>
                  <p className="tnum" style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                    {shortDate(selected.reportDate)} - {formatMeters(selected.depthMdEnd)} - NPT{' '}
                    {selected.nptPercent.toFixed(2)}% - {formatUsd(selected.costDailyUsd)}
                  </p>
                </div>
                <span style={{ marginLeft: 'auto' }}>
                  <StatusBadge status={selected.status} />
                </span>
              </div>

              {/* Pemilih jenis dokumen */}
              <div role="group" aria-label="Jenis dokumen" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                {DOC_OPTIONS.map((opt) => {
                  const active = opt.id === docType;
                  const Icon = opt.id === 'iadc' ? Sheet : FileText;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => pickDoc(opt.id)}
                      aria-pressed={active}
                      aria-label={`Tampilkan pratinjau ${opt.label}`}
                      title={opt.hint}
                      className="pill"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: active ? 'var(--bg-sidebar)' : 'var(--bg-surface)',
                        color: active ? 'var(--text-on-dark)' : 'var(--text-primary)',
                        borderColor: active ? 'var(--bg-sidebar)' : 'var(--border-default)',
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      <Icon size={14} aria-hidden />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                {DOC_OPTIONS.find((o) => o.id === docType)?.hint}
              </p>

              {/* Aksi */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <Button onClick={printPdf} aria-label="Cetak dokumen yang sedang dipratinjau">
                  <Printer size={16} aria-hidden /> Cetak
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (pdfPath) window.open(apiUrl(pdfPath), '_blank', 'noopener');
                  }}
                  aria-label="Buka PDF di tab baru"
                >
                  <ExternalLink size={16} aria-hidden /> Buka di tab baru
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (pdfPath) window.open(apiUrl(pdfPath), '_blank', 'noopener');
                  }}
                  aria-label="Unduh PDF laporan terpilih"
                >
                  <Download size={16} aria-hidden /> Unduh PDF
                </Button>
                <Button variant="tertiary" onClick={reloadPreview} aria-label="Muat ulang pratinjau PDF">
                  <RefreshCw size={16} aria-hidden /> Muat ulang
                </Button>
              </div>

              {/* Pratinjau */}
              <div style={{ position: 'relative' }}>
                {!frameLoaded && (
                  <div
                    aria-hidden
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      color: 'var(--text-secondary)',
                      fontSize: 13,
                      pointerEvents: 'none',
                    }}
                  >
                    <Loader2 size={16} className="rd-spin" /> Menyiapkan dokumen...
                  </div>
                )}
                <iframe
                  key={`${selected.id}-${docType}-${reloadNonce}`}
                  ref={frameRef}
                  title={`Pratinjau PDF ${docType === 'iadc' ? 'IADC Time Sheet' : 'DDR'} laporan ${selected.reportNo} ${selected.wellName}`}
                  src={pdfSrc ?? undefined}
                  onLoad={() => setFrameLoaded(true)}
                  onError={() => setShowTrouble(true)}
                  style={{
                    width: '100%',
                    height: '70vh',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 6,
                    background: 'var(--bg-surface)',
                    display: 'block',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setShowTrouble((v) => !v)}
                  aria-expanded={showTrouble}
                  aria-controls="print-trouble"
                  style={{
                    background: 'transparent',
                    border: 0,
                    padding: 0,
                    fontFamily: 'inherit',
                    fontSize: 12,
                    color: 'var(--accent-teal)',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Pratinjau tidak muncul?
                </button>
              </div>
              {showTrouble && (
                <div id="print-trouble">
                  <Note kind="warn">
                    PDF memerlukan sesi login aktif. Bila pratinjau kosong, sesi mungkin kedaluwarsa, plugin PDF
                    browser memblokir tampilan inline, atau server menolak permintaan. Coba{' '}
                    <a
                      href={pdfPath ? apiUrl(pdfPath) : '#'}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent-teal)', fontWeight: 700 }}
                    >
                      Buka di tab baru
                    </a>{' '}
                    lalu muat ulang halaman bila perlu.
                  </Note>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
