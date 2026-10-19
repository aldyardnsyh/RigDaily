/**
 * FALLBACK TYPE DECLARATIONS - HANYA dipakai bila paket aslinya tidak terpasang.
 *
 * Konteks: `electron` dan `better-sqlite3` TIDAK di-commit ke node_modules root
 * (berat, native). Saat `npm install --workspace=@rigdaily/desktop` dijalankan,
 * paket aslinya memasang `.d.ts` sendiri dan deklarasi di file ini otomatis
 * diabaikan TypeScript (`node_modules` punya prioritas; deklarasi duplikat pada
 * ambient module diabaikan selama strukturnya kompatibel - dan bila tidak, cukup
 * hapus file ini karena type asli sudah tersedia).
 *
 * Deklarasi di bawah = SUBSET API yang benar-benar dipakai apps/desktop/src.
 */

declare module 'electron' {
  import type { EventEmitter } from 'node:events';

  export interface IpcMainInvokeEvent {
    readonly senderId: number;
    readonly sender: WebContents;
  }

  export interface LoadFileOptions {
    query?: Record<string, string>;
    hash?: string;
  }

  export interface WebContents extends EventEmitter {
    send(channel: string, ...args: unknown[]): void;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
    loadURL(url: string): Promise<void>;
    loadFile(filePath: string, options?: LoadFileOptions): Promise<void>;
    on(event: 'did-fail-load', listener: (...args: unknown[]) => void): this;
    once(event: 'ready-to-show', listener: () => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    openDevTools(): void;
    setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void;
    session: { setPermissionRequestHandler(handler: (wc: WebContents, permission: string, cb: (granted: boolean) => void) => void): void };
  }

  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    show?: boolean;
    backgroundColor?: string;
    title?: string;
    autoHideMenuBar?: boolean;
    webPreferences?: {
      preload?: string;
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      sandbox?: boolean;
      webSecurity?: boolean;
      spellcheck?: boolean;
    };
  }

  export class BrowserWindow extends EventEmitter {
    constructor(options?: BrowserWindowConstructorOptions);
    readonly webContents: WebContents;
    loadURL(url: string): Promise<void>;
    loadFile(filePath: string, options?: LoadFileOptions): Promise<void>;
    show(): void;
    focus(): void;
    isMinimized(): boolean;
    restore(): void;
    isDestroyed(): boolean;
    destroy(): void;
    once(event: 'ready-to-show', listener: () => void): this;
    once(event: 'closed', listener: () => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    on(event: 'closed', listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    static getAllWindows(): BrowserWindow[];
    static fromWebContents(contents: WebContents): BrowserWindow | null;
  }

  export interface IpcMain extends EventEmitter {
    handle(
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ): void;
    handleOnce(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
  }

  export interface SaveDialogResult {
    canceled: boolean;
    filePath?: string;
  }

  export interface OpenDialogResult {
    canceled: boolean;
    filePaths: string[];
  }

  export interface MessageBoxOptions {
    type?: 'none' | 'info' | 'error' | 'question' | 'warning';
    title?: string;
    message: string;
    detail?: string;
    buttons?: string[];
    defaultId?: number;
    cancelId?: number;
    noLink?: boolean;
  }

  export interface Dialog {
    showSaveDialog(window: BrowserWindow | null, options: ElectronSaveDialogOptions): Promise<SaveDialogResult>;
    showOpenDialog(window: BrowserWindow | null, options: ElectronOpenDialogOptions): Promise<OpenDialogResult>;
    showMessageBox(window: BrowserWindow | null, options: MessageBoxOptions): Promise<{ response: number; checkboxChecked: boolean }>;
  }

  export interface ElectronSaveDialogOptions {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }

  export interface ElectronOpenDialogOptions {
    title?: string;
    defaultPath?: string;
    properties?: ('openFile' | 'openDirectory' | 'multiSelections')[];
    filters?: { name: string; extensions: string[] }[];
  }

  export interface App extends EventEmitter {
    getPath(name: 'userData' | 'appData' | 'logs' | 'temp' | 'home' | 'exe' | 'documents' | 'downloads'): string;
    getAppPath(): string;
    getVersion(): string;
    getName(): string;
    setName(name: string): void;
    setAppUserModelId(id: string): void;
    requestSingleInstanceLock(): boolean;
    quit(): void;
    exit(code?: number): void;
    whenReady(): Promise<void>;
    on(event: 'window-all-closed' | 'activate' | 'before-quit' | 'second-instance' | 'ready', listener: (...args: never[]) => void): this;
    on(event: string, listener: (...args: never[]) => void): this;
  }

  export interface MenuItemConstructorOptions {
    label?: string;
    role?: string;
    type?: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
    accelerator?: string;
    click?: () => void;
    submenu?: MenuItemConstructorOptions[];
  }

  export const app: App;
  export const ipcMain: IpcMain;
  export const dialog: Dialog;
  export const shell: { openExternal(url: string): Promise<void> };
  export const Menu: {
    setApplicationMenu(menu: ElectronMenuItem | null): void;
    buildFromTemplate(template: MenuItemConstructorOptions[]): ElectronMenuItem;
  };
  export interface ElectronMenuItem {
    readonly items?: ElectronMenuItem[];
  }

  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: unknown): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
    removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  };

  const electron: {
    app: App;
    ipcMain: IpcMain;
    dialog: Dialog;
    shell: { openExternal(url: string): Promise<void> };
    BrowserWindow: typeof BrowserWindow;
    Menu: typeof Menu;
    contextBridge: typeof contextBridge;
    ipcRenderer: typeof ipcRenderer;
  };
  export default electron;
}

declare module 'better-sqlite3' {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement<Row = Record<string, unknown>> {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Row | undefined;
    all(...params: unknown[]): Row[];
    iterate(...params: unknown[]): IterableIterator<Row>;
  }

  interface Database {
    prepare<Row = Record<string, unknown>>(source: string): Statement<Row>;
    exec(source: string): this;
    pragma(source: string): unknown;
    transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
    close(): this;
    readonly open: boolean;
  }

  interface DatabaseConstructor {
    new (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number }): Database;
    (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number }): Database;
    prototype: Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
