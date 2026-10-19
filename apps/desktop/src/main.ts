/**
 * MAIN PROCESS - RigDaily Internal (terminal rig, offline-first).
 *
 * Urutan start:
 *  1. Single instance lock (dua instance = dua penulis SQLite → korupsi).
 *  2. `initDb()` (WAL + tabel idempoten) dan `loadConfig()`.
 *  3. Backup harian otomatis bila `lastBackupAt` > 24 jam.
 *  4. `registerIpcHandlers()` + `SyncWorker` (state dikirim ke renderer tiap siklus).
 *  5. BrowserWindow memuat `RIGDAILY_URL ?? config.serverUrl`; bila server tidak
 *     terjangkau → muat `offline.html` (status offline + Sync Now + daftar draft).
 */
import { BrowserWindow, Menu, app, type MenuItemConstructorOptions } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig } from './config';
import { closeDb, initDb, listLocalReports } from './db';
import { maybeDailyBackup } from './backup';
import { registerIpcHandlers } from './ipc';
import { SyncWorker } from './sync-worker';
import type { SyncState } from './types';

const DEV_ICON_HINT = 'build/icon.ico';

let mainWindow: BrowserWindow | null = null;
let syncWorker: SyncWorker | null = null;
let servedOffline = false;
let quitting = false;

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

function preloadPath(): string {
  // dist/main.js & dist/preload.js berada di folder yang sama.
  return join(__dirname, 'preload.js');
}

function offlinePagePath(): string {
  // electron-builder mengemas offline.html di root app (lihat electron-builder.yml),
  // jadi dari dist/ naik satu level.
  const packaged = join(__dirname, '..', 'offline.html');
  return existsSync(packaged) ? packaged : join(__dirname, 'offline.html');
}

function serverUrlToLoad(): string {
  const fromEnv = process.env.RIGDAILY_URL?.trim();
  if (fromEnv) return fromEnv;
  return loadConfig().serverUrl;
}

function broadcastState(state: SyncState): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('sync:state', state);
}

async function loadOfflineFallback(reason: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  servedOffline = true;
  console.warn(`[main] memuat halaman offline: ${reason}`);
  try {
    await mainWindow.loadFile(offlinePagePath(), { query: { reason, drafts: String(listLocalReports().length) } });
  } catch (err) {
    console.error('[main] gagal memuat offline.html, memakai data URL minimal:', err);
    const drafts = listLocalReports().length;
    const html = `<!doctype html><meta charset="utf-8"><title>RigDaily - Offline</title>
<body style="font-family:Segoe UI,sans-serif;padding:32px;background:#faf8ff;color:#131b2e">
<h1 style="font-size:20px">RigDaily Internal - Offline</h1>
<p>Server kantor tidak terjangkau. ${drafts} draft lokal tersimpan aman di perangkat ini.</p>
<p style="color:#92400e">${escapeHtmlText(reason)}</p></body>`;
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
}

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function createWindow(): void {
  const iconPath = join(app.getAppPath(), DEV_ICON_HINT);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#FAF8FF',
    title: 'RigDaily Internal',
    autoHideMenuBar: true,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  const win = mainWindow;

  win.once('ready-to-show', () => {
    win.show();
  });

  // Akses ke server tidak pernah membuka jendela baru; tautan eksternal diabaikan
  // (aplikasi internal, koneksi keluar tak diizinkan).
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    const code = Number(errorCode);
    // -3 = ERR_ABORTED (diabaikan: bisa jadi redirect normal / request dibatalkan).
    if (code === -3) return;
    void loadOfflineFallback(`Gagal memuat ${validatedURL} (${errorDescription || code}).`).then(() => {
      if (syncWorker) broadcastState(syncWorker.getState());
    });
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  const target = serverUrlToLoad();
  win
    .loadURL(target)
    .then(() => {
      servedOffline = false;
    })
    .catch((err: unknown) => {
      void loadOfflineFallback(`Server ${target} tidak dapat dijangkau: ${String(err)}`);
    });
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Sync Now',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            void syncWorker?.runOnce();
          },
        },
        {
          label: 'Export Backup Bundle...',
          click: () => {
            mainWindow?.webContents.executeJavaScript("window.rigdaily?.backup.export()").catch(() => undefined);
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Keluar' },
      ],
    },
    {
      label: 'Tampilan',
      submenu: [
        { role: 'reload', label: 'Muat ulang' },
        { role: 'toggleDevTools', label: 'Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Zoom in' },
        { role: 'zoomOut', label: 'Zoom out' },
      ],
    },
    {
      label: 'Bantuan',
      submenu: [
        {
          label: 'Tentang RigDaily',
          click: () => {
            const info = {
              version: app.getVersion(),
              deviceId: loadConfig().deviceId,
              db: join(app.getPath('userData'), 'app.db'),
            };
            mainWindow?.webContents.executeJavaScript(
              `window.alert(${JSON.stringify(`RigDaily Internal ${info.version}\nDevice: ${info.deviceId}\nDB: ${info.db}`)})`,
            ).catch(() => undefined);
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

function bootstrap(): void {
  const userData = app.getPath('userData');
  const config = loadConfig();

  try {
    initDb();
  } catch (err) {
    console.error('[main] gagal membuka SQLite lokal:', err);
  }

  // Backup harian sebelum window tampil, supaya bundle selalu berisi data terbaru.
  const backupPath = maybeDailyBackup(config, userData);
  if (backupPath) console.warn('[main] backup harian ditulis:', backupPath);

  syncWorker = new SyncWorker({
    deviceId: config.deviceId,
    serverUrl: config.serverUrl,
    apiKey: config.apiKey,
    onState: (state) => broadcastState(state),
  });

  registerIpcHandlers({
    getWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    syncWorker,
  });

  buildMenu();
  createWindow();

  syncWorker.start();
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // Instance kedua: keluar diam-diam, fokuskan window milik instance pertama.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((err: unknown) => {
    console.error('[main] bootstrap gagal:', err);
    app.exit(1);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    syncWorker?.stop();
    closeDb();
  });
}

// Worker & fetch berjalan async: jangan biarkan rejection menjatuhkan proses rig.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});

/** Status halaman: true bila window sedang menampilkan fallback offline. */
export function isServingOffline(): boolean {
  return servedOffline;
}
