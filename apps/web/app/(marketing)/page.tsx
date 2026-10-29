import type { Metadata } from 'next';
import Link from 'next/link';
import { ROLES, ROLE_IDS } from '@rigdaily/shared';
import { BrandMark } from '@rigdaily/ui';
import './landing.css';

/**
 * LANDING PAGE (halaman awal publik).
 *
 * Halaman ini satu-satunya rute yang boleh diindeks mesin pencari
 * (lihat app/robots.ts dan app/sitemap.ts). Metadata di bawah melengkapi
 * metadata global dari root layout dengan judul dan deskripsi khusus halaman
 * depan, supaya hasil pencarian menampilkan ringkasan yang menjual.
 *
 * Aturan halaman ini:
 *  - Halaman pertama yang dimuat saat membuka domain. Tidak memerlukan sesi.
 *  - Dua jalan masuk: `/login` untuk kredensial, `/login?demo=1` untuk mencoba
 *    dengan akun contoh yang sudah ada di dataset seed.
 *  - Tanpa panggilan database. Semua isi statis supaya halaman depan tetap
 *    terbuka walau basis data sedang sibuk atau belum siap.
 *  - Seluruh warna, radius, dan bayangan memakai token di
 *    `packages/ui/tokens.css`; tidak ada hex baru di sini.
 *
 * Arah desain: bahasa industri bersih yang sama dengan aplikasi (navy untuk
 * struktur, teal hanya untuk aksi utama), ENERGY 2 / RHYTHM 2 / MOTION 1.
 */

export const metadata: Metadata = {
  title: 'RigDaily - Pelaporan Operasi Sumur Harian',
  description:
    'RigDaily mencatat DDR, time breakdown 24 jam, NPT, biaya, personel, dan kondisi sumur di rig, lalu menyinkronkannya ke kantor untuk disetujui dan didistribusikan.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    url: '/',
    title: 'RigDaily - Pelaporan Operasi Sumur Harian',
    description:
      'Laporan harian rig selesai sebelum shift berganti: DDR, time breakdown 24 jam, NPT, biaya, dan sinkronisasi rig ke kantor.',
  },
};

/**
 * Marka rig diambil dari komponen bersama `BrandMark` (@rigdaily/ui), bukan
 * SVG yang ditulis ulang di sini. Dengan begitu landing page, halaman login,
 * sidebar dashboard, dan favicon memakai satu bentuk yang sama persis.
 */

/** Skema sumur: ilustrasi struktur, bukan data operasi. */
function WellSchematic() {
  return (
    <svg
      className="lp-schematic-svg"
      viewBox="0 0 330 300"
      role="img"
      aria-labelledby="lp-schematic-title lp-schematic-desc"
    >
      <title id="lp-schematic-title">Skema sumur dari permukaan sampai zona target</title>
      <desc id="lp-schematic-desc">
        Ilustrasi menara rig di atas garis permukaan, dengan tiga rangkaian casing yang makin
        dalam dan satu lubang terbuka di ujungnya.
      </desc>

      {/* Permukaan tanah */}
      <line x1="36" y1="70" x2="294" y2="70" stroke="var(--border-strong)" strokeWidth="1.5" />
      <line x1="36" y1="76" x2="294" y2="76" stroke="var(--border-default)" strokeWidth="1" />

      {/* Menara rig */}
      <g stroke="var(--bg-sidebar)" strokeWidth="2.4" strokeLinecap="round" fill="none">
        <line x1="124" y1="70" x2="160" y2="20" />
        <line x1="196" y1="70" x2="160" y2="20" />
        <line x1="134" y1="54" x2="186" y2="54" />
        <line x1="144" y1="38" x2="176" y2="38" />
      </g>
      <rect x="154" y="13" width="12" height="4" rx="1" fill="var(--chart-3)" />
      <rect x="112" y="70" width="96" height="4" rx="1" fill="var(--bg-sidebar)" />

      {/* Rangkaian casing, makin dalam makin sempit */}
      <rect
        x="146"
        y="74"
        width="28"
        height="62"
        fill="none"
        stroke="var(--accent-teal)"
        strokeWidth="2"
      />
      <rect
        x="151"
        y="74"
        width="18"
        height="118"
        fill="none"
        stroke="var(--accent-teal)"
        strokeWidth="2"
        opacity="0.75"
      />
      <rect
        x="156"
        y="74"
        width="8"
        height="192"
        fill="none"
        stroke="var(--accent-teal)"
        strokeWidth="2"
        opacity="0.55"
      />
      {/* Lubang terbuka */}
      <line
        x1="160"
        y1="266"
        x2="160"
        y2="288"
        stroke="var(--accent-teal)"
        strokeWidth="2"
        strokeDasharray="4 4"
      />

      {/* Keterangan */}
      <g stroke="var(--border-strong)" strokeWidth="1">
        <line x1="176" y1="108" x2="198" y2="108" />
        <line x1="171" y1="168" x2="198" y2="168" />
        <line x1="166" y1="228" x2="198" y2="228" />
      </g>
      <g fill="var(--text-secondary)" fontSize="11" fontFamily="var(--font-sans)">
        <text x="203" y="112">Konduktor</text>
        <text x="203" y="172">Surface casing</text>
        <text x="203" y="232">Intermediate</text>
        <text x="203" y="286" fill="var(--text-muted)">Zona target</text>
      </g>

      {/* Penanda permukaan */}
      <circle cx="160" cy="70" r="3.5" fill="var(--bg-sidebar)" />
    </svg>
  );
}

/** Penanda bagian: garis tipis dengan blok navy, motif yang diulang tiap bagian. */
function SectionMark() {
  return (
    <span className="lp-mark-rule" aria-hidden>
      <span />
    </span>
  );
}

const FLOW_STEPS = [
  {
    status: 'Draft',
    tone: 'draft',
    desc: 'Rig Clerk menyusun DDR. Isian tersimpan otomatis, validasi menolak total menit yang belum 1.440.',
  },
  {
    status: 'Diajukan',
    tone: 'submitted',
    desc: 'Laporan masuk antrean review Company Man untuk rig yang di-assign.',
  },
  {
    status: 'Disetujui',
    tone: 'approved',
    desc: 'Tanda tangan digital dan konfirmasi biaya sebelum laporan dianggap final.',
  },
  {
    status: 'Terdistribusi',
    tone: 'distributed',
    desc: 'PDF dikirim ke daftar penerima sesuai jadwal yang diatur Reporter.',
  },
  {
    status: 'Terkunci',
    tone: 'locked',
    desc: 'Tidak ada penyuntingan langsung. Perubahan hanya lewat amendment bernomor.',
  },
] as const;

const MODULE_ROWS = [
  ['Biaya dan AFE', 'Biaya harian, kumulatif, dan pemakaian AFE dalam satu baris.'],
  ['Billing bulanan', 'Rekap tagihan per rig dan per kontrak untuk ditinjau Cost Controller.'],
  ['Personel dan POB', 'Susunan kru per shift beserta hitungan orang di atas rig.'],
  ['Marine dan MAC', 'Pergerakan kapal, pasang surut, dan aktivitas ganda pada dual derrick.'],
  ['Safety dan HSE', 'Insiden, observasi, dan klasifikasi NPT yang bisa ditelusuri.'],
  ['Bits, casing, cement', 'Riwayat mata bor, rangkaian casing, dan operasi penyemenan per sumur.'],
  ['Well file dan performa', 'Berkas sumur lengkap serta perbandingan performa antar sumur.'],
  ['Insights', 'Tren kedalaman, NPT, dan biaya untuk dibaca manajemen.'],
] as const;

const SECURITY_POINTS = [
  'Izin diperiksa di server pada setiap permintaan, bukan hanya disembunyikan dari menu.',
  'Approve, perubahan biaya, dan penguncian laporan tercatat di audit log.',
  'Amendment wajib menyertakan alasan dan nomor revisi, jadi angka lama tetap terlacak.',
  'Sesi berakhir otomatis. Cookie sisa dibersihkan saat sesi tidak lagi valid.',
] as const;

export default function LandingPage() {
  return (
    <div className="lp">
      {/* JSON-LD: memberi tahu Google bahwa ini halaman produk perangkat lunak,
          supaya berhak tampil sebagai rich result (nama, deskripsi, bahasa). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'RigDaily',
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Web',
            inLanguage: 'id',
            description:
              'Pelaporan operasi sumur harian: DDR, time breakdown 24 jam, NPT, biaya, personel, dan sinkronisasi rig ke kantor.',
            author: {
              '@type': 'Organization',
              name: 'PogungSoftwareHouseTeam',
            },
          }),
        }}
      />
      {/* ---------------- Topbar ---------------- */}
      <header className="lp-topbar">
        <div className="lp-topbar-inner">
          <Link href="/" className="lp-brand" aria-label="RigDaily, halaman awal">
            <BrandMark size={36} />
            <span className="lp-brand-text">
              <strong>RigDaily</strong>
              <span>Well operations reporting</span>
            </span>
          </Link>

          <nav className="lp-nav" aria-label="Bagian halaman">
            <a href="#alur">Alur laporan</a>
            <a href="#modul">Modul</a>
            <a href="#peran">Peran</a>
            <a href="#sinkron">Sinkronisasi</a>
          </nav>

          <div className="lp-top-actions">
            <Link href="/login" className="lp-btn lp-btn-ghost">
              Masuk
            </Link>
            <Link href="/login?demo=1" className="lp-btn lp-btn-primary">
              Coba demo
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------------- Hero ---------------- */}
        <section className="lp-hero" aria-labelledby="lp-hero-title">
          <div className="lp-shell lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-eyebrow">Pelaporan operasi sumur harian</p>
              <h1 id="lp-hero-title">Laporan harian rig selesai sebelum shift berganti.</h1>
              <p className="lp-lede">
                RigDaily menyatukan time breakdown 24 jam, NPT, biaya, personel, dan kondisi sumur
                dalam satu laporan yang bisa ditinjau dari kantor. Setelah disetujui, laporan
                terkunci dan terdistribusi ke penerima yang berhak.
              </p>

              <div className="lp-cta-row">
                <Link href="/login" className="lp-btn lp-btn-primary lp-btn-lg">
                  Masuk ke aplikasi
                </Link>
                <Link href="/login?demo=1" className="lp-btn lp-btn-outline lp-btn-lg">
                  Coba mode demo
                </Link>
              </div>
              <p className="lp-note">
                Mode demo memakai data contoh yang bisa direset kapan saja. Tidak perlu mendaftar.
              </p>

              <ul className="lp-facts">
                <li>
                  <strong className="tnum">Time breakdown 24 jam</strong>
                  <span>1.440 menit per hari, divalidasi tanpa celah dan tanpa tumpang tindih.</span>
                </li>
                <li>
                  <strong>7 peran</strong>
                  <span>Dari Rig Clerk sampai Administrator, masing-masing dengan cakupan sendiri.</span>
                </li>
                <li>
                  <strong>Input di rig, tinjau di kantor</strong>
                  <span>Data tersimpan lokal di rig dan tersinkron saat jaringan kembali.</span>
                </li>
              </ul>
            </div>

            <div className="lp-hero-visual">
              <figure className="lp-schematic">
                <figcaption className="lp-schematic-head">
                  <span className="lp-schematic-label">Skema sumur</span>
                  <span className="lp-schematic-tag">Ilustrasi</span>
                </figcaption>
                <WellSchematic />
                <p className="lp-schematic-foot">
                  Gambaran struktur yang dicatat di well file: rangkaian casing dan zona target.
                </p>
              </figure>
            </div>
          </div>
        </section>

        {/* ---------------- Alur laporan ---------------- */}
        <section className="lp-section" id="alur" aria-labelledby="lp-alur-title">
          <div className="lp-shell">
            <div className="lp-section-head">
              <p className="lp-kicker">
                <SectionMark /> Kontrol laporan
              </p>
              <h2 id="lp-alur-title">Satu laporan, lima status yang tidak bisa dilompati.</h2>
              <p className="lp-sub">
                Setiap perpindahan status tercatat beserta pelakunya. Laporan yang sudah disetujui
                tidak bisa ditimpa oleh kiriman rig.
              </p>
            </div>

            <ol className="lp-flow">
              {FLOW_STEPS.map((step, index) => (
                <li key={step.status} className={`lp-flow-step lp-tone-${step.tone}`}>
                  <span className="lp-flow-index tnum" aria-hidden>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="lp-flow-dot" aria-hidden />
                  <h3 className="lp-flow-name">{step.status}</h3>
                  <p className="lp-flow-desc">{step.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------- Modul ---------------- */}
        <section className="lp-section lp-section-alt" id="modul" aria-labelledby="lp-modul-title">
          <div className="lp-shell">
            <div className="lp-section-head">
              <p className="lp-kicker">
                <SectionMark /> Modul
              </p>
              <h2 id="lp-modul-title">Yang dicatat setiap hari, dan yang dibaca setiap bulan.</h2>
              <p className="lp-sub">
                Semua modul membaca sumur, rig, dan tanggal yang sama. Angka di layar, PDF, dan
                dashboard berasal dari satu perhitungan.
              </p>
            </div>

            <div className="lp-modules">
              <article className="lp-module-main">
                <p className="lp-module-tag">Inti harian</p>
                <h3>DDR dan time breakdown</h3>
                <p>
                  Formulir harian mengikuti urutan kerja di rig: header sumur, kedalaman, lumpur,
                  BHA, time breakdown 24 jam, biaya, safety, lalu rencana hari berikutnya. Validasi
                  menolak laporan yang menitnya belum habis atau kedalaman yang mundur.
                </p>
                <ul className="lp-module-checks">
                  <li>Total 1.440 menit diperiksa sebelum laporan bisa diajukan.</li>
                  <li>Kode IADC dan kode NPT dipilih dari daftar, bukan diketik bebas.</li>
                  <li>PDF harian memakai angka yang sama dengan layar.</li>
                </ul>
              </article>

              <ul className="lp-module-list">
                {MODULE_ROWS.map(([name, desc]) => (
                  <li key={name}>
                    <h3>{name}</h3>
                    <p>{desc}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---------------- Peran ---------------- */}
        <section className="lp-section" id="peran" aria-labelledby="lp-peran-title">
          <div className="lp-shell">
            <div className="lp-section-head">
              <p className="lp-kicker">
                <SectionMark /> Hak akses
              </p>
              <h2 id="lp-peran-title">Tujuh peran, satu sumber data.</h2>
              <p className="lp-sub">
                Cakupan tiap peran ditentukan di server. Daftar di bawah adalah peran yang benar
                benar ada di aplikasi, bukan contoh pemasaran.
              </p>
            </div>

            <div className="lp-roles">
              {ROLE_IDS.map((id) => {
                const role = ROLES[id];
                return (
                  <article key={id} className="lp-role">
                    <header>
                      <h3>{role.label}</h3>
                      <span className="lp-role-scope">{role.scope}</span>
                    </header>
                    <p>{role.description}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---------------- Sinkronisasi ---------------- */}
        <section className="lp-section lp-section-alt" id="sinkron" aria-labelledby="lp-sinkron-title">
          <div className="lp-shell lp-sync">
            <div className="lp-sync-copy">
              <p className="lp-kicker">
                <SectionMark /> Rig ke kantor
              </p>
              <h2 id="lp-sinkron-title">Jaringan putus bukan alasan laporan hilang.</h2>
              <p>
                Data ditulis lebih dulu ke basis data lokal di rig, lalu dikirim ke kantor sebagai
                perubahan kecil, bukan kiriman penuh. Saat VSAT putus, antrean menunggu dan
                terkirim ketika jaringan kembali.
              </p>
              <p>
                Kalau kantor sudah menyetujui laporan yang sama, kiriman rig tidak menimpa hasil
                final. Data masuk daftar konflik untuk diselesaikan manual, berdampingan.
              </p>
            </div>

            <div className="lp-sync-diagram" role="group" aria-label="Alur data dari rig ke kantor">
              <div className="lp-node">
                <span className="lp-node-tag">Rig</span>
                <strong>Basis data lokal</strong>
                <span>DDR ditulis dan divalidasi di perangkat rig.</span>
              </div>
              <div className="lp-connector" aria-hidden>
                <span />
                <em>Perubahan kecil</em>
              </div>
              <div className="lp-node">
                <span className="lp-node-tag">Kantor</span>
                <strong>Basis data pusat</strong>
                <span>Review, approve, dan penguncian laporan.</span>
              </div>
              <div className="lp-connector" aria-hidden>
                <span />
                <em>Setelah disetujui</em>
              </div>
              <div className="lp-node">
                <span className="lp-node-tag">Penerima</span>
                <strong>PDF dan email</strong>
                <span>Distribusi otomatis ke penerima yang berhak.</span>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- Keamanan ---------------- */}
        <section className="lp-section" id="keamanan" aria-labelledby="lp-keamanan-title">
          <div className="lp-shell">
            <div className="lp-section-head">
              <p className="lp-kicker">
                <SectionMark /> Jejak audit
              </p>
              <h2 id="lp-keamanan-title">Setiap persetujuan meninggalkan jejak.</h2>
            </div>
            <ul className="lp-security">
              {SECURITY_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------- Penutup ---------------- */}
        <section className="lp-band" aria-labelledby="lp-band-title">
          <div className="lp-shell lp-band-inner">
            <div>
              <h2 id="lp-band-title">Lihat alurnya dengan data contoh.</h2>
              <p>
                Masuk sebagai salah satu dari tujuh peran, lalu coba approve, amendment, dan ekspor
                PDF harian.
              </p>
            </div>
            <div className="lp-cta-row lp-band-actions">
              <Link href="/login?demo=1" className="lp-btn lp-btn-onnavy lp-btn-lg">
                Coba mode demo
              </Link>
              <Link href="/login" className="lp-btn lp-btn-outline-navy lp-btn-lg">
                Masuk dengan kredensial
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ---------------- Footer ---------------- */}
      <footer className="lp-footer">
        <div className="lp-shell lp-footer-inner">
          <div className="lp-footer-brand">
            <BrandMark size={28} />
            <div>
              <strong>RigDaily</strong>
              <span>Pelaporan operasi sumur untuk operator dan kontraktor pengeboran.</span>
            </div>
          </div>

          <nav className="lp-footer-nav" aria-label="Tautan footer">
            <a href="#alur">Alur laporan</a>
            <a href="#modul">Modul</a>
            <a href="#peran">Peran</a>
            <Link href="/login">Masuk</Link>
            <Link href="/login?demo=1">Mode demo</Link>
          </nav>

          <p className="lp-copyright">
            Hak cipta (c) 2026 PogungSoftwareHouseTeam (PSHT). Seluruh hak dilindungi.
          </p>
        </div>
      </footer>
    </div>
  );
}
