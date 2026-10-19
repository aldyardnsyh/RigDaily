/**
 * KONFIGURASI DEVICE - `app.getPath('userData')/config.json`.
 *
 * Nilai default dibuat sekali (deviceId stabil seumur instalasi): deviceId inilah
 * yang dipakai server untuk mencocokkan `sync_devices` + `x-device-key`.
 * File ditulis atomik (tmp + rename) supaya crash saat tulis tidak merusak config.
 */
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

import type { DeviceConfig, DeviceConfigPatch } from './types';

const DEFAULT_SERVER_URL = 'http://localhost:3000';

let cached: DeviceConfig | null = null;

export function getConfigPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

function defaultConfig(): DeviceConfig {
  return {
    deviceId: randomUUID(),
    deviceName: hostname() || 'rig-terminal',
    serverUrl: DEFAULT_SERVER_URL,
    apiKey: null,
    rigId: null,
  };
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Normalisasi file config lama/rusak ke `DeviceConfig` utuh (tanpa throw). */
function normalize(raw: unknown, fallback: DeviceConfig): DeviceConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const obj = raw as Record<string, unknown>;
  const deviceId = asStringOrNull(obj.deviceId) ?? fallback.deviceId;
  const deviceName = asStringOrNull(obj.deviceName) ?? fallback.deviceName;
  const serverUrl = asStringOrNull(obj.serverUrl) ?? fallback.serverUrl;
  return {
    deviceId,
    deviceName,
    serverUrl: serverUrl.replace(/\/+$/, ''),
    apiKey: asStringOrNull(obj.apiKey),
    rigId: asStringOrNull(obj.rigId),
  };
}

function writeConfigFile(cfg: DeviceConfig): void {
  const path = getConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Baca config dari disk. Bila belum ada: buat default (deviceId baru) lalu simpan.
 * Hasil di-cache di memori sampai `saveConfig()` dipanggil.
 */
export function loadConfig(): DeviceConfig {
  if (cached) return cached;

  const path = getConfigPath();
  const fallback = defaultConfig();

  if (!existsSync(path)) {
    cached = fallback;
    writeConfigFile(cached);
    return cached;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const normalized = normalize(parsed, fallback);
    cached = normalized;
    // Tulis ulang bila normalisasi menambah field yang belum ada di file lama.
    writeConfigFile(normalized);
    return cached;
  } catch (err) {
    console.error('[config] gagal membaca config.json, memakai default:', err);
    cached = fallback;
    writeConfigFile(cached);
    return cached;
  }
}

/**
 * Simpan sebagian field. `undefined` = tidak diubah, `null` = dikosongkan
 * (kecuali deviceId/deviceName/serverUrl yang tidak boleh null).
 */
export function saveConfig(patch: DeviceConfigPatch): DeviceConfig {
  const current = loadConfig();

  const next: DeviceConfig = {
    deviceId: asStringOrNull(patch.deviceId) ?? current.deviceId,
    deviceName: asStringOrNull(patch.deviceName) ?? current.deviceName,
    serverUrl: (asStringOrNull(patch.serverUrl) ?? current.serverUrl).replace(/\/+$/, ''),
    apiKey: patch.apiKey === undefined ? current.apiKey : asStringOrNull(patch.apiKey),
    rigId: patch.rigId === undefined ? current.rigId : asStringOrNull(patch.rigId),
  };

  writeConfigFile(next);
  cached = next;
  return next;
}

/** Hanya untuk test/restore: paksa cache memakai nilai tertentu. */
export function setCachedConfig(cfg: DeviceConfig): void {
  cached = normalize(cfg, defaultConfig());
  writeConfigFile(cached);
}
