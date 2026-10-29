import type { MetadataRoute } from 'next';

/**
 * robots.txt.
 *
 * Kebijakan:
 *  - Halaman publik (`/`) BOLEH dirayapi dan diindeks: ini satu-satunya pintu
 *    masuk yang memang ditujukan untuk mesin pencari.
 *  - Seluruh area aplikasi (`/login`, `/dashboard`, `/ddr`, dst) DILARANG:
 *    isinya data operasional internal dan selalu butuh sesi. Merayapinya hanya
 *    membuang crawl budget dan berisiko mengindeks halaman login kosong.
 *  - Aset dan API tidak perlu disebut satu per satu: pola `/*?*` menutup semua
 *    URL ber-query string (mis. `?next=`, `?demo=`) supaya tidak terindeks
 *    sebagai halaman duplikat.
 *
 * URL kanonis diambil dari `NEXT_PUBLIC_SITE_URL` agar sama di semua lingkungan
 * (lokal, staging, produksi). Bila env tidak diset, sitemap menunjuk localhost
 * dan Google Search Console akan menolaknya: itu sinyal yang benar, bukan bug.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/login', '/dashboard', '/ddr', '/api/', '/*?*'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
