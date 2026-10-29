/**
 * BrandMark - SATU-SATUNYA marka RigDaily.
 *
 * Bentuk: HELM PROYEK (hard hat) di atas kotak navy, sesuai permintaan.
 * Bentuk ini dipakai di semua tempat: sidebar dashboard, topbar, halaman login,
 * landing page, favicon, dan ikon PWA. `scripts/gen-icons.mjs` menghasilkan
 * favicon/PNG dari geometri yang sama, jadi tidak ada lagi marka yang berbeda.
 *
 * Geometri mengikuti gambar helm 24x24 lalu diskalakan ke viewBox 64x64
 * (faktor 64/24) supaya proporsinya tetap sama di semua ukuran.
 */

const NAVY = 'var(--bg-sidebar)';
const TEAL = 'var(--accent-teal)';

export function BrandMark({
  size = 32,
  /** Di atas latar navy (sidebar): garis tepi tipis agar bentuk terbaca. */
  onDark = false,
  className,
}: {
  size?: number;
  onDark?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden
      focusable="false"
      style={{
        display: 'block',
        flex: '0 0 auto',
        // 12/64 = 18.75%: sudut membulat, tetap proporsional di ukuran apa pun.
        borderRadius: '18.75%',
        ...(onDark ? { boxShadow: 'inset 0 0 0 1.5px rgba(255, 255, 255, 0.24)' } : null),
      }}
    >
      <rect width="64" height="64" rx="12" fill={NAVY} />
      <g
        transform="scale(2.6667)"
        fill="none"
        stroke={TEAL}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Kubah helm */}
        <path d="M4 15v-3a6 6 0 0 1 6-6" />
        <path d="M14 6a6 6 0 0 1 6 6v3" />
        {/* Tonjolan atas */}
        <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" />
      </g>
      {/* Rim bawah: diisi, bukan digaris, agar helm tetap terbaca di ukuran 16px. */}
      <rect x="5.33" y="40" width="53.33" height="8" rx="2.67" fill={TEAL} />
    </svg>
  );
}
