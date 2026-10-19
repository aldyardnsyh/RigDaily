'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Cloud,
  Download,
  GitMerge,
  RefreshCw,
  Send,
  Server,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Share2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card } from '@rigdaily/ui';
import { ConflictResolver, type ConflictView } from '@/components/ConflictResolver';
import { ApiClientError, apiGet, apiUrl } from '@/lib/api-client';
import { useApi } from '@/lib/hooks/useApi';
import type { DistributionRuleDto, ReportListItem } from '@/lib/repo/types';

/* ------------------------------------------------------------------ */
/* Tipe respons (mengikuti implementasi route, bukan tebakan)          */
/* ------------------------------------------------------------------ */

type SyncDeviceStatus = {
  id: string;
  deviceId: string;
  name: string;
  kind: string;
  rigId: string | null;
  lastSeenAt: string | null;
  lastPulledAt: string | null;
  pendingCount: number;
  active: boolean;
  openConflicts: number;
  pendingMutations: number;
};

type DevicesPayload = {
  devices: SyncDeviceStatus[];
  totals: {
    devices: number;
    active: number;
    openConflicts: number;
    pendingMutations: number;
  };
};

type ConflictRow = ConflictView & {
  entityServerId: string | null;
  entityLocalId: string | null;
  clientMutationId: string;
  status: string;
  resolution: string | null;
};

type PullPayload = {
  serverTime: string;
  changes: Array<{
    entity: string;
    entityServerId: string;
    entityLocalId?: string | null;
    op: 'upsert' | 'delete';
    updatedAt: string;
    payload: Record<string, unknown>;
  }>;
  hasMore: boolean;
};

type ReportsList = { items: ReportListItem[]; total: number };
type RulesPayload = { rules: DistributionRuleDto[] };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;

function relativeTime(iso: string | null): string {
  if (!iso) return 'belum pernah';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'tidak diketahui';
  const diff = Date.now() - t;
  if (diff < 0 || diff < 60_000) return 'baru saja';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

/** Titik awal pull bila device belum pernah pull (seluruh riwayat). */
const PULL_EPOCH = '1970-01-01T00:00:00Z';

/** Label jujur untuk `since` pull: tanggal pull terakhir atau "awal riwayat". */
function formatSinceLabel(lastPulledAt: string | null): string {
  if (!lastPulledAt) return 'seluruh riwayat (perangkat belum pernah menarik data)';
  return `${relativeTime(lastPulledAt)}`;
}

/**
 * Kursor pull gabungan = `lastPulledAt` paling TUA di antara device.
 *
 * Device tanpa `lastPulledAt` → epoch (seluruh riwayat), supaya delta device itu
 * tidak terlewat. Tanpa device sama sekali → epoch juga.
 */
function oldestPullCursor(devices: SyncDeviceStatus[]): string {
  let oldest: number | null = null;
  for (const d of devices) {
    const t = d.lastPulledAt ? new Date(d.lastPulledAt).getTime() : Number.NaN;
    if (Number.isNaN(t)) return PULL_EPOCH;
    if (oldest === null || t < oldest) oldest = t;
  }
  return oldest === null ? PULL_EPOCH : new Date(oldest).toISOString();
}

type Health = 'ok' | 'warn' | 'bad';

function deviceHealth(device: SyncDeviceStatus): Health {
  const t = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : Number.NaN;
  const staleHours = Number.isNaN(t) ? Number.POSITIVE_INFINITY : (Date.now() - t) / 3_600_000;
  if (device.pendingCount > 0 || device.openConflicts > 0) return 'warn';
  if (!device.active || staleHours > 24) return 'bad';
  if (staleHours > 2) return 'warn';
  return 'ok';
}

const HEALTH_COLOR: Record<Health, string> = {
  ok: 'var(--success)',
  warn: 'var(--warning)',
  bad: 'var(--danger)',
};

const HEALTH_LABEL: Record<Health, string> = {
  ok: 'Sehat',
  warn: 'Perlu perhatian',
  bad: 'Offline / nonaktif',
};

function HealthIcon({ health }: { health: Health }) {
  if (health === 'ok') return <SignalHigh size={16} aria-hidden style={{ color: HEALTH_COLOR.ok }} />;
  if (health === 'warn') return <SignalMedium size={16} aria-hidden style={{ color: HEALTH_COLOR.warn }} />;
  return <SignalLow size={16} aria-hidden style={{ color: HEALTH_COLOR.bad }} />;
}

function SkeletonBlock({ h, w = '100%' }: { h: number; w?: number | string }) {
  return (
    <div aria-hidden style={{ height: h, width: w, background: 'var(--bg-surface-2)', borderRadius: 4 }} />
  );
}

function FatalCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger-deep)' }}>
        {message}
      </p>
      <p style={{ margin: '10px 0 0' }}>
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden /> Coba lagi
        </Button>
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function SyncPage() {
  const devices = useApi<DevicesPayload>('/api/sync/devices');
  const conflicts = useApi<ConflictRow[]>('/api/sync/conflicts?status=open');
  const rules = useApi<RulesPayload>('/api/master/rules');
  const reports = useApi<ReportsList>('/api/reports?limit=1');

  const [busyDevice, setBusyDevice] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  const deviceList = useMemo(() => devices.data?.devices ?? [], [devices.data]);
  const totals = devices.data?.totals ?? null;
  const conflictList: ConflictRow[] = conflicts.data ?? [];
  const latestReport = reports.data?.items?.[0] ?? null;

  const reloadEverything = useCallback(() => {
    devices.reload();
    conflicts.reload();
    rules.reload();
    reports.reload();
  }, [devices.reload, conflicts.reload, rules.reload, reports.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Tarik delta satu device sejak `lastPulledAt` device (fallback epoch).
   *
   * P1-11: sebelumnya selalu `since=1970-01-01` (seluruh riwayat). Kini memakai
   * `lastPulledAt` yang dicatat server saat pull terakhir → delta kecil.
   */
  async function syncDevice(device: SyncDeviceStatus) {
    setBusyDevice(device.deviceId);
    const since = device.lastPulledAt ?? PULL_EPOCH;
    try {
      const pull = await apiGet<PullPayload>(
        `/api/sync/pull?since=${encodeURIComponent(since)}&deviceId=${encodeURIComponent(device.deviceId)}`,
      );
      toast.success(
        `Delta ${device.deviceId}: ${pull.changes.length} perubahan sejak ${formatSinceLabel(device.lastPulledAt)}` +
          (pull.hasMore ? ' (masih ada data berikutnya).' : '.'),
      );
      devices.reload();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : `Gagal menarik perubahan ${device.deviceId}.`,
      );
    } finally {
      setBusyDevice(null);
    }
  }

  /**
   * Tarik perubahan untuk SEMUA device.
   *
   * P1-11: `since` = `lastPulledAt` paling tua di antara device (agar tidak ada
   * device yang kehilangan delta). Semua device yang belum pernah pull (null)
   * membuat `since` jatuh ke epoch - jujur, bukan tebakan.
   */
  async function pullAll() {
    setPulling(true);
    const oldest = oldestPullCursor(deviceList);
    try {
      const pull = await apiGet<PullPayload>(`/api/sync/pull?since=${encodeURIComponent(oldest)}`);
      const entities = new Set(pull.changes.map((c) => c.entity));
      toast.success(
        `Tarik selesai: ${pull.changes.length} perubahan dari ${entities.size} jenis data.` +
          (pull.hasMore ? ' Masih ada data berikutnya.' : ''),
      );
      devices.reload();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Gagal menarik perubahan dari server. Periksa koneksi lalu coba lagi.');
    } finally {
      setPulling(false);
    }
  }

  function previewTemplate(rule: DistributionRuleDto) {
    if (!latestReport) {
      toast.info('Belum ada laporan untuk dipratinjau. Buat DDR terlebih dahulu.');
      return;
    }
    const type = rule.templateId.toLowerCase().includes('iadc') ? 'iadc' : 'ddr';
    window.open(apiUrl(`/api/reports/${latestReport.id}/pdf?type=${type}`), '_blank', 'noopener');
  }

  const totalPendingDevices = deviceList.reduce((acc, d) => acc + d.pendingCount, 0);
  const nodesHealthy = deviceList.filter((d) => deviceHealth(d) === 'ok').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        OPERASIONAL / SINKRONISASI &amp; DISTRIBUSI DATA
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Pusat Sinkronisasi - Rig ke Kantor</h1>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            onClick={pullAll}
            disabled={pulling}
            title="Tarik perubahan dari server sejak tarikan terakhir. Pengiriman data ke server dilakukan aplikasi desktop di rig."
            aria-label="Tarik perubahan dari server"
          >
            <ArrowDownToLine size={16} aria-hidden /> {pulling ? 'Menarik...' : 'Tarik Perubahan'}
          </Button>
          <Button variant="secondary" onClick={reloadEverything} aria-label="Muat ulang seluruh data sinkronisasi">
            <RefreshCw size={16} aria-hidden /> Refresh
          </Button>
        </span>
      </div>

      {/* ---------- Ringkasan ---------- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
        <Card>
          <div className="field-label">Perangkat Sehat</div>
          <div className="tnum" style={{ fontSize: 26, fontWeight: 800 }}>
            {devices.data ? `${nodesHealthy}/${deviceList.length}` : '-'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {totals ? `${totals.active} perangkat aktif` : 'Memuat status perangkat...'}
          </div>
        </Card>
        <Card>
          <div className="field-label">Antrean Tertunda</div>
          <div className="tnum" style={{ fontSize: 26, fontWeight: 800, color: totalPendingDevices > 0 ? 'var(--warning)' : undefined }}>
            {devices.data ? totalPendingDevices : '-'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {totals ? `${totals.pendingMutations} perubahan menunggu penyelesaian` : '-'}
          </div>
        </Card>
        <Card>
          <div className="field-label">Konflik Terbuka</div>
          <div className="tnum" style={{ fontSize: 26, fontWeight: 800, color: conflictList.length > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {conflicts.data ? conflictList.length : '-'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {totals ? `Total per perangkat: ${totals.openConflicts}` : '-'}
          </div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3.4fr 4.6fr 3.4fr', gap: 16, alignItems: 'start' }}>
        {/* ---------- Kolom 1: Sync Status ---------- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <h2 style={{ fontSize: 15, margin: '0 0 8px', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Cloud size={16} color="var(--accent-teal)" aria-hidden /> Sync Status
              <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
                {deviceList.length} device
              </span>
            </h2>

            {devices.loading && deviceList.length === 0 ? (
              <>
                <SkeletonBlock h={58} />
                <div style={{ height: 8 }} />
                <SkeletonBlock h={58} />
              </>
            ) : devices.error ? (
              <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger-deep)' }}>
                {devices.error}
              </p>
            ) : deviceList.length === 0 ? (
              <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Belum ada perangkat terdaftar untuk rig ini. Daftarkan lewat Admin › Sync Devices.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {deviceList.map((device) => {
                  const health = deviceHealth(device);
                  const busy = busyDevice === device.deviceId;
                  return (
                    <li
                      key={device.id}
                      style={{ border: '1px solid var(--border-default)', borderRadius: 4, padding: 10 }}
                    >
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                        <span
                          aria-hidden
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: HEALTH_COLOR[health],
                            flexShrink: 0,
                          }}
                        />
                        <strong>{device.name}</strong>
                        <span
                          style={{
                            background: 'var(--bg-surface-2)',
                            color: 'var(--text-secondary)',
                            borderRadius: 999,
                            padding: '1px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {device.kind}
                        </span>
                        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11, color: HEALTH_COLOR[health], fontWeight: 700 }}>
                          <HealthIcon health={health} /> {HEALTH_LABEL[health]}
                        </span>
                      </div>
                      <div className="tnum" style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                        {device.deviceId} · terlihat {relativeTime(device.lastSeenAt)} · pending{' '}
                        {device.pendingCount} · konflik {device.openConflicts}
                      </div>
                      <div className="tnum" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Tarikan terakhir: {formatSinceLabel(device.lastPulledAt)}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <Button
                          variant="secondary"
                          onClick={() => void syncDevice(device)}
                          disabled={busy}
                          title="Hanya menarik perubahan dari server. Pengiriman data ke server dilakukan aplikasi desktop di rig."
                          aria-label={`Tarik perubahan device ${device.deviceId}`}
                        >
                          <ArrowDownToLine size={14} aria-hidden /> {busy ? 'Menarik...' : 'Tarik Perubahan'}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <p style={{ display: 'flex', gap: 8, margin: 0, fontSize: 13 }}>
              <Send size={16} color="var(--accent-teal)" aria-hidden style={{ flexShrink: 0 }} />
              <span>
                <strong>Halaman ini hanya menarik data dari server, tidak mengirim data.</strong> Tombol di atas
                memakai <code>GET /api/sync/pull</code> dengan penanda <code>since = lastPulledAt</code>{' '}
                perangkat. <strong>Pengiriman data ke server dilakukan aplikasi desktop di rig</strong> lewat{' '}
                <code>POST /api/sync/push</code> - tidak ada tombol kirim di sini karena pengiriman butuh
                minimal satu perubahan sah dari perangkat, dan mengirim perubahan uji dari browser akan mengotori catatan perubahan.
              </span>
            </p>
          </Card>
        </div>

        {/* ---------- Kolom 2: Penyelesaian Konflik ---------- */}
        <div>
          <h2 style={{ fontSize: 15, margin: '0 0 8px', display: 'flex', gap: 6, alignItems: 'center' }}>
            <GitMerge size={16} color="var(--accent-teal)" aria-hidden /> Penyelesaian Konflik
            <span
              style={{
                marginLeft: 'auto',
                background: conflictList.length > 0 ? 'var(--warning-soft)' : 'var(--success-soft)',
                color: conflictList.length > 0 ? 'var(--warning)' : 'var(--success)',
                borderRadius: 999,
                padding: '2px 10px',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {conflicts.data ? `${conflictList.length} terbuka` : 'MEMUAT'}
            </span>
          </h2>

          {conflicts.loading && conflicts.data === null ? (
            <Card>
              <SkeletonBlock h={18} />
              <div style={{ height: 10 }} />
              <SkeletonBlock h={18} />
              <div style={{ height: 10 }} />
              <SkeletonBlock h={18} />
            </Card>
          ) : conflicts.error ? (
            <FatalCard message={conflicts.error} onRetry={() => conflicts.reload()} />
          ) : (
            <>
              {conflictList.length > 0 && (
                <p
                  style={{
                    fontSize: 12,
                    background: 'var(--warning-soft)',
                    borderLeft: '3px solid var(--warning)',
                    padding: '8px 10px',
                    display: 'flex',
                    gap: 8,
                    margin: '0 0 10px',
                  }}
                >
                  <AlertTriangle size={16} aria-hidden style={{ flexShrink: 0 }} />
                  <span>
                    Laporan yang sudah disetujui tidak pernah ditimpa otomatis. Setiap keputusan penyelesaian tercatat di jejak audit.
                  </span>
                </p>
              )}
              <ConflictResolver
                conflicts={conflictList.map((c) => ({
                  id: c.id,
                  deviceId: c.deviceId,
                  entity: c.entity,
                  reason: c.reason,
                  createdAt: c.createdAt,
                  rigPayload: c.rigPayload,
                  serverPayload: c.serverPayload,
                }))}
                onResolved={() => {
                  conflicts.reload();
                  devices.reload();
                }}
              />
            </>
          )}
        </div>

        {/* ---------- Kolom 3: Distribution & API ---------- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <h2 style={{ fontSize: 15, margin: '0 0 8px', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Share2 size={16} color="var(--accent-teal)" aria-hidden /> Distribution
            </h2>

            {rules.loading && !rules.data ? (
              <>
                <SkeletonBlock h={14} />
                <div style={{ height: 8 }} />
                <SkeletonBlock h={14} />
              </>
            ) : rules.error ? (
              <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger-deep)' }}>
                {rules.error}
              </p>
            ) : (rules.data?.rules ?? []).length === 0 ? (
              <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Belum ada aturan distribusi.{' '}
                <Link href="/reports" style={{ color: 'var(--accent-teal)', fontWeight: 700 }}>
                  Kelola di Perpustakaan Laporan
                </Link>
                .
              </p>
            ) : (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '6px 4px' }}>Aturan</th>
                    <th style={{ padding: '6px 4px' }}>Jadwal</th>
                    <th style={{ padding: '6px 4px' }}>Status</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {(rules.data?.rules ?? []).map((rule) => (
                    <tr key={rule.id} style={{ borderTop: '1px solid var(--border-default)' }}>
                      <td style={{ padding: '6px 4px', wordBreak: 'break-word' }}>{rule.name}</td>
                      <td className="tnum" style={{ padding: '6px 4px' }}>
                        {rule.scheduleCron}
                      </td>
                      <td style={{ padding: '6px 4px' }}>
                        <span
                          style={{
                            background: rule.active ? 'var(--success-soft)' : 'var(--bg-surface-2)',
                            color: rule.active ? 'var(--success)' : 'var(--text-secondary)',
                            borderRadius: 999,
                            padding: '2px 8px',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {rule.active ? 'AKTIF' : 'DIJEDA'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => previewTemplate(rule)}
                          aria-label={`Pratinjau template ${rule.name}`}
                          style={{
                            background: 'none',
                            border: 0,
                            padding: 0,
                            color: 'var(--accent-teal)',
                            fontFamily: 'inherit',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Preview
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {latestReport && (
              <p style={{ margin: '8px 0 0' }}>
                <a
                  href={apiUrl(`/api/reports/${latestReport.id}/pdf?type=ddr`)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-flex' }}
                >
                  <Button variant="secondary" aria-label="Buka Unduh PDF laporan terbaru">
                    <Download size={14} aria-hidden /> Unduh PDF laporan terbaru
                  </Button>
                </a>
              </p>
            )}
          </Card>

          <Card>
            <h2 style={{ fontSize: 15, margin: '0 0 8px', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Server size={16} color="var(--accent-teal)" aria-hidden /> Data API (read-only)
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                ['GET', '/api/reports', 'Daftar DDR + filter sumur/status'],
                ['GET', '/api/sync/pull', 'Delta perubahan server sejak `since`'],
                ['GET', '/api/billing', 'Billing bulanan rate card tiered'],
              ].map(([method, path, desc]) => (
                <li key={path} style={{ border: '1px solid var(--border-default)', borderRadius: 4, padding: '6px 8px' }}>
                  <span
                    className="tnum"
                    style={{ background: 'var(--bg-surface-2)', borderRadius: 4, padding: '1px 6px', fontWeight: 700, marginRight: 6 }}
                  >
                    {method}
                  </span>
                  <code className="tnum">{path}</code>
                  <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{desc}</div>
                </li>
              ))}
            </ul>
            <p
              style={{
                margin: '10px 0 0',
                fontSize: 12,
                background: 'var(--info-soft)',
                color: 'var(--info)',
                borderRadius: 4,
                padding: '8px 10px',
                display: 'flex',
                gap: 8,
              }}
            >
              <CheckCircle2 size={16} aria-hidden style={{ flexShrink: 0 }} />
              <span>Pengelolaan API key tersedia di menu Admin. Semua endpoint memakai sesi cookie.</span>
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 12 }}>
              <Link href="/admin" style={{ color: 'var(--accent-teal)', fontWeight: 700 }}>
                Buka Pengaturan / Admin →
              </Link>
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
