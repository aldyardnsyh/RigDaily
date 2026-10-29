/**
 * Akun demo yang benar-benar ada di dataset seed.
 *
 * Dipakai halaman login (masuk cepat) dan banner demo di dalam aplikasi.
 * Jangan mengarang email di sini: `seed.ts` harus membuat akun dengan email
 * yang sama, jika tidak tombol masuk cepat akan gagal.
 */
import type { RoleId } from './roles';

export const DEMO_PASSWORD = 'rigdaily123';

export type DemoAccount = {
  role: RoleId;
  email: string;
  name: string;
  /** Ringkasan satu baris tentang apa yang bisa dicoba dengan peran ini. */
  focus: string;
};

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    role: 'Admin',
    email: 'admin@rigdaily.local',
    name: 'System Administrator',
    focus: 'Akses penuh: master data, pengguna, rate card, audit.',
  },
  {
    role: 'CompanyMan',
    email: 'dave.miller@medco-energi.com',
    name: 'Dave Miller',
    focus: 'Approve & tanda tangan DDR, lihat biaya dan audit.',
  },
  {
    role: 'RigClerk',
    email: 's.jenkins@medco-energi.com',
    name: 'Sarah Jenkins',
    focus: 'Buat dan kirim DDR harian: time, personnel, marine.',
  },
  {
    role: 'DrillingEngineer',
    email: 'a.arifin@partner-jv.com',
    name: 'Dr. A. Arifin',
    focus: 'Validasi lintas sumur, amendment, dan well file.',
  },
  {
    role: 'CostController',
    email: 'cost.control@medco-energi.com',
    name: 'Rina Wibowo',
    focus: 'Biaya, AFE, dan billing bulanan.',
  },
  {
    role: 'HSE',
    email: 'hse@medco-energi.com',
    name: 'Budi Santoso',
    focus: 'Insiden safety dan klasifikasi NPT.',
  },
  {
    role: 'Viewer',
    email: 'h.setiawan@pertamina-jv.com',
    name: 'Hendra Setiawan',
    focus: 'Read-only dashboard, laporan, dan PDF.',
  },
];
