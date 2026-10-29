import type { MetadataRoute } from 'next';

/**
 * Web app manifest.
 *
 * Tujuannya supaya ikon muncul juga saat situs dipasang ke home screen
 * Android/iOS dan di task switcher, bukan hanya di tab browser.
 *
 * `icon-maskable-512.png` memakai latar penuh dengan gambar 72% di tengah,
 * sesuai safe zone maskable agar tidak terpotong bentuk lingkaran/squircle.
 * Ikon SVG ikut dicantumkan untuk peramban yang mendukungnya (ukuran apa pun).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RigDaily - Pelaporan Operasi Sumur Harian',
    short_name: 'RigDaily',
    description:
      'DDR harian, time breakdown 24 jam, NPT, biaya, personel, dan sinkronisasi rig ke kantor.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#FAF8FF',
    theme_color: '#0F2A44',
    lang: 'id',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}