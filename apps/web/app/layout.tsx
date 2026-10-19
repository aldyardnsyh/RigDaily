import type { Metadata } from 'next';
import './globals.css';
import { ToasterClient } from '../components/ToasterClient';

// Font dimuat lewat CSS lokal (font-family sudah didefinisikan di
// packages/ui/tokens.css dengan fallback system-ui). Sengaja TIDAK memakai
// next/font/google agar build/dev tidak bergantung koneksi ke Google Fonts:
// sebelumnya kegagalan unduh Inter memicu AbortError dan memperlambat request.
export const metadata: Metadata = {
  /*
   * Title memakai template: setiap halaman bisa menambahkan judulnya sendiri
   * lewat `export const metadata` dan otomatis mendapat akhiran "RigDaily".
   */
  title: {
    default: 'RigDaily - Well Operations Reporting',
    template: '%s | RigDaily',
  },
  description:
    'Pelaporan operasi sumur harian: DDR, time breakdown 24 jam, NPT, biaya dan AFE, billing, serta sinkronisasi rig ke kantor.',
  applicationName: 'RigDaily',
  /*
   * Ikon memakai SVG statis dari `app/icon.svg`. SVG dipilih karena ringan,
   * tajam di semua ukuran, dan tidak memerlukan render gambar saat build.
   * (Pendekatan `ImageResponse` sempat dicoba, tetapi gagal bila path proyek
   * mengandung spasi karena pustaka og membangun URL dari path tersebut.)
   */
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-icon.svg', type: 'image/svg+xml', sizes: '180x180' }],
    shortcut: ['/favicon.svg'],
  },
  /*
   * themeColor navy, sama dengan sidebar, agar warna address bar browser
   * selaras dengan identitas aplikasi di perangkat bergerak.
   */
  themeColor: '#0F2A44',
  viewport: {
    width: 'device-width',
    initialScale: 1,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        {children}
        <ToasterClient />
      </body>
    </html>
  );
}
