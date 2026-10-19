'use client';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { Badge, Button } from '@rigdaily/ui';
import {
  MINUTES_PER_DAY,
  classifyTime,
  formatHm,
  formatHours,
  parseHm,
  rowDurationMinutes,
  type TimeClass,
} from '@rigdaily/shared';

/**
 * Baris editable - bentuk yang sama dengan payload PUT /api/reports/{id}/time.
 * Tidak ada `key` sintetis di tipe (kontrol penuh lewat index), agar komponen
 * bisa dipakai sebagai controlled component tanpa state internal.
 */
export type EditableTimeRow = {
  start: string;
  end: string;
  iadcCode: string;
  iadcSubcode?: string | null;
  /**
   * Nama vendor (bukan id). Di server di-resolve ke `time_breakdown.vendor_id`
   * lewat master `vendors` (upsert by name); kolom sub-code TIDAK dipakai
   * menyimpan nama vendor lagi (lihat repo/reports.ts `replaceTimeRows`).
   */
  vendor?: string | null;
  nptFlag?: boolean;
  remarks?: string | null;
};

export type IadcOption = {
  code: string;
  name: string;
  nptDefault: boolean;
  subCodeRequired: boolean;
};

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Klasifikasi baris: nptFlag override, kalau tidak dari kode IADC (shared). */
function rowClass(row: EditableTimeRow): TimeClass {
  if (row.nptFlag) return 'NPT';
  return classifyTime(row.iadcCode);
}

/** Apakah dua baris overlap (interval absolut; baris lintas tengah malam diabaikan). */
function hasOverlap(rows: EditableTimeRow[]): boolean {
  const intervals: Array<{ from: number; to: number }> = [];
  for (const r of rows) {
    const s = parseHm(r.start);
    const e = parseHm(r.end);
    if (s === null || e === null) continue;
    if (e > s) intervals.push({ from: s, to: e });
    else if (e < s) {
      intervals.push({ from: s, to: MINUTES_PER_DAY });
      intervals.push({ from: 0, to: e });
    }
  }
  intervals.sort((a, b) => a.from - b.from);
  for (let i = 1; i < intervals.length; i += 1) {
    if (intervals[i].from < intervals[i - 1].to) return true;
  }
  return false;
}

/**
 * Format batas menit → HH:MM. Batas tepat 1440 ditulis "24:00" (bukan "00:00")
 * agar baris auto-fill 00:00→24:00 = 1440 menit, bukan durasi 0.
 */
function formatBoundary(minutes: number): string {
  return minutes === MINUTES_PER_DAY ? '24:00' : formatHm(minutes);
}

/** Cari celah unallocated (menit) untuk auto-fill handover. */
function findGap(rows: EditableTimeRow[]): { start: string; end: string } | null {
  const intervals: Array<{ from: number; to: number }> = [];
  for (const r of rows) {
    const s = parseHm(r.start);
    const e = parseHm(r.end);
    if (s === null || e === null) continue;
    if (e > s) intervals.push({ from: s, to: e });
    else if (e < s) {
      intervals.push({ from: s, to: MINUTES_PER_DAY });
      intervals.push({ from: 0, to: e });
    }
  }
  if (intervals.length === 0) return { start: '00:00', end: '24:00' };
  intervals.sort((a, b) => a.from - b.from);

  let cursor = 0;
  for (const iv of intervals) {
    if (iv.from > cursor) {
      return { start: formatBoundary(cursor), end: formatBoundary(iv.from) };
    }
    cursor = Math.max(cursor, iv.to);
  }
  if (cursor < MINUTES_PER_DAY) {
    return { start: formatBoundary(cursor), end: formatBoundary(MINUTES_PER_DAY) };
  }
  return null;
}

function cellInput(): React.CSSProperties {
  return {
    height: 'var(--control-h-cell, 32px)',
    width: '100%',
    border: '1px solid var(--border-default)',
    borderRadius: 4,
    padding: '0 8px',
    fontFamily: 'inherit',
    fontSize: 13,
    background: '#fff',
    color: 'var(--text-primary)',
  };
}

export function TimeBreakdownEditor({
  rows,
  iadcCodes,
  onChange,
  readOnly = false,
}: {
  rows: EditableTimeRow[];
  iadcCodes: IadcOption[];
  onChange: (rows: EditableTimeRow[]) => void;
  readOnly?: boolean;
}) {
  /* ---------- derived totals ---------- */
  let total = 0;
  let prd = 0;
  let npt = 0;
  let wow = 0;
  for (const r of rows) {
    const dur = rowDurationMinutes(r.start, r.end) ?? 0;
    total += dur;
    const cls = rowClass(r);
    if (cls === 'PRD') prd += dur;
    else if (cls === 'NPT') npt += dur;
    else if (cls === 'WOW') wow += dur;
  }
  const overlap = hasOverlap(rows);
  const diff = total - MINUTES_PER_DAY;

  // Hijau = 1440 menit penuh; amber = kurang; rose = lebih atau overlap.
  const totalColor =
    overlap || diff > 0 ? 'var(--danger)' : diff === 0 ? 'var(--success)' : 'var(--warning)';

  const gap = findGap(rows);

  /* ---------- mutators (controlled) ---------- */
  function patchRow(index: number, patch: Partial<EditableTimeRow>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const last = rows[rows.length - 1];
    const start = last && HM_RE.test(last.end) ? last.end : '06:00';
    const startMin = parseHm(start) ?? 360;
    const end = formatHm((startMin + 60) % MINUTES_PER_DAY);
    onChange([
      ...rows,
      {
        start,
        end,
        iadcCode: iadcCodes[0]?.code ?? '01',
        iadcSubcode: '',
        vendor: '',
        nptFlag: false,
        remarks: '',
      },
    ]);
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function autoFillHandover() {
    const g = findGap(rows);
    if (!g) return;
    onChange([
      ...rows,
      {
        start: g.start,
        end: g.end,
        iadcCode: '14',
        iadcSubcode: 'Shift handover (IADC 14)',
        vendor: '',
        nptFlag: false,
        remarks: 'Shift handover - gap waktu yang belum terpakai.',
      },
    ]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ---------- Header total ---------- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="tnum" style={{ fontSize: 18, fontWeight: 800, color: totalColor }}>
          Total {formatHours(total)} jam / 24.0 jam
        </div>
        <span className="tnum" style={{ fontSize: 13, color: 'var(--success)' }}>PRD {formatHours(prd)} jam</span>
        <span className="tnum" style={{ fontSize: 13, color: 'var(--danger)' }}>NPT {formatHours(npt)} jam</span>
        <span className="tnum" style={{ fontSize: 13, color: 'var(--warning)' }}>WOW {formatHours(wow)} jam</span>
        {overlap ? (
          <Badge kind="NPT">Waktu bertumpang tindih</Badge>
        ) : diff !== 0 ? (
          <Badge kind={diff > 0 ? 'NPT' : 'Submitted'}>{diff > 0 ? `Lebih ${formatHours(diff)} jam` : `Kurang ${formatHours(-diff)} jam`}</Badge>
        ) : (
          <Badge kind="Distributed">24,0 jam terpenuhi</Badge>
        )}
      </div>

      {/* ---------- Toolbar ---------- */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={addRow} disabled={readOnly}>
          <Plus size={16} /> Tambah Baris
        </Button>
        <Button variant="secondary" onClick={autoFillHandover} disabled={readOnly || !gap} title="Isi celah waktu yang belum terpakai dengan kode IADC 14 (shift handover)">
          <Wand2 size={16} /> Isi Gap Otomatis (IADC 14)
        </Button>
      </div>
      {gap && !readOnly && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
          Celah waktu belum terpakai: <strong>{gap.start}-{gap.end}</strong> ({formatHours(rowDurationMinutes(gap.start, gap.end) ?? 0)} jam). Tombol ini mengisi celah tersebut dengan kode IADC 14.
        </p>
      )}

      {/* ---------- Tabel ---------- */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>
              <th style={{ width: 32 }}>#</th>
              <th style={{ width: 88 }}>Mulai</th>
              <th style={{ width: 88 }}>Selesai</th>
              <th style={{ width: 64 }}>Durasi (jam)</th>
              <th style={{ width: 190 }}>Kode IADC</th>
              <th style={{ width: 180 }}>Sub-kode</th>
              <th style={{ width: 160 }}>Vendor</th>
              <th style={{ width: 56 }}>NPT</th>
              <th>Keterangan</th>
              <th style={{ width: 52 }}>Hapus</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: '10px 0', color: 'var(--text-muted)' }}>
                  Belum ada baris waktu. Tambahkan baris, atau isi gap otomatis dengan kode IADC 14.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => {
                const dur = rowDurationMinutes(r.start, r.end);
                const badDur = dur === null || dur <= 0;
                const isNpt = r.nptFlag === true;
                return (
                  <tr
                    key={idx}
                    style={{
                      height: 'var(--row-h)',
                      background: isNpt ? 'var(--npt-bg)' : undefined,
                      boxShadow: isNpt ? 'inset 3px 0 0 var(--npt-border-left)' : undefined,
                    }}
                  >
                    <td className="tnum">{idx + 1}</td>
                    <td>
                      <input
                        aria-label={`Jam mulai baris ${idx + 1}`}
                        className="tnum"
                        style={cellInput()}
                        value={r.start}
                        disabled={readOnly}
                        onChange={(e) => patchRow(idx, { start: e.target.value })}
                        placeholder="HH:MM (24 jam)"
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Jam selesai baris ${idx + 1}`}
                        className="tnum"
                        style={cellInput()}
                        value={r.end}
                        disabled={readOnly}
                        onChange={(e) => patchRow(idx, { end: e.target.value })}
                        placeholder="HH:MM (24 jam)"
                      />
                    </td>
                    <td className="tnum" style={{ color: badDur ? 'var(--danger)' : undefined }}>
                      {dur === null ? '-' : formatHours(dur)}
                    </td>
                    <td>
                      <select
                        aria-label={`Kode IADC baris ${idx + 1}`}
                        style={cellInput()}
                        value={r.iadcCode}
                        disabled={readOnly}
                        onChange={(e) => patchRow(idx, { iadcCode: e.target.value })}
                      >
                        {/* Pastikan kode tersimpan ikut tampil walau tidak ada di master aktif. */}
                        {!iadcCodes.some((c) => c.code === r.iadcCode) && r.iadcCode ? (
                          <option value={r.iadcCode}>{r.iadcCode} (tidak ada di master)</option>
                        ) : null}
                        {iadcCodes.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={`Sub-kode baris ${idx + 1}`}
                        style={cellInput()}
                        value={r.iadcSubcode ?? ''}
                        disabled={readOnly}
                        onChange={(e) => patchRow(idx, { iadcSubcode: e.target.value })}
                        placeholder={iadcCodes.find((c) => c.code === r.iadcCode)?.subCodeRequired ? 'Wajib diisi' : 'mis. POOH'}
                      />
                    </td>
                    <td>
                      {/* Vendor terpisah dari sub-code: nama disimpan di master vendors (server upsert). */}
                      <input
                        aria-label={`Vendor baris ${idx + 1}`}
                        style={cellInput()}
                        value={r.vendor ?? ''}
                        disabled={readOnly}
                        onChange={(e) => patchRow(idx, { vendor: e.target.value })}
                        placeholder="mis. Halliburton"
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`NPT baris ${idx + 1}`}
                        checked={isNpt}
                        disabled={readOnly}
                        onChange={(e) => patchRow(idx, { nptFlag: e.target.checked })}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Keterangan baris ${idx + 1}`}
                        style={cellInput()}
                        value={r.remarks ?? ''}
                        disabled={readOnly}
                        onChange={(e) => patchRow(idx, { remarks: e.target.value })}
                        placeholder="Deskripsi operasi (wajib untuk kode 08/18/24)"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Hapus baris ${idx + 1}`}
                        onClick={() => removeRow(idx)}
                        disabled={readOnly}
                        style={{ background: 'none', border: 'none', cursor: readOnly ? 'not-allowed' : 'pointer', color: 'var(--danger)', padding: 4 }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
