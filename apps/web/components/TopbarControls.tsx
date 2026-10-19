'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, ChevronDown, Clock, HardHat, WifiOff } from 'lucide-react';
import type { WellDto } from '@/lib/repo/types';
import { useApi } from '@/lib/hooks/useApi';
import { useActiveWell, useRequestedWellId, useSelectWell } from '@/lib/hooks/useActiveWell';

/**
 * Jam operasi yang mengikuti waktu SERVER.
 *
 * Kenapa tidak memakai jam perangkat: komputer di rig sering salah setel zona
 * waktu atau jamnya melenceng. Semua waktu yang ditampilkan diturunkan dari
 * `GET /api/system/time` (server), lalu dihitung maju secara lokal memakai
 * selisih (offset) sehingga tetap akurat tanpa polling tiap detik.
 */
type ServerTime = {
  epochMs: number;
  timeZone: string;
  localIso: string;
  localTime: string;
  shift: 'Day' | 'Night';
  shiftWindow: string;
  reportDate: string;
};

type TimeState = {
  offsetMs: number;
  timeZone: string;
  shift: 'Day' | 'Night';
  shiftWindow: string;
  reportDate: string;
  online: boolean;
  /** Jam lokal server saat terakhir sinkron (untuk fallback awal). */
  syncedAt: number;
};

const DEFAULT_TZ = 'Asia/Jakarta';

function partsInZone(ms: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  if (out.hour === '24') out.hour = '00';
  return out;
}

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function formatDateId(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')} ${MONTHS_ID[m - 1]} ${y}`;
}

/** Jam + tanggal + shift berjalan, dari waktu server. */
export function ServerClock({ compact = false }: { compact?: boolean }) {
  const time = useApi<ServerTime>('/api/system/time');
  const [now, setNow] = useState<number>(() => Date.now());
  const stateRef = useRef<TimeState | null>(null);

  useEffect(() => {
    if (!time.data) return;
    // offset = jamServer - jamLokal pada saat respons diterima
    stateRef.current = {
      offsetMs: time.data.epochMs - Date.now(),
      timeZone: time.data.timeZone || DEFAULT_TZ,
      shift: time.data.shift,
      shiftWindow: time.data.shiftWindow,
      reportDate: time.data.reportDate,
      online: true,
      syncedAt: Date.now(),
    };
    setNow(Date.now() + stateRef.current.offsetMs);
  }, [time.data]);

  useEffect(() => {
    const timer = setInterval(() => {
      const s = stateRef.current;
      setNow(Date.now() + (s ? s.offsetMs : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const s = stateRef.current;
  const tz = s?.timeZone ?? DEFAULT_TZ;
  const p = useMemo(() => partsInZone(now, tz), [now, tz]);

  /*
   * HYDRATION GUARD (bug yang diperbaiki):
   * Jam dirender hanya setelah komponen ter-mount. Server dan klien pasti
   * menghasilkan detik yang berbeda, sehingga merender jam saat SSR memicu
   * "Text content does not match server-rendered HTML".
   * Sebelum mount, tampilkan placeholder stabil agar markup server == klien.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const clock = mounted ? `${p.hour}:${p.minute}:${p.second}` : '--:--:--';
  const dateLong = mounted ? formatDateId(`${p.year}-${p.month}-${p.day}`) : '--';
  const shift = s?.shift ?? (Number(p.hour) >= 6 && Number(p.hour) < 18 ? 'Day' : 'Night');
  const shiftLabel = shift === 'Day' ? 'Shift Siang' : 'Shift Malam';

  if (compact) {
    return (
      <span className="tnum" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {clock}
      </span>
    );
  }

  return (
    <div
      className="hidden items-center gap-2 md:flex"
      title={`Waktu server (${tz}). Tanggal laporan berjalan: ${s?.reportDate ?? p.year + '-' + p.month + '-' + p.day}`}
      style={{
        height: 'var(--control-h)',
        padding: '0 12px',
        borderRadius: 'var(--radius-input)',
        background: 'var(--bg-surface-2)',
        border: '1px solid var(--border-default)',
        gap: 10,
        whiteSpace: 'nowrap',
      }}
      aria-label={`Waktu server ${clock}, ${dateLong}`}
    >
      <Clock size={15} aria-hidden style={{ color: 'var(--text-secondary)', flex: '0 0 auto' }} />
      <span className="tnum" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>
        {clock}
      </span>
      <span aria-hidden style={{ width: 1, height: 16, background: 'var(--border-default)' }} />
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <CalendarDays size={14} aria-hidden />
        {dateLong}
      </span>
      <span
        className="badge"
        style={{
          fontSize: 11,
          fontWeight: 700,
          background: shift === 'Day' ? 'var(--warning-soft)' : 'var(--info-soft)',
          color: shift === 'Day' ? 'var(--warning)' : 'var(--info)',
        }}
        title={`${shiftLabel} (${s?.shiftWindow ?? '06:00-18:00'})`}
      >
        {shiftLabel}
      </span>
      {time.error && (
        <span title="Gagal sinkron waktu server, memakai jam perangkat" style={{ display: 'inline-flex' }}>
          <WifiOff size={13} aria-hidden style={{ color: 'var(--danger)' }} />
        </span>
      )}
    </div>
  );
}

/**
 * Pemilih sumur aktif.
 *
 * Menggantikan label "Well ARUN-07" yang di-hardcode. Pilihan disimpan pada
 * query `?wellId=` sehingga seluruh modul (DDR, Time, Cost, Well File, dst)
 * mengikuti sumur yang sama, dan bertahan saat halaman dimuat ulang.
 */
export function WellSwitcher() {
  const router = useRouter();
  const activeWell = useActiveWell();
  const requested = useRequestedWellId();
  const wells = activeWell.wells;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current: WellDto | null = activeWell.well;
  const label = current?.name ?? (wells.length === 0 ? 'Belum ada sumur' : 'Pilih sumur');

  const selectWell = useSelectWell();

  const select = useCallback(
    (well: WellDto) => {
      setOpen(false);
      if (well.id === activeWell.wellId) return;

      /*
       * Ganti sumur tanpa memuat ulang halaman.
       *
       * `useSelectWell` menulis `?wellId=` lewat history API lalu memancarkan
       * event `rigdaily:navigate`. Hook `useActiveWell` mendengarkan event itu
       * sehingga seluruh modul langsung membaca ulang data sumur yang baru.
       *
       * `router.refresh()` dipanggil sebagai jaring pengaman agar komponen
       * server (jika ada) ikut menyegarkan.
       */
      selectWell(well.id);
      router.refresh();
    },
    [activeWell.wellId, router, selectWell],
  );

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '0 0 auto' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sumur aktif: ${label}. Klik untuk mengganti sumur.`}
        className="flex items-center gap-2"
        style={{
          height: 'var(--control-h)',
          maxWidth: 240,
          padding: '0 10px',
          borderRadius: 'var(--radius-input)',
          border: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          minWidth: 0,
        }}
      >
        <HardHat size={16} aria-hidden style={{ flex: '0 0 auto', color: 'var(--accent-teal)' }} />
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={label}
        >
          {label}
        </span>
        <ChevronDown size={14} aria-hidden style={{ flex: '0 0 auto' }} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Daftar sumur"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 280,
            maxWidth: 340,
            maxHeight: 360,
            overflowY: 'auto',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--shadow-pop)',
            zIndex: 50,
            padding: 6,
          }}
        >
          {wells.length === 0 && (
            <p style={{ margin: 0, padding: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
              Belum ada sumur pada master data.
            </p>
          )}
          {wells.map((w) => {
            const isActive = w.id === activeWell.wellId;
            return (
              <button
                key={w.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => select(w)}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid transparent',
                  background: isActive ? 'var(--accent-tonal)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minWidth: 0,
                }}
              >
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {w.name}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {w.type} / {w.phase}
                    {w.rigName ? ` / ${w.rigName}` : ''}
                  </span>
                </span>
                {w.latestDepthMd != null && (
                  <span className="tnum" style={{ fontSize: 11, color: 'var(--text-muted)', flex: '0 0 auto' }}>
                    {w.latestDepthMd.toFixed(0)} m
                  </span>
                )}
              </button>
            );
          })}
          <div style={{ borderTop: '1px solid var(--border-default)', marginTop: 6, paddingTop: 6 }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push('/well-file');
              }}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 'var(--radius-input)',
                border: '1px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--accent-teal)',
                textAlign: 'left',
              }}
            >
              Kelola sumur di Well File
            </button>
          </div>
          {requested && (
            <p style={{ margin: '4px 10px 2px', fontSize: 11, color: 'var(--text-muted)' }}>
              Sumur dipilih manual dari tautan.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
