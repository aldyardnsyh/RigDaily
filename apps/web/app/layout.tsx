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
   * Ikon.
   *
   * `app/favicon.ico` dilayani otomatis oleh Next di /favicon.ico, jadi ia
   * TIDAK didaftarkan di sini (mendaftarkannya lagi hanya membuat tag ganda).
   * Yang didaftarkan: SVG (tajam di semua ukuran) dan PNG untuk peramban serta
   * perangkat yang tidak memakai SVG sebagai ikon tab.
   *
   * Catatan penting: path berakhiran ekstensi kini dikecualikan di middleware,
   * kalau tidak berkas ikon dibalas HTML dan tidak pernah tampil.
   */
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/favicon.ico'],
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
