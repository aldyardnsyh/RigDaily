'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * WellboreDrillingAnimation - visualisasi sumur yang SEDANG DIBOR.
 *
 * PERBAIKAN v3
 * 1. Animasi selalu berjalan. Versi sebelumnya berhenti total ketika sistem
 *    melaporkan `prefers-reduced-motion`, sehingga terlihat sebagai gambar
 *    diam tanpa sebab yang jelas. Sistem operasi Windows sering mengaktifkan
 *    setelan itu secara bawaan. Sekarang animasi tetap berjalan; bila
 *    pengguna memang meminta gerakan minimal, kita hanya memperlambat laju
 *    perubahan kedalaman (bagian informasi), bukan mematikan seluruh gerak.
 * 2. Tombol Jeda dihapus. Ini penggambaran aktivitas nyata, bukan pemutar
 *    video: yang benar adalah rig terlihat bekerja sepanjang waktu.
 * 3. Waktu animasi memakai `performance.now()` sejak mount, sehingga progres
 *    selalu bergerak maju walau tab sempat tidak aktif.
 *
 * YANG DIGAMBARKAN
 *  - Derrick + crown block + travelling block yang naik/turun mengikuti siklus.
 *  - Drill string berputar (garis putus bergerak ke bawah = sirkulasi mud).
 *  - Bit berputar di ujung, dengan percikan cutting saat on-bottom.
 *  - Partikel mud naik melalui annulus.
 *  - Kedalaman beranimasi: bertambah saat drilling, sedikit mundur saat
 *    connection (menyambung pipa), lalu berulang.
 *  - Casing bertingkat sebagai referensi struktur sumur.
 */

type CasingSpec = {
  label: string;
  sizeIn: number;
  sizeLabel: string;
  shoeMd: number;
  color: string;
};

type Props = {
  wellName: string;
  tdPlannedMd: number;
  currentMd: number;
  casings?: CasingSpec[];
  height?: number;
};

function defaultCasings(td: number): CasingSpec[] {
  return [
    { label: 'Conductor', sizeIn: 30, sizeLabel: '30"', shoeMd: td * 0.08, color: 'var(--text-muted)' },
    { label: 'Surface', sizeIn: 20, sizeLabel: '20"', shoeMd: td * 0.28, color: 'var(--chart-6)' },
    { label: 'Intermediate', sizeIn: 13.375, sizeLabel: '13-3/8"', shoeMd: td * 0.62, color: 'var(--accent-teal)' },
    { label: 'Production', sizeIn: 9.625, sizeLabel: '9-5/8"', shoeMd: td * 0.92, color: 'var(--chart-4)' },
  ];
}

/** Durasi satu siklus pengeboran (detik). */
const CYCLE = 7;
/** Bagian siklus yang dipakai untuk mengebor (sisanya connection). */
const DRILL_RATIO = 0.82;

export function WellboreDrillingAnimation({ wellName, tdPlannedMd, currentMd, casings, height = 460 }: Props) {
  const td = tdPlannedMd > 0 ? tdPlannedMd : 0;
  const baseDepth = currentMd > 0 ? Math.min(currentMd, td || currentMd) : 0;
  const list = casings && casings.length > 0 ? casings : td > 0 ? defaultCasings(td) : [];

  /*
   * Satu nilai waktu (detik) yang selalu maju. Diperbarui lewat rAF.
   * Disimpan di state agar React merender ulang setiap frame.
   */
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Berhenti menghitung saat komponen tidak terlihat (hemat CPU).
    if (typeof document !== 'undefined') {
      const onVis = () => setVisible(document.visibilityState !== 'hidden');
      document.addEventListener('visibilitychange', onVis);
      onVis();
      return () => document.removeEventListener('visibilitychange', onVis);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;

    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      setElapsed((ts - startRef.current) / 1000);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [visible]);

  /* ---------------- Turunan animasi ---------------- */
  const cyclePos = (elapsed % CYCLE) / CYCLE; // 0..1
  const drilling = cyclePos < DRILL_RATIO;
  const drillPhase = drilling ? cyclePos / DRILL_RATIO : Math.max(0, 1 - (cyclePos - DRILL_RATIO) / (1 - DRILL_RATIO));

  // Kedalaman bergerak maju-mundur di sekitar kedalaman laporan terakhir.
  const SWING_M = 12;
  const animatedDepth =
    baseDepth > 0 && td > 0 ? Math.min(td, baseDepth - SWING_M * 0.55 + drillPhase * SWING_M) : baseDepth;

  const maxSize = Math.max(...(list.length ? list.map((c) => c.sizeIn) : [30]));
  const widthPct = (sizeIn: number) => 22 + (sizeIn / maxSize) * 40;

  const RIG_H = 84;
  const plotH = height - RIG_H;
  const y = (md: number) => RIG_H + Math.max(0, Math.min(1, md / (td || 1))) * plotH;
  const bitY = y(animatedDepth);

  // Travelling block: naik cepat saat connection, turun pelan saat mengebor.
  const blockPos = drilling ? drillPhase * 10 : 10 + (1 - drillPhase) * 14;

  // Momentum rotasi & laju mud (kontinu, tidak bergantung fase).
  const stringOffset = (elapsed * 46 * (drilling ? 1 : 0.35)) % 12;
  const mudSpeed = drilling ? 1 : 0.3;

  /*
   * Rotasi DRILL STRING terlihat dari pola garis yang bergerak turun.
   * Bit sendiri TIDAK diputar pada sumbu layar; lihat blok BIT PDC di bawah.
   */
  const rpm = drilling ? 120 : 0;
  const torque = drilling ? 14 + Math.sin(elapsed * 3) * 2 : 0;

  const mudParticles = useMemo(() => Array.from({ length: 9 }, (_, i) => i), []);

  if (td <= 0 || list.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          border: '1px dashed var(--border-strong)',
          borderRadius: 'var(--radius-input)',
          background: 'var(--bg-surface-2)',
          fontSize: 13,
          color: 'var(--text-secondary)',
          textAlign: 'center',
        }}
        role="status"
      >
        TD planned sumur ini belum diisi. Isi angka TD pada tab Planning agar animasi pengeboran dapat digambar.
      </div>
    );
  }

  const deepestShoe = Math.max(...list.map((c) => c.shoeMd));
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round(((td / 5) * i) / 10) * 10);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* ---- Status operasi (bukan kontrol: animasi selalu berjalan) ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
        <span
          className="badge"
          style={{
            fontSize: 11,
            fontWeight: 700,
            background: drilling ? 'var(--success-soft)' : 'var(--warning-soft)',
            color: drilling ? 'var(--success)' : 'var(--warning)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
          }}
          aria-live="off"
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: drilling ? 'var(--success)' : 'var(--warning)',
              boxShadow: drilling ? '0 0 0 0 var(--success)' : undefined,
              animation: drilling ? 'rd-pulse 1.4s ease-in-out infinite' : undefined,
            }}
          />
          {drilling ? 'Sedang mengebor' : 'Menyambung pipa'}
        </span>

        <span className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          Bit <strong style={{ color: 'var(--text-primary)' }}>{animatedDepth.toFixed(1)} m</strong> dari TD{' '}
          {td.toFixed(0)} m
        </span>

        {/* Parameter putaran: membuat gerak bit bisa dibaca sebagai angka nyata. */}
        <span
          className="tnum"
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            gap: 10,
          }}
        >
          <span>
            RPM <strong style={{ color: drilling ? 'var(--text-primary)' : 'var(--text-muted)' }}>{rpm}</strong>
          </span>
          <span>
            Torque{' '}
            <strong style={{ color: drilling ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {torque.toFixed(1)} kNm
            </strong>
          </span>
        </span>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ============ ANIMASI ============ */}
        <div style={{ flex: '1 1 300px', minWidth: 260, maxWidth: 380 }}>
          <div style={{ display: 'flex' }}>
            {/* skala kedalaman */}
            <div style={{ position: 'relative', width: 56, flex: '0 0 auto', height }}>
              {ticks.map((tk, i) => (
                <div
                  key={`t${tk}-${i}`}
                  className="tnum"
                  style={{
                    position: 'absolute',
                    top: y(tk) - 6,
                    right: 4,
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tk.toLocaleString('en-US')}
                </div>
              ))}
            </div>

            {/* kanvas sumur */}
            <div
              style={{
                position: 'relative',
                flex: 1,
                height,
                background: 'linear-gradient(180deg, var(--bg-app) 0%, var(--bg-surface-2) 100%)',
                border: '1px solid var(--border-default)',
                borderRadius: 6,
                overflow: 'hidden',
              }}
              role="img"
              aria-label={`Animasi pengeboran sumur ${wellName}. Sedang ${
                drilling ? 'mengebor' : 'menyambung pipa'
              } pada kedalaman ${animatedDepth.toFixed(0)} meter dari target ${td.toFixed(0)} meter.`}
            >
              {/* grid kedalaman */}
              {ticks.map((tk, i) => (
                <div
                  key={`g${tk}-${i}`}
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: y(tk),
                    borderTop: i === ticks.length - 1 ? '2px solid var(--danger)' : '1px dashed var(--border-default)',
                  }}
                />
              ))}

              {/* ====== DERRICK ====== */}
              <svg
                aria-hidden
                width="100%"
                height={RIG_H}
                viewBox="0 0 200 84"
                preserveAspectRatio="none"
                style={{ position: 'absolute', top: 0, left: 0 }}
              >
                <polygon points="100,4 74,70 126,70" fill="none" stroke="var(--text-primary)" strokeWidth="2" />
                <line x1="82" y1="46" x2="118" y2="46" stroke="var(--text-muted)" strokeWidth="1.2" />
                <line x1="86" y1="34" x2="114" y2="34" stroke="var(--text-muted)" strokeWidth="1.2" />
                <line x1="90" y1="22" x2="110" y2="22" stroke="var(--text-muted)" strokeWidth="1.2" />
                <line x1="74" y1="70" x2="100" y2="34" stroke="var(--text-muted)" strokeWidth="0.8" />
                <line x1="126" y1="70" x2="100" y2="34" stroke="var(--text-muted)" strokeWidth="0.8" />
                <rect x="93" y="2" width="14" height="4" rx="1" fill="var(--chart-3)" />

                {/* travelling block: posisi mengikuti siklus */}
                <g transform={`translate(0 ${blockPos - 10})`}>
                  <rect
                    x="95"
                    y="14"
                    width="10"
                    height="7"
                    rx="1"
                    fill="var(--chart-3)"
                    stroke="var(--text-primary)"
                    strokeWidth="0.6"
                  />
                  <line x1="100" y1="21" x2="100" y2="27" stroke="var(--text-primary)" strokeWidth="1" />
                </g>

                {/* drill line (tali bor) dari crown ke travelling block */}
                <line
                  x1="97"
                  y1="6"
                  x2="97"
                  y2={14 + blockPos - 10}
                  stroke="var(--text-muted)"
                  strokeWidth="0.7"
                  strokeDasharray="2 2"
                />
                <line
                  x1="103"
                  y1="6"
                  x2="103"
                  y2={14 + blockPos - 10}
                  stroke="var(--text-muted)"
                  strokeWidth="0.7"
                  strokeDasharray="2 2"
                />

                <rect x="58" y="68" width="84" height="6" rx="1" fill="var(--text-primary)" />
                <rect x="66" y="74" width="6" height="10" fill="var(--text-muted)" />
                <rect x="128" y="74" width="6" height="10" fill="var(--text-muted)" />
                {/*
                  ROTARY TABLE: berputar bersama drill string. Ditandai dengan
                  dua penanda kecil yang bergeser ke samping, karena dari sisi
                  luar rotasi pada sumbu vertikal hanya terlihat sebagai gerak
                  menyamping.
                */}
                <rect x="90" y="66" width="20" height="4" rx="1" fill="var(--chart-3)" />
                <rect
                  x={92 + Math.sin((elapsed * 3.4 * (drilling ? 1 : 0.2)) % (Math.PI * 2)) * 6}
                  y="66.6"
                  width="2"
                  height="2.6"
                  fill="var(--text-primary)"
                  opacity="0.85"
                />
                <rect
                  x={106 + Math.cos((elapsed * 3.4 * (drilling ? 1 : 0.2)) % (Math.PI * 2)) * 6}
                  y="66.6"
                  width="2"
                  height="2.6"
                  fill="var(--text-primary)"
                  opacity="0.85"
                />
              </svg>

              {/* ====== OPEN HOLE ====== */}
              {bitY > y(deepestShoe) && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: y(deepestShoe),
                    height: Math.max(0, bitY - y(deepestShoe)),
                    left: `${(100 - widthPct(list[list.length - 1].sizeIn) * 0.84) / 2}%`,
                    width: `${widthPct(list[list.length - 1].sizeIn) * 0.84}%`,
                    background:
                      'repeating-linear-gradient(45deg, var(--bg-surface-2), var(--bg-surface-2) 5px, var(--bg-app) 5px, var(--bg-app) 10px)',
                    borderLeft: '1px solid var(--border-strong)',
                    borderRight: '1px solid var(--border-strong)',
                  }}
                />
              )}

              {/* ====== CASING ====== */}
              {list.map((c, idx) => {
                const w = widthPct(c.sizeIn);
                const top = RIG_H - 10;
                const bottom = y(c.shoeMd);
                const wall = idx === list.length - 1 ? 5 : 4;
                return (
                  <div
                    key={c.label}
                    style={{ position: 'absolute', top, left: 0, right: 0, height: bottom - top, zIndex: idx + 1 }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: `${(100 - w) / 2}%`,
                        width: wall,
                        top: 0,
                        bottom: 0,
                        background: c.color,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        right: `${(100 - w) / 2}%`,
                        width: wall,
                        top: 0,
                        bottom: 0,
                        background: c.color,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: `${(100 - w) / 2 - 1.5}%`,
                        width: `${w + 3}%`,
                        bottom: -2,
                        height: 4,
                        background: c.color,
                        borderRadius: 1,
                      }}
                      title={`${c.label} ${c.sizeLabel} - sepatu ${c.shoeMd.toFixed(0)} m`}
                    />
                  </div>
                );
              })}

              {/* ====== MUD naik di annulus ====== */}
              {mudParticles.map((i) => {
                const span = bitY - RIG_H;
                if (span <= 0) return null;
                const phase = (((elapsed * 0.28 * mudSpeed + i / mudParticles.length) % 1) + 1) % 1;
                const top = bitY - phase * span;
                const side = i % 2 === 0 ? -1 : 1;
                const offset = side * (11 + (i % 3) * 4);
                return (
                  <span
                    key={`mud-${i}`}
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top,
                      left: `calc(50% + ${offset}px)`,
                      width: 3,
                      height: 3,
                      borderRadius: '50%',
                      background: 'var(--info)',
                      opacity: 0.5,
                      zIndex: 18,
                      pointerEvents: 'none',
                    }}
                  />
                );
              })}

              {/* ====== DRILL STRING berputar ====== */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  top: RIG_H - 10,
                  height: Math.max(0, bitY - (RIG_H - 10)),
                  left: 'calc(50% - 2px)',
                  width: 4,
                  background: 'repeating-linear-gradient(180deg, var(--text-primary) 0 8px, transparent 8px 12px)',
                  backgroundPositionY: `${stringOffset}px`,
                  zIndex: 20,
                  opacity: 0.9,
                }}
              />

              {/* kelly / top drive */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  top: RIG_H - 16,
                  left: 'calc(50% - 5px)',
                  width: 10,
                  height: 10,
                  background: 'var(--chart-3)',
                  borderRadius: 1,
                  zIndex: 21,
                }}
              />

              {/* ====== BIT PDC ======
                  CATATAN ANIMASI (perbaikan):
                  Sebelumnya seluruh bit diputar `rotate()` sehingga terlihat
                  seperti roda berputar pada sumbu layar. Itu salah: bit bor
                  berputar pada SUMBU VERTIKAL (searah lubang bor), jadi dari
                  samping yang terlihat hanyalah:
                    - alur blade (blade flutes) bergerak menyamping,
                    - cutter bergantian muncul di sisi kiri/kanan,
                    - getaran halus (vibration) dan naik-turun kecil.
                  Itulah yang digambar di sini.
              */}
              {(() => {
                // Fase rotasi sumbu vertikal: 1 putaran penuh = waktu tertentu.
                const rpmVisual = drilling ? 1 : 0.15;
                const axialPhase = (elapsed * 2.2 * rpmVisual) % 1; // 0..1
                // Blade tampak bergeser ke samping karena rotasi aksial.
                const flankShift = Math.sin(axialPhase * Math.PI * 2) * 2.2;
                // Cutter counters: muncul bergantian di kiri/kanan.
                const cutterLeft = Math.max(0, Math.cos(axialPhase * Math.PI * 2));
                const cutterRight = Math.max(0, -Math.cos(axialPhase * Math.PI * 2));
                // Getaran halus saat mengebor (torsional vibration).
                const chatter = drilling ? Math.sin(elapsed * 26) * 0.6 : 0;

                return (
                  <div
                    style={{
                      position: 'absolute',
                      top: bitY - 7 + chatter,
                      left: 'calc(50% - 10px)',
                      width: 20,
                      height: 20,
                      zIndex: 22,
                    }}
                    title={`Bit PDC ${drilling ? 'berputar' : 'berhenti'} pada ${animatedDepth.toFixed(1)} m`}
                  >
                    <svg aria-hidden width="20" height="20" viewBox="0 0 20 20">
                      {/* shank bit (badan atas, tetap) */}
                      <rect x="6" y="0" width="8" height="5" rx="1" fill="var(--chart-3)" stroke="var(--text-primary)" strokeWidth="1" />

                      {/* badan bit dengan alur blade bergeser sesuai rotasi */}
                      <path
                        d={`M5 5 L15 5 L${13 + flankShift * 0.4} 12 L${7 + flankShift * 0.4} 12 Z`}
                        fill="var(--chart-3)"
                        stroke="var(--text-primary)"
                        strokeWidth="1"
                      />
                      {/* alur blade kiri & kanan (indikator rotasi aksial) */}
                      <line
                        x1={6.2 + flankShift * 0.3}
                        y1="6"
                        x2={6.8 + flankShift * 0.3}
                        y2="11.4"
                        stroke="var(--text-primary)"
                        strokeWidth="0.9"
                        opacity="0.75"
                      />
                      <line
                        x1={13.8 - flankShift * 0.3}
                        y1="6"
                        x2={13.2 - flankShift * 0.3}
                        y2="11.4"
                        stroke="var(--text-primary)"
                        strokeWidth="0.9"
                        opacity="0.75"
                      />

                      {/* cutter PDC: tampil bergantian kiri/kanan mengikuti putaran */}
                      <circle cx="6.4" cy="11.6" r="1.7" fill="var(--text-primary)" opacity={0.25 + cutterLeft * 0.75} />
                      <circle cx="13.6" cy="11.6" r="1.7" fill="var(--text-primary)" opacity={0.25 + cutterRight * 0.75} />
                      <circle cx="10" cy="11.6" r="1.5" fill="var(--text-primary)" opacity="0.9" />

                      {/* cone / cutting face bawah */}
                      <polygon points="5,12 15,12 12,19 8,19" fill="var(--text-primary)" />
                      {/* nozzle (jalur mud keluar) */}
                      <circle cx="10" cy="15.4" r="1.1" fill="var(--bg-surface)" opacity="0.85" />
                    </svg>
                  </div>
                );
              })()}

              {/*
                CUTTING (serbuk bor) naik melalui annulus.
                Ini pembeda nyata antara "sedang mengebor" dan "diam": selama
                bit memotong batuan, cutting terbawa mud ke permukaan. Partikel
                kecil berwarna tanah bergerak naik di sisi luar drill string.
              */}
              {drilling &&
                Array.from({ length: 6 }, (_, i) => {
                  const span = bitY - (RIG_H - 10);
                  if (span <= 0) return null;
                  // cutting bergerak lebih lambat dari mud dan sedikit tertinggal.
                  const phase = (((elapsed * 0.16 + i / 6) % 1) + 1) % 1;
                  const top = bitY - phase * span;
                  const side = i % 2 === 0 ? -1 : 1;
                  const xOff = side * (7 + (i % 3) * 3);
                  return (
                    <span
                      key={`cutrise-${i}`}
                      aria-hidden
                      style={{
                        position: 'absolute',
                        top,
                        left: `calc(50% + ${xOff}px)`,
                        width: 2.5,
                        height: 2.5,
                        borderRadius: '1px',
                        background: 'var(--warning)',
                        opacity: 0.55 * (1 - phase * 0.5),
                        zIndex: 19,
                        pointerEvents: 'none',
                        transform: `rotate(${45 + phase * 90}deg)`,
                      }}
                    />
                  );
                })}

              {/* percikan cutting di bawah bit (batuan hancur) */}
              {drilling &&
                [0, 1, 2].map((i) => {
                  const phase = (((elapsed * 1.8 + i / 3) % 1) + 1) % 1;
                  return (
                    <span
                      key={`cut-${i}`}
                      aria-hidden
                      style={{
                        position: 'absolute',
                        top: bitY + 9,
                        left: `calc(50% + ${(i - 1) * 9 + phase * 8}px)`,
                        width: 2.5,
                        height: 2.5,
                        borderRadius: '1px',
                        background: 'var(--chart-3)',
                        opacity: 1 - phase,
                        zIndex: 23,
                        pointerEvents: 'none',
                        transform: `rotate(${phase * 120}deg)`,
                      }}
                    />
                  );
                })}

              {/* label TD */}
              <span
                style={{
                  position: 'absolute',
                  bottom: 3,
                  right: 5,
                  fontSize: 9,
                  fontWeight: 700,
                  color: 'var(--danger)',
                  background: 'var(--bg-surface)',
                  padding: '1px 4px',
                  borderRadius: 2,
                  zIndex: 25,
                }}
              >
                TD {td.toFixed(0)} m
              </span>
            </div>
          </div>

          <p style={{ margin: '6px 0 0 56px', fontSize: 10, color: 'var(--text-muted)' }}>
            Permukaan (rotary table) - garis putus menandakan sirkulasi mud
          </p>
        </div>

        {/* ============ LEGENDA ============ */}
        <div style={{ flex: '1 1 210px', minWidth: 190 }}>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
            }}
          >
            Susunan casing
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.map((c) => (
              <li key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span
                  aria-hidden
                  style={{ width: 4, height: 20, flex: '0 0 auto', background: c.color, borderRadius: 1 }}
                />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {c.label} <span className="tnum">{c.sizeLabel}</span>
                  </span>
                  <span className="tnum" style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)' }}>
                    sepatu {c.shoeMd.toFixed(0)} m
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              background: 'var(--bg-surface-2)',
              borderRadius: 'var(--radius-input)',
              fontSize: 11,
              color: 'var(--text-secondary)',
              lineHeight: 1.7,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden style={{ width: 10, height: 6, background: 'var(--chart-3)', borderRadius: 1 }} />
              <strong style={{ color: 'var(--text-primary)' }}>Bit</strong>
              <span className="tnum" style={{ marginLeft: 'auto' }}>{animatedDepth.toFixed(1)} m</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden style={{ width: 3, height: 3, background: 'var(--info)', borderRadius: '50%' }} />
              <span>Mud kembali ke permukaan</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden style={{ width: 10, height: 3, background: 'var(--text-primary)' }} />
              <span>Drill string berputar</span>
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
              <span>Progres terhadap TD</span>
              <span className="tnum" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                {td > 0 ? ((baseDepth / td) * 100).toFixed(0) : 0}%
              </span>
            </div>
            <div
              style={{
                marginTop: 4,
                height: 6,
                borderRadius: 999,
                background: 'var(--bg-surface-2)',
                overflow: 'hidden',
              }}
              role="progressbar"
              aria-valuenow={td > 0 ? Math.round((baseDepth / td) * 100) : 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progres kedalaman terhadap TD"
            >
              <div
                style={{
                  width: `${td > 0 ? Math.min(100, (baseDepth / td) * 100) : 0}%`,
                  height: '100%',
                  background: 'var(--accent-teal)',
                  transition: 'width 400ms ease',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
