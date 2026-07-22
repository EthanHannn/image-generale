import { base64ToBlob, blobToBase64 } from './utils'

export const CFG_KEY = 'img-tool-cfg'
export const THEME_KEY = 'img-tool-theme'
export const UPSCALE_KEY = 'img-tool-upscale'
const DB_NAME = 'ImageGenHistoryDB'
const DB_VERSION = 2
const STORE_NAME = 'records'

export type HistoryStorageLimitMode = 'unlimited' | 'limited'

export type HistoryStoragePolicy = {
  limitMode: HistoryStorageLimitMode
  limitBytes: number | null
}

export type StorageCleanupResult = {
  deletedCount: number
  freedBytes: number
  remainingBytes: number
  limitReached: boolean
}

export const DEFAULT_HISTORY_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024
export const DEFAULT_HISTORY_STORAGE_POLICY: HistoryStoragePolicy = {
  limitMode: 'unlimited',
  limitBytes: null,
}

export type ProviderConfig = {
  id: string
  name: string
  apiUrl: string
  apiKey: string
}

export type ThemeName = 'dark' | 'light' | 'system'

export type RequestParams = {
  n: number
  size: string
  quality: string
  autoPrompt: string
  promptSizeHint?: string
  translate: string
  resolution?: string
  targetSizeMode?: 'ratio' | 'manual'
  targetRatio?: string
  targetWidth?: number
  targetHeight?: number
  generationWidth?: number
  generationHeight?: number
  compressTo1k?: boolean
  autoUpscale?: boolean
  autoUpscaleFactor?: number
  standaloneUpscale?: boolean
  sourceFileName?: string
  sourceFileSize?: number
  sourceMimeType?: string
  sourceWidth?: number
  sourceHeight?: number
  upscaleProviderId?: string
  upscaleProviderName?: string
  upscaleFactor?: number
  outputWidth?: number
  outputHeight?: number
}

export type HistoryRecord = {
  id?: number
  timestamp: number
  providerId: string
  providerName: string
  mode: 'gen' | 'edit' | 'upscale'
  modelId: string
  modelName: string
  prompt: string
  params: RequestParams
  images: Blob[]
  imageCount: number
  duration: string
  requestJson: string
  totalSize: number
  thumbnails?: Blob[]
  upscaledImages?: Record<number, Record<number, Blob>>
  isFavorite?: boolean
  favoritedAt?: number | null
}

export type HistoryRecordModeFilter = 'all' | 'gen' | 'edit' | 'upscale'

export type HistoryPageQuery = {
  search: string
  modelId: string
  favoriteOnly: boolean
  modeFilter: HistoryRecordModeFilter
  offset: number
  limit: number
}

export type HistoryPageResult = {
  records: HistoryRecord[]
  totalCount: number
}

export type HistoryOverview = {
  totalCount: number
  totalImages: number
  favoriteCount: number
  modelIds: string[]
  latestRecord: HistoryRecord | null
}

type DesktopHistoryRecord = Omit<HistoryRecord, 'images' | 'thumbnails'> & {
  imagesBase64: string[]
  thumbnailBase64?: string[]
  upscaleImagesBase64?: Record<string, Record<string, string>>
}

type DesktopHistoryPageResult = {
  records: DesktopHistoryRecord[]
  totalCount: number
}

type DesktopHistoryOverview = Omit<HistoryOverview, 'latestRecord'> & {
  latestRecord: DesktopHistoryRecord | null
}

type DbConfig = {
  providers: ProviderConfig[]
  currentProviderId: string
}

export type UpscaleProvider = 'aliyun' | 'custom'

export type UpscaleProviderConfig = {
  id: string
  name: string
  provider: UpscaleProvider
  accessKeyId: string
  accessKeySecret: string
  apiUrl: string
  apiKey: string
}

export type AliyunUpscaleConfig = {
  provider: 'aliyun'
  accessKeyId: string
  accessKeySecret: string
}

export type CustomUpscaleConfig = {
  provider: 'custom'
  apiUrl: string
  apiKey: string
}

export type UpscaleConfig = AliyunUpscaleConfig | CustomUpscaleConfig

export function isUpscaleConfigured(config: UpscaleConfig): boolean {
  if (config.provider === 'aliyun')
    return !!(config.accessKeyId && config.accessKeySecret)
  return !!normalizeBaseUrl(config.apiUrl)
}

export type AppConfigSnapshot = DbConfig & {
  upscaleConfig: UpscaleConfig
  upscaleProviders: UpscaleProviderConfig[]
  currentUpscaleProviderId: string
  theme: ThemeName
  historyRootDir: string
  historyStoragePolicy: HistoryStoragePolicy
}

// UI 层使用的平铺表单状态，两套供应商字段同时保留，切换不清空
export type UpscaleFormState = {
  provider: UpscaleProvider
  accessKeyId: string
  accessKeySecret: string
  apiUrl: string
  apiKey: string
}

export function toUpscaleConfig(form: UpscaleFormState): UpscaleConfig {
  if (form.provider === 'aliyun')
    return { provider: 'aliyun', accessKeyId: form.accessKeyId, accessKeySecret: form.accessKeySecret }
  return { provider: 'custom', apiUrl: form.apiUrl, apiKey: form.apiKey }
}

export function fromUpscaleConfig(config: UpscaleConfig): UpscaleFormState {
  if (config.provider === 'aliyun')
    return { provider: 'aliyun', accessKeyId: config.accessKeyId, accessKeySecret: config.accessKeySecret, apiUrl: '', apiKey: '' }
  return { provider: 'custom', apiUrl: config.apiUrl, apiKey: config.apiKey, accessKeyId: '', accessKeySecret: '' }
}

export function upscaleProviderToConfig(provider: UpscaleProviderConfig | null | undefined): UpscaleConfig {
  if (!provider)
    return DEFAULT_UPSCALE_CONFIG
  if (provider.provider === 'aliyun')
    return { provider: 'aliyun', accessKeyId: provider.accessKeyId, accessKeySecret: provider.accessKeySecret }
  return { provider: 'custom', apiUrl: provider.apiUrl, apiKey: provider.apiKey }
}

export function isUpscaleProviderConfigured(provider: UpscaleProviderConfig | null | undefined): boolean {
  return !!provider && isUpscaleConfigured(upscaleProviderToConfig(provider))
}

const DEFAULT_UPSCALE_CONFIG: UpscaleConfig = {
  provider: 'custom',
  apiUrl: '',
  apiKey: '',
}

const DEFAULT_UPSCALE_STORE = {
  providers: [] as UpscaleProviderConfig[],
  currentProviderId: '',
}

function normalizeUpscaleConfig(raw: unknown): UpscaleConfig {
  if (typeof raw !== 'object' || raw === null)
    return DEFAULT_UPSCALE_CONFIG
  const obj = raw as Record<string, unknown>
  if (obj.provider === 'aliyun') {
    return {
      provider: 'aliyun',
      accessKeyId: typeof obj.accessKeyId === 'string' ? obj.accessKeyId : '',
      accessKeySecret: typeof obj.accessKeySecret === 'string' ? obj.accessKeySecret : '',
    }
  }
  // 兼容无 provider 字段的旧格式
  return {
    provider: 'custom',
    apiUrl: typeof obj.apiUrl === 'string' ? obj.apiUrl : '',
    apiKey: typeof obj.apiKey === 'string' ? obj.apiKey : '',
  }
}

function normalizeUpscaleProviderConfig(raw: unknown): UpscaleProviderConfig | null {
  if (typeof raw !== 'object' || raw === null)
    return null

  const obj = raw as Record<string, unknown>
  const provider: UpscaleProvider = obj.provider === 'aliyun' ? 'aliyun' : 'custom'
  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : makeProviderId(),
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : '未命名超分服务',
    provider,
    accessKeyId: typeof obj.accessKeyId === 'string' ? obj.accessKeyId : '',
    accessKeySecret: typeof obj.accessKeySecret === 'string' ? obj.accessKeySecret : '',
    apiUrl: typeof obj.apiUrl === 'string' ? obj.apiUrl : '',
    apiKey: typeof obj.apiKey === 'string' ? obj.apiKey : '',
  }
}

function upscaleConfigToProvider(config: UpscaleConfig, name = '默认超分服务'): UpscaleProviderConfig {
  const form = fromUpscaleConfig(config)
  return {
    id: makeProviderId(),
    name,
    provider: form.provider,
    accessKeyId: form.accessKeyId,
    accessKeySecret: form.accessKeySecret,
    apiUrl: form.apiUrl,
    apiKey: form.apiKey,
  }
}

function normalizeUpscaleStore(raw: unknown, fallbackConfig?: UpscaleConfig) {
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    if (Array.isArray(obj.providers)) {
      const providers = obj.providers
        .map(normalizeUpscaleProviderConfig)
        .filter((provider): provider is UpscaleProviderConfig => !!provider)
      const currentProviderId = typeof obj.currentProviderId === 'string'
        ? obj.currentProviderId
        : ''
      return {
        providers,
        currentProviderId: providers.some(provider => provider.id === currentProviderId)
          ? currentProviderId
          : providers[0]?.id || '',
      }
    }
  }

  const config = fallbackConfig || normalizeUpscaleConfig(raw)
  if (isUpscaleConfigured(config)) {
    const provider = upscaleConfigToProvider(config)
    return { providers: [provider], currentProviderId: provider.id }
  }

  return DEFAULT_UPSCALE_STORE
}

function normalizeHistoryStoragePolicy(raw: unknown): HistoryStoragePolicy {
  if (typeof raw !== 'object' || raw === null)
    return DEFAULT_HISTORY_STORAGE_POLICY

  const obj = raw as Record<string, unknown>
  if (obj.limitMode !== 'limited')
    return DEFAULT_HISTORY_STORAGE_POLICY

  const limitBytes = typeof obj.limitBytes === 'number' ? obj.limitBytes : Number(obj.limitBytes)
  if (!Number.isFinite(limitBytes) || limitBytes <= 0)
    return DEFAULT_HISTORY_STORAGE_POLICY

  return {
    limitMode: 'limited',
    limitBytes: Math.round(limitBytes),
  }
}

export function isDesktopApp() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  if (!isDesktopApp())
    return null

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

async function serializeHistoryRecord(record: HistoryRecord): Promise<DesktopHistoryRecord> {
  const upscaleImagesBase64: Record<string, Record<string, string>> = {}
  for (const [imageIndex, variants] of Object.entries(record.upscaledImages || {})) {
    upscaleImagesBase64[imageIndex] = {}
    for (const [factor, blob] of Object.entries(variants))
      upscaleImagesBase64[imageIndex][factor] = await blobToBase64(blob)
  }

  return {
    ...record,
    imagesBase64: await Promise.all((record.images || []).map(blob => blobToBase64(blob))),
    thumbnailBase64: record.thumbnails?.length
      ? await Promise.all(record.thumbnails.map(blob => blobToBase64(blob)))
      : [],
    upscaleImagesBase64,
  }
}

function deserializeHistoryRecord(record: DesktopHistoryRecord): HistoryRecord {
  const upscaledImages: Record<number, Record<number, Blob>> = {}
  for (const [imageIndex, variants] of Object.entries(record.upscaleImagesBase64 || {})) {
    upscaledImages[Number(imageIndex)] = {}
    for (const [factor, base64] of Object.entries(variants))
      upscaledImages[Number(imageIndex)][Number(factor)] = base64ToBlob(base64)
  }

  return {
    ...record,
    images: (record.imagesBase64 || []).map(base64 => base64ToBlob(base64)),
    thumbnails: (record.thumbnailBase64 || []).map(base64 => base64ToBlob(base64)),
    upscaledImages,
    isFavorite: !!record.isFavorite,
    favoritedAt: record.favoritedAt || null,
  }
}

function filterHistoryRecords(records: HistoryRecord[], query: HistoryPageQuery) {
  const search = query.search.trim().toLowerCase()
  return records.filter((record) => {
    const hitPrompt = !search || record.prompt.toLowerCase().includes(search)
    const hitModel = !query.modelId || record.modelId === query.modelId
    const hitFavorite = !query.favoriteOnly || !!record.isFavorite
    const hitMode = query.modeFilter === 'all' || record.mode === query.modeFilter
    return hitPrompt && hitModel && hitFavorite && hitMode
  })
}

function getHistoryOverviewFromRecords(records: HistoryRecord[]): HistoryOverview {
  return {
    totalCount: records.length,
    totalImages: records.reduce((sum, record) => sum + (record.imageCount || 0), 0),
    favoriteCount: records.filter(record => record.isFavorite).length,
    modelIds: [...new Set(records.map(record => record.modelId))].sort(),
    latestRecord: records[0] || null,
  }
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      let store: IDBObjectStore
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
        store.createIndex('by_timestamp', 'timestamp', { unique: false })
        store.createIndex('by_modelId', 'modelId', { unique: false })
      }
      else {
        store = request.transaction!.objectStore(STORE_NAME)
      }

      if (!store.indexNames.contains('by_favorite'))
        store.createIndex('by_favorite', 'isFavorite', { unique: false })
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
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : null
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

  const fallbackUpscaleConfig = normalizeUpscaleConfig(raw.upscaleConfig)
  const upscaleStore = normalizeUpscaleStore({
    providers: raw.upscaleProviders,
    currentProviderId: raw.currentUpscaleProviderId,
  }, fallbackUpscaleConfig)
  const currentUpscaleProvider = upscaleStore.providers.find(provider => provider.id === upscaleStore.currentProviderId) || null

  return {
    ...config,
    upscaleConfig: currentUpscaleProvider ? upscaleProviderToConfig(currentUpscaleProvider) : fallbackUpscaleConfig,
    upscaleProviders: upscaleStore.providers,
    currentUpscaleProviderId: upscaleStore.currentProviderId,
    historyRootDir: raw.historyRootDir || '',
    historyStoragePolicy: normalizeHistoryStoragePolicy(raw.historyStoragePolicy),
    theme: raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system'
      ? raw.theme
      : (loadThemeFromLocalStorage() || 'dark'),
  }
}

export async function loadAppConfig(): Promise<AppConfigSnapshot> {
  const upscaleStore = loadUpscaleProviders()
  const localSnapshot = normalizeSnapshot({
    ...loadConfig(),
    upscaleConfig: loadUpscaleConfig(),
    upscaleProviders: upscaleStore.providers,
    currentUpscaleProviderId: upscaleStore.currentProviderId,
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
  saveUpscaleStore({
    providers: nextSnapshot.upscaleProviders,
    currentProviderId: nextSnapshot.currentUpscaleProviderId,
  })
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
  const nextRecord: HistoryRecord = {
    ...record,
    isFavorite: !!record.isFavorite,
    favoritedAt: record.favoritedAt || null,
  }

  if (isDesktopApp()) {
    return serializeHistoryRecord(nextRecord).then(serialized => invokeDesktop<number>('add_history_record', { record: serialized }))
  }

  return withStore<number>('readwrite', (store, resolve, reject) => {
    const request = store.add(nextRecord)
    request.onsuccess = () => resolve(Number(request.result))
    request.onerror = () => reject(request.error)
  })
}

export function saveHistoryUpscaleVariant(
  recordId: number,
  imageIndex: number,
  factor: number,
  imageBase64: string,
  localPath?: string,
) {
  if (isDesktopApp()) {
    return invokeDesktop<void>('save_history_upscale_variant', {
      recordId,
      imageIndex,
      factor,
      imageBase64,
      localPath: localPath || null,
    })
  }

  return withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.get(recordId)
    request.onsuccess = () => {
      const record = request.result as HistoryRecord | undefined
      if (!record) {
        resolve()
        return
      }
      const upscaledImages = record.upscaledImages || {}
      upscaledImages[imageIndex] = {
        ...(upscaledImages[imageIndex] || {}),
        [factor]: base64ToBlob(imageBase64),
      }
      const updateRequest = store.put({ ...record, upscaledImages })
      updateRequest.onsuccess = () => resolve()
      updateRequest.onerror = () => reject(updateRequest.error)
    }
    request.onerror = () => reject(request.error)
  })
}

export function saveHistoryThumbnails(recordId: number, thumbnailsBase64: string[]) {
  if (isDesktopApp()) {
    return invokeDesktop<void>('save_history_thumbnails', {
      recordId,
      thumbnailsBase64,
    })
  }

  return withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.get(recordId)
    request.onsuccess = () => {
      const record = request.result as HistoryRecord | undefined
      if (!record) {
        resolve()
        return
      }
      const updateRequest = store.put({
        ...record,
        thumbnails: thumbnailsBase64.map(base64 => base64ToBlob(base64)),
      })
      updateRequest.onsuccess = () => resolve()
      updateRequest.onerror = () => reject(updateRequest.error)
    }
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

export function getHistoryPage(query: HistoryPageQuery): Promise<HistoryPageResult> {
  const offset = Math.max(0, query.offset)
  const limit = Math.max(1, query.limit)

  if (isDesktopApp()) {
    return invokeDesktop<DesktopHistoryPageResult>('list_history_records_page', {
      search: query.search || null,
      modelId: query.modelId || null,
      favoriteOnly: query.favoriteOnly,
      modeFilter: query.modeFilter,
      offset,
      limit,
    }).then(result => ({
      records: (result?.records || []).map(deserializeHistoryRecord),
      totalCount: result?.totalCount || 0,
    }))
  }

  return getAllRecords().then((records) => {
    const filteredRecords = filterHistoryRecords(records, { ...query, offset, limit })
    return {
      records: filteredRecords.slice(offset, offset + limit),
      totalCount: filteredRecords.length,
    }
  })
}

export function getHistoryOverview(): Promise<HistoryOverview> {
  if (isDesktopApp()) {
    return invokeDesktop<DesktopHistoryOverview>('get_history_overview').then((overview) => ({
      totalCount: overview?.totalCount || 0,
      totalImages: overview?.totalImages || 0,
      favoriteCount: overview?.favoriteCount || 0,
      modelIds: overview?.modelIds || [],
      latestRecord: overview?.latestRecord ? deserializeHistoryRecord(overview.latestRecord) : null,
    }))
  }

  return getAllRecords().then(getHistoryOverviewFromRecords)
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

export function setRecordFavorite(id: number, isFavorite: boolean) {
  const favoritedAt = isFavorite ? Date.now() : null

  if (isDesktopApp()) {
    return invokeDesktop<void>('set_history_record_favorite', {
      recordId: id,
      isFavorite,
      favoritedAt,
    })
  }

  return withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.get(id)
    request.onsuccess = () => {
      const record = request.result as HistoryRecord | undefined
      if (!record) {
        resolve()
        return
      }
      const updateRequest = store.put({ ...record, isFavorite, favoritedAt })
      updateRequest.onsuccess = () => resolve()
      updateRequest.onerror = () => reject(updateRequest.error)
    }
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

export async function deleteUnfavoriteRecords() {
  if (isDesktopApp())
    return (await invokeDesktop<number>('clear_unfavorite_history_records')) || 0

  const records = await getAllRecords()
  const recordsToRemove = records.filter(record => !record.isFavorite)
  await Promise.all(recordsToRemove.map(record => record.id === undefined ? Promise.resolve() : deleteRecord(record.id)))
  return recordsToRemove.length
}

export async function getTotalSize() {
  if (isDesktopApp())
    return (await invokeDesktop<number>('get_history_storage_usage')) || 0

  const records = await getAllRecords()
  return records.reduce((sum, item) => sum + (item.totalSize || 0), 0)
}

export async function enforceStorageLimit(policy: HistoryStoragePolicy): Promise<StorageCleanupResult> {
  const normalizedPolicy = normalizeHistoryStoragePolicy(policy)
  const total = await getTotalSize()
  if (normalizedPolicy.limitMode !== 'limited' || !normalizedPolicy.limitBytes) {
    return {
      deletedCount: 0,
      freedBytes: 0,
      remainingBytes: total,
      limitReached: false,
    }
  }

  const maxStorage = normalizedPolicy.limitBytes
  if (isDesktopApp()) {
    const result = await invokeDesktop<StorageCleanupResult>('enforce_history_storage_limit', { maxStorage })
    return result || {
      deletedCount: 0,
      freedBytes: 0,
      remainingBytes: await getTotalSize(),
      limitReached: false,
    }
  }

  let currentTotal = total
  let deletedCount = 0
  let freedBytes = 0
  if (currentTotal <= maxStorage) {
    return {
      deletedCount,
      freedBytes,
      remainingBytes: currentTotal,
      limitReached: false,
    }
  }

  const records = await getRecordsAsc()
  for (const record of records) {
    if (currentTotal <= maxStorage)
      break
    if (record.isFavorite)
      continue
    if (record.id !== undefined)
      await deleteRecord(record.id)
    deletedCount += 1
    freedBytes += record.totalSize || 0
    currentTotal -= record.totalSize || 0
  }

  return {
    deletedCount,
    freedBytes,
    remainingBytes: Math.max(currentTotal, 0),
    limitReached: currentTotal > maxStorage,
  }
}

export function loadUpscaleConfig(): UpscaleConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(UPSCALE_KEY) || '{}')
    if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { providers?: unknown }).providers)) {
      const store = normalizeUpscaleStore(raw)
      return upscaleProviderToConfig(store.providers.find(provider => provider.id === store.currentProviderId))
    }
    return normalizeUpscaleConfig(raw)
  }
  catch {
    return DEFAULT_UPSCALE_CONFIG
  }
}

export function saveUpscaleConfig(config: UpscaleConfig) {
  localStorage.setItem(UPSCALE_KEY, JSON.stringify(config))
}

export function loadUpscaleProviders() {
  try {
    const raw = JSON.parse(localStorage.getItem(UPSCALE_KEY) || '{}')
    return normalizeUpscaleStore(raw)
  }
  catch {
    return DEFAULT_UPSCALE_STORE
  }
}

export function saveUpscaleStore(store: { providers: UpscaleProviderConfig[]; currentProviderId: string }) {
  localStorage.setItem(UPSCALE_KEY, JSON.stringify(normalizeUpscaleStore(store)))
}
