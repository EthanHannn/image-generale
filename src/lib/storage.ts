import { base64ToBlob, blobToBase64 } from './utils'

export const CFG_KEY = 'img-tool-cfg'
export const THEME_KEY = 'img-tool-theme'
export const UPSCALE_KEY = 'img-tool-upscale'
const DB_NAME = 'ImageGenHistoryDB'
const DB_VERSION = 1
const STORE_NAME = 'records'
export const MAX_STORAGE = 1024 * 1024 * 1024

export type ProviderConfig = {
  id: string
  name: string
  apiUrl: string
  apiKey: string
}

export type ThemeName = 'dark' | 'light'

export type RequestParams = {
  n: number
  size: string
  quality: string
  autoPrompt: string
  translate: string
  resolution?: string
}

export type HistoryRecord = {
  id?: number
  timestamp: number
  providerId: string
  providerName: string
  mode: 'gen' | 'edit'
  modelId: string
  modelName: string
  prompt: string
  params: RequestParams
  images: Blob[]
  imageCount: number
  duration: string
  requestJson: string
  totalSize: number
}

type DesktopHistoryRecord = Omit<HistoryRecord, 'images'> & {
  imagesBase64: string[]
}

type DbConfig = {
  providers: ProviderConfig[]
  currentProviderId: string
}

export type UpscaleConfig = {
  apiUrl: string
  apiKey: string
}

export type AppConfigSnapshot = DbConfig & {
  upscaleConfig: UpscaleConfig
  theme: ThemeName
  historyRootDir: string
}

const DEFAULT_UPSCALE_CONFIG: UpscaleConfig = {
  apiUrl: '',
  apiKey: '',
}

function isDesktopApp() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  if (!isDesktopApp())
    return null

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

async function serializeHistoryRecord(record: HistoryRecord): Promise<DesktopHistoryRecord> {
  return {
    ...record,
    imagesBase64: await Promise.all((record.images || []).map(blob => blobToBase64(blob))),
  }
}

function deserializeHistoryRecord(record: DesktopHistoryRecord): HistoryRecord {
  return {
    ...record,
    images: (record.imagesBase64 || []).map(base64 => base64ToBlob(base64)),
  }
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
        store.createIndex('by_timestamp', 'timestamp', { unique: false })
        store.createIndex('by_modelId', 'modelId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function withStore<T>(mode: IDBTransactionMode, execute: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void) {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], mode)
    const store = tx.objectStore(STORE_NAME)
    execute(store, resolve, reject)
    tx.oncomplete = () => db.close()
    tx.onerror = () => reject(tx.error)
  }))
}

export function makeProviderId() {
  return `provider_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '')
}

export function loadConfig(): DbConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') as Partial<DbConfig> & { apiUrl?: string; apiKey?: string }
    if (Array.isArray(raw.providers)) {
      return {
        providers: raw.providers.map((provider) => ({
          id: provider.id || makeProviderId(),
          name: provider.name?.trim() || '未命名供应商',
          apiUrl: provider.apiUrl || '',
          apiKey: provider.apiKey || '',
        })),
        currentProviderId: raw.currentProviderId || raw.providers[0]?.id || '',
      }
    }

    if (raw.apiUrl || raw.apiKey) {
      const id = makeProviderId()
      return {
        providers: [{
          id,
          name: '默认供应商',
          apiUrl: raw.apiUrl || '',
          apiKey: raw.apiKey || '',
        }],
        currentProviderId: id,
      }
    }
  }
  catch {}

  return { providers: [], currentProviderId: '' }
}

export function saveConfig(config: DbConfig) {
  localStorage.setItem(CFG_KEY, JSON.stringify(config))
}

function loadThemeFromLocalStorage(): ThemeName | null {
  const saved = localStorage.getItem(THEME_KEY)
  return saved === 'light' || saved === 'dark' ? saved : null
}

function normalizeSnapshot(raw: Partial<AppConfigSnapshot> & { apiUrl?: string; apiKey?: string } = {}): AppConfigSnapshot {
  const config = Array.isArray(raw.providers)
    ? {
        providers: raw.providers.map((provider) => ({
          id: provider.id || makeProviderId(),
          name: provider.name?.trim() || '未命名供应商',
          apiUrl: provider.apiUrl || '',
          apiKey: provider.apiKey || '',
        })),
        currentProviderId: raw.currentProviderId || raw.providers[0]?.id || '',
      }
    : (raw.apiUrl || raw.apiKey)
        ? {
            providers: [{
              id: makeProviderId(),
              name: '默认供应商',
              apiUrl: raw.apiUrl || '',
              apiKey: raw.apiKey || '',
            }],
            currentProviderId: '',
          }
        : { providers: [], currentProviderId: '' }

  if (!config.currentProviderId && config.providers.length)
    config.currentProviderId = config.providers[0].id

  return {
    ...config,
    upscaleConfig: {
      apiUrl: raw.upscaleConfig?.apiUrl || '',
      apiKey: raw.upscaleConfig?.apiKey || '',
    },
    historyRootDir: raw.historyRootDir || '',
    theme: raw.theme === 'light' || raw.theme === 'dark'
      ? raw.theme
      : (loadThemeFromLocalStorage() || 'dark'),
  }
}

export async function loadAppConfig(): Promise<AppConfigSnapshot> {
  const localSnapshot = normalizeSnapshot({
    ...loadConfig(),
    upscaleConfig: loadUpscaleConfig(),
    theme: loadThemeFromLocalStorage() || undefined,
  })

  if (!isDesktopApp())
    return localSnapshot

  try {
    const desktopSnapshot = await invokeDesktop<AppConfigSnapshot | null>('load_app_config')
    if (desktopSnapshot)
      return normalizeSnapshot({
        ...desktopSnapshot,
        historyRootDir: desktopSnapshot.historyRootDir || (await getHistoryRootDir()) || '',
      })

    await saveAppConfig(localSnapshot)
    return normalizeSnapshot({
      ...localSnapshot,
      historyRootDir: (await getHistoryRootDir()) || localSnapshot.historyRootDir,
    })
  }
  catch {}

  return localSnapshot
}

export async function saveAppConfig(snapshot: AppConfigSnapshot) {
  const nextSnapshot = normalizeSnapshot(snapshot)

  saveConfig({
    providers: nextSnapshot.providers,
    currentProviderId: nextSnapshot.currentProviderId,
  })
  saveUpscaleConfig(nextSnapshot.upscaleConfig)
  localStorage.setItem(THEME_KEY, nextSnapshot.theme)

  if (!isDesktopApp())
    return

  await invokeDesktop('save_app_config', { config: nextSnapshot })
}

export async function selectHistoryDirectory() {
  return (await invokeDesktop<string | null>('select_history_directory')) || null
}

export async function openHistoryDirectory() {
  await invokeDesktop('open_history_directory')
}

export async function getHistoryRootDir() {
  return (await invokeDesktop<string | null>('get_history_root_dir')) || null
}

export function addRecord(record: HistoryRecord) {
  if (isDesktopApp()) {
    return serializeHistoryRecord(record).then(serialized => invokeDesktop<number>('add_history_record', { record: serialized }))
  }

  return withStore<number>('readwrite', (store, resolve, reject) => {
    const request = store.add(record)
    request.onsuccess = () => resolve(Number(request.result))
    request.onerror = () => reject(request.error)
  })
}

export function getAllRecords() {
  if (isDesktopApp()) {
    return invokeDesktop<DesktopHistoryRecord[]>('list_history_records', { descending: true })
      .then(records => (records || []).map(deserializeHistoryRecord))
  }

  return withStore<HistoryRecord[]>('readonly', (store, resolve, reject) => {
    const index = store.index('by_timestamp')
    const request = index.getAll()
    request.onsuccess = () => resolve((request.result as HistoryRecord[]).slice().reverse())
    request.onerror = () => reject(request.error)
  })
}

export function getRecordsAsc() {
  if (isDesktopApp()) {
    return invokeDesktop<DesktopHistoryRecord[]>('list_history_records', { descending: false })
      .then(records => (records || []).map(deserializeHistoryRecord))
  }

  return withStore<HistoryRecord[]>('readonly', (store, resolve, reject) => {
    const index = store.index('by_timestamp')
    const request = index.getAll()
    request.onsuccess = () => resolve(request.result as HistoryRecord[])
    request.onerror = () => reject(request.error)
  })
}

export function getRecord(id: number) {
  if (isDesktopApp()) {
    return invokeDesktop<DesktopHistoryRecord | null>('get_history_record', { id })
      .then(record => record ? deserializeHistoryRecord(record) : null)
  }

  return withStore<HistoryRecord | null>('readonly', (store, resolve, reject) => {
    const request = store.get(id)
    request.onsuccess = () => resolve((request.result as HistoryRecord | undefined) || null)
    request.onerror = () => reject(request.error)
  })
}

export function deleteRecord(id: number) {
  if (isDesktopApp())
    return invokeDesktop<void>('delete_history_record', { id })

  return withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export function clearAllRecords() {
  if (isDesktopApp())
    return invokeDesktop<void>('clear_history_records')

  return withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function getTotalSize() {
  if (isDesktopApp())
    return (await invokeDesktop<number>('get_history_storage_usage')) || 0

  const records = await getAllRecords()
  return records.reduce((sum, item) => sum + (item.totalSize || 0), 0)
}

export async function enforceStorageLimit() {
  if (isDesktopApp()) {
    await invokeDesktop('enforce_history_storage_limit', { maxStorage: MAX_STORAGE })
    return
  }

  let total = await getTotalSize()
  if (total <= MAX_STORAGE)
    return

  const records = await getRecordsAsc()
  for (const record of records) {
    if (total <= MAX_STORAGE)
      break
    if (record.id !== undefined)
      await deleteRecord(record.id)
    total -= record.totalSize || 0
  }
}

export function loadUpscaleConfig(): UpscaleConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(UPSCALE_KEY) || '{}') as Partial<UpscaleConfig>
    return { apiUrl: raw.apiUrl || '', apiKey: raw.apiKey || '' }
  }
  catch {
    return DEFAULT_UPSCALE_CONFIG
  }
}

export function saveUpscaleConfig(config: UpscaleConfig) {
  localStorage.setItem(UPSCALE_KEY, JSON.stringify(config))
}
