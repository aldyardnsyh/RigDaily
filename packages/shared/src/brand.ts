/**
 * Identitas pemilik produk — SATU-SATUNYA sumber string atribusi.
 *
 * Semua footer, metadata, health check, dan dialog About WAJIB import dari
 * sini. Tujuannya: menghapus atribusi butuh edit di banyak tempat sekaligus,
 * bukan satu baris. Ini bukan proteksi teknis penuh (lihat docs/ARCHITECTURE.md),
 * melainkan lapisan murah yang membuat kloning malas.
 */
export const VENDOR_NAME = 'PogungSoftwareHouseTeam';
export const VENDOR_SHORT = 'PSHT';
export const COPYRIGHT_NOTICE = 'Hak cipta (c) 2026 PogungSoftwareHouseTeam (PSHT). Seluruh hak dilindungi.';
export const VENDOR_URL = 'https://www.rigdaily.web.id';
