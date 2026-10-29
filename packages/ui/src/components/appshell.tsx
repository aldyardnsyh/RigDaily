'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { BrandMark } from './brand-mark';
import {
  Activity,
  Banknote,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Cloud,
  Compass,
  FileText,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Layers,
  Menu,
  Printer,
  Receipt,
  Search,
  Settings2,
  Ship,
  ShieldCheck,
  Timer,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// AppShell mengikuti Figma field-operations sidebar: rail tetap 264px, konteks
// rig aktif, modul operasional yang DIKELOMPOKKAN (accordion), dan status shift
// handover. Font ikut sumber Figma (Inter + tabular-nums). Countdown shift live.
//
// NAVIGASI BERGRUP
// Sebelumnya 13 item dirender datar sehingga mata harus memindai seluruh daftar
// setiap kali mencari satu modul. Sekarang item dikelompokkan per domain kerja
// (Operations, Well Engineering, Drilling Support, Analysis, Cost & Billing,
// Documents, System). Grup yang memuat halaman aktif terbuka otomatis.

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Penjelas satu baris (tooltip + `aria-describedby`) agar item kembar tidak membingungkan. */
  description?: string;
};

export type NavGroup = { id: string; label: string; items: NavItem[] };

/**
 * Item tunggal di atas grup: Dashboard selalu terlihat tanpa perlu buka grup.
 * `href` halaman aktif` dicocokkan id-nya dengan prop `active`.
 */
export const NAV_PRIMARY: NavItem = {
  id: 'dashboard',
  label: 'Dashboard',
  href: '/dashboard',
  icon: LayoutDashboard,
  description: 'Ringkasan KPI portofolio, tren kedalaman, dan laporan hari ini',
};

/**
 * Struktur grup navigasi - SUMBER KEBENARAN urutan menu sidebar.
 *
 * Catatan `Directional & Survey` dan `Safety & Other`: keduanya mengarah ke
 * `/safety-survey` karena halaman itu memang memuat dua bagian (survey
 * directional dan laporan insiden). Label dibuat spesifik supaya pengguna tahu
 * bagian mana yang dituju, bukan dua menu identik tanpa alasan.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'ddr', label: 'Daily Reports', href: '/ddr', icon: ClipboardList, description: 'Daily Drilling Report harian per sumur' },
      { id: 'time', label: 'Time Breakdown', href: '/time', icon: Timer, description: 'Rincian 24 jam per kode IADC dan klasifikasi waktu' },
      { id: 'daily-ops', label: 'Daily Operations', href: '/daily-ops', icon: FlaskConical, description: 'Catatan operasi harian, lumpur, dan peralatan' },
    ],
  },
  {
    id: 'well-engineering',
    label: 'Well Engineering',
    items: [
      { id: 'well-header', label: 'Well Header', href: '/well-header', icon: FileText, description: 'Identitas sumur: WELL ID, WELL NAME, DIVISION, FIELD' },
      { id: 'bits', label: 'Bits / BHA', href: '/bits', icon: Layers, description: 'Susunan bit dan Bottom Hole Assembly per laporan' },
      { id: 'casing-cement', label: 'Casing & Cement', href: '/casing-cement', icon: Gauge, description: 'Program casing, tally, dan operasi penyemenan' },
      { id: 'well-file', label: 'Well File', href: '/well-file', icon: FileText, description: 'Berkas lengkap sumur: profil, milestone, dan riwayat' },
    ],
  },
  {
    id: 'drilling-support',
    label: 'Drilling Support',
    items: [
      { id: 'safety-survey', label: 'Directional & Survey', href: '/safety-survey', icon: Compass, description: 'Trayektori sumur: MD, inklinasi, azimut, dan TVD' },
      { id: 'marine-mac', label: 'Marine & MAC', href: '/marine-mac', icon: Ship, description: 'Aktivitas marine dan Marine Activity Center' },
      { id: 'safety-incidents', label: 'Safety & Other', href: '/safety-survey', icon: ShieldCheck, description: 'Bagian insiden pada halaman Safety & Survey yang sama' },
      { id: 'personnel', label: 'Personnel & POB', href: '/personnel', icon: Users, description: 'Daftar crew, mustering, dan Person On Board' },
    ],
  },
  {
    id: 'analysis',
    label: 'Analysis',
    items: [
      { id: 'performance', label: 'Performance', href: '/performance', icon: Activity, description: 'ROP, NPT, time mix, dan benchmark antar sumur' },
      { id: 'insights', label: 'Insights', href: '/insights', icon: TrendingUp, description: 'KPI aktual vs baseline dan tren metrik' },
    ],
  },
  {
    id: 'cost-billing',
    label: 'Cost & Billing',
    items: [
      { id: 'cost', label: 'Costs', href: '/cost', icon: Receipt, description: 'Biaya harian, kumulatif, dan konsumsi AFE' },
      { id: 'billing', label: 'Monthly Billing', href: '/billing', icon: BarChart3, description: 'Tagihan bulanan per rate card dan kode aktivitas' },
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    items: [
      { id: 'reports', label: 'Reports Library', href: '/reports', icon: FileText, description: 'Arsip seluruh DDR, filter status, dan impor CSV' },
      { id: 'print', label: 'Print Preview', href: '/print', icon: Printer, description: 'Pratinjau dan cetak DDR atau IADC time sheet' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'sync', label: 'Sync Center', href: '/sync', icon: Cloud, description: 'Status device lapangan, antrean, dan konflik data' },
      { id: 'admin', label: 'Settings / Admin', href: '/admin', icon: Settings2, description: 'Master data, pengguna, rate card, dan audit' },
    ],
  },
];

/**
 * Daftar datar turunan (NAV_PRIMARY + semua item grup).
 *
 * Dipertahankan agar kode lama yang mengimpor `MUDLOGGING_NAV` (mis. pencarian
 * menu, prefetch) tetap bekerja tanpa perubahan.
 */
export const MUDLOGGING_NAV: NavItem[] = [NAV_PRIMARY, ...NAV_GROUPS.flatMap((g) => g.items)];

/** Key `localStorage` untuk state buka/tutup grup. */
const NAV_OPEN_STORAGE_KEY = 'rigdaily.nav.open';

/** Grup yang memuat `activeId` (null bila tidak ada / halaman di luar menu). */
function groupIdForActive(activeId: string): string | null {
  for (const group of NAV_GROUPS) {
    if (group.items.some((item) => item.id === activeId)) return group.id;
  }
  return null;
}

/**
 * Baca daftar grup yang DITUTUP dari localStorage.
 *
 * DEFAULT: SEMUA GRUP TERBUKA.
 * Alasan: pengguna baru harus langsung melihat seluruh fitur yang tersedia
 * (Operations, Well Engineering, Drilling Support, dst) tanpa perlu menebak
 * bahwa ada menu tersembunyi. Klik header grup untuk menutupnya.
 *
 * Yang disimpan adalah grup yang DITUTUP, bukan yang dibuka. Dengan begitu
 * grup baru yang ditambahkan kemudian otomatis ikut terbuka tanpa perlu
 * migrasi data localStorage pengguna lama.
 */
function readStoredClosed(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(NAV_OPEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function writeStoredClosed(value: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NAV_OPEN_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Mode privat / kuota penuh: state hanya hidup di memori, bukan error.
  }
}

/**
 * State buka/tutup grup navigasi.
 *
 * Aturan:
 * - DEFAULT TERBUKA: semua grup terbuka agar seluruh fitur langsung terlihat.
 * - Grup yang memuat halaman aktif SELALU terbuka (override, tidak disimpan).
 * - Klik header grup menutupnya; pilihan itu disimpan di localStorage.
 * - Sebelum hidrasi (SSR), semua grup juga dirender terbuka supaya tidak ada
 *   kedipan buka-tutup saat halaman selesai dimuat.
 */
function useNavGroups(activeId: string): {
  isOpen: (groupId: string) => boolean;
  toggle: (groupId: string) => void;
} {
  const activeGroup = groupIdForActive(activeId);
  /** Berisi grup yang DITUTUP pengguna. Kosong = semua terbuka. */
  const [closedMap, setClosedMap] = useState<Record<string, boolean>>({});
  const hydratedRef = useRef(false);

  useEffect(() => {
    // Hidrasi setelah mount: server tidak tahu localStorage, hindari mismatch.
    setClosedMap(readStoredClosed());
    hydratedRef.current = true;
  }, []);

  const toggle = useCallback((groupId: string) => {
    setClosedMap((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      writeStoredClosed(next);
      return next;
    });
  }, []);

  const isOpen = useCallback(
    (groupId: string) => {
      // Grup yang memuat halaman aktif selalu terbuka.
      if (activeGroup === groupId) return true;
      // Sebelum hidrasi: terbuka (default), agar tidak berkedip.
      if (!hydratedRef.current) return true;
      // Selain itu: terbuka kecuali pengguna menutupnya.
      return closedMap[groupId] !== true;
    },
    [activeGroup, closedMap],
  );

  return { isOpen, toggle };
}

/** Inisial 2 huruf dari nama (avatar statis fallback saat `userMenu` kosong). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const joined = parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
  return joined || 'RD';
}

type Props = {
  active?: string;
  well?: string;
  date?: string;
  userName?: string;
  userRole?: string;
  syncLabel?: string;
  /** Slot indikator sinkronisasi (data nyata dari apps/web). */
  syncBadge?: React.ReactNode;
  /**
   * Slot kanan topbar. Bila diisi (mis. `<UserMenu />` dari apps/web), blok
   * avatar statis diganti sepenuhnya. packages/ui sengaja tidak meng-import
   * komponen app - cukup merender node yang diberikan.
   */
  userMenu?: React.ReactNode;
  /** Slot pemilih sumur (menggantikan tombol wellbore statis). */
  wellSwitcher?: React.ReactNode;
  /** Slot jam/tanggal dari waktu server (menggantikan tanggal statis). */
  clock?: React.ReactNode;
  children: React.ReactNode;
};

export function AppShell({
  active = 'dashboard',
  well = 'Well ARUN-07',
  date = '10 Sep 2026',
  userName = 'Dave Miller',
  userRole = 'Company Man',
  syncLabel = 'Status sinkronisasi',
  syncBadge,
  userMenu,
  wellSwitcher,
  clock,
  children,
}: Props) {
  const [shiftLeft, setShiftLeft] = useState(3 * 3600 + 42 * 60 + 18);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setShiftLeft((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);
  const hh = String(Math.floor(shiftLeft / 3600)).padStart(2, '0');
  const mm = String(Math.floor((shiftLeft % 3600) / 60)).padStart(2, '0');
  const ss = String(shiftLeft % 60).padStart(2, '0');
  const shiftPct = Math.round((shiftLeft / (12 * 3600)) * 100);
  const nav = useNavGroups(active);

  /** Satu baris tautan menu. `sub` memberi indentasi untuk item di dalam grup. */
  function renderNavItem(item: NavItem, sub: boolean) {
    const isActive = item.id === active;
    const descId = item.description ? `nav-desc-${item.id}` : undefined;
    return (
      <li key={item.id}>
        <a
          href={item.href}
          aria-current={isActive ? 'page' : undefined}
          aria-describedby={descId}
          title={item.description}
          className={cn(
            'nav-item flex items-center rounded-[var(--radius-input)] text-[13px] font-medium',
            sub ? 'nav-item-sub h-9 pl-3 pr-2' : 'h-10 px-3 text-[14px]',
            isActive
              ? 'bg-[var(--bg-sidebar-active)] text-white'
              : 'text-[var(--text-nav-idle)] hover:bg-white/10 hover:text-white'
          )}
          onClick={() => setMobileOpen(false)}
        >
          <item.icon size={sub ? 15 : 17} strokeWidth={1.8} aria-hidden />
          <span className="nav-label">{item.label}</span>
        </a>
      </li>
    );
  }
  return (
    <div className="shell">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Lewati ke konten
      </a>
      <button
        type="button"
        className="shell-menu no-print"
        aria-label={mobileOpen ? 'Tutup navigasi' : 'Buka navigasi'}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((v) => !v)}
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      {mobileOpen && <button type="button" className="shell-scrim no-print" aria-label="Tutup navigasi" onClick={() => setMobileOpen(false)} />}
      <aside className={cn('sidebar no-print flex min-h-screen w-[var(--sidebar-w)] flex-col', mobileOpen && 'sidebar-open')} aria-label="Navigasi utama">
        <div className="sidebar-brand flex items-center gap-2">
          {/*
            Marka memakai komponen BrandMark yang sama dengan favicon, login,
            dan landing page. Sebelumnya di sini dipakai ikon helm dari pustaka
            Lucide, sehingga ikon di sidebar berbeda dengan ikon di tab browser.
          */}
          <BrandMark size={32} onDark />
          <span className="sidebar-wordmark leading-tight">
            <span className="block text-[16px] font-bold tracking-wide">RigDaily</span>
            <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-nav-idle)]">
              Field Operations
            </span>
          </span>
        </div>

        <div className="active-rig-panel">
          <div className="active-rig-copy">
            <div className="active-rig-label">ACTIVE RIG</div>
            <div className="active-rig-name">DEEP-HORIZON 04</div>
          </div>
          <span aria-hidden className="active-rig-dot" />
        </div>

        <nav className="sidebar-nav flex-1" aria-label="Modul mudlogging">
          {/* Item tunggal: selalu terlihat tanpa membuka grup. */}
          <ul className="m-0 list-none p-0" style={{ marginBottom: 6 }}>
            {renderNavItem(NAV_PRIMARY, false)}
          </ul>

          <ul className="m-0 list-none p-0" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV_GROUPS.map((group) => {
              const open = nav.isOpen(group.id);
              const panelId = `nav-group-${group.id}`;
              const headerId = `nav-group-header-${group.id}`;
              const hasActive = group.items.some((item) => item.id === active);
              return (
                <li key={group.id} className="nav-group">
                  <button
                    type="button"
                    id={headerId}
                    role="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    aria-label={`Grup ${group.label}, ${open ? 'terbuka' : 'tertutup'}${
                      hasActive ? ', memuat halaman aktif' : ''
                    }. Tekan untuk ${open ? 'menutup' : 'membuka'}.`}
                    onClick={() => nav.toggle(group.id)}
                    className={cn(
                      'nav-group-header flex w-full items-center gap-2 rounded-[var(--radius-input)] px-3 text-[11px] font-bold uppercase',
                      hasActive ? 'text-white' : 'text-[var(--text-nav-idle)]'
                    )}
                  >
                    <span className="nav-label truncate">{group.label}</span>
                    {hasActive && (
                      <span aria-hidden className="nav-group-active-dot" title="Halaman aktif ada di grup ini" />
                    )}
                    <ChevronDown
                      size={14}
                      aria-hidden
                      className="nav-group-chevron"
                      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                    />
                  </button>
                  {/* Panel tetap di DOM agar `aria-controls` selalu menunjuk elemen nyata. */}
                  <div
                    id={panelId}
                    role="group"
                    aria-labelledby={headerId}
                    hidden={!open}
                  >
                    <ul className="m-0 list-none p-0" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {group.items.map((item) => renderNavItem(item, true))}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="sidebar-handover">
          <div className="sidebar-handover-head">
            <span>SHIFT HANDOVER IN</span>
            <strong className="tnum">{hh}:{mm}:{ss}</strong>
          </div>
          <div className="sidebar-handover-track" role="progressbar" aria-valuenow={shiftPct} aria-valuemin={0} aria-valuemax={100} aria-label="Shift handover progress">
            <div className="sidebar-handover-fill" style={{ width: `${shiftPct}%` }} />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="topbar no-print sticky top-0 z-30 flex h-[var(--topbar-h)] items-center gap-3 px-6">
          {wellSwitcher ?? (
            <button
              type="button"
              className="flex h-[var(--control-h)] items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border-default)] bg-white px-3 text-[13px] font-semibold"
              aria-label="Ganti wellbore"
            >
              <BrandMark size={16} />
              <span className="well-value">
                <span className="text-[var(--text-muted)]">SUMUR:</span> {well}
              </span>
              <ChevronDown size={14} aria-hidden />
            </button>
          )}
          {clock ?? (
            <span className="tnum hidden items-center gap-2 rounded-[var(--radius-input)] bg-[var(--bg-surface-2)] px-3 py-2 text-[13px] font-medium md:flex">
              <CalendarDays size={15} aria-hidden />
              {date}
            </span>
          )}
          <label className="sr-only" htmlFor="ops-search">
            Cari log operasi
          </label>
          <div className="topbar-search hidden lg:flex">
            <Search size={16} aria-hidden />
            <input
            id="ops-search"
            placeholder="Search ops log, parameters, alerts"
            className="h-full w-full bg-transparent text-[14px] outline-none"
            />
          </div>
          <span className="ml-auto" style={{ display: 'inline-flex', minWidth: 0 }}>
            {syncBadge ?? (
              <span className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-badge)] bg-[var(--bg-surface-2)] px-3 text-[12px] font-semibold text-[var(--text-secondary)]">
                <Cloud size={15} aria-hidden />
                {syncLabel}
              </span>
            )}
          </span>
          {userMenu ? (
            userMenu
          ) : (
            <span className="flex items-center gap-2">
              <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-sidebar)] text-[13px] font-bold text-white">
                {initialsOf(userName)}
              </span>
              <span className="hidden leading-tight xl:block">
                <span className="block text-[13px] font-bold">{userName}</span>
                <span className="block text-[12px] text-[var(--text-secondary)]">{userRole}</span>
              </span>
            </span>
          )}
        </header>

        <main id="main" className="content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
