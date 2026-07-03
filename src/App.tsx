import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { ChangeEvent, DragEvent, MouseEvent, PointerEvent, SyntheticEvent, WheelEvent } from 'react'
import { Icon, type IconName } from './components/Icon'
import { HistoryView } from './features/history/HistoryView'
import { hydrateModels, type ModelPreset, type RemoteModel } from './lib/models'
import {
  DEFAULT_HISTORY_STORAGE_LIMIT_BYTES,
  DEFAULT_HISTORY_STORAGE_POLICY,
  addRecord,
  deleteRecord,
  enforceStorageLimit,
  getAllRecords,
  getRecord,
  getTotalSize,
  loadAppConfig,
  loadConfig,
  isDesktopApp,
  isUpscaleProviderConfigured,
  loadUpscaleProviders,
  makeProviderId,
  normalizeBaseUrl,
  openHistoryDirectory,
  saveAppConfig,
  saveHistoryUpscaleVariant,
  selectHistoryDirectory,
  setRecordFavorite,
  upscaleProviderToConfig,
  THEME_KEY,
  type HistoryStoragePolicy,
  type HistoryRecord,
  type ProviderConfig,
  type RequestParams,
  type ThemeName,
  type UpscaleProvider,
  type UpscaleProviderConfig,
} from './lib/storage'
import { upscaleImage } from './lib/upscale'
import { getErrorMessage } from './lib/errors'
import { saveImageFile } from './lib/files'
import { base64ToBlob, blobToBase64, formatSize, sanitizeFilename } from './lib/utils'

type StatusType = 'ok' | 'err' | 'loading' | 'warn'
type StatusValue = { type: StatusType; message: string } | null
type ToastValue = { type: 'success' | 'error'; message: string } | null
type ResultImage = { b64_json?: string; url?: string }
type ResultPayload = { data?: ResultImage[]; error?: { message?: string } | string }
type ViewName = 'workspace' | 'upscale' | 'history' | 'settings'
type UpscaleFactor = 1 | 2 | 3 | 4
type StandaloneUpscaleFactor = 2 | 3 | 4
type ImageDimensions = { width: number; height: number }
type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'
type StorageLimitUnit = 'MB' | 'GB'
type ImageContextMenuTarget =
  | { type: 'result'; index: number }
  | { type: 'standalone'; imageBase64: string; filename: string; mimeType: ImageMimeType }
type ImageContextMenuState = {
  x: number
  y: number
  target: ImageContextMenuTarget
}
type GlobalDropTarget =
  | { status: 'ready'; kind: 'workspace' | 'upscale'; title: string; hint: string }
  | { status: 'blocked'; title: string; hint: string }
type ImagePreviewState = {
  image: string
  title: string
  mode: 'single' | 'compare'
  split: number
  zoom: number
  fitZoom: number
  offsetX: number
  offsetY: number
  singleSide: 'before' | 'after'
  sideFitZooms: Partial<Record<'before' | 'after', number>>
  compare?: {
    before: string
    after: string
    beforeLabel: string
    afterLabel: string
  }
}
type HistoryFavoriteFilter = 'all' | 'favorites'
type HistoryModeFilter = 'all' | 'gen' | 'edit' | 'upscale'
type TargetSizeMode = 'ratio' | 'manual'
type TargetSizeState = {
  mode: TargetSizeMode
  ratioText: string
  targetWidth: number
  targetHeight: number
  autoUpscale: boolean
}
type TargetSizeDraft = {
  targetWidth: string
  targetHeight: string
}
type SizePlan = {
  targetWidth: number
  targetHeight: number
  generationWidth: number
  generationHeight: number
  requestSize: string
  needsUpscale: boolean
  autoUpscaleFactor: UpscaleFactor | null
  canAutoUpscale: boolean
  requiredScale: number
}
type SizePlanResult = { plan: SizePlan; error: null } | { plan: null; error: string }
type UpscaleOptions = {
  factor?: UpscaleFactor
  targetWidth?: number
  targetHeight?: number
  sourceImage?: ResultImage
  recordId?: number | null
  auto?: boolean
}
type StandaloneUpscaleVariant = {
  outputBase64: string
  outputWidth: number
  outputHeight: number
  duration: string
  responseJson: string
  activeRecordId: number | null
}
type StandaloneUpscaleState = {
  fileName: string
  fileSize: number
  mimeType: string
  sourceBase64: string
  sourceWidth: number
  sourceHeight: number
  factor: StandaloneUpscaleFactor
  outputBase64: string
  outputWidth: number
  outputHeight: number
  duration: string
  responseJson: string
  activeRecordId: number | null
  isProcessing: boolean
  completedFactors: Partial<Record<StandaloneUpscaleFactor, StandaloneUpscaleVariant>>
}

const GENERATION_MAX_AREA = 1024 * 1024
const TARGET_WIDTH_MIN = 256
const TARGET_WIDTH_MAX = 8192
const TARGET_SIZE_MIN = 64
const TARGET_SIZE_MAX = 16384
const SIZE_ALIGN = 8
const COMMON_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21']
const COMMON_TARGET_WIDTHS = [512, 768, 1024, 1280, 1920, 2560, 3840, 4096]
const COMMON_TARGET_HEIGHTS = [512, 720, 768, 1024, 1080, 1440, 2160, 3072]
const ALIYUN_UPSCALE_MAX_BYTES = 20 * 1024 * 1024
const ALIYUN_UPSCALE_MIN_SIDE = 64
const ALIYUN_UPSCALE_MAX_LONG_SIDE = 5000
const ALIYUN_UPSCALE_MAX_ASPECT_RATIO = 2

const emptyParams: RequestParams = {
  n: 1,
  size: '',
  quality: 'auto',
  autoPrompt: 'false',
  translate: 'false',
}

const defaultStandaloneUpscaleState: StandaloneUpscaleState = {
  fileName: '',
  fileSize: 0,
  mimeType: '',
  sourceBase64: '',
  sourceWidth: 0,
  sourceHeight: 0,
  factor: 2,
  outputBase64: '',
  outputWidth: 0,
  outputHeight: 0,
  duration: '',
  responseJson: '无',
  activeRecordId: null,
  isProcessing: false,
  completedFactors: {},
}

const defaultTargetSize: TargetSizeState = {
  mode: 'ratio',
  ratioText: '1:1',
  targetWidth: 1024,
  targetHeight: 1024,
  autoUpscale: false,
}

const defaultTargetSizeDraft: TargetSizeDraft = {
  targetWidth: String(defaultTargetSize.targetWidth),
  targetHeight: String(defaultTargetSize.targetHeight),
}

function getInitialTheme(): ThemeName {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark')
    return saved

  if (window.matchMedia?.('(prefers-color-scheme: light)').matches)
    return 'light'

  return 'dark'
}

export default function App() {
  const initialConfig = loadConfig()
  const initialUpscaleStore = loadUpscaleProviders()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const modalDirtyRef = useRef(false)
  const previewPanRef = useRef<{ x: number; y: number } | null>(null)
  const dragDepthRef = useRef(0)

  const [theme, setTheme] = useState<ThemeName>(getInitialTheme)
  const [providers, setProviders] = useState<ProviderConfig[]>(initialConfig.providers)
  const [currentProviderId, setCurrentProviderId] = useState(initialConfig.currentProviderId)
  const [providerDraft, setProviderDraft] = useState<ProviderConfig>({
    id: '',
    name: '',
    apiUrl: '',
    apiKey: '',
  })
  const [configReady, setConfigReady] = useState(false)
  const [connStatus, setConnStatus] = useState<StatusValue>(null)
  const [genStatus, setGenStatus] = useState<StatusValue>(null)
  const [toast, setToast] = useState<ToastValue>(null)

  const [models, setModels] = useState<ModelPreset[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [currentModelId, setCurrentModelId] = useState('')
  const [view, setView] = useState<ViewName>('workspace')
  const [mode, setMode] = useState<'gen' | 'edit'>('gen')
  const [prompt, setPrompt] = useState('')
  const [params, setParams] = useState<RequestParams>(emptyParams)
  const [targetSize, setTargetSize] = useState<TargetSizeState>(defaultTargetSize)
  const [targetSizeDraft, setTargetSizeDraft] = useState<TargetSizeDraft>(defaultTargetSizeDraft)
  const [refFiles, setRefFiles] = useState<File[]>([])
  const [requestJson, setRequestJson] = useState('无')
  const [upscaleResponseJson, setUpscaleResponseJson] = useState('无')
  const [resultTimer, setResultTimer] = useState('')
  const [results, setResults] = useState<ResultImage[]>([])
  const [activeHistoryRecordId, setActiveHistoryRecordId] = useState<number | null>(null)
  const [loadingCount, setLoadingCount] = useState(0)
  const [isGenerating, setIsGenerating] = useState(false)
  const [imageSizes, setImageSizes] = useState<Record<number, string>>({})
  const [originalImageSizes, setOriginalImageSizes] = useState<Record<number, ImageDimensions>>({})
  const [downloadedIndex, setDownloadedIndex] = useState<number | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [imageContextMenu, setImageContextMenu] = useState<ImageContextMenuState | null>(null)
  const [previewImage, setPreviewImage] = useState<ImagePreviewState | null>(null)
  const [previewDragging, setPreviewDragging] = useState(false)
  const [globalDropTarget, setGlobalDropTarget] = useState<GlobalDropTarget | null>(null)

  const [upscaleProviders, setUpscaleProviders] = useState<UpscaleProviderConfig[]>(initialUpscaleStore.providers)
  const [currentUpscaleProviderId, setCurrentUpscaleProviderId] = useState(initialUpscaleStore.currentProviderId)
  const [upscaleProviderDraft, setUpscaleProviderDraft] = useState<UpscaleProviderConfig>(() => makeEmptyUpscaleProvider())
  const [selectedUpscaleFactors, setSelectedUpscaleFactors] = useState<Record<number, UpscaleFactor>>({})
  const [resultUpscaleVariants, setResultUpscaleVariants] = useState<Record<number, Partial<Record<UpscaleFactor, string>>>>({})
  const [upscalingIndex, setUpscalingIndex] = useState<number | null>(null)
  const [autoUpscalingIndexes, setAutoUpscalingIndexes] = useState<Record<number, boolean>>({})
  const [standaloneUpscale, setStandaloneUpscale] = useState<StandaloneUpscaleState>(defaultStandaloneUpscaleState)

  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([])
  const [historySearch, setHistorySearch] = useState('')
  const [historyModelFilter, setHistoryModelFilter] = useState('')
  const [historyFavoriteFilter, setHistoryFavoriteFilter] = useState<HistoryFavoriteFilter>('all')
  const [historyModeFilter, setHistoryModeFilter] = useState<HistoryModeFilter>('all')
  const [favoritePendingIds, setFavoritePendingIds] = useState<Record<number, boolean>>({})
  const [storageUsed, setStorageUsed] = useState(0)
  const [historyRootDir, setHistoryRootDir] = useState('')
  const [historyStoragePolicy, setHistoryStoragePolicy] = useState<HistoryStoragePolicy>(DEFAULT_HISTORY_STORAGE_POLICY)
  const [storageLimitEnabledDraft, setStorageLimitEnabledDraft] = useState(false)
  const [storageLimitDraft, setStorageLimitDraft] = useState(String(Math.round(DEFAULT_HISTORY_STORAGE_LIMIT_BYTES / 1024 / 1024 / 1024)))
  const [storageLimitUnit, setStorageLimitUnit] = useState<StorageLimitUnit>('GB')
  const [storagePolicyPending, setStoragePolicyPending] = useState(false)
  const [historyDirPending, setHistoryDirPending] = useState(false)

  const [providerModalOpen, setProviderModalOpen] = useState(false)
  const [providerModalMode, setProviderModalMode] = useState<'create' | 'edit'>('create')
  const [upscaleModalOpen, setUpscaleModalOpen] = useState(false)
  const [upscaleModalMode, setUpscaleModalMode] = useState<'create' | 'edit'>('create')
  const [keyVisible, setKeyVisible] = useState(false)
  const [upscaleKeyVisible, setUpscaleKeyVisible] = useState(false)
  const [testConnStatus, setTestConnStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [testConnMessage, setTestConnMessage] = useState('')
  const [autoSaveHint, setAutoSaveHint] = useState(false)

  const currentProvider = providers.find(provider => provider.id === currentProviderId) || null
  const currentUpscaleProvider = upscaleProviders.find(provider => provider.id === currentUpscaleProviderId) || null
  const currentUpscaleConfig = upscaleProviderToConfig(currentUpscaleProvider)
  const currentModel = models.find(model => model.id === currentModelId) || null
  const activeHistoryRecord = activeHistoryRecordId === null
    ? null
    : historyRecords.find(record => record.id === activeHistoryRecordId) || null
  const activeFavoritePending = activeHistoryRecordId === null ? false : !!favoritePendingIds[activeHistoryRecordId]
  const standaloneActiveRecord = standaloneUpscale.activeRecordId === null
    ? null
    : historyRecords.find(record => record.id === standaloneUpscale.activeRecordId) || null
  const standaloneFavoritePending = standaloneUpscale.activeRecordId === null ? false : !!favoritePendingIds[standaloneUpscale.activeRecordId]
  const resolutionOptions = currentModel?.supportedResolutions || []
  const sizePlanResult = createSizePlan(targetSize)
  const sizePlan = sizePlanResult.plan

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false

    void loadAppConfig().then((snapshot) => {
      if (cancelled)
        return

      setProviders(snapshot.providers)
      setCurrentProviderId(snapshot.currentProviderId)
      setUpscaleProviders(snapshot.upscaleProviders)
      setCurrentUpscaleProviderId(snapshot.currentUpscaleProviderId)
      setTheme(snapshot.theme)
      setHistoryRootDir(snapshot.historyRootDir)
      setHistoryStoragePolicy(snapshot.historyStoragePolicy)
      setStorageLimitEnabledDraft(snapshot.historyStoragePolicy.limitMode === 'limited' && !!snapshot.historyStoragePolicy.limitBytes)
      setConfigReady(true)
    }).catch(() => {
      if (!cancelled)
        setConfigReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!configReady)
      return

    void saveAppConfig({
      providers,
      currentProviderId,
      upscaleConfig: upscaleProviderToConfig(upscaleProviders.find(provider => provider.id === currentUpscaleProviderId)),
      upscaleProviders,
      currentUpscaleProviderId,
      theme,
      historyRootDir,
      historyStoragePolicy,
    })
  }, [configReady, providers, currentProviderId, upscaleProviders, currentUpscaleProviderId, theme, historyRootDir, historyStoragePolicy])

  useEffect(() => {
    const limitBytes = historyStoragePolicy.limitBytes
    const enabled = historyStoragePolicy.limitMode === 'limited' && !!limitBytes
    setStorageLimitEnabledDraft(enabled)
    if (!enabled)
      return

    const nextDraft = getStorageLimitDraft(limitBytes)
    setStorageLimitDraft(nextDraft.value)
    setStorageLimitUnit(nextDraft.unit)
  }, [historyStoragePolicy])

  useEffect(() => {
    if (currentUpscaleProviderId && upscaleProviders.some(provider => provider.id === currentUpscaleProviderId))
      return
    setCurrentUpscaleProviderId(upscaleProviders[0]?.id || '')
  }, [upscaleProviders, currentUpscaleProviderId])

  useEffect(() => {
    setTargetSizeDraft({
      targetWidth: String(targetSize.targetWidth),
      targetHeight: String(targetSize.targetHeight),
    })
  }, [targetSize.targetWidth, targetSize.targetHeight])

  useEffect(() => {
    if (providerModalOpen)
      return
    const provider = providers.find(item => item.id === currentProviderId)
    if (provider)
      setProviderDraft(provider)
    else
      setProviderDraft({ id: '', name: '', apiUrl: '', apiKey: '' })
  }, [providers, currentProviderId, providerModalOpen])

  useEffect(() => {
    if (!providerModalOpen || providerModalMode !== 'edit' || !modalDirtyRef.current)
      return
    const name = providerDraft.name.trim()
    const apiUrl = normalizeBaseUrl(providerDraft.apiUrl)
    if (!name || !apiUrl)
      return

    const timer = window.setTimeout(() => {
      const id = providerDraft.id
      const nextProvider: ProviderConfig = { id, name, apiUrl, apiKey: providerDraft.apiKey.trim() }
      setProviders((current) => {
        const index = current.findIndex(item => item.id === id)
        if (index < 0)
          return current
        const next = current.slice()
        next[index] = nextProvider
        return next
      })
      setAutoSaveHint(true)
      window.setTimeout(() => setAutoSaveHint(false), 2000)
    }, 500)

    return () => window.clearTimeout(timer)
  }, [providerDraft, providerModalOpen, providerModalMode])

  useEffect(() => {
    void refreshHistory()
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current)
        window.clearTimeout(toastTimerRef.current)
      if (timerRef.current)
        window.clearInterval(timerRef.current)
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented)
        return

      if (event.key === 'Escape' && imageContextMenu) {
        event.preventDefault()
        closeImageContextMenu()
        return
      }

      const hasHistoryPreview = !!document.querySelector('.history-preview-modal')

      if (hasHistoryPreview) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g')
          event.preventDefault()
        return
      }

      if (event.key === 'Escape') {
        if (previewImage) {
          event.preventDefault()
          closeImagePreview()
          return
        }

        if (providerModalOpen) {
          event.preventDefault()
          closeProviderModal()
          return
        }

        if (upscaleModalOpen) {
          event.preventDefault()
          closeUpscaleModal()
          return
        }

        if (isGenerating) {
          event.preventDefault()
          cancelGeneration()
        }
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        focusPromptInput()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [imageContextMenu, previewImage, providerModalOpen, upscaleModalOpen, isGenerating])

  useEffect(() => {
    closeImageContextMenu()
  }, [view, results, isGenerating, previewImage])

  function focusPromptInput() {
    if (previewImage || providerModalOpen || upscaleModalOpen)
      return

    setView('workspace')
    window.setTimeout(() => {
      const input = promptInputRef.current
      if (!input)
        return
      input.focus()
      const cursor = input.value.length
      input.setSelectionRange(cursor, cursor)
    }, 0)
  }

  async function refreshHistory() {
    const records = await getAllRecords()
    setHistoryRecords(records)
    setStorageUsed(await getTotalSize())
  }

  function resetModelState() {
    setModels([])
    setDefaultModel('')
    setCurrentModelId('')
    setParams(emptyParams)
    setTargetSize(defaultTargetSize)
    setGenStatus(null)
  }

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    if (toastTimerRef.current)
      window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500)
  }

  function getStorageUnitSize(unit: StorageLimitUnit) {
    return unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024
  }

  function formatStorageLimitValue(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
  }

  function getStorageLimitDraft(limitBytes: number): { value: string; unit: StorageLimitUnit } {
    const gb = 1024 * 1024 * 1024
    if (limitBytes >= gb)
      return { value: formatStorageLimitValue(limitBytes / gb), unit: 'GB' }

    return { value: formatStorageLimitValue(limitBytes / 1024 / 1024), unit: 'MB' }
  }

  function getStorageLimitBytesFromDraft() {
    const value = Number(storageLimitDraft)
    if (!Number.isFinite(value) || value <= 0)
      return null

    return Math.round(value * getStorageUnitSize(storageLimitUnit))
  }

  function getStorageLimitLabel(policy = historyStoragePolicy) {
    if (policy.limitMode !== 'limited' || !policy.limitBytes)
      return '无限制'

    return formatSize(policy.limitBytes)
  }

  async function applyStorageCleanup(policy: HistoryStoragePolicy, notify: boolean) {
    const result = await enforceStorageLimit(policy)
    setStorageUsed(result.remainingBytes)

    if (!notify)
      return result

    if (result.limitReached) {
      showToast(result.deletedCount > 0
        ? `已清理 ${result.deletedCount} 条旧记录，但收藏记录仍超过当前上限`
        : '收藏记录已超过当前上限，请提高上限或手动整理收藏', 'error')
    }
    else if (result.deletedCount > 0) {
      showToast(`已自动清理 ${result.deletedCount} 条旧记录，释放 ${formatSize(result.freedBytes)}`, 'success')
    }

    return result
  }

  async function saveHistoryStoragePolicy() {
    const nextPolicy: HistoryStoragePolicy = storageLimitEnabledDraft
      ? {
          limitMode: 'limited',
          limitBytes: getStorageLimitBytesFromDraft(),
        }
      : DEFAULT_HISTORY_STORAGE_POLICY

    if (nextPolicy.limitMode === 'limited' && !nextPolicy.limitBytes) {
      showToast('请填写有效的存储上限', 'error')
      return
    }

    setStoragePolicyPending(true)
    try {
      setHistoryStoragePolicy(nextPolicy)
      const cleanupResult = nextPolicy.limitMode === 'limited'
        ? await applyStorageCleanup(nextPolicy, true)
        : null
      if (nextPolicy.limitMode === 'limited')
        await refreshHistory()
      if (nextPolicy.limitMode !== 'limited') {
        showToast('历史存储已改为无限制', 'success')
      }
      else if (!cleanupResult?.deletedCount && !cleanupResult?.limitReached) {
        showToast(`历史存储上限已设置为 ${getStorageLimitLabel(nextPolicy)}`, 'success')
      }
    }
    finally {
      setStoragePolicyPending(false)
    }
  }

  function isFileDrag(event: globalThis.DragEvent) {
    const types = event.dataTransfer?.types
    return !!types && Array.from(types).includes('Files')
  }

  function getImageFiles(files: FileList | null | undefined) {
    return Array.from(files || []).filter(file => file.type.startsWith('image/'))
  }

  function getGlobalDropTarget(): GlobalDropTarget {
    const hasHistoryPreview = !!document.querySelector('.history-preview-modal')
    if (previewImage || providerModalOpen || upscaleModalOpen || hasHistoryPreview) {
      return {
        status: 'blocked',
        title: '当前弹层不支持拖入图片',
        hint: '关闭预览或设置弹窗后再拖入。',
      }
    }

    if (view === 'workspace') {
      if (mode !== 'edit') {
        return {
          status: 'blocked',
          title: '当前模式不支持拖入图片',
          hint: '切换到图生图后可拖放参考图。',
        }
      }
      if (isGenerating) {
        return {
          status: 'blocked',
          title: '生成中暂不能拖入参考图',
          hint: '等待当前任务结束后再替换参考图。',
        }
      }
      return {
        status: 'ready',
        kind: 'workspace',
        title: '拖放文件作为参考图',
        hint: '松开后载入 JPG / PNG / WebP 等图片文件。',
      }
    }

    if (view === 'upscale') {
      if (standaloneUpscale.isProcessing) {
        return {
          status: 'blocked',
          title: '超分处理中暂不能替换图片',
          hint: '等待当前超分任务完成后再拖入新图片。',
        }
      }
      return {
        status: 'ready',
        kind: 'upscale',
        title: '拖放文件开始超分',
        hint: '松开后载入第一张图片作为独立超分源图。',
      }
    }

    return {
      status: 'blocked',
      title: '当前页面不支持拖入图片',
      hint: '请进入工作台图生图或独立超分页面。',
    }
  }

  function acceptWorkspaceDropFiles(files: File[]) {
    const maxFiles = currentModel?.maxInputImages ?? files.length
    if (maxFiles <= 0) {
      showToast('当前模型不支持参考图', 'error')
      return
    }

    const nextFiles = files.slice(0, maxFiles)
    setRefFiles(nextFiles)
    if (files.length > nextFiles.length) {
      showToast(`已载入 ${nextFiles.length} 张参考图，超过上限的已忽略`, 'success')
      return
    }
    showToast(`已载入 ${nextFiles.length} 张参考图`, 'success')
  }

  function handleGlobalDrop(event: globalThis.DragEvent) {
    const dropTarget = getGlobalDropTarget()
    const imageFiles = getImageFiles(event.dataTransfer?.files)
    if (!imageFiles.length) {
      showToast('请拖入图片文件', 'error')
      return
    }

    if (dropTarget.status === 'blocked') {
      showToast(dropTarget.title, 'error')
      return
    }

    if (dropTarget.kind === 'workspace') {
      acceptWorkspaceDropFiles(imageFiles)
      return
    }

    void handleStandaloneUpscaleFile(imageFiles[0])
  }

  useEffect(() => {
    function updateDropTarget(event: globalThis.DragEvent) {
      const dropTarget = getGlobalDropTarget()
      setGlobalDropTarget(dropTarget)
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = dropTarget.status === 'ready' ? 'copy' : 'none'
    }

    function onDragEnter(event: globalThis.DragEvent) {
      if (!isFileDrag(event))
        return

      event.preventDefault()
      if (imageContextMenu)
        closeImageContextMenu()
      dragDepthRef.current += 1
      updateDropTarget(event)
    }

    function onDragOver(event: globalThis.DragEvent) {
      if (!isFileDrag(event))
        return

      event.preventDefault()
      updateDropTarget(event)
    }

    function onDragLeave(event: globalThis.DragEvent) {
      if (!isFileDrag(event))
        return

      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0)
        setGlobalDropTarget(null)
    }

    function onDrop(event: globalThis.DragEvent) {
      if (!isFileDrag(event))
        return

      event.preventDefault()
      dragDepthRef.current = 0
      setGlobalDropTarget(null)
      handleGlobalDrop(event)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [
    currentModel?.maxInputImages,
    imageContextMenu,
    isGenerating,
    mode,
    previewImage,
    providerModalOpen,
    standaloneUpscale.factor,
    standaloneUpscale.isProcessing,
    upscaleModalOpen,
    view,
  ])

  function getSavedFileLabel(path: string | undefined, fallback: string) {
    if (!path)
      return fallback
    return path.split(/[\\/]/).pop() || fallback
  }

  function makeTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  }

  function getImageExtension(mimeType: ImageMimeType) {
    if (mimeType === 'image/jpeg')
      return 'jpg'
    if (mimeType === 'image/webp')
      return 'webp'
    return 'png'
  }

  function getStandaloneSourceFilename() {
    const mimeType = normalizeImageMimeType(standaloneUpscale.mimeType)
    return `source_${sanitizeFilename(standaloneUpscale.fileName || 'image')}_${makeTimestamp()}.${getImageExtension(mimeType)}`
  }

  function getStandaloneOutputFilename() {
    return `upscale_${sanitizeFilename(standaloneUpscale.fileName || 'image')}_${standaloneUpscale.factor}x_${makeTimestamp()}.png`
  }

  function normalizeImageMimeType(mimeType: string): ImageMimeType {
    if (mimeType === 'image/jpeg' || mimeType === 'image/webp')
      return mimeType
    return 'image/png'
  }

  function cancelGeneration() {
    abortControllerRef.current?.abort()
  }

  function openImagePreview(
    image: string,
    title: string,
    compare?: ImagePreviewState['compare'],
  ) {
    setPreviewDragging(false)
    const singleSide = compare && image === compare.before ? 'before' : 'after'
    setPreviewImage({
      image,
      title,
      mode: compare ? 'compare' : 'single',
      split: 50,
      zoom: 1,
      fitZoom: 1,
      offsetX: 0,
      offsetY: 0,
      singleSide: compare ? 'before' : singleSide,
      sideFitZooms: {},
      compare,
    })
  }

  function closeImagePreview() {
    setPreviewDragging(false)
    previewPanRef.current = null
    setPreviewImage(null)
  }

  function closeImageContextMenu() {
    setImageContextMenu(null)
  }

  function getBoundedContextMenuPosition(clientX: number, clientY: number) {
    const menuWidth = 204
    const menuHeight = 88
    const margin = 8
    const x = Math.min(clientX, window.innerWidth - menuWidth - margin)
    const y = Math.min(clientY, window.innerHeight - menuHeight - margin)
    return {
      x: Math.max(margin, x),
      y: Math.max(margin, y),
    }
  }

  function openImageContextMenu(event: MouseEvent, target: ImageContextMenuTarget) {
    event.preventDefault()
    event.stopPropagation()
    const imageBase64 = target.type === 'result' ? getCurrentImageBase64(target.index) : target.imageBase64
    if (!imageBase64)
      return

    setImageContextMenu({
      ...getBoundedContextMenuPosition(event.clientX, event.clientY),
      target,
    })
  }

  function handleContextMenuSave() {
    const target = imageContextMenu?.target
    closeImageContextMenu()
    if (!target)
      return
    if (target.type === 'result') {
      void handleDownload(target.index)
      return
    }
    void saveStandaloneContextImage(target)
  }

  function handleContextMenuCopy() {
    const target = imageContextMenu?.target
    closeImageContextMenu()
    if (!target)
      return
    if (target.type === 'result') {
      void handleCopy(target.index)
      return
    }
    void copyStandaloneContextImage(target)
  }

  function resetPreviewSplit() {
    setPreviewImage(current => current && current.compare ? { ...current, split: 50 } : current)
  }

  function resetSinglePreviewTransform() {
    previewPanRef.current = null
    setPreviewImage(current => current ? { ...current, zoom: current.fitZoom, offsetX: 0, offsetY: 0 } : current)
  }

  function selectSinglePreviewSide(side: 'before' | 'after') {
    previewPanRef.current = null
    setPreviewImage(current => current && current.compare
      ? (() => {
          const nextFitZoom = current.sideFitZooms[side] || current.fitZoom
          return {
            ...current,
            singleSide: side,
            image: side === 'before' ? current.compare.before : current.compare.after,
            zoom: nextFitZoom,
            fitZoom: nextFitZoom,
            offsetX: 0,
            offsetY: 0,
          }
        })()
      : current)
  }

  function updateSinglePreviewZoom(nextZoom: number) {
    previewPanRef.current = null
    setPreviewImage((current) => {
      if (!current)
        return current
      const zoom = Math.min(6, Math.max(0.01, nextZoom))
      const isFitZoom = Math.abs(zoom - current.fitZoom) < 0.001
      return {
        ...current,
        zoom,
        offsetX: isFitZoom ? 0 : current.offsetX,
        offsetY: isFitZoom ? 0 : current.offsetY,
      }
    })
  }

  function stepSinglePreviewZoom(direction: 1 | -1) {
    if (!previewImage)
      return
    const step = previewImage.zoom < 0.5 ? 0.05 : previewImage.zoom < 1 ? 0.1 : 0.25
    updateSinglePreviewZoom(previewImage.zoom + direction * step)
  }

  function handleSinglePreviewWheel(event: WheelEvent<HTMLDivElement>) {
    if (!previewImage || previewImage.mode !== 'single')
      return
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.08 : 0.08
    updateSinglePreviewZoom(previewImage.zoom + delta)
  }

  function handleSinglePreviewPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!previewImage || previewImage.mode !== 'single' || Math.abs(previewImage.zoom - previewImage.fitZoom) < 0.001)
      return
    event.currentTarget.setPointerCapture(event.pointerId)
    previewPanRef.current = { x: event.clientX, y: event.clientY }
  }

  function handleSinglePreviewPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!previewImage || previewImage.mode !== 'single' || Math.abs(previewImage.zoom - previewImage.fitZoom) < 0.001 || !previewPanRef.current)
      return
    const deltaX = event.clientX - previewPanRef.current.x
    const deltaY = event.clientY - previewPanRef.current.y
    previewPanRef.current = { x: event.clientX, y: event.clientY }
    setPreviewImage(current => current
      ? {
          ...current,
          offsetX: current.offsetX + deltaX,
          offsetY: current.offsetY + deltaY,
        }
      : current)
  }

  function handleSinglePreviewPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    previewPanRef.current = null
  }

  function handleSinglePreviewImageLoad(event: SyntheticEvent<HTMLImageElement>, side?: 'before' | 'after') {
    const image = event.currentTarget
    const viewport = image.parentElement
    if (!viewport || !image.naturalWidth || !image.naturalHeight)
      return

    const rect = viewport.getBoundingClientRect()
    const fitZoom = Math.min(1, rect.width / image.naturalWidth, rect.height / image.naturalHeight)
    const normalizedFitZoom = Number.isFinite(fitZoom) && fitZoom > 0 ? Math.max(0.01, fitZoom) : 1
    setPreviewImage((current) => {
      if (!current)
        return current

      const currentSource = current.compare && side
        ? side === 'before'
          ? current.compare.before
          : current.compare.after
        : current.image
      if (image.src !== currentSource)
        return current

      if (current.compare && side && side !== current.singleSide) {
        return {
          ...current,
          sideFitZooms: {
            ...current.sideFitZooms,
            [side]: normalizedFitZoom,
          },
        }
      }

      return {
        ...current,
        fitZoom: normalizedFitZoom,
        zoom: normalizedFitZoom,
        offsetX: 0,
        offsetY: 0,
        sideFitZooms: current.compare
          ? {
              ...current.sideFitZooms,
              [side || current.singleSide]: normalizedFitZoom,
            }
          : current.sideFitZooms,
      }
    })
  }

  function updatePreviewSplit(clientX: number, target: HTMLDivElement) {
    const rect = target.getBoundingClientRect()
    if (!rect.width)
      return
    const next = Math.min(85, Math.max(15, ((clientX - rect.left) / rect.width) * 100))
    setPreviewImage(current => current && current.compare ? { ...current, split: next } : current)
  }

  function handlePreviewPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!previewImage?.compare)
      return
    event.currentTarget.setPointerCapture(event.pointerId)
    setPreviewDragging(true)
    updatePreviewSplit(event.clientX, event.currentTarget)
  }

  function handlePreviewPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!previewDragging || !previewImage?.compare)
      return
    updatePreviewSplit(event.clientX, event.currentTarget)
  }

  function handlePreviewPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    setPreviewDragging(false)
  }

  function updateProviderDraft<K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]) {
    modalDirtyRef.current = true
    setProviderDraft(current => ({ ...current, [key]: value }))
  }

  function openCreateModal() {
    setProviderDraft({ id: '', name: '', apiUrl: '', apiKey: '' })
    setProviderModalMode('create')
    setConnStatus(null)
    setKeyVisible(false)
    setTestConnStatus('idle')
    setTestConnMessage('')
    setAutoSaveHint(false)
    modalDirtyRef.current = false
    setProviderModalOpen(true)
  }

  function openEditModal(provider: ProviderConfig) {
    setProviderDraft(provider)
    setProviderModalMode('edit')
    setConnStatus(null)
    setKeyVisible(false)
    setTestConnStatus('idle')
    setTestConnMessage('')
    setAutoSaveHint(false)
    modalDirtyRef.current = false
    setProviderModalOpen(true)
  }

  function closeProviderModal() {
    setProviderModalOpen(false)
    setConnStatus(null)
    setKeyVisible(false)
    setTestConnStatus('idle')
    setTestConnMessage('')
    setAutoSaveHint(false)
  }

  function saveProvider(): boolean {
    const name = providerDraft.name.trim()
    const apiUrl = normalizeBaseUrl(providerDraft.apiUrl)
    const apiKey = providerDraft.apiKey.trim()
    if (!name) {
      setConnStatus({ type: 'err', message: '请填写供应商名称' })
      return false
    }
    if (!apiUrl) {
      setConnStatus({ type: 'err', message: '请填写 API URL' })
      return false
    }

    const id = providerModalMode === 'edit' ? providerDraft.id : makeProviderId()
    const nextProvider = { id, name, apiUrl, apiKey }
    setProviders((current) => {
      const index = current.findIndex(item => item.id === id)
      if (index >= 0) {
        const next = current.slice()
        next[index] = nextProvider
        return next
      }
      return [...current, nextProvider]
    })
    setCurrentProviderId(id)
    return true
  }

  function handleSaveProviderModal() {
    if (saveProvider()) {
      showToast('供应商配置已保存', 'success')
      closeProviderModal()
    }
  }

  function removeProvider(providerId: string) {
    setProviders(current => current.filter(item => item.id !== providerId))
    if (currentProviderId === providerId) {
      setCurrentProviderId('')
      resetModelState()
    }
    showToast('供应商已删除', 'success')
  }

  function onProviderChange(providerId: string) {
    setCurrentProviderId(providerId)
    resetModelState()
  }

  function updateUpscaleProviderDraft<K extends keyof UpscaleProviderConfig>(key: K, value: UpscaleProviderConfig[K]) {
    setUpscaleProviderDraft(current => ({ ...current, [key]: value }))
  }

  function openCreateUpscaleModal() {
    setUpscaleProviderDraft(makeEmptyUpscaleProvider(isDesktopApp() ? 'aliyun' : 'custom'))
    setUpscaleModalMode('create')
    setConnStatus(null)
    setUpscaleKeyVisible(false)
    setUpscaleModalOpen(true)
  }

  function openEditUpscaleModal(provider: UpscaleProviderConfig) {
    setUpscaleProviderDraft(provider)
    setUpscaleModalMode('edit')
    setConnStatus(null)
    setUpscaleKeyVisible(false)
    setUpscaleModalOpen(true)
  }

  function closeUpscaleModal() {
    setUpscaleModalOpen(false)
    setConnStatus(null)
    setUpscaleKeyVisible(false)
  }

  function saveUpscaleProvider(): boolean {
    const name = upscaleProviderDraft.name.trim()
    if (!name) {
      setConnStatus({ type: 'err', message: '请填写超分服务名称' })
      return false
    }
    if (upscaleProviderDraft.provider === 'aliyun') {
      if (!isDesktopApp()) {
        setConnStatus({ type: 'err', message: '阿里云超分仅桌面端可用' })
        return false
      }
      if (!upscaleProviderDraft.accessKeyId.trim() || !upscaleProviderDraft.accessKeySecret.trim()) {
        setConnStatus({ type: 'err', message: '请填写 AccessKey ID 和 AccessKey Secret' })
        return false
      }
    }
    else if (!normalizeBaseUrl(upscaleProviderDraft.apiUrl)) {
      setConnStatus({ type: 'err', message: '请填写自定义超分服务地址' })
      return false
    }

    const id = upscaleModalMode === 'edit' ? upscaleProviderDraft.id : makeProviderId()
    const nextProvider: UpscaleProviderConfig = {
      id,
      name,
      provider: upscaleProviderDraft.provider,
      accessKeyId: upscaleProviderDraft.accessKeyId.trim(),
      accessKeySecret: upscaleProviderDraft.accessKeySecret.trim(),
      apiUrl: normalizeBaseUrl(upscaleProviderDraft.apiUrl),
      apiKey: upscaleProviderDraft.apiKey.trim(),
    }
    setUpscaleProviders((current) => {
      const index = current.findIndex(item => item.id === id)
      if (index >= 0) {
        const next = current.slice()
        next[index] = nextProvider
        return next
      }
      return [...current, nextProvider]
    })
    setCurrentUpscaleProviderId(id)
    return true
  }

  function handleSaveUpscaleProviderModal() {
    if (saveUpscaleProvider()) {
      showToast('超分服务配置已保存', 'success')
      closeUpscaleModal()
    }
  }

  function removeUpscaleProvider(providerId: string) {
    setUpscaleProviders(current => current.filter(item => item.id !== providerId))
    if (currentUpscaleProviderId === providerId)
      setCurrentUpscaleProviderId('')
    showToast('超分服务已删除', 'success')
  }

  function onUpscaleProviderChange(providerId: string) {
    setCurrentUpscaleProviderId(providerId)
    setUpscaleResponseJson('无')
  }

  async function loadModels() {
    if (!currentProvider) {
      setConnStatus({ type: 'err', message: '请先选择供应商' })
      return
    }
    const baseUrl = normalizeBaseUrl(currentProvider.apiUrl)
    if (!baseUrl) {
      setConnStatus({ type: 'err', message: '请填写 API URL' })
      return
    }

    setConnStatus({ type: 'loading', message: '拉取模型清单中...' })
    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: currentProvider.apiKey ? { Authorization: `Bearer ${currentProvider.apiKey}` } : {},
      })
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)

      const data = await response.json() as { data?: RemoteModel[]; default_model?: string }
      const nextModels = hydrateModels(data.data || [])
      setModels(nextModels)
      setDefaultModel(data.default_model || '')
      if (data.default_model && nextModels.some(model => model.id === data.default_model))
        selectModel(data.default_model, nextModels)
      setConnStatus({
        type: 'ok',
        message: `${currentProvider.name} 已拉取 ${nextModels.length} 个模型${data.default_model ? `（默认: ${data.default_model}）` : ''}`,
      })
    }
    catch (error) {
      const message = getErrorMessage(error)
      setConnStatus({ type: 'err', message: `拉取失败: ${message}` })
      showToast(`拉取模型失败: ${message}`, 'error')
    }
  }

  async function testConnection() {
    const apiUrl = normalizeBaseUrl(providerDraft.apiUrl)
    if (!apiUrl) {
      setTestConnStatus('err')
      setTestConnMessage('请填写 API URL')
      return
    }
    setTestConnStatus('loading')
    setTestConnMessage('')
    try {
      const response = await fetch(`${apiUrl}/v1/models`, {
        headers: providerDraft.apiKey ? { Authorization: `Bearer ${providerDraft.apiKey}` } : {},
      })
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)
      setTestConnStatus('ok')
      window.setTimeout(() => setTestConnStatus('idle'), 2000)
    }
    catch (error) {
      const message = getErrorMessage(error)
      setTestConnStatus('err')
      setTestConnMessage(`连接失败: ${message}`)
    }
  }

  function selectModel(modelId: string, sourceModels = models) {
    const model = sourceModels.find(item => item.id === modelId)
    if (!model)
      return

    setCurrentModelId(model.id)
    const sizes = model.supportedSizes || []
    const sortedSizes = getSortedSizes(sizes)
    const resolutions = model.supportedResolutions || []
    const nextTargetSize = makeTargetSizeFromPreset(model.defaultSize || sortedSizes[0] || '')
    const nextSizePlan = createSizePlan(nextTargetSize).plan
    setTargetSize(nextTargetSize)
    setParams(current => ({
      ...current,
      n: Math.min(current.n || 1, model.maxGenerations || 1),
      size: nextSizePlan?.requestSize || '1024x1024',
      resolution: model.hasResolution && resolutions.length ? (model.defaultResolution || resolutions[0] || '') : undefined,
    }))
  }

  function onFileChange(files: FileList | null) {
    setRefFiles(files ? Array.from(files) : [])
  }

  function updateTargetSizeMode(mode: TargetSizeMode) {
    setTargetSize((current) => {
      if (mode === current.mode)
        return current
      if (mode === 'ratio') {
        const ratioText = formatRatioFromSize(current.targetWidth, current.targetHeight)
        const ratio = parseRatio(ratioText) || parseRatio(current.ratioText)
        const next = ratio ? normalizeRatioSizeFromWidth(current.targetWidth, ratio) : null
        return {
          ...current,
          mode,
          ratioText,
          targetWidth: next?.width ?? current.targetWidth,
          targetHeight: next?.height ?? current.targetHeight,
        }
      }
      return { ...current, mode }
    })
  }

  function updateRatioText(ratioText: string) {
    setTargetSize((current) => {
      const ratio = parseRatio(ratioText)
      const next = ratio ? normalizeRatioSizeFromWidth(current.targetWidth, ratio) : null
      return {
        ...current,
        ratioText,
        targetWidth: next?.width ?? current.targetWidth,
        targetHeight: next?.height ?? current.targetHeight,
      }
    })
  }

  function updateTargetWidth(value: number) {
    const targetWidth = clampInteger(value, TARGET_SIZE_MIN, TARGET_SIZE_MAX)
    setTargetSize((current) => {
      if (current.mode === 'ratio') {
        const ratio = parseRatio(current.ratioText)
        if (ratio) {
          const next = normalizeRatioSizeFromWidth(targetWidth, ratio)
          return {
            ...current,
            targetWidth: next.width,
            targetHeight: next.height,
          }
        }
        return {
          ...current,
          targetWidth,
          targetHeight: current.targetHeight,
        }
      }
      return { ...current, targetWidth }
    })
  }

  function changeTargetWidthDraft(value: string) {
    setTargetSizeDraft(current => ({ ...current, targetWidth: value }))
    const nextValue = parseDimensionDraft(value)
    if (nextValue !== null)
      updateTargetWidth(nextValue)
  }

  function commitTargetWidthDraft() {
    const nextValue = parseDimensionDraft(targetSizeDraft.targetWidth, true)
    if (nextValue !== null)
      updateTargetWidth(nextValue)
    else
      setTargetSizeDraft(current => ({ ...current, targetWidth: String(targetSize.targetWidth) }))
  }

  function updateTargetHeight(value: number) {
    const targetHeight = clampInteger(value, TARGET_SIZE_MIN, TARGET_SIZE_MAX)
    setTargetSize((current) => {
      if (current.mode === 'ratio') {
        const ratio = parseRatio(current.ratioText)
        if (ratio) {
          const next = normalizeRatioSizeFromHeight(targetHeight, ratio)
          return {
            ...current,
            targetWidth: next.width,
            targetHeight: next.height,
          }
        }
        return {
          ...current,
          targetHeight,
          targetWidth: current.targetWidth,
        }
      }
      return { ...current, targetHeight }
    })
  }

  function changeTargetHeightDraft(value: string) {
    setTargetSizeDraft(current => ({ ...current, targetHeight: value }))
    const nextValue = parseDimensionDraft(value)
    if (nextValue !== null)
      updateTargetHeight(nextValue)
  }

  function commitTargetHeightDraft() {
    const nextValue = parseDimensionDraft(targetSizeDraft.targetHeight, true)
    if (nextValue !== null)
      updateTargetHeight(nextValue)
    else
      setTargetSizeDraft(current => ({ ...current, targetHeight: String(targetSize.targetHeight) }))
  }

  function updateAutoUpscale(autoUpscale: boolean) {
    setTargetSize(current => ({ ...current, autoUpscale }))
  }

  function removeRefFile(index: number) {
    setRefFiles(current => current.filter((_, currentIndex) => currentIndex !== index))
  }

  async function generate() {
    if (!currentProvider) {
      setGenStatus({ type: 'err', message: '请先选择供应商' })
      return
    }
    if (!currentModel) {
      setGenStatus({ type: 'err', message: '请先选择模型' })
      return
    }
    const baseUrl = normalizeBaseUrl(currentProvider.apiUrl)
    if (!baseUrl) {
      setGenStatus({ type: 'err', message: '当前供应商未配置 API URL' })
      return
    }
    if (!prompt.trim()) {
      setGenStatus({ type: 'err', message: '请填写 Prompt' })
      return
    }
    const currentSizePlanResult = createSizePlan(targetSize)
    if (!currentSizePlanResult.plan) {
      setGenStatus({ type: 'err', message: currentSizePlanResult.error })
      return
    }
    const currentSizePlan = currentSizePlanResult.plan
    if (targetSize.autoUpscale && currentSizePlan.needsUpscale && !isUpscaleProviderConfigured(currentUpscaleProvider)) {
      setGenStatus({ type: 'err', message: '自动超分需要先配置超分服务' })
      return
    }
    if (targetSize.autoUpscale && currentSizePlan.needsUpscale && !currentSizePlan.canAutoUpscale) {
      setGenStatus({ type: 'err', message: '目标尺寸超过 4X 自动超分能力，请降低目标尺寸' })
      return
    }

    let useRefFiles = refFiles.slice()
    if (mode === 'edit') {
      if (!useRefFiles.length) {
        setGenStatus({ type: 'err', message: '图生图请上传至少 1 张参考图' })
        return
      }
      if (useRefFiles.length > currentModel.maxInputImages) {
        useRefFiles = useRefFiles.slice(0, currentModel.maxInputImages)
        setGenStatus({ type: 'warn', message: `参考图超过上限 ${currentModel.maxInputImages} 张，将只取前 ${currentModel.maxInputImages} 张` })
      }
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsGenerating(true)
    setLoadingCount(Math.max(params.n || 1, 1))
    setResults([])
    setActiveHistoryRecordId(null)
    setImageSizes({})
    setOriginalImageSizes({})
    setSelectedUpscaleFactors({})
    setResultUpscaleVariants({})
    setAutoUpscalingIndexes({})
    setUpscaleResponseJson('无')
    setCopiedIndex(null)
    setDownloadedIndex(null)
    setResultTimer('')
    const startAt = Date.now()
    timerRef.current = window.setInterval(() => {
      setResultTimer(`${((Date.now() - startAt) / 1000).toFixed(1)}s`)
    }, 100)

    try {
      let response: Response
      let nextRequestJson = ''
      if (mode === 'gen') {
        const body: Record<string, unknown> = {
          prompt: prompt.trim(),
          model: currentModel.id,
          n: Math.min(params.n || 1, currentModel.maxGenerations),
          size: currentSizePlan.requestSize,
          quality: params.quality,
          autoPrompt: params.autoPrompt === 'true',
          translate: params.translate === 'true',
        }
        if (currentModel.hasResolution && params.resolution)
          body.resolution = params.resolution

        nextRequestJson = JSON.stringify(body, null, 2)
        setRequestJson(nextRequestJson)
        setGenStatus({ type: 'loading', message: '生成中（约 10-30s）...' })
        response = await fetch(`${baseUrl}/v1/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(currentProvider.apiKey ? { Authorization: `Bearer ${currentProvider.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      }
      else {
        const formData = new FormData()
        const fieldName = useRefFiles.length > 1 ? 'image[]' : 'image'
        useRefFiles.forEach(file => formData.append(fieldName, file))
        formData.append('prompt', prompt.trim())
        formData.append('model', currentModel.id)
        formData.append('n', String(Math.min(params.n || 1, currentModel.maxGenerations)))
        formData.append('size', currentSizePlan.requestSize)
        formData.append('quality', params.quality)
        formData.append('autoPrompt', params.autoPrompt)
        formData.append('translate', params.translate)
        if (currentModel.hasResolution && params.resolution)
          formData.append('resolution', params.resolution)

        nextRequestJson = `[multipart] prompt=${prompt.trim()} model=${currentModel.id} refImages=${useRefFiles.length} size=${currentSizePlan.requestSize}`
        setRequestJson(nextRequestJson)
        setGenStatus({ type: 'loading', message: `图生图中（上传 ${useRefFiles.length} 张参考图，约 15-30s）...` })
        response = await fetch(`${baseUrl}/v1/images/edits`, {
          method: 'POST',
          headers: currentProvider.apiKey ? { Authorization: `Bearer ${currentProvider.apiKey}` } : {},
          body: formData,
          signal: controller.signal,
        })
      }

      const payload = await response.json() as ResultPayload
      const duration = ((Date.now() - startAt) / 1000).toFixed(1)
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      setResultTimer(`${duration}s`)
      setLoadingCount(0)

      if (controller.signal.aborted) {
        setGenStatus({ type: 'warn', message: '已取消生成' })
        return
      }

      if (!response.ok) {
        const message = typeof payload.error === 'string'
          ? payload.error
          : payload.error?.message || JSON.stringify(payload).slice(0, 200)
        setGenStatus({ type: 'err', message: `失败 (${response.status}): ${message}` })
        showToast(`请求失败: ${message}`, 'error')
        setResults([])
        setActiveHistoryRecordId(null)
        setOriginalImageSizes({})
        setSelectedUpscaleFactors({})
        setResultUpscaleVariants({})
        setAutoUpscalingIndexes({})
        return
      }

      const nextResults = payload.data || []
      setResults(nextResults)
      setSelectedUpscaleFactors({})
      setResultUpscaleVariants({})
      setGenStatus({ type: 'ok', message: `成功生成 ${nextResults.length} 张，用时 ${duration}s` })
      showToast(`生成成功：${nextResults.length} 张图片`, 'success')
      const recordId = await saveHistory(nextResults, duration, nextRequestJson, currentSizePlan)
      if (targetSize.autoUpscale && currentSizePlan.needsUpscale && currentSizePlan.canAutoUpscale)
        void runAutoUpscaleQueue(nextResults, currentSizePlan, recordId)
    }
    catch (error) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      setLoadingCount(0)
      setResults([])
      setActiveHistoryRecordId(null)
      setOriginalImageSizes({})
      setSelectedUpscaleFactors({})
      setResultUpscaleVariants({})
      setAutoUpscalingIndexes({})
      if ((error as Error).name === 'AbortError') {
        setGenStatus({ type: 'warn', message: '已取消生成' })
      }
      else {
        const message = getErrorMessage(error)
        setGenStatus({ type: 'err', message: `请求失败: ${message}` })
        showToast(`请求失败: ${message}`, 'error')
      }
    }
    finally {
      setIsGenerating(false)
      abortControllerRef.current = null
    }
  }

  async function saveHistory(nextResults: ResultImage[], duration: string, nextRequestJson: string, plan: SizePlan) {
    if (!currentProvider || !currentModel || !nextResults.length)
      return null

    const imageBlobs: Blob[] = []
    let totalSize = 0
    for (const image of nextResults) {
      if (!image.b64_json)
        continue
      const blob = base64ToBlob(image.b64_json)
      imageBlobs.push(blob)
      totalSize += blob.size
    }

    if (!imageBlobs.length)
      return null

    const nextParams: RequestParams = {
      n: params.n,
      size: plan.requestSize,
      quality: params.quality,
      autoPrompt: params.autoPrompt,
      translate: params.translate,
      resolution: currentModel.hasResolution ? params.resolution : undefined,
      targetSizeMode: targetSize.mode,
      targetRatio: targetSize.mode === 'ratio' ? targetSize.ratioText : undefined,
      targetWidth: plan.targetWidth,
      targetHeight: plan.targetHeight,
      generationWidth: plan.generationWidth,
      generationHeight: plan.generationHeight,
      autoUpscale: targetSize.autoUpscale,
      autoUpscaleFactor: plan.autoUpscaleFactor || undefined,
    }

    const recordId = await addRecord({
      timestamp: Date.now(),
      providerId: currentProvider.id,
      providerName: currentProvider.name,
      mode,
      modelId: currentModel.id,
      modelName: currentModel.displayName || currentModel.id,
      prompt: prompt.trim(),
      params: nextParams,
      images: imageBlobs,
      imageCount: imageBlobs.length,
      duration,
      requestJson: nextRequestJson,
      totalSize: totalSize + JSON.stringify(nextParams).length + prompt.trim().length,
      isFavorite: false,
      favoritedAt: null,
    })
    setActiveHistoryRecordId(recordId || null)

    await applyStorageCleanup(historyStoragePolicy, true)
    await refreshHistory()
    return recordId || null
  }

  function getCurrentImageBase64(index: number) {
    const selectedFactor = selectedUpscaleFactors[index] || 1
    if (selectedFactor > 1) {
      const variant = resultUpscaleVariants[index]?.[selectedFactor]
      if (variant)
        return variant
    }
    return results[index]?.b64_json || ''
  }

  async function handleDownload(index: number) {
    const imageBase64 = getCurrentImageBase64(index)
    if (!imageBase64) {
      showToast('无图片数据可下载', 'error')
      return
    }
    const filename = `${currentModel?.id || 'image'}_${sanitizeFilename(prompt.trim())}_${index + 1}_${makeTimestamp()}.png`
    try {
      const result = await saveImageFile({ imageBase64, filename, mimeType: 'image/png' })
      if (result.status === 'cancelled')
        return

      setDownloadedIndex(index)
      window.setTimeout(() => setDownloadedIndex(current => current === index ? null : current), 2000)
      showToast(isDesktopApp() ? `图片已保存：${getSavedFileLabel(result.path, filename)}` : `图片已下载：${filename}`, 'success')
    }
    catch (error) {
      showToast(`保存失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  async function handleCopy(index: number) {
    const imageBase64 = getCurrentImageBase64(index)
    if (!imageBase64) {
      showToast('无数据可复制', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(`data:image/png;base64,${imageBase64}`)
      setCopiedIndex(index)
      window.setTimeout(() => setCopiedIndex(current => current === index ? null : current), 2000)
      showToast('Base64 已复制到剪贴板', 'success')
    }
    catch (error) {
      showToast(`复制失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  async function saveStandaloneContextImage(target: Extract<ImageContextMenuTarget, { type: 'standalone' }>) {
    try {
      const result = await saveImageFile({
        imageBase64: target.imageBase64,
        filename: target.filename,
        mimeType: target.mimeType,
      })
      if (result.status === 'cancelled')
        return

      showToast(isDesktopApp() ? `图片已保存：${getSavedFileLabel(result.path, target.filename)}` : `图片已下载：${target.filename}`, 'success')
    }
    catch (error) {
      showToast(`保存失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  async function copyStandaloneContextImage(target: Extract<ImageContextMenuTarget, { type: 'standalone' }>) {
    try {
      await navigator.clipboard.writeText(`data:${target.mimeType};base64,${target.imageBase64}`)
      showToast('Base64 已复制到剪贴板', 'success')
    }
    catch (error) {
      showToast(`复制失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  async function handleUpscale(index: number, options: UpscaleOptions = {}) {
    const image = options.sourceImage || results[index]
    if (!image?.b64_json) {
      showToast('该图片无 base64 数据，无法放大', 'error')
      return
    }
    if (!isUpscaleProviderConfigured(currentUpscaleProvider)) {
      showToast('请先配置放大服务', 'error')
      return
    }
    const selectedFactor = options.factor || selectedUpscaleFactors[index] || 1
    if (options.factor)
      setSelectedUpscaleFactors(current => ({ ...current, [index]: options.factor as UpscaleFactor }))
    const existingVariant = resultUpscaleVariants[index]?.[selectedFactor]
    if (selectedFactor === 1) {
      showToast('1X 为原图，不需要提升分辨率', 'error')
      return
    }
    if (existingVariant) {
      showToast(`当前图片已存在 ${selectedFactor}X 版本，不能重复提升`, 'error')
      return
    }

    if (options.auto)
      setAutoUpscalingIndexes(current => ({ ...current, [index]: true }))
    const dims = currentUpscaleConfig.provider === 'aliyun'
      ? await validateAliyunUpscaleInput(image.b64_json)
      : await readBase64ImageSize(image.b64_json).catch(() => parseImageSize(imageSizes[index]))
    if (!dims) {
      showToast('图片尺寸尚未就绪，请稍候再试', 'error')
      if (options.auto)
        setAutoUpscalingIndexes(current => ({ ...current, [index]: false }))
      return
    }

    const targetWidth = options.targetWidth || Math.round(dims.width * selectedFactor)
    const targetHeight = options.targetHeight || Math.round(dims.height * selectedFactor)

    setUpscalingIndex(index)
    setUpscaleResponseJson(options.auto ? '自动超分处理中...' : '处理中...')
    try {
      const out = await upscaleImage(currentUpscaleConfig, image.b64_json, targetWidth, targetHeight)
      setResultUpscaleVariants(current => ({
        ...current,
        [index]: {
          ...(current[index] || {}),
          [selectedFactor]: out.imageBase64,
        },
      }))
      setImageSizes(current => ({ ...current, [index]: `${out.width} × ${out.height}px` }))
      setUpscaleResponseJson(JSON.stringify(out.responseJson || {
        width: out.width,
        height: out.height,
      }, null, 2))
      const targetRecordId = options.recordId ?? activeHistoryRecordId
      if (targetRecordId !== null)
        await saveHistoryUpscaleVariant(targetRecordId, index, selectedFactor, out.imageBase64, out.localPath)
      await applyStorageCleanup(historyStoragePolicy, true)
      await refreshHistory()
      showToast(`${options.auto ? '已自动超分至' : '已放大至'} ${out.width} × ${out.height}`, 'success')
    }
    catch (error) {
      const message = getErrorMessage(error)
      setUpscaleResponseJson(JSON.stringify({ error: message }, null, 2))
      showToast(`放大失败: ${message}`, 'error')
    }
    finally {
      setUpscalingIndex(null)
      if (options.auto)
        setAutoUpscalingIndexes(current => ({ ...current, [index]: false }))
    }
  }

  async function runAutoUpscaleQueue(nextResults: ResultImage[], plan: SizePlan, recordId: number | null) {
    if (!plan.autoUpscaleFactor)
      return

    for (const [index, image] of nextResults.entries()) {
      if (!image.b64_json)
        continue
      await handleUpscale(index, {
        factor: plan.autoUpscaleFactor,
        targetWidth: plan.targetWidth,
        targetHeight: plan.targetHeight,
        sourceImage: image,
        recordId,
        auto: true,
      })
    }
  }

  async function handleStandaloneUpscaleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', 'error')
      return
    }
    if (standaloneUpscale.isProcessing) {
      showToast('超分处理中，暂不能替换图片', 'error')
      return
    }

    try {
      const sourceBase64 = await blobToBase64(file)
      const dimensions = await readImageFileSize(file)
      setStandaloneUpscale({
        ...defaultStandaloneUpscaleState,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'image/png',
        sourceBase64,
        sourceWidth: dimensions.width,
        sourceHeight: dimensions.height,
        factor: standaloneUpscale.factor,
      })
      showToast('图片已载入', 'success')
    }
    catch (error) {
      showToast(`读取图片失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  function handleStandaloneFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file)
      void handleStandaloneUpscaleFile(file)
  }

  function handleStandaloneDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    event.stopPropagation()
    const file = event.dataTransfer.files?.[0]
    if (file)
      void handleStandaloneUpscaleFile(file)
  }

  function setStandaloneFactor(factor: StandaloneUpscaleFactor) {
    setStandaloneUpscale(current => ({
      ...current,
      factor,
      outputBase64: current.completedFactors[factor]?.outputBase64 || '',
      outputWidth: current.completedFactors[factor]?.outputWidth || 0,
      outputHeight: current.completedFactors[factor]?.outputHeight || 0,
      duration: current.completedFactors[factor]?.duration || '',
      responseJson: current.completedFactors[factor]?.responseJson || '无',
      activeRecordId: current.completedFactors[factor]?.activeRecordId || null,
    }))
  }

  function resetStandaloneUpscale() {
    if (standaloneUpscale.isProcessing)
      return
    setStandaloneUpscale(current => ({ ...defaultStandaloneUpscaleState, factor: current.factor }))
  }

  async function runStandaloneUpscale() {
    if (!standaloneUpscale.sourceBase64) {
      showToast('请先上传图片', 'error')
      return
    }
    if (!isUpscaleProviderConfigured(currentUpscaleProvider)) {
      showToast('请先在设置页配置放大服务', 'error')
      return
    }

    const targetWidth = Math.round(standaloneUpscale.sourceWidth * standaloneUpscale.factor)
    const targetHeight = Math.round(standaloneUpscale.sourceHeight * standaloneUpscale.factor)
    const startedAt = performance.now()
    setStandaloneUpscale(current => ({ ...current, isProcessing: true, responseJson: '独立超分处理中...' }))
    try {
      if (currentUpscaleConfig.provider === 'aliyun')
        await validateAliyunUpscaleInput(standaloneUpscale.sourceBase64)
      const out = await upscaleImage(currentUpscaleConfig, standaloneUpscale.sourceBase64, targetWidth, targetHeight)
      const duration = `${((performance.now() - startedAt) / 1000).toFixed(1)}`
      const responseJson = JSON.stringify(out.responseJson || {
        width: out.width,
        height: out.height,
        scale: out.scale || standaloneUpscale.factor,
      }, null, 2)
      const nextParams: RequestParams = {
        ...emptyParams,
        size: `${standaloneUpscale.sourceWidth}x${standaloneUpscale.sourceHeight}`,
        standaloneUpscale: true,
        sourceFileName: standaloneUpscale.fileName,
        sourceFileSize: standaloneUpscale.fileSize,
        sourceMimeType: standaloneUpscale.mimeType,
        sourceWidth: standaloneUpscale.sourceWidth,
        sourceHeight: standaloneUpscale.sourceHeight,
        upscaleProviderId: currentUpscaleProvider?.id,
        upscaleProviderName: currentUpscaleProvider?.name,
        upscaleFactor: standaloneUpscale.factor,
        targetWidth,
        targetHeight,
        outputWidth: out.width,
        outputHeight: out.height,
      }
      const outputBlob = base64ToBlob(out.imageBase64)
      const sourceBlob = base64ToBlob(standaloneUpscale.sourceBase64)
      const recordId = await addRecord({
        timestamp: Date.now(),
        providerId: currentUpscaleProvider?.id || 'upscale',
        providerName: currentUpscaleProvider?.name || '超分服务',
        mode: 'upscale',
        modelId: currentUpscaleProvider?.id || 'standalone-upscale',
        modelName: currentUpscaleProvider?.name || '独立超分',
        prompt: standaloneUpscale.fileName || '独立超分',
        params: nextParams,
        images: [sourceBlob],
        imageCount: 1,
        duration,
        requestJson: JSON.stringify({
          request: {
            mode: 'standalone-upscale',
            provider: currentUpscaleProvider?.name || '',
            factor: standaloneUpscale.factor,
            targetWidth,
            targetHeight,
            sourceFileName: standaloneUpscale.fileName,
          },
          response: out.responseJson || {
            width: out.width,
            height: out.height,
            scale: out.scale || standaloneUpscale.factor,
          },
        }, null, 2),
        totalSize: sourceBlob.size + outputBlob.size + JSON.stringify(nextParams).length,
        upscaledImages: {
          0: {
            [standaloneUpscale.factor]: outputBlob,
          },
        },
        isFavorite: false,
        favoritedAt: null,
      })
      if (recordId !== null)
        await saveHistoryUpscaleVariant(recordId, 0, standaloneUpscale.factor, out.imageBase64, out.localPath)
      await applyStorageCleanup(historyStoragePolicy, true)
      await refreshHistory()
      setStandaloneUpscale(current => ({
        ...current,
        outputBase64: out.imageBase64,
        outputWidth: out.width,
        outputHeight: out.height,
        duration,
        responseJson,
        activeRecordId: recordId || null,
        isProcessing: false,
        completedFactors: {
          ...current.completedFactors,
          [standaloneUpscale.factor]: {
            outputBase64: out.imageBase64,
            outputWidth: out.width,
            outputHeight: out.height,
            duration,
            responseJson,
            activeRecordId: recordId || null,
          },
        },
      }))
      showToast(`已超分至 ${out.width} × ${out.height}`, 'success')
    }
    catch (error) {
      setStandaloneUpscale(current => ({
        ...current,
        responseJson: JSON.stringify({ error: getErrorMessage(error) }, null, 2),
        isProcessing: false,
      }))
      showToast(`独立超分失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  async function downloadStandaloneOutput() {
    if (!standaloneUpscale.outputBase64) {
      showToast('暂无超分结果可下载', 'error')
      return
    }
    const filename = getStandaloneOutputFilename()
    try {
      const result = await saveImageFile({ imageBase64: standaloneUpscale.outputBase64, filename, mimeType: 'image/png' })
      if (result.status === 'cancelled')
        return

      showToast(isDesktopApp() ? `图片已保存：${getSavedFileLabel(result.path, filename)}` : `图片已下载：${filename}`, 'success')
    }
    catch (error) {
      showToast(`保存失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  async function recallHistory(recordId: number) {
    const record = await getRecord(recordId)
    if (!record) {
      showToast('记录不存在', 'error')
      return
    }

    if (record.mode === 'upscale') {
      const sourceBlob = record.images?.[0]
      if (!sourceBlob) {
        showToast('记录缺少原图数据', 'error')
        return
      }
      const factor = normalizeStandaloneFactor(record.params.upscaleFactor)
      const outputBlob = record.upscaledImages?.[0]?.[factor]
      const sourceBase64 = await blobToBase64(sourceBlob)
      const outputBase64 = outputBlob ? await blobToBase64(outputBlob) : ''
      const outputWidth = record.params.outputWidth || record.params.targetWidth || 0
      const outputHeight = record.params.outputHeight || record.params.targetHeight || 0
      const responseJson = record.requestJson || '无'
      setStandaloneUpscale({
        fileName: record.params.sourceFileName || record.prompt || '历史图片',
        fileSize: record.params.sourceFileSize || sourceBlob.size,
        mimeType: record.params.sourceMimeType || sourceBlob.type || 'image/png',
        sourceBase64,
        sourceWidth: record.params.sourceWidth || 0,
        sourceHeight: record.params.sourceHeight || 0,
        factor,
        outputBase64,
        outputWidth,
        outputHeight,
        duration: record.duration || '',
        responseJson,
        activeRecordId: record.id || null,
        isProcessing: false,
        completedFactors: outputBase64
          ? {
              [factor]: {
                outputBase64,
                outputWidth,
                outputHeight,
                duration: record.duration || '',
                responseJson,
                activeRecordId: record.id || null,
              },
            }
          : {},
      })
      setActiveHistoryRecordId(null)
      setView('upscale')
      showToast('已回显到超分台', 'success')
      return
    }

    if (record.providerId && providers.some(provider => provider.id === record.providerId))
      setCurrentProviderId(record.providerId)
    setMode(record.mode)
    setPrompt(record.prompt)
    setParams({
      n: record.params.n || 1,
      size: record.params.size || '',
      quality: record.params.quality || 'auto',
      autoPrompt: String(record.params.autoPrompt ?? 'false'),
      translate: String(record.params.translate ?? 'false'),
      resolution: record.params.resolution,
    })
    setTargetSize(makeTargetSizeFromParams(record.params))
    setRequestJson(record.requestJson || '无')
    setUpscaleResponseJson('无')

    if (models.some(model => model.id === record.modelId))
      setCurrentModelId(record.modelId)

    const restored: ResultImage[] = []
    for (const blob of record.images || [])
      restored.push({ b64_json: await blobToBase64(blob) })
    const restoredVariants: Record<number, Partial<Record<UpscaleFactor, string>>> = {}
    for (const [imageIndex, variants] of Object.entries(record.upscaledImages || {})) {
      restoredVariants[Number(imageIndex)] = {}
      for (const [factor, blob] of Object.entries(variants)) {
        const numericFactor = Number(factor) as UpscaleFactor
        if ([2, 3, 4].includes(numericFactor))
          restoredVariants[Number(imageIndex)][numericFactor] = await blobToBase64(blob)
      }
    }
    setImageSizes({})
    setOriginalImageSizes({})
    setSelectedUpscaleFactors({})
    setResultUpscaleVariants(restoredVariants)
    setAutoUpscalingIndexes({})
    setActiveHistoryRecordId(record.id || null)
    setCopiedIndex(null)
    setDownloadedIndex(null)
    setResults(restored)
    setView('workspace')
    showToast('已恢复历史记录', 'success')
    if (record.mode === 'edit')
      window.setTimeout(() => showToast('图生图参考图未保存，请重新上传', 'error'), 1200)
  }

  async function toggleHistoryFavorite(recordId: number, nextFavorite: boolean) {
    const favoritedAt = nextFavorite ? Date.now() : null
    const previousRecords = historyRecords
    setFavoritePendingIds(current => ({ ...current, [recordId]: true }))
    setHistoryRecords(current => current.map(record => record.id === recordId
      ? { ...record, isFavorite: nextFavorite, favoritedAt }
      : record))

    try {
      await setRecordFavorite(recordId, nextFavorite)
      showToast(nextFavorite ? '已收藏该记录' : '已取消收藏', 'success')
    }
    catch (error) {
      setHistoryRecords(previousRecords)
      showToast(`更新收藏失败: ${getErrorMessage(error)}`, 'error')
    }
    finally {
      setFavoritePendingIds((current) => {
        const next = { ...current }
        delete next[recordId]
        return next
      })
    }
  }

  async function removeHistory(recordId: number) {
    const record = historyRecords.find(item => item.id === recordId)
    if (record?.isFavorite && !window.confirm('该记录已收藏，确定仍要删除吗？此操作不可撤销。'))
      return

    await deleteRecord(recordId)
    if (activeHistoryRecordId === recordId)
      setActiveHistoryRecordId(null)
    await refreshHistory()
    showToast('已删除该记录', 'success')
  }

  async function clearHistory() {
    if (!historyRecords.length) {
      showToast('没有可清空的记录', 'error')
      return
    }
    const recordsToRemove = historyRecords.filter(record => !record.isFavorite)
    const protectedCount = historyRecords.length - recordsToRemove.length
    if (!recordsToRemove.length) {
      showToast('没有可清理的未收藏记录', 'error')
      return
    }
    const confirmText = protectedCount
      ? `确定要清理 ${recordsToRemove.length} 条未收藏记录吗？${protectedCount} 条收藏记录会保留。`
      : `确定要清理全部 ${recordsToRemove.length} 条历史记录吗？此操作不可撤销。`
    if (!window.confirm(confirmText))
      return
    await Promise.all(recordsToRemove.map(record => record.id === undefined ? Promise.resolve() : deleteRecord(record.id)))
    if (activeHistoryRecordId !== null && recordsToRemove.some(record => record.id === activeHistoryRecordId))
      setActiveHistoryRecordId(null)
    await refreshHistory()
    showToast(protectedCount ? '已清理未收藏记录，收藏记录已保留' : '已清理历史记录', 'success')
  }

  async function handleSelectHistoryDirectory() {
    setHistoryDirPending(true)
    try {
      const nextDir = await selectHistoryDirectory()
      if (!nextDir)
        return
      setHistoryRootDir(nextDir)
      showToast('历史存储目录已更新，新记录将写入新目录', 'success')
      await refreshHistory()
    }
    catch (error) {
      showToast(`设置目录失败: ${getErrorMessage(error)}`, 'error')
    }
    finally {
      setHistoryDirPending(false)
    }
  }

  async function handleOpenHistoryDirectory() {
    try {
      await openHistoryDirectory()
    }
    catch (error) {
      showToast(`打开目录失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  function renderStatus(status: StatusValue) {
    if (!status)
      return null
    return (
      <div className={`status ${status.type}`}>
        {status.type === 'loading' ? <span className="spinner" /> : null}
        <span>{status.message}</span>
      </div>
    )
  }

  const navItems: Array<{ id: ViewName; label: string; icon: IconName; hint: string }> = [
    { id: 'workspace', label: '工作台', icon: 'navWorkspace', hint: '生成与结果' },
    { id: 'upscale', label: '超分', icon: 'navUpscale', hint: '独立放大' },
    { id: 'history', label: '历史记录', icon: 'navHistory', hint: '资产浏览' },
    { id: 'settings', label: '设置', icon: 'navSettings', hint: '系统与配置' },
  ]
  const viewTitle = view === 'workspace' ? '工作台' : view === 'upscale' ? '超分' : view === 'history' ? '历史记录' : '设置'
  const viewDesc = view === 'workspace'
    ? '围绕当前供应商与模型完成图片生成和结果处理。'
    : view === 'upscale'
      ? '上传本地图片，单独执行高清放大并保存到历史记录。'
    : view === 'history'
      ? '查看、筛选并回显本地历史生成记录。'
      : '集中管理供应商、放大服务、历史目录与外观主题。'

  function renderWorkspaceView() {
    return (
      <div className="workspace-layout">
        {/* 左栏：控制面板 */}
        <div className="control-panel">
          <section className="panel">
            <div className="panel-heading compact">
              <div>
                <h2>模型</h2>
                <div className="panel-caption">选择供应商后拉取并选择模型。</div>
              </div>
              <span className="rail-count">{models.length}</span>
            </div>

            <div className="provider-select-bar">
              <select
                value={currentProviderId}
                onChange={event => onProviderChange(event.target.value)}
              >
                <option value="">请选择供应商</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button type="button" disabled={!currentProvider} onClick={() => void loadModels()}>
                拉模型
              </button>
            </div>

            {renderStatus(connStatus)}

            <div className="model-list model-list-rail">
              {!models.length
                ? (
                    <div className="empty compact-empty">
                      <div className="empty-icon"><Icon name="box" size={32} /></div>
                      <div className="empty-text">暂无模型</div>
                      <div className="empty-hint">填写 API 配置后点击"拉模型"</div>
                    </div>
                  )
                : models.map(model => (
                    <button
                      key={model.id}
                      type="button"
                      className={`model-card ${currentModelId === model.id ? 'active' : ''}`}
                      onClick={() => selectModel(model.id)}
                    >
                      <div className="name">
                        {model.displayName || model.id}
                        {model.id === defaultModel ? <span className="badge">默认</span> : null}
                      </div>
                      <div className="model-id">{model.id}</div>
                      <div className="meta">{model.description || ''}</div>
                      {model.creditPerImage !== undefined
                        ? (
                            <div className="tags">
                              <span className="tag"><Icon name="prompt" size={13} />{model.maxGenerations}张/次</span>
                              <span className="tag"><Icon name="image" size={13} />{model.maxInputImages}张参考图</span>
                            </div>
                          )
                        : null}
                    </button>
                  ))}
            </div>
          </section>

          <section className="panel composer-panel">
            <div className="panel-heading compact">
              <div>
                <h2>创作</h2>
                <div className="panel-caption">填写 Prompt 与生成参数。</div>
              </div>
              <div className="composer-state">
                <span>{mode === 'edit' ? '图生图' : '文生图'}</span>
              </div>
            </div>

            <div className="mode-switch">
              <label className={mode === 'gen' ? 'active' : ''}>
                <input type="radio" checked={mode === 'gen'} onChange={() => setMode('gen')} />
                <Icon name="spark" size={15} />
                文生图
              </label>
              <label className={mode === 'edit' ? 'active' : ''}>
                <input type="radio" checked={mode === 'edit'} onChange={() => setMode('edit')} />
                <Icon name="editImage" size={15} />
                图生图
              </label>
            </div>

            {mode === 'edit'
              ? (
                  <div className="edit-upload">
                    <label>
                      参考图
                      <span className="accent-inline">（上限: {currentModel?.maxInputImages || 0} 张）</span>
                    </label>
                    <button className="upload-zone" type="button" onClick={() => fileInputRef.current?.click()}>
                      <div className="upload-icon"><Icon name="upload" size={24} /></div>
                      <div className="upload-text">点击上传参考图</div>
                      <div className="upload-hint">支持多选 · JPG / PNG / WebP</div>
                    </button>
                    <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={event => onFileChange(event.target.files)} />
                    <div className="ref-preview">
                      {refFiles.map((file, index) => (
                        <div key={`${file.name}_${index}`} className="ref-item">
                          <img src={URL.createObjectURL(file)} alt={file.name} />
                          <button className="ref-remove" type="button" onClick={() => removeRefFile(index)} aria-label="移除参考图">
                            <Icon name="close" size={12} />
                          </button>
                          <div className="ref-name">{file.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              : null}

            <div className="row">
              <div>
                <label htmlFor="prompt">Prompt</label>
                <textarea
                  id="prompt"
                  ref={promptInputRef}
                  value={prompt}
                  placeholder="输入你想生成的画面描述，Ctrl + Enter 可直接提交"
                  onChange={event => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing)
                      void generate()
                  }}
                />
              </div>
            </div>

            <div className="param-grid">
              <div className="fixed-n">
                <label htmlFor="n">数量 <span className="muted">{currentModel ? `(≤${currentModel.maxGenerations})` : ''}</span></label>
                <input
                  id="n"
                  type="number"
                  min={1}
                  max={currentModel?.maxGenerations || 1}
                  value={params.n}
                  onChange={event => setParams(current => ({ ...current, n: Number(event.target.value || 1) }))}
                />
              </div>
              <div>
                <label htmlFor="quality">质量</label>
                <select id="quality" value={params.quality} onChange={event => setParams(current => ({ ...current, quality: event.target.value }))}>
                  <option value="auto">auto</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </div>
              <div>
                <label htmlFor="autoPrompt">自动补全</label>
                <select id="autoPrompt" value={params.autoPrompt} onChange={event => setParams(current => ({ ...current, autoPrompt: event.target.value }))}>
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </div>
              <div>
                <label htmlFor="translate">自动翻译</label>
                <select id="translate" value={params.translate} onChange={event => setParams(current => ({ ...current, translate: event.target.value }))}>
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </div>
              {currentModel?.hasResolution && resolutionOptions.length
                ? (
                    <div>
                      <label htmlFor="resolution">分辨率</label>
                      <select id="resolution" value={params.resolution || ''} onChange={event => setParams(current => ({ ...current, resolution: event.target.value }))}>
                        {resolutionOptions.map(value => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </div>
                  )
                : null}
            </div>

            <div className="target-size-panel">
              <div className="target-size-head">
                <label>目标尺寸</label>
                <div className="target-size-mode">
                  <button type="button" className={`chip ${targetSize.mode === 'ratio' ? 'active' : ''}`} onClick={() => updateTargetSizeMode('ratio')}>按比例</button>
                  <button type="button" className={`chip ${targetSize.mode === 'manual' ? 'active' : ''}`} onClick={() => updateTargetSizeMode('manual')}>直接输入</button>
                </div>
              </div>

              {targetSize.mode === 'ratio'
                ? (
                    <>
                      <div className="ratio-chip-grid">
                        {COMMON_RATIOS.map(ratio => (
                          <button key={ratio} type="button" className={`chip ${targetSize.ratioText === ratio ? 'active' : ''}`} onClick={() => updateRatioText(ratio)}>
                            {ratio}
                          </button>
                        ))}
                      </div>
                      <div className="target-input-grid compact">
                        <div>
                          <label htmlFor="ratioText">自定义比例</label>
                          <input id="ratioText" value={targetSize.ratioText} placeholder="16:9" onChange={event => updateRatioText(event.target.value)} />
                        </div>
                        <div>
                          <label htmlFor="targetWidthRange">目标宽度</label>
                          <input
                            id="targetWidthRange"
                            type="range"
                            min={TARGET_WIDTH_MIN}
                            max={TARGET_WIDTH_MAX}
                            step={SIZE_ALIGN}
                            value={Math.min(targetSize.targetWidth, TARGET_WIDTH_MAX)}
                            onChange={event => updateTargetWidth(Number(event.target.value))}
                          />
                        </div>
                      </div>
                      <div className="dimension-preset-grid">
                        <div>
                          <label>常用宽度</label>
                          <div className="dimension-preset-row">
                            {COMMON_TARGET_WIDTHS.map(width => (
                              <button key={width} type="button" className={`chip ${targetSize.targetWidth === width ? 'active' : ''}`} onClick={() => updateTargetWidth(width)}>
                                {width}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label>常用高度</label>
                          <div className="dimension-preset-row">
                            {COMMON_TARGET_HEIGHTS.map(height => (
                              <button key={height} type="button" className={`chip ${targetSize.targetHeight === height ? 'active' : ''}`} onClick={() => updateTargetHeight(height)}>
                                {height}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  )
                : null}

              <div className="target-input-grid">
                <div>
                  <label htmlFor="targetWidth">目标宽度</label>
                  <input
                    id="targetWidth"
                    inputMode="numeric"
                    value={targetSizeDraft.targetWidth}
                    onBlur={commitTargetWidthDraft}
                    onChange={event => changeTargetWidthDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        event.currentTarget.blur()
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="targetHeight">目标高度</label>
                  <input
                    id="targetHeight"
                    inputMode="numeric"
                    value={targetSizeDraft.targetHeight}
                    onBlur={commitTargetHeightDraft}
                    onChange={event => changeTargetHeightDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        event.currentTarget.blur()
                    }}
                  />
                </div>
              </div>

              <label className="auto-upscale-toggle">
                <input type="checkbox" checked={targetSize.autoUpscale} onChange={event => updateAutoUpscale(event.target.checked)} />
                <span>自动超分</span>
              </label>

              {sizePlan
                ? (
                    <div className={`size-plan-preview ${sizePlan.needsUpscale ? 'warn' : 'ready'}`}>
                      <div>
                        <span>目标尺寸</span>
                        <strong>{sizePlan.targetWidth} × {sizePlan.targetHeight}</strong>
                      </div>
                      <div>
                        <span>生图尺寸</span>
                        <strong>{sizePlan.generationWidth} × {sizePlan.generationHeight}</strong>
                      </div>
                      <div>
                        <span>后续处理</span>
                        <strong>
                          {sizePlan.needsUpscale
                            ? targetSize.autoUpscale
                              ? sizePlan.canAutoUpscale
                                ? `自动超分 ${sizePlan.autoUpscaleFactor}X`
                                : '超过 4X 能力'
                              : '未启用自动超分'
                            : '直接生成'}
                        </strong>
                      </div>
                    </div>
                  )
                : (
                    <div className="target-size-error">{sizePlanResult.error}</div>
                  )}
            </div>

            <div className="composer-checklist">
              <span className={`composer-check-item ${currentProvider ? 'ready' : ''}`}>供应商</span>
              <span className={`composer-check-item ${currentModel ? 'ready' : ''}`}>模型</span>
              <span className={`composer-check-item ${sizePlan ? 'ready' : ''}`}>尺寸</span>
              <span className={`composer-check-item ${prompt.trim() ? 'ready' : ''}`}>Prompt</span>
              <span className={`composer-check-item ${mode === 'gen' || refFiles.length ? 'ready' : ''}`}>参考图</span>
            </div>

            <div className="generate-bar">
              <div className="generate-hint">
                <strong>{currentModel?.displayName || '尚未选择模型'}</strong>
                <span>{prompt.trim() ? `Prompt 已填写 ${prompt.trim().length} 字` : '填写 Prompt 后即可开始生成'}</span>
              </div>
              <div className="gen-btn-group">
                <button
                  className={`generate-btn${isGenerating ? ' is-generating' : ''}`}
                  type="button"
                  disabled={!currentModel || isGenerating}
                  onClick={() => void generate()}
                >
                  {isGenerating
                    ? (
                        <>
                          <span className="btn-spinner" />
                          <span>
                            生成中
                            {resultTimer ? ` ${resultTimer}` : ''}
                          </span>
                        </>
                      )
                    : (mode === 'edit' ? '生成图片（图生图）' : '生成图片')}
                </button>
                {isGenerating
                  ? (
                      <button className="cancel-btn" type="button" onClick={cancelGeneration}>
                        取消
                      </button>
                    )
                  : null}
              </div>
            </div>
            {renderStatus(genStatus)}
          </section>
        </div>

        {/* 右栏：画布区 */}
        <div className="canvas-panel">
          <div className="canvas-header">
            <div className="canvas-meta-bar">
              <div className="canvas-meta-copy">
                <span className="canvas-title">
                  {isGenerating ? '生成中' : results.length ? `${results.length} 张结果` : '等待生成'}
                </span>
                <span className="canvas-timer">{resultTimer}</span>
              </div>
              {results.length
                ? (
                    <button
                      className={`favorite-btn canvas-favorite-btn ${activeHistoryRecord?.isFavorite ? 'active' : ''}`}
                      type="button"
                      disabled={!activeHistoryRecord || activeFavoritePending}
                      title={activeHistoryRecord ? '' : '记录保存后可收藏'}
                      onClick={() => {
                        if (activeHistoryRecord?.id !== undefined)
                          void toggleHistoryFavorite(activeHistoryRecord.id, !activeHistoryRecord.isFavorite)
                      }}
                    >
                      <Icon name={activeHistoryRecord?.isFavorite ? 'starFilled' : 'star'} size={16} />
                      {activeFavoritePending ? '保存中...' : activeHistoryRecord?.isFavorite ? '已收藏' : '收藏本次'}
                    </button>
                  )
                : null}
            </div>
          </div>

          <div className={`results-grid ${results.length > 1 ? 'multi' : ''}`}>
            {isGenerating && loadingCount > 0
              ? Array.from({ length: loadingCount }).map((_, index) => (
                  <div key={index} className="skeleton-card">
                    <div className="skeleton-bar" style={{ width: '60%', height: 14, marginBottom: 10 }} />
                    <div className="skeleton-bar img" />
                  </div>
                ))
              : !results.length
                  ? (
                      <div className="empty">
                        <div className="empty-icon"><Icon name="palette" size={34} /></div>
                        <div className="empty-text">等待生成</div>
                        <div className="empty-hint">选择模型并填写参数后点击"生成图片"</div>
                      </div>
                    )
                  : results.map((image, index) => {
                      const selectedFactor = selectedUpscaleFactors[index] || 1
                      const selectedVariant = resultUpscaleVariants[index]?.[selectedFactor]
                      const selectedBase64 = selectedFactor === 1 ? image.b64_json : selectedVariant
                      const source = selectedBase64 ? `data:image/png;base64,${selectedBase64}` : image.b64_json ? `data:image/png;base64,${image.b64_json}` : image.url || ''
                      const originalSource = image.b64_json ? `data:image/png;base64,${image.b64_json}` : ''
                      const isUpscaleConfigured = isUpscaleProviderConfigured(currentUpscaleProvider)
                      const isAutoUpscaling = !!autoUpscalingIndexes[index]
                      const hasSelectedVariant = selectedFactor > 1 && !!selectedVariant
                      const originalDims = originalImageSizes[index] || parseImageSize(imageSizes[index])
                      const upscalePreviewText = getUpscalePreviewText(originalDims, selectedFactor, hasSelectedVariant)
                      const imageAspectRatio = originalDims ? `${originalDims.width} / ${originalDims.height}` : undefined
                      const upscaleDisabled = !isUpscaleConfigured || upscalingIndex !== null || selectedFactor === 1 || hasSelectedVariant
                      const upscaleTitle = !isUpscaleConfigured
                        ? '请先在设置页配置放大服务'
                        : selectedFactor === 1
                          ? '1X 为原图，不需要提升分辨率'
                          : hasSelectedVariant
                            ? `当前图片已存在 ${selectedFactor}X 版本`
                            : ''
                      return (
                        <div key={index} className="result-item">
                          <div className="info">
                            <span className="info-left">
                              <span className="info-tag">#{index + 1}</span>
                              <span>{image.b64_json ? 'base64' : 'url'}</span>
                              <span className="accent-text">{currentModel?.id || '-'}</span>
                            </span>
                            <span className="img-size">{imageSizes[index] || '计算中...'}</span>
                          </div>
                          {source
                            ? (
                                <div className="result-img-wrap" style={imageAspectRatio ? { aspectRatio: imageAspectRatio } : undefined}>
                                  <img
                                    className="result-img"
                                    src={source}
                                    alt={`结果 ${index + 1}`}
                                    loading="lazy"
                                    onContextMenu={event => openImageContextMenu(event, { type: 'result', index })}
                                    onClick={() => openImagePreview(
                                      source,
                                      `结果 #${index + 1}`,
                                      hasSelectedVariant && originalSource
                                        ? {
                                            before: originalSource,
                                            after: source,
                                            beforeLabel: '1X 原图',
                                            afterLabel: `${selectedFactor}X 超分图`,
                                          }
                                        : undefined,
                                    )}
                                    onLoad={(event) => {
                                      const target = event.currentTarget
                                      const dimensions = { width: target.naturalWidth, height: target.naturalHeight }
                                      setImageSizes(current => ({ ...current, [index]: formatImageDimensions(dimensions) }))
                                      if ((selectedFactor === 1 || !selectedVariant) && image.b64_json)
                                        setOriginalImageSizes(current => ({ ...current, [index]: dimensions }))
                                    }}
                                  />
                                </div>
                              )
                            : (
                                <div className="empty" style={{ padding: 20 }}>
                                  <div className="empty-text">未返回图片数据</div>
                                </div>
                              )}
                          <div className="result-actions">
                            <div className="result-primary-actions">
                              <button className={`dl-btn ${downloadedIndex === index ? 'downloaded' : ''}`} type="button" onClick={() => void handleDownload(index)}>
                                {downloadedIndex === index ? '已保存' : '下载图片'}
                              </button>
                              <button className="dl-btn" type="button" onClick={() => void handleCopy(index)}>
                                {copiedIndex === index ? '已复制' : '复制 Base64'}
                              </button>
                            </div>
                            {image.b64_json
                              ? (
                                  <div className="result-upscale-row">
                                    <div className="result-upscale-chips">
                                      {([1, 2, 3, 4] as UpscaleFactor[]).map(factor => (
                                        <button
                                          key={factor}
                                          type="button"
                                          className={`chip ${selectedFactor === factor ? 'active' : ''} ${factor > 1 && resultUpscaleVariants[index]?.[factor] ? 'completed' : ''}`}
                                          disabled={upscalingIndex === index}
                                          onClick={() => setSelectedUpscaleFactors(current => ({ ...current, [index]: factor }))}
                                        >
                                          {factor}X
                                        </button>
                                      ))}
                                    </div>
                                    <div className="result-upscale-target">{upscalePreviewText}</div>
                                    <button
                                      className="dl-btn result-upscale-btn"
                                      type="button"
                                      disabled={upscaleDisabled}
                                      title={upscaleTitle}
                                      onClick={() => void handleUpscale(index)}
                                    >
                                      {upscalingIndex === index ? (isAutoUpscaling ? '自动超分中…' : '放大中…') : '提升分辨率'}
                                    </button>
                                  </div>
                                )
                              : null}
                          </div>
                        </div>
                      )
                    })}
          </div>

          <details className="panel request-panel">
            <summary>生图请求 JSON</summary>
            <pre>{requestJson}</pre>
          </details>

          <details className="panel request-panel">
            <summary>图片超分响应 JSON</summary>
            <pre>{upscaleResponseJson}</pre>
          </details>
        </div>
      </div>
    )
  }

  function renderStandaloneUpscaleView() {
    const hasSource = !!standaloneUpscale.sourceBase64
    const sourceUrl = hasSource ? `data:${standaloneUpscale.mimeType || 'image/png'};base64,${standaloneUpscale.sourceBase64}` : ''
    const outputUrl = standaloneUpscale.outputBase64 ? `data:image/png;base64,${standaloneUpscale.outputBase64}` : ''
    const targetWidth = hasSource ? Math.round(standaloneUpscale.sourceWidth * standaloneUpscale.factor) : 0
    const targetHeight = hasSource ? Math.round(standaloneUpscale.sourceHeight * standaloneUpscale.factor) : 0
    const canRunStandalone = hasSource && isUpscaleProviderConfigured(currentUpscaleProvider) && !standaloneUpscale.isProcessing

    return (
      <div className="standalone-upscale-layout">
        <section className="panel standalone-control-panel">
          <div className="panel-heading compact">
            <div>
              <h2>图片上传</h2>
              <div className="panel-caption">选择一张本地图片，直接执行超分处理。</div>
            </div>
          </div>

          <label
            className={`standalone-dropzone ${hasSource ? 'has-file' : ''}`}
            onDragOver={event => event.preventDefault()}
            onDrop={handleStandaloneDrop}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={standaloneUpscale.isProcessing}
              onChange={handleStandaloneFileInput}
            />
            <span className="standalone-dropzone-icon"><Icon name="upload" size={24} /></span>
            <strong>{hasSource ? standaloneUpscale.fileName : '点击或拖入图片'}</strong>
            <span>{hasSource ? `${formatSize(standaloneUpscale.fileSize)} · ${standaloneUpscale.mimeType || 'image'}` : '支持 PNG、JPG、WEBP'}</span>
          </label>

          <div className="standalone-info-grid">
            <div>
              <span>原图尺寸</span>
              <strong>{hasSource ? formatImageDimensions({ width: standaloneUpscale.sourceWidth, height: standaloneUpscale.sourceHeight }) : '-'}</strong>
            </div>
            <div>
              <span>目标尺寸</span>
              <strong>{hasSource ? formatImageDimensions({ width: targetWidth, height: targetHeight }) : '-'}</strong>
            </div>
          </div>

          <div className={`standalone-provider-status ${isUpscaleProviderConfigured(currentUpscaleProvider) ? 'ready' : 'empty'}`}>
            <div>
              <span>当前超分服务</span>
              <strong>{currentUpscaleProvider ? currentUpscaleProvider.name : '未选择'}</strong>
              <small>{currentUpscaleProvider ? getUpscaleProviderTypeLabel(currentUpscaleProvider.provider) : '请在设置页选择服务'}</small>
            </div>
            <button className="secondary" type="button" disabled={standaloneUpscale.isProcessing} onClick={() => setView('settings')}>
              去设置
            </button>
          </div>

          <div className="field">
            <label>放大倍率</label>
            <div className="standalone-factor-row">
              {([2, 3, 4] as StandaloneUpscaleFactor[]).map(factor => (
                <button
                  key={factor}
                  className={`chip ${standaloneUpscale.factor === factor ? 'active' : ''} ${standaloneUpscale.completedFactors[factor] ? 'completed' : ''}`}
                  type="button"
                  disabled={standaloneUpscale.isProcessing}
                  onClick={() => setStandaloneFactor(factor)}
                >
                  {factor}X
                </button>
              ))}
            </div>
          </div>

          <div className="standalone-action-row">
            <button type="button" disabled={!canRunStandalone} onClick={() => void runStandaloneUpscale()}>
              {standaloneUpscale.isProcessing ? '超分处理中...' : '开始超分'}
            </button>
            <button className="secondary" type="button" disabled={standaloneUpscale.isProcessing || !hasSource} onClick={resetStandaloneUpscale}>
              重新上传
            </button>
          </div>

        </section>

        <section className="panel standalone-preview-panel">
          <div className="panel-heading compact">
            <div>
              <h2>超分预览</h2>
              <div className="panel-caption">{outputUrl ? `输出 ${formatImageDimensions({ width: standaloneUpscale.outputWidth, height: standaloneUpscale.outputHeight })}` : '原图与结果会在这里并排展示。'}</div>
            </div>
            {outputUrl
              ? (
                  <button className="dl-btn" type="button" onClick={() => void downloadStandaloneOutput()}>下载超分图</button>
                )
              : null}
          </div>

          <div className={`standalone-preview-grid ${outputUrl ? 'has-output' : ''}`}>
            <div className="standalone-preview-card">
              <div className="standalone-preview-head">
                <span>原图</span>
                <span>{hasSource ? formatImageDimensions({ width: standaloneUpscale.sourceWidth, height: standaloneUpscale.sourceHeight }) : '-'}</span>
              </div>
              {sourceUrl
                ? (
                    <img
                      src={sourceUrl}
                      alt="独立超分原图"
                      onContextMenu={event => openImageContextMenu(event, {
                        type: 'standalone',
                        imageBase64: standaloneUpscale.sourceBase64,
                        filename: getStandaloneSourceFilename(),
                        mimeType: normalizeImageMimeType(standaloneUpscale.mimeType),
                      })}
                      onClick={() => openImagePreview(
                        sourceUrl,
                        '独立超分',
                        outputUrl
                          ? {
                              before: sourceUrl,
                              after: outputUrl,
                              beforeLabel: '原图',
                              afterLabel: `${standaloneUpscale.factor}X 超分图`,
                            }
                          : undefined,
                      )}
                    />
                  )
                : (
                    <div className="standalone-preview-empty">
                      <strong>暂无图片</strong>
                      <span>上传图片后开始处理。</span>
                    </div>
                  )}
            </div>

            <div className="standalone-preview-card">
              <div className="standalone-preview-head">
                <span>超分图</span>
                <span>{outputUrl ? formatImageDimensions({ width: standaloneUpscale.outputWidth, height: standaloneUpscale.outputHeight }) : hasSource ? `预计 ${targetWidth} × ${targetHeight}px` : '-'}</span>
              </div>
              {outputUrl
                ? (
                    <img
                      src={outputUrl}
                      alt="独立超分结果"
                      onContextMenu={event => openImageContextMenu(event, {
                        type: 'standalone',
                        imageBase64: standaloneUpscale.outputBase64,
                        filename: getStandaloneOutputFilename(),
                        mimeType: 'image/png',
                      })}
                      onClick={() => openImagePreview(
                        outputUrl,
                        '独立超分',
                        sourceUrl
                          ? {
                              before: sourceUrl,
                              after: outputUrl,
                              beforeLabel: '原图',
                              afterLabel: `${standaloneUpscale.factor}X 超分图`,
                            }
                          : undefined,
                      )}
                    />
                  )
                : (
                    <div className="standalone-preview-empty">
                      <strong>{standaloneUpscale.isProcessing ? '处理中' : '等待超分'}</strong>
                      <span>{hasSource ? '确认倍率后点击开始超分。' : '先上传一张图片。'}</span>
                    </div>
                  )}
            </div>
          </div>

          <div className="standalone-result-actions">
            <button
              className={`favorite-btn ${standaloneActiveRecord?.isFavorite ? 'active' : ''}`}
              type="button"
              disabled={!standaloneActiveRecord || standaloneFavoritePending}
              onClick={() => {
                if (standaloneActiveRecord?.id !== undefined)
                  void toggleHistoryFavorite(standaloneActiveRecord.id, !standaloneActiveRecord.isFavorite)
              }}
            >
              <Icon name={standaloneActiveRecord?.isFavorite ? 'starFilled' : 'star'} size={16} />
              {standaloneFavoritePending ? '保存中...' : standaloneActiveRecord?.isFavorite ? '已收藏' : '收藏记录'}
            </button>
            <span>{standaloneUpscale.activeRecordId ? `历史记录 #${standaloneUpscale.activeRecordId}` : outputUrl ? '结果已生成，历史保存后可收藏' : '完成后会保存到历史记录'}</span>
          </div>

          <details className="panel request-panel standalone-response-panel">
            <summary>独立超分响应 JSON</summary>
            <pre>{standaloneUpscale.responseJson}</pre>
          </details>
        </section>
      </div>
    )
  }

  function renderSettingsView() {
    const storageLimitEnabled = storageLimitEnabledDraft
    const storageLimitBytes = getStorageLimitBytesFromDraft()
    return (
      <div className="settings-view">
        <section className="panel settings-overview-panel">
          <div className="panel-heading">
            <div>
              <h2>系统设置概览</h2>
              <div className="panel-caption">将供应商、放大服务、历史存储和主题切换收敛到统一的桌面端设置中心。</div>
            </div>
          </div>
          <div className="settings-overview-grid">
            <div className="settings-overview-card accent">
              <span className="settings-overview-label">供应商资源</span>
              <strong>{providers.length}</strong>
              <span className="settings-overview-copy">{currentProvider?.name || '当前未选择默认供应商'}</span>
            </div>
            <div className="settings-overview-card">
              <span className="settings-overview-label">历史目录</span>
              <strong>{historyRootDir ? '已配置' : '默认目录'}</strong>
              <span className="settings-overview-copy">{historyRootDir || '未手动设置时将使用应用默认目录'}</span>
            </div>
            <div className="settings-overview-card">
              <span className="settings-overview-label">主题外观</span>
              <strong>{theme === 'dark' ? '深色' : '浅色'}</strong>
              <span className="settings-overview-copy">切换后会立即同步到整个桌面工作台。</span>
            </div>
          </div>
        </section>

        <div className="settings-grid">
        <section className="panel settings-panel provider-section">
          <div className="panel-heading">
            <div>
              <h2>供应商管理</h2>
              <div className="panel-caption">管理 API 供应商配置，工作台下拉框可随时切换使用中的供应商。</div>
            </div>
            <button type="button" onClick={openCreateModal}>+ 新增供应商</button>
          </div>

          {providers.length === 0
            ? (
                <div className="empty" style={{ padding: '32px 0' }}>
                  <div className="empty-icon"><Icon name="plug" size={34} /></div>
                  <div className="empty-text">暂无供应商配置</div>
                  <div className="empty-hint">点击右上角"+ 新增供应商"开始配置</div>
                </div>
              )
            : (
                <div className="provider-list">
                  {providers.map(p => (
                    <div key={p.id} className={`provider-list-row${p.id === currentProviderId ? ' active' : ''}`}>
                      <div
                        className="provider-list-main"
                        role="button"
                        tabIndex={0}
                        onClick={() => onProviderChange(p.id)}
                        onKeyDown={e => e.key === 'Enter' && onProviderChange(p.id)}
                      >
                        <div className="provider-list-name">{p.name}</div>
                        <div className="provider-list-url">{p.apiUrl || '未填写 URL'}</div>
                      </div>
                      <div className="provider-list-meta">
                        {p.id === currentProviderId && <span className="badge-in-use">使用中</span>}
                        {p.apiKey ? <span className="badge-key">已配密钥</span> : null}
                      </div>
                      <div className="provider-list-actions">
                        <button className="secondary" type="button" onClick={() => openEditModal(p)}>编辑</button>
                        <button className="secondary danger" type="button" onClick={() => removeProvider(p.id)}>删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
        </section>

        <section className="panel settings-panel upscale-section">
          <div className="panel-heading">
            <div>
              <h2>图像超分</h2>
              <div className="panel-caption">管理超分服务配置，结果区会使用当前选中的服务提升图片分辨率。</div>
            </div>
            <button type="button" onClick={openCreateUpscaleModal}>+ 新增超分服务</button>
          </div>

          {!upscaleProviders.length
            ? (
                <div className="empty" style={{ padding: '32px 0' }}>
                  <div className="empty-icon"><Icon name="upscale" size={34} /></div>
                  <div className="empty-text">暂无超分服务配置</div>
                  <div className="empty-hint">点击右上角"+ 新增超分服务"开始配置</div>
                </div>
              )
            : (
                <div className="provider-list">
                  {upscaleProviders.map(p => (
                    <div key={p.id} className={`provider-list-row${p.id === currentUpscaleProviderId ? ' active' : ''}`}>
                      <div
                        className="provider-list-main"
                        role="button"
                        tabIndex={0}
                        onClick={() => onUpscaleProviderChange(p.id)}
                        onKeyDown={e => e.key === 'Enter' && onUpscaleProviderChange(p.id)}
                      >
                        <div className="provider-list-name">{p.name}</div>
                        <div className="provider-list-url">{getUpscaleProviderSummary(p)}</div>
                      </div>
                      <div className="provider-list-meta">
                        <span className="badge-key">{getUpscaleProviderTypeLabel(p.provider)}</span>
                        {p.id === currentUpscaleProviderId && <span className="badge-in-use">使用中</span>}
                        {isUpscaleProviderConfigured(p) ? <span className="badge-key">已配置</span> : null}
                      </div>
                      <div className="provider-list-actions">
                        <button className="secondary" type="button" onClick={() => openEditUpscaleModal(p)}>编辑</button>
                        <button className="secondary danger" type="button" onClick={() => removeUpscaleProvider(p.id)}>删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

          <div className="settings-summary-list">
            <div className="settings-summary-row">
              <span>当前超分服务</span>
              <strong>{currentUpscaleProvider ? `${currentUpscaleProvider.name} · ${getUpscaleProviderTypeLabel(currentUpscaleProvider.provider)}` : '未选择'}</strong>
            </div>
          </div>
        </section>

        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>历史存储</h2>
              <div className="panel-caption">查看当前存储路径、打开目录或切换新目录。</div>
            </div>
          </div>
          <div className="storage-setting-card">
            <div className="storage-setting-head">
              <div>
                <div className="storage-setting-title">历史图片目录</div>
                <div className="storage-setting-desc">桌面端会把历史数据库和图片资源保存到这里。</div>
              </div>
              <div className="storage-setting-actions">
                <button className="secondary" type="button" disabled={historyDirPending} onClick={() => void handleOpenHistoryDirectory()}>
                  打开目录
                </button>
                <button type="button" disabled={historyDirPending} onClick={() => void handleSelectHistoryDirectory()}>
                  {historyDirPending ? '选择中…' : '更改目录'}
                </button>
              </div>
            </div>
            <div className="storage-setting-path">{historyRootDir || '未设置时将使用应用默认目录'}</div>
            <div className="storage-setting-meta">
              <span>当前已用：{formatSize(storageUsed)}</span>
              <span>上限：{getStorageLimitLabel()}</span>
              <span>{historyRootDir ? '后续新记录会落入当前目录' : '当前仍使用应用默认目录'}</span>
            </div>
            <div className="storage-limit-box">
              <label className="storage-limit-toggle">
                <input
                  type="checkbox"
                  checked={storageLimitEnabled}
                  disabled={storagePolicyPending}
                  onChange={event => setStorageLimitEnabledDraft(event.target.checked)}
                />
                <span>启用历史存储上限</span>
              </label>
              <div className="storage-limit-controls">
                <input
                  type="number"
                  min="1"
                  step="0.1"
                  value={storageLimitDraft}
                  disabled={!storageLimitEnabled || storagePolicyPending}
                  onChange={event => setStorageLimitDraft(event.target.value)}
                />
                <select
                  value={storageLimitUnit}
                  disabled={!storageLimitEnabled || storagePolicyPending}
                  onChange={event => setStorageLimitUnit(event.target.value as StorageLimitUnit)}
                >
                  <option value="GB">GB</option>
                  <option value="MB">MB</option>
                </select>
                <button
                  type="button"
                  disabled={storagePolicyPending || (storageLimitEnabled && !storageLimitBytes)}
                  onClick={() => void saveHistoryStoragePolicy()}
                >
                  {storagePolicyPending ? '保存中...' : '保存设置'}
                </button>
              </div>
              <div className="storage-limit-hint">
                {storageLimitEnabled
                  ? '超出上限后会自动清理最旧的未收藏记录，收藏记录默认保留。'
                  : '默认无限制，不会自动删除历史记录。'}
              </div>
            </div>
          </div>
        </section>

        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>外观主题</h2>
              <div className="panel-caption">深浅主题切换会立即同步到整个工作台。</div>
            </div>
          </div>
          <div className="theme-setting-card">
            <div className="theme-mode-label">
              <span className="theme-swatch current" />
              <div>
                <strong>{theme === 'dark' ? '深色主题' : '浅色主题'}</strong>
                <div className="small-note">当前主题用于整个桌面客户端视图。</div>
              </div>
            </div>
            <button type="button" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>
              切换主题
            </button>
          </div>
        </section>
      </div>
      </div>
    )
  }

  const isTauri = typeof window !== 'undefined'
    && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  const isMac = typeof navigator !== 'undefined'
    && /mac/i.test(navigator.userAgent)
    && !/iphone|ipad/i.test(navigator.userAgent)

  async function handleMinimize() {
    if (isTauri) await getCurrentWindow().minimize()
  }
  async function handleMaximize() {
    if (isTauri) await getCurrentWindow().toggleMaximize()
  }
  async function handleClose() {
    if (isTauri) await getCurrentWindow().close()
  }

  return (
    <>
      <div className="desktop-shell">
        <div className="titlebar">
          {isMac
            ? <div className="titlebar-mac-space" data-tauri-drag-region />
            : <div className="titlebar-drag-left" data-tauri-drag-region />}
          <div className="titlebar-center" data-tauri-drag-region>Image Generator</div>
          {!isMac
            ? (
                <div className="titlebar-controls">
                  <button className="titlebar-btn" type="button" onClick={() => void handleMinimize()}>&#x2014;</button>
                  <button className="titlebar-btn" type="button" onClick={() => void handleMaximize()}>&#x25A1;</button>
                  <button className="titlebar-btn close" type="button" onClick={() => void handleClose()}>&#x2715;</button>
                </div>
              )
            : null}
        </div>
        <aside className="shell-sidebar">
          <nav className="shell-nav">
            {navItems.map(item => (
              <button
                key={item.id}
                type="button"
                className={`shell-nav-item ${view === item.id ? 'active' : ''}`}
                title={item.label}
                onClick={() => setView(item.id)}
              >
                <span className="shell-nav-icon"><Icon name={item.icon} size={21} strokeWidth={1.7} /></span>
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <button
              className="theme-toggle-icon"
              type="button"
              title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
              onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
            >
              <Icon name={theme === 'dark' ? 'themeLight' : 'themeDark'} size={19} strokeWidth={1.8} />
            </button>
          </div>
        </aside>

        <main className="shell-main">
          <div className="view-header">
            <div>
              <div className="view-kicker">Image Generator</div>
              <h1>{viewTitle}</h1>
              <p>{viewDesc}</p>
            </div>
          </div>

          <div className="view-body">
            {view === 'workspace' ? renderWorkspaceView() : null}
            {view === 'upscale' ? renderStandaloneUpscaleView() : null}
            {view === 'history'
              ? (
                  <HistoryView
                    historyRecords={historyRecords}
                    historySearch={historySearch}
                    historyModelFilter={historyModelFilter}
                    historyFavoriteFilter={historyFavoriteFilter}
                    historyModeFilter={historyModeFilter}
                    storageUsed={storageUsed}
                    storagePolicy={historyStoragePolicy}
                    onHistorySearchChange={setHistorySearch}
                    onHistoryModelFilterChange={setHistoryModelFilter}
                    onHistoryFavoriteFilterChange={setHistoryFavoriteFilter}
                    onHistoryModeFilterChange={setHistoryModeFilter}
                    onClearHistory={clearHistory}
                    onRecallHistory={recallHistory}
                    onRemoveHistory={removeHistory}
                  onToggleFavorite={toggleHistoryFavorite}
                  favoritePendingIds={favoritePendingIds}
                  onShowToast={showToast}
                />
                )
              : null}
            {view === 'settings' ? renderSettingsView() : null}
          </div>
        </main>
      </div>

      {globalDropTarget
        ? (
            <div className={`global-drop-overlay ${globalDropTarget.status}`}>
              <div className="global-drop-panel">
                <div className="global-drop-icon">
                  <Icon name={globalDropTarget.status === 'ready' ? 'upload' : 'alert'} size={26} />
                </div>
                <strong>{globalDropTarget.title}</strong>
                <span>{globalDropTarget.hint}</span>
              </div>
            </div>
          )
        : null}

      {imageContextMenu
        ? (
            <div
              className="image-context-menu-backdrop"
              onClick={closeImageContextMenu}
              onContextMenu={(event) => {
                event.preventDefault()
                closeImageContextMenu()
              }}
            >
              <div
                className="image-context-menu"
                style={{ left: imageContextMenu.x, top: imageContextMenu.y }}
                onClick={event => event.stopPropagation()}
                onContextMenu={event => event.preventDefault()}
              >
                <button type="button" onClick={handleContextMenuSave}>
                  <span>图片另存为</span>
                </button>
                <button type="button" onClick={handleContextMenuCopy}>
                  <span>复制 Base64</span>
                </button>
              </div>
            </div>
          )
        : null}

      <div className={`img-modal ${previewImage ? 'active' : ''}`} onClick={closeImagePreview}>
        <button className="modal-close" type="button" onClick={closeImagePreview} aria-label="关闭预览">
          <Icon name="close" size={20} />
        </button>
        {previewImage
          ? (
              <div className="preview-dialog" onClick={event => event.stopPropagation()}>
                <div className="preview-toolbar">
                  <div>
                    <strong>{previewImage.title}</strong>
                    <span>
                      {previewImage.compare
                        ? previewImage.mode === 'compare'
                          ? `${previewImage.compare.beforeLabel} / ${previewImage.compare.afterLabel}`
                          : '单图预览'
                        : '单图预览'}
                    </span>
                  </div>
                  <div className="preview-actions">
                    {previewImage.compare
                      ? (
                          <div className="preview-mode-row">
                            <button
                              className={`chip ${previewImage.mode === 'single' ? 'active' : ''}`}
                              type="button"
                              onClick={() => setPreviewImage(current => current ? { ...current, mode: 'single', zoom: current.fitZoom, offsetX: 0, offsetY: 0 } : current)}
                            >
                              单图
                            </button>
                            <button
                              className={`chip ${previewImage.mode === 'compare' ? 'active' : ''}`}
                              type="button"
                              onClick={() => setPreviewImage(current => current ? { ...current, mode: 'compare', zoom: current.fitZoom, offsetX: 0, offsetY: 0 } : current)}
                            >
                              对比
                            </button>
                          </div>
                        )
                      : null}
                    {previewImage.mode === 'single'
                      ? (
                          <>
                            {previewImage.compare
                              ? (
                                  <div className="preview-side-row">
                                    <button
                                      className={previewImage.singleSide === 'before' ? 'active' : ''}
                                      type="button"
                                      onClick={() => selectSinglePreviewSide('before')}
                                    >
                                      {previewImage.compare.beforeLabel}
                                    </button>
                                    <button
                                      className={previewImage.singleSide === 'after' ? 'active' : ''}
                                      type="button"
                                      onClick={() => selectSinglePreviewSide('after')}
                                    >
                                      {previewImage.compare.afterLabel}
                                    </button>
                                  </div>
                                )
                              : null}
                            <div className="preview-zoom-row">
                              <button type="button" onClick={() => stepSinglePreviewZoom(-1)} disabled={previewImage.zoom <= 0.01}>-</button>
                              <span>{Math.round(previewImage.zoom * 100)}%</span>
                              <button type="button" onClick={() => stepSinglePreviewZoom(1)} disabled={previewImage.zoom >= 6}>+</button>
                              <button type="button" onClick={resetSinglePreviewTransform}>适应</button>
                            </div>
                          </>
                        )
                      : null}
                  </div>
                </div>

                <div className="preview-stage">
                  {previewImage.compare && previewImage.mode === 'compare'
                    ? (
                        <div
                          className="compare-view"
                          onDoubleClick={resetPreviewSplit}
                          onPointerDown={handlePreviewPointerDown}
                          onPointerMove={handlePreviewPointerMove}
                          onPointerUp={handlePreviewPointerUp}
                          onPointerCancel={handlePreviewPointerUp}
                        >
                          <img
                            className="compare-img"
                            src={previewImage.compare.before}
                            alt={previewImage.compare.beforeLabel}
                            draggable={false}
                            onLoad={event => handleSinglePreviewImageLoad(event, 'before')}
                          />
                          <img
                            className="compare-img compare-after"
                            src={previewImage.compare.after}
                            alt={previewImage.compare.afterLabel}
                            draggable={false}
                            onLoad={event => handleSinglePreviewImageLoad(event, 'after')}
                            style={{ clipPath: `inset(0 0 0 ${previewImage.split}%)` }}
                          />
                          <div className="compare-label compare-label-before">{previewImage.compare.beforeLabel}</div>
                          <div className="compare-label compare-label-after">{previewImage.compare.afterLabel}</div>
                          <div className="compare-divider" style={{ left: `${previewImage.split}%` }}>
                            <span />
                          </div>
                        </div>
                      )
                    : (
                        <div
                          className={`single-preview-view ${Math.abs(previewImage.zoom - previewImage.fitZoom) >= 0.001 ? 'is-zoomed' : ''}`}
                          onWheel={handleSinglePreviewWheel}
                          onPointerDown={handleSinglePreviewPointerDown}
                          onPointerMove={handleSinglePreviewPointerMove}
                          onPointerUp={handleSinglePreviewPointerUp}
                          onPointerCancel={handleSinglePreviewPointerUp}
                          onDoubleClick={resetSinglePreviewTransform}
                        >
                          {previewImage.compare
                            ? (
                                <>
                                  <img
                                    className={`preview-single-img ${previewImage.singleSide === 'before' ? 'active' : ''}`}
                                    src={previewImage.compare.before}
                                    alt={previewImage.compare.beforeLabel}
                                    draggable={false}
                                    onLoad={event => handleSinglePreviewImageLoad(event, 'before')}
                                    style={{
                                      transform: `translate(-50%, -50%) translate(${previewImage.singleSide === 'before' ? previewImage.offsetX : 0}px, ${previewImage.singleSide === 'before' ? previewImage.offsetY : 0}px) scale(${previewImage.singleSide === 'before' ? previewImage.zoom : previewImage.sideFitZooms.before || previewImage.fitZoom})`,
                                    }}
                                  />
                                  <img
                                    className={`preview-single-img ${previewImage.singleSide === 'after' ? 'active' : ''}`}
                                    src={previewImage.compare.after}
                                    alt={previewImage.compare.afterLabel}
                                    draggable={false}
                                    onLoad={event => handleSinglePreviewImageLoad(event, 'after')}
                                    style={{
                                      transform: `translate(-50%, -50%) translate(${previewImage.singleSide === 'after' ? previewImage.offsetX : 0}px, ${previewImage.singleSide === 'after' ? previewImage.offsetY : 0}px) scale(${previewImage.singleSide === 'after' ? previewImage.zoom : previewImage.sideFitZooms.after || previewImage.fitZoom})`,
                                    }}
                                  />
                                </>
                              )
                            : (
                                <img
                                  className="preview-single-img active"
                                  src={previewImage.image}
                                  alt="预览"
                                  draggable={false}
                                  onLoad={handleSinglePreviewImageLoad}
                                  style={{
                                    transform: `translate(-50%, -50%) translate(${previewImage.offsetX}px, ${previewImage.offsetY}px) scale(${previewImage.zoom})`,
                                  }}
                                />
                              )}
                        </div>
                      )}
                </div>
              </div>
            )
          : null}
      </div>

      {providerModalOpen && (
        <div className="provider-modal-overlay" onClick={closeProviderModal}>
          <div className="provider-modal-dialog" onClick={event => event.stopPropagation()}>
            <div className="provider-modal-header">
              <h3>{providerModalMode === 'create' ? '新增供应商' : '编辑供应商'}</h3>
              <button className="provider-modal-close" type="button" onClick={closeProviderModal} aria-label="关闭弹窗">
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="provider-modal-body">
              <div className="row">
                <div>
                  <label htmlFor="modalProviderName">供应商名称</label>
                  <input
                    id="modalProviderName"
                    value={providerDraft.name}
                    placeholder="例如：供应商 A"
                    autoFocus
                    onChange={event => updateProviderDraft('name', event.target.value)}
                  />
                </div>
              </div>
              <div className="row">
                <div>
                  <label htmlFor="modalApiUrl">API URL</label>
                  <input
                    id="modalApiUrl"
                    className={testConnStatus === 'err' ? 'input-error' : ''}
                    value={providerDraft.apiUrl}
                    placeholder="https://your-api.com"
                    onChange={event => updateProviderDraft('apiUrl', event.target.value)}
                  />
                </div>
              </div>
              <div className="row">
                <div>
                  <label htmlFor="modalApiKey">API Key</label>
                  <div className="key-input-wrap">
                    <input
                      id="modalApiKey"
                      type={keyVisible ? 'text' : 'password'}
                      value={providerDraft.apiKey}
                      placeholder="sk-xxxxx（可选）"
                      onChange={event => updateProviderDraft('apiKey', event.target.value)}
                    />
                    <button
                      type="button"
                      className="key-eye-btn"
                      tabIndex={-1}
                      title={keyVisible ? '隐藏密钥' : '显示密钥'}
                      onClick={() => setKeyVisible(v => !v)}
                    >
                      <VisibilityIcon hidden={keyVisible} />
                    </button>
                  </div>
                </div>
              </div>
              <div className="test-conn-row">
                <button
                  type="button"
                  className={`test-conn-btn secondary${testConnStatus === 'ok' ? ' test-conn-ok' : ''}`}
                  disabled={testConnStatus === 'loading'}
                  onClick={() => void testConnection()}
                >
                  {testConnStatus === 'loading' && <span className="btn-spinner test-conn-spinner" />}
                  {testConnStatus === 'ok'
                    ? (
                        <>
                          <Icon name="check" size={15} />
                          连接成功
                        </>
                      )
                    : '测试连接'}
                </button>
              </div>
              {testConnStatus === 'err' && testConnMessage
                ? <div className="test-conn-error">{testConnMessage}</div>
                : null}
              {renderStatus(connStatus)}
            </div>
            <div className="provider-modal-footer">
              {autoSaveHint
                ? (
                    <span className="autosave-hint">
                      <Icon name="check" size={14} />
                      已自动保存
                    </span>
                  )
                : null}
              <button className="secondary" type="button" onClick={closeProviderModal}>取消</button>
              <button type="button" onClick={handleSaveProviderModal}>保存</button>
            </div>
          </div>
        </div>
      )}

      {upscaleModalOpen && (
        <div className="provider-modal-overlay" onClick={closeUpscaleModal}>
          <div className="provider-modal-dialog" onClick={event => event.stopPropagation()}>
            <div className="provider-modal-header">
              <h3>{upscaleModalMode === 'create' ? '新增超分服务' : '编辑超分服务'}</h3>
              <button className="provider-modal-close" type="button" onClick={closeUpscaleModal} aria-label="关闭弹窗">
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="provider-modal-body">
              <div className="row">
                <div>
                  <label htmlFor="modalUpscaleName">服务名称</label>
                  <input
                    id="modalUpscaleName"
                    value={upscaleProviderDraft.name}
                    placeholder="例如：阿里云主账号"
                    autoFocus
                    onChange={event => updateUpscaleProviderDraft('name', event.target.value)}
                  />
                </div>
              </div>

              <div className="row">
                <div>
                  <label>服务类型</label>
                  <div className="upscale-provider-tabs">
                    <button
                      type="button"
                      className={`chip ${upscaleProviderDraft.provider === 'aliyun' ? 'active' : ''}`}
                      disabled={!isDesktopApp()}
                      title={!isDesktopApp() ? '阿里云超分仅桌面端可用' : ''}
                      onClick={() => updateUpscaleProviderDraft('provider', 'aliyun')}
                    >
                      阿里云
                    </button>
                    <button
                      type="button"
                      className={`chip ${upscaleProviderDraft.provider === 'custom' ? 'active' : ''}`}
                      onClick={() => updateUpscaleProviderDraft('provider', 'custom')}
                    >
                      自定义
                    </button>
                  </div>
                </div>
              </div>

              {upscaleProviderDraft.provider === 'aliyun'
                ? (
                    <>
                      <div className="row">
                        <div>
                          <label htmlFor="modalAliyunKeyId">AccessKey ID</label>
                          <input
                            id="modalAliyunKeyId"
                            value={upscaleProviderDraft.accessKeyId}
                            placeholder="填入 AccessKey ID"
                            onChange={event => updateUpscaleProviderDraft('accessKeyId', event.target.value)}
                          />
                        </div>
                      </div>
                      <div className="row">
                        <div>
                          <label htmlFor="modalAliyunKeySecret">AccessKey Secret</label>
                          <div className="key-input-wrap">
                            <input
                              id="modalAliyunKeySecret"
                              type={upscaleKeyVisible ? 'text' : 'password'}
                              value={upscaleProviderDraft.accessKeySecret}
                              placeholder="填入 AccessKey Secret"
                              onChange={event => updateUpscaleProviderDraft('accessKeySecret', event.target.value)}
                            />
                            <button
                              type="button"
                              className="key-eye-btn"
                              onClick={() => setUpscaleKeyVisible(v => !v)}
                              title={upscaleKeyVisible ? '隐藏密钥' : '显示密钥'}
                            >
                              <VisibilityIcon hidden={upscaleKeyVisible} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )
                : (
                    <>
                      <div className="row">
                        <div>
                          <label htmlFor="modalUpscaleUrl">服务地址</label>
                          <input
                            id="modalUpscaleUrl"
                            value={upscaleProviderDraft.apiUrl}
                            placeholder="https://your-upscale.com/upscale"
                            onChange={event => updateUpscaleProviderDraft('apiUrl', event.target.value)}
                          />
                        </div>
                      </div>
                      <div className="row">
                        <div>
                          <label htmlFor="modalUpscaleKey">访问密钥</label>
                          <div className="key-input-wrap">
                            <input
                              id="modalUpscaleKey"
                              type={upscaleKeyVisible ? 'text' : 'password'}
                              value={upscaleProviderDraft.apiKey}
                              placeholder="可选"
                              onChange={event => updateUpscaleProviderDraft('apiKey', event.target.value)}
                            />
                            <button
                              type="button"
                              className="key-eye-btn"
                              onClick={() => setUpscaleKeyVisible(v => !v)}
                              title={upscaleKeyVisible ? '隐藏密钥' : '显示密钥'}
                            >
                              <VisibilityIcon hidden={upscaleKeyVisible} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

              {renderStatus(connStatus)}
            </div>
            <div className="provider-modal-footer">
              <button className="secondary" type="button" onClick={closeUpscaleModal}>取消</button>
              <button type="button" onClick={handleSaveUpscaleProviderModal}>保存</button>
            </div>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? `show ${toast.type}` : ''}`}>{toast?.message}</div>
    </>
  )
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value))
    return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function parseDimensionDraft(value: string, shouldClamp = false) {
  const text = value.trim()
  if (!/^\d+$/.test(text))
    return null
  const numericValue = Number(text)
  if (!Number.isFinite(numericValue))
    return null
  if (shouldClamp)
    return clampInteger(numericValue, TARGET_SIZE_MIN, TARGET_SIZE_MAX)
  if (numericValue < TARGET_SIZE_MIN || numericValue > TARGET_SIZE_MAX)
    return null
  return Math.round(numericValue)
}

function alignDown(value: number, step: number) {
  return Math.max(step, Math.floor(value / step) * step)
}

function parseRatio(text: string) {
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(text.trim())
  if (!match)
    return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return null
  return { width, height }
}

function getHeightByRatio(width: number, ratio: { width: number; height: number }) {
  return clampInteger((width * ratio.height) / ratio.width, TARGET_SIZE_MIN, TARGET_SIZE_MAX)
}

function getWidthByRatio(height: number, ratio: { width: number; height: number }) {
  return clampInteger((height * ratio.width) / ratio.height, TARGET_SIZE_MIN, TARGET_SIZE_MAX)
}

function normalizeRatioSizeFromWidth(width: number, ratio: { width: number; height: number }) {
  const rawHeight = (width * ratio.height) / ratio.width
  if (rawHeight > TARGET_SIZE_MAX) {
    const height = TARGET_SIZE_MAX
    return { width: getWidthByRatio(height, ratio), height }
  }
  if (rawHeight < TARGET_SIZE_MIN) {
    const height = TARGET_SIZE_MIN
    return { width: getWidthByRatio(height, ratio), height }
  }
  return { width, height: Math.round(rawHeight) }
}

function normalizeRatioSizeFromHeight(height: number, ratio: { width: number; height: number }) {
  const rawWidth = (height * ratio.width) / ratio.height
  if (rawWidth > TARGET_SIZE_MAX) {
    const width = TARGET_SIZE_MAX
    return { width, height: getHeightByRatio(width, ratio) }
  }
  if (rawWidth < TARGET_SIZE_MIN) {
    const width = TARGET_SIZE_MIN
    return { width, height: getHeightByRatio(width, ratio) }
  }
  return { width: Math.round(rawWidth), height }
}

function getGreatestCommonDivisor(left: number, right: number): number {
  const normalizedLeft = Math.abs(Math.round(left))
  const normalizedRight = Math.abs(Math.round(right))
  if (!normalizedRight)
    return normalizedLeft || 1
  return getGreatestCommonDivisor(normalizedRight, normalizedLeft % normalizedRight)
}

function formatRatioFromSize(width: number, height: number) {
  const divisor = getGreatestCommonDivisor(width, height)
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}

function chooseUpscaleFactor(requiredScale: number): UpscaleFactor | null {
  if (requiredScale <= 1)
    return 1
  if (requiredScale <= 2)
    return 2
  if (requiredScale <= 3)
    return 3
  if (requiredScale <= 4)
    return 4
  return null
}

function createSizePlan(size: TargetSizeState): SizePlanResult {
  const targetWidth = clampInteger(size.targetWidth, TARGET_SIZE_MIN, TARGET_SIZE_MAX)
  let targetHeight = clampInteger(size.targetHeight, TARGET_SIZE_MIN, TARGET_SIZE_MAX)

  if (size.mode === 'ratio') {
    const ratio = parseRatio(size.ratioText)
    if (!ratio)
      return { plan: null, error: '请输入有效比例，例如 16:9' }
    targetHeight = getHeightByRatio(targetWidth, ratio)
  }

  const targetArea = targetWidth * targetHeight
  if (targetArea <= GENERATION_MAX_AREA) {
    return {
      plan: {
        targetWidth,
        targetHeight,
        generationWidth: targetWidth,
        generationHeight: targetHeight,
        requestSize: `${targetWidth}x${targetHeight}`,
        needsUpscale: false,
        autoUpscaleFactor: null,
        canAutoUpscale: true,
        requiredScale: 1,
      },
      error: null,
    }
  }

  const scale = Math.sqrt(GENERATION_MAX_AREA / targetArea)
  let generationWidth = Math.max(TARGET_SIZE_MIN, alignDown(targetWidth * scale, SIZE_ALIGN))
  let generationHeight = Math.max(TARGET_SIZE_MIN, alignDown(targetHeight * scale, SIZE_ALIGN))
  while (generationWidth * generationHeight > GENERATION_MAX_AREA) {
    if (generationWidth >= generationHeight)
      generationWidth = Math.max(TARGET_SIZE_MIN, generationWidth - SIZE_ALIGN)
    else
      generationHeight = Math.max(TARGET_SIZE_MIN, generationHeight - SIZE_ALIGN)
  }

  const requiredScale = Math.max(targetWidth / generationWidth, targetHeight / generationHeight)
  const factor = chooseUpscaleFactor(requiredScale)

  return {
    plan: {
      targetWidth,
      targetHeight,
      generationWidth,
      generationHeight,
      requestSize: `${generationWidth}x${generationHeight}`,
      needsUpscale: true,
      autoUpscaleFactor: factor && factor > 1 ? factor : null,
      canAutoUpscale: factor !== null,
      requiredScale,
    },
    error: null,
  }
}

function makeTargetSizeFromPreset(size: string): TargetSizeState {
  const parsedSize = parseSize(size)
  if (parsedSize) {
    return {
      mode: 'manual',
      ratioText: formatRatioFromSize(parsedSize.width, parsedSize.height),
      targetWidth: parsedSize.width,
      targetHeight: parsedSize.height,
      autoUpscale: false,
    }
  }

  const ratio = parseRatio(size)
  if (ratio) {
    return {
      mode: 'ratio',
      ratioText: size,
      targetWidth: 1024,
      targetHeight: getHeightByRatio(1024, ratio),
      autoUpscale: false,
    }
  }

  return defaultTargetSize
}

function makeTargetSizeFromParams(params: RequestParams): TargetSizeState {
  if (params.targetWidth && params.targetHeight) {
    return {
      mode: params.targetSizeMode === 'manual' ? 'manual' : 'ratio',
      ratioText: params.targetRatio || formatRatioFromSize(params.targetWidth, params.targetHeight),
      targetWidth: params.targetWidth,
      targetHeight: params.targetHeight,
      autoUpscale: !!params.autoUpscale,
    }
  }

  return makeTargetSizeFromPreset(params.size || '')
}

function formatImageDimensions(dimensions: ImageDimensions) {
  return `${dimensions.width} × ${dimensions.height}px`
}

function getUpscalePreviewText(dimensions: ImageDimensions | null, factor: UpscaleFactor, hasVariant: boolean) {
  if (!dimensions)
    return factor > 1 ? '预计输出：等待原图尺寸' : '原图尺寸：计算中'

  if (factor === 1)
    return `原图尺寸：${formatImageDimensions(dimensions)}`

  const target = {
    width: Math.round(dimensions.width * factor),
    height: Math.round(dimensions.height * factor),
  }
  return `${hasVariant ? '已生成' : '预计输出'}：${formatImageDimensions(target)}`
}

// imageSizes 存的是 "1024 × 768px" 格式，与 parseSize 解析的 "1024x768" 不同
function parseImageSize(text: string | undefined) {
  const match = /^(\d+)\s*×\s*(\d+)/.exec(text || '')
  if (!match)
    return null
  return { width: Number(match[1]), height: Number(match[2]) }
}

function readBase64ImageSize(imageBase64: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('图片尺寸读取失败'))
    image.src = `data:image/png;base64,${imageBase64}`
  })
}

function readImageFileSize(file: File) {
  return new Promise<ImageDimensions>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片尺寸读取失败'))
    }
    image.src = url
  })
}

function normalizeStandaloneFactor(value: number | undefined): StandaloneUpscaleFactor {
  return value === 3 || value === 4 ? value : 2
}

function getBase64ByteLength(imageBase64: string) {
  const normalized = imageBase64.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.floor((normalized.length * 3) / 4) - padding
}

function detectImageFormat(imageBase64: string) {
  const header = atob(imageBase64.slice(0, 32))
  const bytes = Array.from(header, char => char.charCodeAt(0))
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47)
    return 'PNG'
  if (bytes[0] === 0xFF && bytes[1] === 0xD8)
    return 'JPEG'
  if (bytes[0] === 0x42 && bytes[1] === 0x4D)
    return 'BMP'
  return ''
}

async function validateAliyunUpscaleInput(imageBase64: string) {
  const byteLength = getBase64ByteLength(imageBase64)
  if (byteLength > ALIYUN_UPSCALE_MAX_BYTES)
    throw new Error(`阿里云生成式超分输入图片不能超过 ${formatSize(ALIYUN_UPSCALE_MAX_BYTES)}`)

  const format = detectImageFormat(imageBase64)
  if (!format)
    throw new Error('阿里云生成式超分仅支持 JPEG、JPG、PNG、BMP 图片')

  const dims = await readBase64ImageSize(imageBase64)
  const shortSide = Math.min(dims.width, dims.height)
  const longSide = Math.max(dims.width, dims.height)
  if (shortSide < ALIYUN_UPSCALE_MIN_SIDE)
    throw new Error(`阿里云生成式超分输入图片最小边不能低于 ${ALIYUN_UPSCALE_MIN_SIDE}px`)
  if (longSide > ALIYUN_UPSCALE_MAX_LONG_SIDE)
    throw new Error(`阿里云生成式超分输入图片长边不能超过 ${ALIYUN_UPSCALE_MAX_LONG_SIDE}px`)
  if (longSide / shortSide > ALIYUN_UPSCALE_MAX_ASPECT_RATIO)
    throw new Error(`阿里云生成式超分输入图片长宽比不能超过 ${ALIYUN_UPSCALE_MAX_ASPECT_RATIO}:1`)

  return dims
}

function makeEmptyUpscaleProvider(provider: UpscaleProvider = 'aliyun'): UpscaleProviderConfig {
  return {
    id: '',
    name: '',
    provider,
    accessKeyId: '',
    accessKeySecret: '',
    apiUrl: '',
    apiKey: '',
  }
}

function getUpscaleProviderTypeLabel(provider: UpscaleProvider) {
  return provider === 'aliyun' ? '阿里云' : '自定义'
}

function getUpscaleProviderSummary(provider: UpscaleProviderConfig) {
  if (provider.provider === 'aliyun')
    return provider.accessKeyId ? `AccessKey ID：${maskValue(provider.accessKeyId)}` : '未填写 AccessKey ID'
  return provider.apiUrl || '未填写服务地址'
}

function maskValue(value: string) {
  if (value.length <= 8)
    return value ? '••••' : ''
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}

function VisibilityIcon({ hidden }: { hidden: boolean }) {
  if (hidden) {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    )
  }

  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function parseSize(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size)
  if (!match)
    return null
  const width = Number(match[1])
  const height = Number(match[2])
  return {
    width,
    height,
    area: width * height,
    ratio: width / height,
  }
}

function getSortedSizes(sizes: string[]) {
  return [...sizes].sort((left, right) => {
    const leftParsed = parseSize(left)
    const rightParsed = parseSize(right)
    if (!leftParsed || !rightParsed)
      return left.localeCompare(right)
    if (leftParsed.area !== rightParsed.area)
      return leftParsed.area - rightParsed.area
    if (leftParsed.width !== rightParsed.width)
      return leftParsed.width - rightParsed.width
    return leftParsed.height - rightParsed.height
  })
}
