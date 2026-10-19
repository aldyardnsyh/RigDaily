'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, History, Printer, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@rigdaily/ui';
import { MINUTES_PER_DAY, classifyTime, formatHours, parseHm, rowDurationMinutes } from '@rigdaily/shared';
import { Note } from '@/components/controls';
import { StatusBadge } from '@/components/StatusBadge';
import { TimeBreakdownEditor, type EditableTimeRow } from '@/components/TimeBreakdownEditor';
import { ApiClientError, apiSend, apiUrl } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell } from '@/lib/hooks/useActiveWell';
import type { IadcCodeDto, ReportDetail, ReportListItem, WellDto } from '@/lib/repo/types';

type ReportsList = { items: ReportListItem[]; total: number };
type TimeSaveResult = { ok: boolean; totalMinutes: number };
type Issue = { severity: string; code: string; message: string; rowIndex?: number };

/** Warna strip timeline per TimeClass (memakai token CSS). */
const CLASS_COLOR: Record<string, string> = {
  PRD: 'var(--success)',
  NPT: 'var(--danger)',
  WOW: 'var(--wow-bg)',
  FM: 'var(--warning)',
  STBY: 'var(--bg-surface-2)',
  DSPT: 'var(--info)',
  GAP: 'var(--danger-soft)',
};

function classOfRow(row: EditableTimeRow): string {
  if (row.nptFlag) return 'NPT';
  // Klasifikasi otoritatif berasal dari @rigdaily/shared (parity dengan PDF/validasi).
  return classifyTime(row.iadcCode);
}

/** Strip timeline 24 jam dari baris aktual (proporsi durasi/1440). */
function TimelineStrip({ rows }: { rows: EditableTimeRow[] }) {
  const segments = useMemo(() => {
    const out: Array<{ key: string; left: number; width: number; color: string; label: string }> = [];
    rows.forEach((r, i) => {
      const s = parseHm(r.start);
      const e = parseHm(r.end);
      if (s === null || e === null) return;
      const dur = rowDurationMinutes(r.start, r.end) ?? 0;
      if (dur <= 0) return;
      const color = CLASS_COLOR[classOfRow(r)] ?? 'var(--bg-surface-2)';
      if (e > s) {
        out.push({ key: `${i}`, left: s, width: e - s, color, label: `${r.start}-${r.end} ${r.iadcCode} ${formatHours(dur)}h` });
      } else {
        out.push({ key: `${i}a`, left: s, width: MINUTES_PER_DAY - s, color, label: `${r.start}-24:00 ${r.iadcCode}` });
        out.push({ key: `${i}b`, left: 0, width: e, color, label: `00:00-${r.end} ${r.iadcCode}` });
      }
    });
    return out;
  }, [rows]);

  return (
    <div
      role="img"
      aria-label="Strip timeline 24 jam dari baris time breakdown aktual"
      style={{ position: 'relative', height: 26, background: 'var(--bg-surface-2)', borderRadius: 4, overflow: 'hidden' }}
    >
      {segments.map((seg) => (
        <div
          key={seg.key}
          title={seg.label}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${(seg.left / MINUTES_PER_DAY) * 100}%`,
            width: `${(seg.width / MINUTES_PER_DAY) * 100}%`,
            background: seg.color,
            borderRight: '1px solid #fff',
          }}
        />
      ))}
    </div>
  );
}

export default function TimePage() {
  const activeWell = useActiveWell();
  const wells = activeWell.wells;
  const wellId = activeWell.wellId;

  const reportsList = useApi<ReportsList>(wellId ? `/api/reports?wellId=${wellId}&limit=1` : null);
  const latest = reportsList.data?.items?.[0] ?? null;
  const detail = useApi<ReportDetail>(latest ? `/api/reports/${latest.id}` : null);
  const iadc = useApi<IadcCodeDto[]>('/api/master/iadc');

  const report = detail.data;
  const iadcCodes = iadc.data ?? [];

  const readOnly = !report || report.status !== 'draft';

  /* ---------- local editable rows, synced from server ---------- */
  const [rows, setRows] = useState<EditableTimeRow[]>([]);
  const serverRows = report?.timeRows;
  // Signature konten (bukan sekadar jumlah baris) supaya reload setelah simpan
  // selalu menyegarkan editor walau jumlah baris sama.
  const serverSignature = serverRows
    ? serverRows.map((r) => `${r.id}:${r.start}:${r.end}:${r.iadcCode}:${r.nptFlag}:${r.iadcSubcode ?? ''}:${r.vendor ?? ''}`).join('|')
    : '';
  const reportKey = report ? `${report.id}:${report.revision}:${serverSignature}` : null;

  useEffect(() => {
    if (!report || !serverRows) return;
    setRows(
      serverRows.map((r) => ({
        start: r.start,
        end: r.end,
        iadcCode: r.iadcCode,
        iadcSubcode: r.iadcSubcode ?? '',
        // Vendor DTO = nama dari master vendors; WAJIB dibawa agar tidak hilang saat replace.
        vendor: r.vendor ?? '',
        nptFlag: r.nptFlag,
        remarks: r.remarks ?? '',
      })),
    );
  }, [reportKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- save ---------- */
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);

  const reloadAll = useCallback(() => {
    detail.reload();
    reportsList.reload();
  }, [detail.reload, reportsList.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!report) return;
    setSaving(true);
    setIssues([]);
    try {
      const payload = {
        rows: rows.map((r) => ({
          start: r.start,
          end: r.end,
          iadcCode: r.iadcCode,
          iadcSubcode: r.iadcSubcode && r.iadcSubcode.trim() ? r.iadcSubcode.trim() : null,
          vendor: r.vendor && r.vendor.trim() ? r.vendor.trim() : null,
          nptFlag: r.nptFlag ?? false,
          remarks: r.remarks && r.remarks.trim() ? r.remarks.trim() : null,
        })),
      };
      const res = await apiSend<TimeSaveResult>(`/api/reports/${report.id}/time`, 'PUT', payload);
      toast.success(`Time breakdown tersimpan: total ${formatHours(res.totalMinutes)} jam / 24.0 jam.`);
      reloadAll();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 422 && Array.isArray(err.details)) {
        setIssues(err.details as Issue[]);
      }
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan time breakdown.');
    } finally {
      setSaving(false);
    }
  }

  /* ---------- derived ---------- */
  const liveTotal = useMemo(() => rows.reduce((acc, r) => acc + (rowDurationMinutes(r.start, r.end) ?? 0), 0), [rows]);
  const serverTotal = report?.totalMinutes ?? 0;
  const is24 = serverTotal === MINUTES_PER_DAY;
  const dirty = serverTotal !== liveTotal || rows.length !== (serverRows?.length ?? 0);
  const errorIssues = issues.filter((i) => i.severity === 'error');

  const loading = activeWell.loading || reportsList.loading || detail.loading;
  const loadError = activeWell.error ?? reportsList.error ?? detail.error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        DAILY DRILLING REPORT {report ? `#${report.reportNo}` : ''} &gt; TIME BREAKDOWN 24 JAM
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Time Breakdown Operasional 24 Jam</h1>
        {report && <StatusBadge status={report.status} />}
        {report &&
          (is24 ? (
            <Badge kind="Distributed">
              <CheckCircle2 size={12} /> 24.0 jam terpenuhi
            </Badge>
          ) : (
            <Badge kind="NPT">
              <AlertCircle size={12} /> {formatHours(serverTotal)} jam / 24.0 jam
            </Badge>
          ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/ddr" style={{ display: 'inline-flex' }}>
            <Button variant="secondary">
              <History size={16} /> Kembali ke DDR
            </Button>
          </Link>
          {report && (
            <a href={apiUrl(`/api/reports/${report.id}/pdf?type=iadc`)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex' }}>
              <Button variant="secondary">
                <Printer size={16} /> Unduh Lembar IADC
              </Button>
            </a>
          )}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 13 }}>
        {report ? (
          <>
            Sumur {report.wellName}
            {report.rigName ? `, Rig ${report.rigName}` : ''}. Periode {report.periodFrom}-{report.periodTo}. Total tersimpan{' '}
            <span className="tnum">{formatHours(serverTotal)} jam / 24.0 jam</span>.
          </>
        ) : (
          'Memuat laporan...'
        )}
      </p>

      {loadError && (
        <div role="alert" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: 12, color: 'var(--danger-deep)', fontSize: 13 }}>
          {loadError}
        </div>
      )}

      {loading ? (
        <Card>
          <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div aria-hidden style={{ height: 24, width: 200, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} aria-hidden style={{ height: 32, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
            ))}
          </div>
        </Card>
      ) : !report ? (
        <Card>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>Belum ada laporan DDR untuk sumur ini.</p>
        </Card>
      ) : (
        <>
          {/* Balance + total bar */}
          <Card>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <span
                aria-hidden
                style={{
                  display: 'flex',
                  width: 36,
                  height: 36,
                  borderRadius: 4,
                  background: is24 ? 'var(--success)' : 'var(--danger)',
                  color: '#fff',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {is24 ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              </span>
              <div style={{ flex: 1, minWidth: 240 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  Saldo Harian: <span className="tnum">{formatHours(serverTotal)} / 24.0 jam tercatat</span>
                  {dirty && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--warning)' }}>(perubahan belum disimpan: {formatHours(liveTotal)} jam)</span>}
                </p>
                {is24 ? (
                  <Note kind="success">Total 24.0 jam penuh. Aturan IADC terpenuhi, laporan siap dikirim untuk persetujuan.</Note>
                ) : (
                  <Note kind="error">
                    Total harus tepat 24.0 jam sebelum laporan dikirim. Kurang {formatHours(MINUTES_PER_DAY - serverTotal)} jam. Gunakan tombol &quot;Isi Gap Otomatis (IADC 14)&quot; untuk menutup selisih.
                  </Note>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="tnum" style={{ fontSize: 13, color: 'var(--success)' }}>PRD {formatHours(report.productiveMinutes)} jam</span>
                <span className="tnum" style={{ fontSize: 13, color: 'var(--danger)' }}>NPT {formatHours(report.nptMinutes)} jam</span>
                <span className="tnum" style={{ fontSize: 13, color: 'var(--warning)' }}>WOW {formatHours(report.wowMinutes)} jam</span>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <TimelineStrip rows={rows} />
            </div>
          </Card>

          {/* Editor */}
          <Card>
            {readOnly && <Note kind="info">Laporan berstatus {report.status} - time breakdown hanya bisa diubah lewat amendemen.</Note>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>Baris Waktu &amp; Kode IADC</h2>
              <span style={{ marginLeft: 'auto' }}>
                <Button onClick={save} disabled={readOnly || saving}>
                  <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </span>
            </div>

            {errorIssues.length > 0 && (
              <div role="alert" style={{ marginBottom: 12, background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 6, padding: 10, color: 'var(--danger-deep)', fontSize: 13 }}>
                <strong>Validasi gagal ({errorIssues.length} error) - data tidak disimpan:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {errorIssues.map((i, k) => (
                    <li key={k}>{i.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <TimeBreakdownEditor rows={rows} iadcCodes={iadcCodes} onChange={setRows} readOnly={readOnly} />
          </Card>
        </>
      )}
    </div>
  );
}
