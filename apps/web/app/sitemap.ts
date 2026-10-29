import type { MetadataRoute } from 'next';

/**
 * sitemap.xml.
 *
 * Hanya berisi SATU URL: halaman depan publik (`/`). Seluruh rute aplikasi
 * butuh sesi dan sengaja tidak didaftarkan supaya tidak terindeks.
 *
 * `lastModified` memakai tanggal build agar Google tahu kapan harus merayapi
 * ulang, tanpa perlu memelihara tanggal manual per halaman.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return [
    {
      url: `${base}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
