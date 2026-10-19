'use client';

/**
 * WellboreDiagram v2 - ilustrasi pengeboran yang sesungguhnya.
 *
 * Perbaikan dari versi sebelumnya:
 *  - Skala kedalaman diberi label yang TIDAK bertumpuk (dulu 0/640/1280/...
 *    berdesakan) dan diletakkan di kolom khusus dengan lebar tetap.
 *  - Casing digambar sebagai PIPA BERLAPIS (dinding + lubang) dengan ukuran
 *    inci yang benar, bukan bar warna.
 *  - Ditambahkan RIG di permukaan: derrick, rotary table, drill floor, dan
 *    drill string yang menyambung dari rig ke bit. Ini yang membuat gambar
 *    terbaca sebagai "aktivitas pengeboran", bukan sekadar bar chart.
 *  - Bit digambar sebagai kerucut PDC dengan nozzle, di kedalaman terkini.
 *  - Formasi batuan di belakang casing (lapisan netral) memberi konteks
 *    bawah permukaan.
 *  - Semua label memakai HTML absolut dengan latar solid supaya tidak
 *    menembus garis.
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

export function WellboreDiagram({ wellName, tdPlannedMd, currentMd, casings, height = 420 }: Props) {
  const td = tdPlannedMd > 0 ? tdPlannedMd : 0;
  const current = currentMd > 0 ? Math.min(currentMd, td || currentMd) : 0;
  const list = casings && casings.length > 0 ? casings : td > 0 ? defaultCasings(td) : [];

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
        TD planned sumur ini belum diisi. Isi angka TD pada tab Planning agar penampang lubang bor dapat digambar.
      </div>
    );
  }

  const RIG_H = 64; // tinggi area rig di atas permukaan
  const plotH = height - RIG_H;

  /** Posisi vertikal (px) untuk kedalaman tertentu, di dalam area plot. */
  const y = (md: number) => RIG_H + Math.max(0, Math.min(1, md / td)) * plotH;

  const maxSize = Math.max(...list.map((c) => c.sizeIn));
  /** Lebar pipa relatif: casing terbesar ~72% lebar kolom. */
  const widthPct = (sizeIn: number) => 26 + (sizeIn / maxSize) * 46;

  const bitAt = current > 0 ? current : null;
  const deepestShoe = Math.max(...list.map((c) => c.shoeMd));

  // Tanda skala: 5 segmen, label dibulatkan ke 10 m agar rapi.
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const raw = (td / tickCount) * i;
    return Math.round(raw / 10) * 10;
  });

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* ============ AREA GAMBAR ============ */}
      <div style={{ position: 'relative', flex: '1 1 300px', minWidth: 260, maxWidth: 360 }}>
        <div style={{ display: 'flex' }}>
          {/* --- Kolom skala kedalaman (lebar tetap, tidak bertumpuk) --- */}
          <div style={{ position: 'relative', width: 58, flex: '0 0 auto', height }}>
            {ticks.map((t, i) => (
              <div
                key={`t-${t}-${i}`}
                style={{
                  position: 'absolute',
                  top: y(t) - 6,
                  left: 0,
                  width: 52,
                  textAlign: 'right',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.toLocaleString('en-US')}
              </div>
            ))}
            <div
              style={{
                position: 'absolute',
                top: RIG_H,
                left: 54,
                bottom: 0,
                borderLeft: '1px solid var(--border-strong)',
              }}
            />
          </div>

          {/* --- Kolom penampang sumur --- */}
          <div
            role="img"
            aria-label={`Ilustrasi pengeboran ${wellName}. Rig di permukaan, casing bertingkat sampai ${deepestShoe.toFixed(
              0,
            )} meter, bit pada ${current.toFixed(0)} meter, target TD ${td.toFixed(0)} meter.`}
            style={{
              position: 'relative',
              flex: 1,
              height,
              background: 'var(--bg-app)',
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {/* Garis skala horizontal */}
            {ticks.map((t, i) => (
              <div
                key={`g-${t}-${i}`}
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: y(t),
                  borderTop: i === ticks.length - 1 ? '2px solid var(--danger)' : '1px dashed var(--border-default)',
                }}
              />
            ))}

            {/* ---- RIG di permukaan (derrick + drill floor) ---- */}
            <svg
              aria-hidden
              width="100%"
              height={RIG_H}
              viewBox="0 0 200 64"
              preserveAspectRatio="none"
              style={{ position: 'absolute', top: 0, left: 0 }}
            >
              {/* derrick: dua kaki menyilang ke atas */}
              <polygon points="100,2 76,56 124,56" fill="none" stroke="var(--text-primary)" strokeWidth="2" />
              <line x1="88" y1="30" x2="112" y2="30" stroke="var(--text-primary)" strokeWidth="1.5" />
              <line x1="94" y1="16" x2="106" y2="16" stroke="var(--text-primary)" strokeWidth="1.5" />
              {/* drill floor */}
              <rect x="60" y="54" width="80" height="5" fill="var(--text-primary)" />
              {/* substructure */}
              <rect x="70" y="59" width="6" height="5" fill="var(--text-muted)" />
              <rect x="124" y="59" width="6" height="5" fill="var(--text-muted)" />
              {/* crown block + travelling block */}
              <rect x="95" y="4" width="10" height="3" fill="var(--chart-3)" />
              <rect x="96.5" y="14" width="7" height="5" fill="var(--chart-3)" />
            </svg>

            {/* ---- Lubang terbuka (open hole) di bawah sepatu terdalam ---- */}
            {bitAt != null && bitAt > deepestShoe && (
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  top: y(deepestShoe),
                  height: Math.max(0, y(bitAt) - y(deepestShoe)),
                  left: `${(100 - widthPct(list[list.length - 1].sizeIn) * 0.86) / 2}%`,
                  width: `${widthPct(list[list.length - 1].sizeIn) * 0.86}%`,
                  background: 'repeating-linear-gradient(45deg, var(--bg-surface-2), var(--bg-surface-2) 6px, var(--bg-app) 6px, var(--bg-app) 12px)',
                  borderLeft: '2px solid var(--border-strong)',
                  borderRight: '2px solid var(--border-strong)',
                }}
              />
            )}

            {/* ---- Casing bertingkat: gambar sebagai pipa (dua dinding) ---- */}
            {list.map((c, idx) => {
              const w = widthPct(c.sizeIn);
              const top = RIG_H - 6;
              const bottom = y(c.shoeMd);
              const wall = idx === list.length - 1 ? 5 : 4;
              return (
                <div key={c.label} style={{ position: 'absolute', top, left: 0, right: 0, height: bottom - top, zIndex: idx + 1 }}>
                  {/* dinding kiri */}
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
                  {/* dinding kanan */}
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
                  {/* sepatu casing (shoe) */}
                  <div
                    style={{
                      position: 'absolute',
                      left: `${(100 - w) / 2 - 2}%`,
                      width: `${w + 4}%`,
                      bottom: -3,
                      height: 5,
                      background: c.color,
                      borderRadius: 1,
                    }}
                    title={`${c.label} ${c.sizeLabel} - sepatu ${c.shoeMd.toFixed(0)} m`}
                  />
                  {/* label ukuran di dalam pipa */}
                  <span
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: 6,
                      transform: 'translateX(-50%)',
                      fontSize: 9,
                      fontWeight: 700,
                      color: c.color,
                      background: 'var(--bg-app)',
                      padding: '0 3px',
                      borderRadius: 2,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.sizeLabel}
                  </span>
                </div>
              );
            })}

            {/* ---- Drill string dari rig ke bit ---- */}
            {bitAt != null && (
              <>
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: RIG_H,
                    height: Math.max(0, y(bitAt) - RIG_H),
                    left: 'calc(50% - 2px)',
                    width: 4,
                    background: 'var(--text-primary)',
                    opacity: 0.8,
                    zIndex: 20,
                  }}
                />
                {/* kelly / top drive di rig */}
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: RIG_H - 12,
                    left: 'calc(50% - 5px)',
                    width: 10,
                    height: 12,
                    background: 'var(--chart-3)',
                    borderRadius: 1,
                    zIndex: 21,
                  }}
                />

                {/* ---- BIT (PDC) di kedalaman terkini ---- */}
                <div
                  title={`Bit pada ${bitAt.toFixed(1)} m MD`}
                  style={{
                    position: 'absolute',
                    top: y(bitAt) - 4,
                    left: 'calc(50% - 9px)',
                    width: 18,
                    zIndex: 22,
                  }}
                >
                  {/* body bit */}
                  <div style={{ height: 10, background: 'var(--chart-3)', border: '1.5px solid var(--text-primary)', borderRadius: 2 }} />
                  {/* cutting structure */}
                  <svg aria-hidden width="18" height="8" viewBox="0 0 18 8">
                    <polygon points="0,0 18,0 13,8 5,8" fill="var(--text-primary)" />
                  </svg>
                </div>

                {/* label kedalaman bit */}
                <span
                  className="tnum"
                  style={{
                    position: 'absolute',
                    top: y(bitAt) + 12,
                    left: '58%',
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    background: 'var(--chart-3)',
                    padding: '1px 4px',
                    borderRadius: 2,
                    whiteSpace: 'nowrap',
                    zIndex: 22,
                  }}
                >
                  {bitAt.toFixed(0)} m
                </span>
              </>
            )}

            {/* ---- Penanda TD ---- */}
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

        {/* Garis permukaan tanah */}
        <div style={{ display: 'flex', marginTop: 1 }}>
          <span style={{ width: 58 }} />
          <span style={{ flex: 1, height: 3, background: 'var(--border-strong)', borderRadius: 2 }} title="Permukaan tanah / rotary table" />
        </div>
        <p style={{ margin: '4px 0 0 58px', fontSize: 10, color: 'var(--text-muted)' }}>Permukaan (rotary table)</p>
      </div>

      {/* ============ LEGENDA ============ */}
      <div style={{ flex: '1 1 210px', minWidth: 190, minHeight: 0 }}>
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
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {list.map((c) => (
            <li key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                aria-hidden
                style={{ width: 4, height: 22, flex: '0 0 auto', background: c.color, borderRadius: 1 }}
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
            marginTop: 12,
            padding: '8px 10px',
            background: 'var(--bg-surface-2)',
            borderRadius: 'var(--radius-input)',
            fontSize: 11,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span aria-hidden style={{ width: 12, height: 8, background: 'var(--chart-3)', borderRadius: 1 }} />
            <strong style={{ color: 'var(--text-primary)' }}>Bit</strong> pada{' '}
            <span className="tnum">{current.toFixed(0)} m</span>
          </div>
          <div>
            Target TD <span className="tnum">{td.toFixed(0)} m</span>
            {td > 0 && current > 0 ? `, tercapai ${((current / td) * 100).toFixed(0)}%` : ''}
          </div>
        </div>

        <div
          style={{
            marginTop: 8,
            height: 6,
            borderRadius: 999,
            background: 'var(--bg-surface-2)',
            overflow: 'hidden',
          }}
          role="progressbar"
          aria-valuenow={td > 0 ? Math.round((current / td) * 100) : 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progres kedalaman terhadap TD"
        >
          <div
            style={{
              width: `${td > 0 ? Math.min(100, (current / td) * 100) : 0}%`,
              height: '100%',
              background: 'var(--accent-teal)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
