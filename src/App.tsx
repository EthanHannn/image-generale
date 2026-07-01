import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { HistoryView } from './features/history/HistoryView'
import { hydrateModels, type ModelPreset, type RemoteModel } from './lib/models'
import {
  MAX_STORAGE,
  addRecord,
  clearAllRecords,
  deleteRecord,
  enforceStorageLimit,
  getAllRecords,
  getRecord,
  getTotalSize,
  loadAppConfig,
  loadConfig,
  loadUpscaleConfig,
  makeProviderId,
  normalizeBaseUrl,
  openHistoryDirectory,
  saveAppConfig,
  selectHistoryDirectory,
  THEME_KEY,
  type HistoryRecord,
  type ProviderConfig,
  type RequestParams,
  type ThemeName,
  type UpscaleConfig,
} from './lib/storage'
import { upscaleImage } from './lib/upscale'
import { base64ToBlob, blobToBase64, downloadBlob, formatSize, sanitizeFilename } from './lib/utils'

type StatusType = 'ok' | 'err' | 'loading' | 'warn'
type StatusValue = { type: StatusType; message: string } | null
type ToastValue = { type: 'success' | 'error'; message: string } | null
type ResultImage = { b64_json?: string; url?: string }
type ResultPayload = { data?: ResultImage[]; error?: { message?: string } | string }
type ViewName = 'workspace' | 'history' | 'settings'
type SizeFilter = 'all' | 'square' | 'landscape' | 'portrait' | 'ultrawide'

const emptyParams: RequestParams = {
  n: 1,
  size: '',
  quality: 'auto',
  autoPrompt: 'false',
  translate: 'false',
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
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const modalDirtyRef = useRef(false)

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
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>('all')
  const [refFiles, setRefFiles] = useState<File[]>([])
  const [requestJson, setRequestJson] = useState('无')
  const [resultTimer, setResultTimer] = useState('')
  const [results, setResults] = useState<ResultImage[]>([])
  const [loadingCount, setLoadingCount] = useState(0)
  const [isGenerating, setIsGenerating] = useState(false)
  const [imageSizes, setImageSizes] = useState<Record<number, string>>({})
  const [downloadedIndex, setDownloadedIndex] = useState<number | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [previewImage, setPreviewImage] = useState('')

  const [upscaleConfig, setUpscaleConfig] = useState<UpscaleConfig>(loadUpscaleConfig)
  const [upscaleFactor, setUpscaleFactor] = useState<2 | 4>(2)
  const [upscalingIndex, setUpscalingIndex] = useState<number | null>(null)

  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([])
  const [historySearch, setHistorySearch] = useState('')
  const [historyModelFilter, setHistoryModelFilter] = useState('')
  const [storageUsed, setStorageUsed] = useState(0)
  const [historyRootDir, setHistoryRootDir] = useState('')
  const [historyDirPending, setHistoryDirPending] = useState(false)

  const [providerModalOpen, setProviderModalOpen] = useState(false)
  const [providerModalMode, setProviderModalMode] = useState<'create' | 'edit'>('create')
  const [keyVisible, setKeyVisible] = useState(false)
  const [testConnStatus, setTestConnStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [testConnMessage, setTestConnMessage] = useState('')
  const [autoSaveHint, setAutoSaveHint] = useState(false)

  const currentProvider = providers.find(provider => provider.id === currentProviderId) || null
  const currentModel = models.find(model => model.id === currentModelId) || null
  const sizeOptions = getSortedSizes(currentModel?.supportedSizes || [])
  const resolutionOptions = currentModel?.supportedResolutions || []
  const filteredSizeOptions = sizeOptions.filter(size => matchSizeFilter(size, sizeFilter))

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
      setUpscaleConfig(snapshot.upscaleConfig)
      setTheme(snapshot.theme)
      setHistoryRootDir(snapshot.historyRootDir)
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
      upscaleConfig,
      theme,
      historyRootDir,
    })
  }, [configReady, providers, currentProviderId, upscaleConfig, theme, historyRootDir])

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
      if (event.key === 'Escape')
        setPreviewImage('')
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

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
    setSizeFilter('all')
    setGenStatus(null)
  }

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    if (toastTimerRef.current)
      window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500)
  }

  function cancelGeneration() {
    abortControllerRef.current?.abort()
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
      setConnStatus({ type: 'err', message: `拉取失败: ${(error as Error).message}` })
      showToast(`拉取模型失败: ${(error as Error).message}`, 'error')
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
      setTestConnStatus('err')
      setTestConnMessage(`连接失败: ${(error as Error).message}`)
    }
  }

  function selectModel(modelId: string, sourceModels = models) {
    const model = sourceModels.find(item => item.id === modelId)
    if (!model)
      return

    setCurrentModelId(model.id)
    setSizeFilter('all')
    const sizes = model.supportedSizes || []
    const sortedSizes = getSortedSizes(sizes)
    const resolutions = model.supportedResolutions || []
    setParams(current => ({
      ...current,
      n: Math.min(current.n || 1, model.maxGenerations || 1),
      size: model.defaultSize || sortedSizes[0] || '',
      resolution: model.hasResolution && resolutions.length ? (model.defaultResolution || resolutions[0] || '') : undefined,
    }))
  }

  function onFileChange(files: FileList | null) {
    setRefFiles(files ? Array.from(files) : [])
  }

  function handleSizeFilterChange(nextFilter: SizeFilter) {
    setSizeFilter(nextFilter)
    const nextSizes = sizeOptions.filter(size => matchSizeFilter(size, nextFilter))
    const fallbackSize = nextSizes[0] || currentModel?.defaultSize || ''
    setParams(current => ({
      ...current,
      size: nextSizes.includes(current.size) ? current.size : fallbackSize,
    }))
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
    setImageSizes({})
    setCopiedIndex(null)
    setDownloadedIndex(null)
    setResultTimer('')
    const startAt = Date.now()
    timerRef.current = window.setInterval(() => {
      setResultTimer(`⏱ ${((Date.now() - startAt) / 1000).toFixed(1)}s`)
    }, 100)

    try {
      let response: Response
      let nextRequestJson = ''
      if (mode === 'gen') {
        const body: Record<string, unknown> = {
          prompt: prompt.trim(),
          model: currentModel.id,
          n: Math.min(params.n || 1, currentModel.maxGenerations),
          size: params.size,
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
        formData.append('size', params.size)
        formData.append('quality', params.quality)
        formData.append('autoPrompt', params.autoPrompt)
        formData.append('translate', params.translate)
        if (currentModel.hasResolution && params.resolution)
          formData.append('resolution', params.resolution)

        nextRequestJson = `[multipart] prompt=${prompt.trim()} model=${currentModel.id} refImages=${useRefFiles.length} size=${params.size}`
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
      setResultTimer(`⏱ ${duration}s`)
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
        return
      }

      const nextResults = payload.data || []
      setResults(nextResults)
      setGenStatus({ type: 'ok', message: `成功生成 ${nextResults.length} 张，用时 ${duration}s` })
      showToast(`生成成功：${nextResults.length} 张图片`, 'success')
      await saveHistory(nextResults, duration, nextRequestJson)
    }
    catch (error) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      setLoadingCount(0)
      setResults([])
      if ((error as Error).name === 'AbortError') {
        setGenStatus({ type: 'warn', message: '已取消生成' })
      }
      else {
        setGenStatus({ type: 'err', message: `请求失败: ${(error as Error).message}` })
        showToast(`请求失败: ${(error as Error).message}`, 'error')
      }
    }
    finally {
      setIsGenerating(false)
      abortControllerRef.current = null
    }
  }

  async function saveHistory(nextResults: ResultImage[], duration: string, nextRequestJson: string) {
    if (!currentProvider || !currentModel || !nextResults.length)
      return

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
      return

    const nextParams: RequestParams = {
      n: params.n,
      size: params.size,
      quality: params.quality,
      autoPrompt: params.autoPrompt,
      translate: params.translate,
      resolution: currentModel.hasResolution ? params.resolution : undefined,
    }

    await addRecord({
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
    })

    await enforceStorageLimit()
    await refreshHistory()
  }

  async function handleDownload(index: number) {
    const image = results[index]
    if (!image?.b64_json) {
      showToast('无图片数据可下载', 'error')
      return
    }
    const filename = `${currentModel?.id || 'image'}_${sanitizeFilename(prompt.trim())}_${index + 1}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`
    downloadBlob(base64ToBlob(image.b64_json), filename)
    setDownloadedIndex(index)
    window.setTimeout(() => setDownloadedIndex(current => current === index ? null : current), 2000)
    showToast(`图片已下载：${filename}`, 'success')
  }

  async function handleCopy(index: number) {
    const image = results[index]
    if (!image?.b64_json) {
      showToast('无数据可复制', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(`data:image/png;base64,${image.b64_json}`)
      setCopiedIndex(index)
      window.setTimeout(() => setCopiedIndex(current => current === index ? null : current), 2000)
      showToast('Base64 已复制到剪贴板', 'success')
    }
    catch (error) {
      showToast(`复制失败: ${(error as Error).message}`, 'error')
    }
  }

  async function handleUpscale(index: number) {
    const image = results[index]
    if (!image?.b64_json) {
      showToast('该图片无 base64 数据，无法放大', 'error')
      return
    }
    if (!normalizeBaseUrl(upscaleConfig.apiUrl)) {
      showToast('请先配置放大服务', 'error')
      return
    }

    const dims = parseImageSize(imageSizes[index])
    if (!dims) {
      showToast('图片尺寸尚未就绪，请稍候再试', 'error')
      return
    }

    const targetWidth = Math.round(dims.width * upscaleFactor)
    const targetHeight = Math.round(dims.height * upscaleFactor)

    setUpscalingIndex(index)
    try {
      const out = await upscaleImage(upscaleConfig, image.b64_json, targetWidth, targetHeight)
      setResults(current => current.map((item, currentIndex) => currentIndex === index ? { b64_json: out.imageBase64 } : item))
      setImageSizes(current => ({ ...current, [index]: `${out.width} × ${out.height}px` }))
      showToast(`已放大至 ${out.width} × ${out.height}`, 'success')
    }
    catch (error) {
      showToast(`放大失败: ${(error as Error).message}`, 'error')
    }
    finally {
      setUpscalingIndex(null)
    }
  }

  async function recallHistory(recordId: number) {
    const record = await getRecord(recordId)
    if (!record) {
      showToast('记录不存在', 'error')
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
    setRequestJson(record.requestJson || '无')

    if (models.some(model => model.id === record.modelId))
      selectModel(record.modelId)

    const restored: ResultImage[] = []
    for (const blob of record.images || [])
      restored.push({ b64_json: await blobToBase64(blob) })
    setResults(restored)
    setView('workspace')
    showToast('已恢复历史记录', 'success')
    if (record.mode === 'edit')
      window.setTimeout(() => showToast('图生图参考图未保存，请重新上传', 'error'), 1200)
  }

  async function removeHistory(recordId: number) {
    await deleteRecord(recordId)
    await refreshHistory()
    showToast('已删除该记录', 'success')
  }

  async function clearHistory() {
    if (!historyRecords.length) {
      showToast('没有可清空的记录', 'error')
      return
    }
    if (!window.confirm(`确定要清空全部 ${historyRecords.length} 条历史记录吗？此操作不可撤销。`))
      return
    await clearAllRecords()
    await refreshHistory()
    showToast('已清空全部历史记录', 'success')
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
      showToast(`设置目录失败: ${(error as Error).message}`, 'error')
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
      showToast(`打开目录失败: ${(error as Error).message}`, 'error')
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

  const navItems: Array<{ id: ViewName; label: string; icon: string; hint: string }> = [
    { id: 'workspace', label: '工作台', icon: '◈', hint: '生成与结果' },
    { id: 'history', label: '历史记录', icon: '◎', hint: '资产浏览' },
    { id: 'settings', label: '设置', icon: '◌', hint: '系统与配置' },
  ]
  const viewTitle = view === 'workspace' ? '工作台' : view === 'history' ? '历史记录' : '设置'
  const viewDesc = view === 'workspace'
    ? '围绕当前供应商与模型完成图片生成和结果处理。'
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
                      <div className="empty-icon">📦</div>
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
                              <span className="tag">📝 {model.maxGenerations}张/次</span>
                              <span className="tag">📎 {model.maxInputImages}张参考图</span>
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
                ✨ 文生图
              </label>
              <label className={mode === 'edit' ? 'active' : ''}>
                <input type="radio" checked={mode === 'edit'} onChange={() => setMode('edit')} />
                🖼 图生图
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
                      <div className="upload-icon">📎</div>
                      <div className="upload-text">点击上传参考图</div>
                      <div className="upload-hint">支持多选 · JPG / PNG / WebP</div>
                    </button>
                    <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={event => onFileChange(event.target.files)} />
                    <div className="ref-preview">
                      {refFiles.map((file, index) => (
                        <div key={`${file.name}_${index}`} className="ref-item">
                          <img src={URL.createObjectURL(file)} alt={file.name} />
                          <button className="ref-remove" type="button" onClick={() => removeRefFile(index)}>✕</button>
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
                  value={prompt}
                  placeholder="输入你想生成的画面描述，Ctrl + Enter 可直接提交"
                  onChange={event => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.ctrlKey && event.key === 'Enter')
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
                <label htmlFor="sizeSelect">尺寸 <span className="muted">{currentModel?.sizeFormat ? `(${currentModel.sizeFormat})` : ''}</span></label>
                <select id="sizeSelect" value={params.size} onChange={event => setParams(current => ({ ...current, size: event.target.value }))}>
                  {filteredSizeOptions.length
                    ? filteredSizeOptions.map(size => <option key={size} value={size}>{size}</option>)
                    : <option value="">默认</option>}
                </select>
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

            {sizeOptions.length > 0
              ? (
                  <div className="size-grid-wrap">
                    <label>尺寸筛选</label>
                    <div className="size-filter-bar">
                      <button type="button" className={`chip ${sizeFilter === 'all' ? 'active' : ''}`} onClick={() => handleSizeFilterChange('all')}>全部</button>
                      <button type="button" className={`chip ${sizeFilter === 'square' ? 'active' : ''}`} onClick={() => handleSizeFilterChange('square')}>方图</button>
                      <button type="button" className={`chip ${sizeFilter === 'landscape' ? 'active' : ''}`} onClick={() => handleSizeFilterChange('landscape')}>横图</button>
                      <button type="button" className={`chip ${sizeFilter === 'portrait' ? 'active' : ''}`} onClick={() => handleSizeFilterChange('portrait')}>竖图</button>
                      <button type="button" className={`chip ${sizeFilter === 'ultrawide' ? 'active' : ''}`} onClick={() => handleSizeFilterChange('ultrawide')}>超宽</button>
                    </div>
                    <label>尺寸快选</label>
                    <div className="size-grid">
                      {filteredSizeOptions.map(size => (
                        <label key={size}>
                          <input type="radio" checked={params.size === size} onChange={() => setParams(current => ({ ...current, size }))} />
                          <span>{size}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              : null}

            <div className="composer-checklist">
              <span className={`composer-check-item ${currentProvider ? 'ready' : ''}`}>供应商</span>
              <span className={`composer-check-item ${currentModel ? 'ready' : ''}`}>模型</span>
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
                            {resultTimer ? ` ${resultTimer.replace('⏱ ', '')}` : ''}
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
              <span className="canvas-title">
                {isGenerating ? '生成中' : results.length ? `${results.length} 张结果` : '等待生成'}
              </span>
              <span className="canvas-timer">{resultTimer}</span>
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
                        <div className="empty-icon">🎨</div>
                        <div className="empty-text">等待生成</div>
                        <div className="empty-hint">选择模型并填写参数后点击"生成图片"</div>
                      </div>
                    )
                  : results.map((image, index) => {
                      const source = image.b64_json ? `data:image/png;base64,${image.b64_json}` : image.url || ''
                      return (
                        <div key={`${source}_${index}`} className="result-item">
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
                                <div className="result-img-wrap">
                                  <img
                                    className="result-img"
                                    src={source}
                                    alt={`结果 ${index + 1}`}
                                    loading="lazy"
                                    onClick={() => setPreviewImage(source)}
                                    onLoad={(event) => {
                                      const target = event.currentTarget
                                      setImageSizes(current => ({ ...current, [index]: `${target.naturalWidth} × ${target.naturalHeight}px` }))
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
                                {downloadedIndex === index ? '已下载' : '下载图片'}
                              </button>
                              <button className="dl-btn" type="button" onClick={() => void handleCopy(index)}>
                                {copiedIndex === index ? '已复制' : '复制 Base64'}
                              </button>
                            </div>
                            {image.b64_json
                              ? (
                                  <div className="result-upscale-row">
                                    <div className="result-upscale-chips">
                                      <button type="button" className={`chip ${upscaleFactor === 2 ? 'active' : ''}`} onClick={() => setUpscaleFactor(2)}>2x</button>
                                      <button type="button" className={`chip ${upscaleFactor === 4 ? 'active' : ''}`} onClick={() => setUpscaleFactor(4)}>4x</button>
                                    </div>
                                    <button
                                      className="dl-btn result-upscale-btn"
                                      type="button"
                                      disabled={!normalizeBaseUrl(upscaleConfig.apiUrl) || upscalingIndex !== null}
                                      title={!normalizeBaseUrl(upscaleConfig.apiUrl) ? '请先在设置页配置放大服务' : ''}
                                      onClick={() => void handleUpscale(index)}
                                    >
                                      {upscalingIndex === index ? '放大中…' : '提升分辨率'}
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
            <summary>上次请求 JSON</summary>
            <pre>{requestJson}</pre>
          </details>
        </div>
      </div>
    )
  }

  function renderSettingsView() {
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
                  <div className="empty-icon">🔌</div>
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

        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>放大服务</h2>
              <div className="panel-caption">配置用于提升图片分辨率的自建放大服务端点。</div>
            </div>
          </div>
          <div className="row">
            <div>
              <label htmlFor="upscaleUrl">服务地址</label>
              <input
                id="upscaleUrl"
                value={upscaleConfig.apiUrl}
                placeholder="https://your-upscale.com/upscale"
                onChange={event => setUpscaleConfig(current => ({ ...current, apiUrl: event.target.value }))}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label htmlFor="upscaleKey">访问密钥</label>
              <input
                id="upscaleKey"
                type="password"
                value={upscaleConfig.apiKey}
                placeholder="可选"
                onChange={event => setUpscaleConfig(current => ({ ...current, apiKey: event.target.value }))}
              />
            </div>
          </div>
          <div className="settings-summary-list">
            <div className="settings-summary-row">
              <span>服务状态</span>
              <strong>{upscaleConfig.apiUrl ? '已配置' : '未配置'}</strong>
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
              <span>上限：1024 MB</span>
              <span>{historyRootDir ? '后续新记录会落入当前目录' : '当前仍使用应用默认目录'}</span>
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
                <span className="shell-nav-icon">{item.icon}</span>
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
              {theme === 'dark' ? '☀' : '☾'}
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
            {view === 'history'
              ? (
                  <HistoryView
                    historyRecords={historyRecords}
                    historySearch={historySearch}
                    historyModelFilter={historyModelFilter}
                    storageUsed={storageUsed}
                    maxStorage={MAX_STORAGE}
                    onHistorySearchChange={setHistorySearch}
                    onHistoryModelFilterChange={setHistoryModelFilter}
                    onClearHistory={clearHistory}
                    onRecallHistory={recallHistory}
                    onRemoveHistory={removeHistory}
                  />
                )
              : null}
            {view === 'settings' ? renderSettingsView() : null}
          </div>
        </main>
      </div>

      <div className={`img-modal ${previewImage ? 'active' : ''}`} onClick={() => setPreviewImage('')}>
        <button className="modal-close" type="button" onClick={() => setPreviewImage('')}>✕</button>
        {previewImage ? <img src={previewImage} alt="预览" onClick={event => event.stopPropagation()} /> : null}
      </div>

      {providerModalOpen && (
        <div className="provider-modal-overlay" onClick={closeProviderModal}>
          <div className="provider-modal-dialog" onClick={event => event.stopPropagation()}>
            <div className="provider-modal-header">
              <h3>{providerModalMode === 'create' ? '新增供应商' : '编辑供应商'}</h3>
              <button className="provider-modal-close" type="button" onClick={closeProviderModal}>✕</button>
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
                      {keyVisible
                        ? (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                              <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                          )
                        : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
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
                  {testConnStatus === 'ok' ? '✓ 连接成功' : '测试连接'}
                </button>
              </div>
              {testConnStatus === 'err' && testConnMessage
                ? <div className="test-conn-error">{testConnMessage}</div>
                : null}
              {renderStatus(connStatus)}
            </div>
            <div className="provider-modal-footer">
              {autoSaveHint ? <span className="autosave-hint">✓ 已自动保存</span> : null}
              <button className="secondary" type="button" onClick={closeProviderModal}>取消</button>
              <button type="button" onClick={handleSaveProviderModal}>保存</button>
            </div>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? `show ${toast.type}` : ''}`}>{toast?.message}</div>
    </>
  )
}

// imageSizes 存的是 "1024 × 768px" 格式，与 parseSize 解析的 "1024x768" 不同
function parseImageSize(text: string | undefined) {
  const match = /^(\d+)\s*×\s*(\d+)/.exec(text || '')
  if (!match)
    return null
  return { width: Number(match[1]), height: Number(match[2]) }
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

function matchSizeFilter(size: string, filter: SizeFilter) {
  const parsed = parseSize(size)
  if (!parsed)
    return filter === 'all'

  if (filter === 'all')
    return true
  if (filter === 'square')
    return Math.abs(parsed.ratio - 1) < 0.02
  if (filter === 'ultrawide')
    return parsed.ratio >= 1.85
  if (filter === 'landscape')
    return parsed.ratio > 1.02 && parsed.ratio < 1.85
  if (filter === 'portrait')
    return parsed.ratio < 0.98
  return true
}
