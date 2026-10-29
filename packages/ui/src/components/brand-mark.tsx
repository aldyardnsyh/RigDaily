/**
 * BrandMark - SATU-SATUNYA marka RigDaily.
 *
 * KENAPA FILE INI ADA
 * Sebelumnya marka dibuat ulang di tiga tempat dengan hasil berbeda:
 *   - sidebar/dashboard : ikon helm dari pustaka Lucide, kotak teal
 *   - halaman login     : karakter "$" di kotak navy
 *   - landing page      : derrick SVG di kotak navy
 *   - favicon           : derrick SVG di kotak navy
 * Akibatnya ikon di tab browser tidak sama dengan ikon di dalam aplikasi.
 *
 * Sekarang semua tempat memakai komponen ini, dan `scripts/gen-icons.mjs`
 * menghasilkan favicon/PNG dari geometri yang sama. Satu bentuk, satu warna.
 *
 * Ukuran: atribut `width`/`height` adalah nilai bawaan. CSS boleh menimpanya
 * (mis. marka login yang mengecil di layar pendek), karena atribut presentasi
 * SVG kalah oleh aturan CSS. `border-radius` memakai persen agar selalu
 * proporsional terhadap ukuran berapa pun.
 */

const NAVY = 'var(--bg-sidebar)';
const TEAL = 'var(--accent-teal)';
const AMBER = 'var(--chart-3)';
const BASE = 'var(--bg-surface)';
const LEG = 'var(--text-muted)';

export function BrandMark({
  size = 32,
  /** Di atas latar navy (sidebar): beri garis tepi tipis agar bentuknya terbaca. */
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
        // 12/64 = 18.75%: sudut membulat ikon, tetap proporsional di ukuran apa pun.
        borderRadius: '18.75%',
        ...(onDark ? { boxShadow: 'inset 0 0 0 1.5px rgba(255, 255, 255, 0.24)' } : null),
      }}
    >
      <rect width="64" height="64" rx="12" fill={NAVY} />
      <g stroke={TEAL} strokeWidth="2.2" strokeLinecap="round" fill="none">
        <line x1="20" y1="50" x2="32" y2="16" />
        <line x1="44" y1="50" x2="32" y2="16" />
        <line x1="24" y1="39" x2="40" y2="39" />
        <line x1="27" y1="30" x2="37" y2="30" />
      </g>
      <rect x="29" y="13" width="6" height="3" rx="1" fill={AMBER} />
      <rect x="18" y="50" width="28" height="3" rx="1.5" fill={BASE} />
      <rect x="22" y="53" width="4" height="5" fill={LEG} />
      <rect x="38" y="53" width="4" height="5" fill={LEG} />
    </svg>
  );
}
