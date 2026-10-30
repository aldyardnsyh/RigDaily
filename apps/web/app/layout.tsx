import type { Metadata } from 'next';
import { VENDOR_NAME, VENDOR_SHORT } from '@rigdaily/shared';
import './globals.css';
import { ToasterClient } from '../components/ToasterClient';

// Font dimuat lewat CSS lokal (font-family sudah didefinisikan di
// packages/ui/tokens.css dengan fallback system-ui). Sengaja TIDAK memakai
// next/font/google agar build/dev tidak bergantung koneksi ke Google Fonts:
// sebelumnya kegagalan unduh Inter memicu AbortError dan memperlambat request.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  /*
   * Title memakai template: setiap halaman bisa menambahkan judulnya sendiri
   * lewat `export const metadata` dan otomatis mendapat akhiran "RigDaily".
   */
  title: {
    default: 'RigDaily - Pelaporan Operasi Sumur Harian',
    template: '%s | RigDaily',
  },
  description:
    'RigDaily mencatat DDR harian, time breakdown 24 jam, NPT, biaya, personel, dan kondisi sumur di rig, lalu menyinkronkannya ke kantor untuk disetujui dan didistribusikan.',
  applicationName: 'RigDaily',
  authors: [{ name: `${VENDOR_NAME} (${VENDOR_SHORT})` }],
  creator: VENDOR_NAME,
  publisher: VENDOR_NAME,
  keywords: [
    'daily drilling report',
    'DDR',
    'laporan harian pengeboran',
    'time breakdown',
    'NPT',
    'operasi sumur',
    'well operations',
    'rig reporting',
    'AFE',
    'laporan pengeboran migas',
  ],
  /*
   * Halaman aplikasi butuh sesi; hanya halaman depan publik yang boleh diindeks.
   * Aturan per-rute yang lebih rinci ada di app/robots.ts.
   */
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: '/',
  },
  /*
   * Open Graph + Twitter Card: pratinjau saat tautan dibagikan.
   * Gambar memakai ikon 512 yang sudah ada, supaya tidak ada aset baru.
   */
  openGraph: {
    type: 'website',
    locale: 'id_ID',
    url: '/',
    siteName: 'RigDaily',
    title: 'RigDaily - Pelaporan Operasi Sumur Harian',
    description:
      'DDR harian, time breakdown 24 jam, NPT, biaya, dan sinkronisasi rig ke kantor dalam satu alur.',
    images: [
      {
        url: '/icon-512.png',
        width: 512,
        height: 512,
        alt: 'Marka RigDaily',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'RigDaily - Pelaporan Operasi Sumur Harian',
    description:
      'DDR harian, time breakdown 24 jam, NPT, biaya, dan sinkronisasi rig ke kantor dalam satu alur.',
    images: ['/icon-512.png'],
  },
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
