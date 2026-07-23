import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ContextMenu } from '../../components/ui/ContextMenu'
import type { MouseEvent } from 'react'
import { saveImageFile } from '../../lib/files'
import { getErrorMessage } from '../../lib/errors'
import { getRecord, saveHistoryThumbnails, type HistoryRecord } from '../../lib/storage'
import { blobToBase64, detectImageMimeType, formatSize, formatTime, sanitizeFilename } from '../../lib/utils'
import { Icon, type IconName } from '../../components/Icon'
import type { CropMarginIncomingImage, CropMarginVariant } from '../crop-margin/types'
import { createHistoryThumbnails } from './historyThumbnails'

const EMPTY_HISTORY_IMAGES: Blob[] = []
type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'
type HistoryContextMenuState = {
  x: number
  y: number
  index: number
}

type HistoryRecordCardProps = {
  record: HistoryRecord
  onRecallHistory: (recordId: number) => void | Promise<void>
  onRemoveHistory: (recordId: number, isFavorite?: boolean) => void | Promise<void>
  onToggleFavorite: (recordId: number, nextFavorite: boolean) => void | Promise<void>
  favoritePending: boolean
  onShowToast: (message: string, type: 'success' | 'error') => void
  onSendToCropMargin: (images: CropMarginIncomingImage[]) => void
}

export function HistoryRecordCard(props: HistoryRecordCardProps) {
  const { record, onRecallHistory, onRemoveHistory, onToggleFavorite, favoritePending, onShowToast, onSendToCropMargin } = props
  const [localThumbnails, setLocalThumbnails] = useState<Blob[]>(record.thumbnails || EMPTY_HISTORY_IMAGES)
  const [thumbnailLoading, setThumbnailLoading] = useState(false)
  const [thumbnailLoadFailed, setThumbnailLoadFailed] = useState(false)
  const [fullRecord, setFullRecord] = useState<HistoryRecord | null>(hasFullHistoryImages(record) ? record : null)
  const displayImages = useMemo(
    () => localThumbnails.length ? localThumbnails : getHistoryDisplayImages(record),
    [localThumbnails, record],
  )
  const previewImages = useMemo(
    () => fullRecord ? getHistoryDisplayImages(fullRecord) : EMPTY_HISTORY_IMAGES,
    [fullRecord],
  )
  const { urls: imageUrls, isLoading: imageUrlsLoading } = useObjectUrls(displayImages)
  const { urls: previewImageUrls } = useObjectUrls(previewImages)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<HistoryContextMenuState | null>(null)
  const promptSummary = record.prompt || '(无 Prompt)'
  const modeText = getHistoryModeText(record.mode)
  const sizeLabel = getHistorySizeLabel(record)
  const titleLabel = record.mode === 'upscale' ? (record.providerName || record.modelName || '超分服务') : record.modelId
  const previewUrl = previewIndex !== null ? previewImageUrls[previewIndex] : ''
  const previewTotal = Math.max(previewImageUrls.length, previewImages.length, displayImages.length, record.imageCount || 0)
  const hasPreview = previewIndex !== null
  const hasMultipleImages = previewTotal > 1
  const canUseRecordImages = record.imageCount > 0 || displayImages.length > 0

  useEffect(() => {
    setLocalThumbnails(record.thumbnails || EMPTY_HISTORY_IMAGES)
    setThumbnailLoadFailed(false)
    setFullRecord(hasFullHistoryImages(record) ? record : null)
  }, [record])

  useEffect(() => {
    let cancelled = false
    if (localThumbnails.length || record.id === undefined)
      return

    setThumbnailLoading(true)
    setThumbnailLoadFailed(false)

    void (async () => {
      try {
        const recordId = record.id
        if (recordId === undefined)
          throw new Error('历史记录不存在')

        const detailRecord = hasFullHistoryImages(record) ? record : await getRecord(recordId)
        if (!detailRecord)
          throw new Error('历史记录不存在')

        const sourceImages = getHistoryDisplayImages(detailRecord)
        if (!sourceImages.length)
          throw new Error('图片文件缺失或无法读取')

        const thumbnails = await createHistoryThumbnails(sourceImages)
        const thumbnailBase64 = await Promise.all(thumbnails.map(blob => blobToBase64(blob)))
        if (cancelled)
          return

        setFullRecord(detailRecord)
        setLocalThumbnails(thumbnails)
        await saveHistoryThumbnails(recordId, thumbnailBase64)
      }
      catch {
        if (!cancelled)
          setThumbnailLoadFailed(true)
      }
      finally {
        if (!cancelled)
          setThumbnailLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [localThumbnails.length, record])

  useEffect(() => {
    if (!hasPreview && !contextMenu)
      return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && contextMenu) {
        event.preventDefault()
        closeContextMenu()
        return
      }
      if (event.key === 'Escape') {
        setPreviewIndex(null)
        return
      }
      if (event.key === 'ArrowLeft' && previewTotal) {
        event.preventDefault()
        setPreviewIndex(current => current === null ? current : getPreviousImageIndex(current, previewTotal))
      }
      if (event.key === 'ArrowRight' && previewTotal) {
        event.preventDefault()
        setPreviewIndex(current => current === null ? current : getNextImageIndex(current, previewTotal))
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [contextMenu, hasPreview, previewTotal])

  function openPreview(index: number) {
    closeContextMenu()
    setPreviewIndex(index)
    void loadFullRecord().catch((error) => {
      setPreviewIndex(null)
      onShowToast(`预览失败: ${getErrorMessage(error)}`, 'error')
    })
  }

  function showPrevious(event: React.MouseEvent) {
    event.stopPropagation()
    setPreviewIndex(current => current === null ? current : getPreviousImageIndex(current, previewTotal))
  }

  function showNext(event: React.MouseEvent) {
    event.stopPropagation()
    setPreviewIndex(current => current === null ? current : getNextImageIndex(current, previewTotal))
  }

  async function loadFullRecord() {
    if (fullRecord && hasFullHistoryImages(fullRecord))
      return fullRecord
    if (hasFullHistoryImages(record)) {
      setFullRecord(record)
      return record
    }
    if (record.id === undefined)
      throw new Error('历史记录不存在')

    const detailRecord = await getRecord(record.id)
    if (!detailRecord)
      throw new Error('历史记录不存在')
    if (!hasFullHistoryImages(detailRecord))
      throw new Error('图片文件缺失或无法读取')

    setFullRecord(detailRecord)
    return detailRecord
  }

  async function getFullDisplayImage(index: number) {
    const detailRecord = await loadFullRecord()
    const blob = getHistoryDisplayImages(detailRecord)[index]
    if (!blob)
      throw new Error('图片文件缺失或无法读取')
    return { detailRecord, blob }
  }

  function toggleFavorite(event: React.MouseEvent) {
    event.stopPropagation()
    if (record.id === undefined || favoritePending)
      return
    void onToggleFavorite(record.id, !record.isFavorite)
  }

  function closeContextMenu() {
    setContextMenu(null)
  }

  function getBoundedContextMenuPosition(clientX: number, clientY: number) {
    const menuWidth = 204
    const menuHeight = 126
    const margin = 8
    const x = Math.min(clientX, window.innerWidth - menuWidth - margin)
    const y = Math.min(clientY, window.innerHeight - menuHeight - margin)
    return {
      x: Math.max(margin, x),
      y: Math.max(margin, y),
    }
  }

  function openContextMenu(event: MouseEvent, index: number) {
    event.preventDefault()
    event.stopPropagation()
    if (!displayImages[index])
      return

    setContextMenu({
      ...getBoundedContextMenuPosition(event.clientX, event.clientY),
      index,
    })
  }

  async function saveContextImage() {
    const index = contextMenu?.index
    closeContextMenu()
    if (index === undefined)
      return

    try {
      const { detailRecord, blob } = await getFullDisplayImage(index)
      const mimeType = normalizeImageMimeType(blob.type)
      const filename = getHistoryImageFilename(detailRecord, index, mimeType)
      const imageBase64 = await blobToBase64(blob)
      const result = await saveImageFile({ imageBase64, filename, mimeType })
      if (result.status === 'cancelled')
        return

      onShowToast(`图片已保存：${getSavedFileLabel(result.path, filename)}`, 'success')
    }
    catch (error) {
      onShowToast(`保存失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  async function copyContextImage() {
    const index = contextMenu?.index
    closeContextMenu()
    if (index === undefined)
      return

    try {
      const { blob } = await getFullDisplayImage(index)
      const mimeType = normalizeImageMimeType(blob.type)
      const imageBase64 = await blobToBase64(blob)
      await navigator.clipboard.writeText(`data:${mimeType};base64,${imageBase64}`)
      onShowToast('Base64 已复制到剪贴板', 'success')
    }
    catch (error) {
      onShowToast(`复制失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  async function sendContextImageToCropMargin() {
    const index = contextMenu?.index
    closeContextMenu()
    if (index === undefined)
      return

    try {
      const { detailRecord, blob } = await getFullDisplayImage(index)
      const image = await createCropMarginImage(detailRecord, blob, index)
      onSendToCropMargin([image])
    }
    catch (error) {
      onShowToast(`发送失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  async function sendRecordToCropMargin() {
    if (!canUseRecordImages) {
      onShowToast('该记录没有可发送的图片', 'error')
      return
    }

    try {
      const detailRecord = await loadFullRecord()
      const images = await createCropMarginImages(detailRecord)
      if (!images.length)
        throw new Error('图片文件缺失或无法读取')
      onSendToCropMargin(images)
    }
    catch (error) {
      onShowToast(`发送失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  return (
    <div className="history-card">
      <div className="history-thumb-rail">
        {imageUrls.length
          ? (
              <div className={`history-thumb-grid ${imageUrls.length > 1 ? 'multi' : ''}`}>
                {imageUrls.slice(0, 4).map((url, index) => (
                  <button
                    key={url}
                    className="history-thumb-button"
                    type="button"
                    onClick={() => openPreview(index)}
                    onContextMenu={event => openContextMenu(event, index)}
                  >
                    <img className="thumb history-thumb" src={url} alt={`历史图片 ${index + 1}`} />
                    {index === 3 && imageUrls.length > 4 ? <span className="history-thumb-more">+{imageUrls.length - 4}</span> : null}
                  </button>
                ))}
              </div>
            )
          : thumbnailLoading || (displayImages.length && imageUrlsLoading)
              ? (
                  <div className="thumb-placeholder history-thumb-placeholder loading">
                    <span className="spinner" />
                  </div>
                )
          : (
              <div className="thumb-placeholder history-thumb-placeholder">
                <Icon name={getHistoryPlaceholderIcon(record.mode)} size={28} />
                {thumbnailLoadFailed ? <span className="history-thumb-placeholder-text">图片无法读取</span> : null}
              </div>
            )}
      </div>
      <div className="card-body history-card-body">
        <div className="history-card-topline">
          <div className="history-card-title-row">
            <span className="model-tag">{titleLabel}</span>
            <button
              className={`favorite-icon-btn history-favorite-btn ${record.isFavorite ? 'active' : ''}`}
              type="button"
              disabled={record.id === undefined || favoritePending}
              aria-label={record.isFavorite ? '取消收藏' : '收藏记录'}
              title={record.isFavorite ? '取消收藏' : '收藏记录'}
              onClick={toggleFavorite}
            >
              {favoritePending ? '...' : <Icon name={record.isFavorite ? 'starFilled' : 'star'} size={15} />}
            </button>
          </div>
          <span className="history-card-timestamp">{formatTime(record.timestamp)}</span>
        </div>
        <div className="history-card-prompt" title={promptSummary}>{promptSummary}</div>
        <div className="history-card-summary">
          <span className={`history-mode-tag ${record.mode === 'edit' ? 'edit' : record.mode === 'upscale' ? 'upscale' : 'gen'}`}>
            {modeText}
          </span>
          <span>{record.imageCount} 张图片</span>
          <span>{sizeLabel}</span>
          <span>{record.duration}s</span>
        </div>
        <div className="card-meta">
          <span className="meta-item">供应商 {record.providerName || '-'}</span>
          <span className="meta-item">占用 {formatSize(record.totalSize || 0)}</span>
          <span className="meta-item">模式 {record.mode === 'edit' ? '编辑' : '生成'}</span>
        </div>
      </div>
      <div className="card-actions history-card-actions" onClick={event => event.stopPropagation()}>
        <button className="history-action-btn primary-btn" type="button" onClick={() => record.id && void onRecallHistory(record.id)}>{record.mode === 'upscale' ? '回显到超分台' : '回显到工作台'}</button>
        <button className="history-action-btn" type="button" disabled={!canUseRecordImages} onClick={() => void sendRecordToCropMargin()}>发送到裁剪台</button>
        <button className="history-action-btn delete-btn" type="button" onClick={() => record.id && void onRemoveHistory(record.id, record.isFavorite)}>删除记录</button>
      </div>
      {hasPreview
        ? createPortal(
            <div className="history-preview-modal" onClick={() => setPreviewIndex(null)}>
              <button className="modal-close history-preview-close" type="button" onClick={() => setPreviewIndex(null)} aria-label="关闭预览">
                <Icon name="close" size={20} />
              </button>
              {hasMultipleImages
                ? (
                    <button className="history-preview-nav prev" type="button" onClick={showPrevious} aria-label="上一张">
                      <Icon name="chevronLeft" size={30} />
                    </button>
                  )
                : null}
              <div className="history-preview-stage" onClick={event => event.stopPropagation()}>
                {previewUrl
                  ? <img src={previewUrl} alt={`历史预览 ${previewIndex + 1}`} onContextMenu={event => openContextMenu(event, previewIndex)} />
                  : (
                      <div className="history-preview-loading">
                        <span className="spinner" />
                      </div>
                    )}
                <div className="history-preview-count">{previewIndex + 1} / {Math.max(previewTotal, 1)}</div>
              </div>
              {hasMultipleImages
                ? (
                    <button className="history-preview-nav next" type="button" onClick={showNext} aria-label="下一张">
                      <Icon name="chevronRight" size={30} />
                    </button>
                  )
                : null}
            </div>,
            document.body,
          )
        : null}
      {contextMenu
        ? createPortal(
            <ContextMenu
              backdropClassName={hasPreview ? 'history-context-menu-backdrop' : undefined}
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={closeContextMenu}
              items={[
                { id: 'save', label: '图片另存为', onSelect: () => void saveContextImage() },
                { id: 'copy', label: '复制 Base64', onSelect: () => void copyContextImage() },
                { id: 'send-to-crop-margin', label: '发送到裁剪台', onSelect: () => void sendContextImageToCropMargin() },
              ]}
            />,
            document.body,
          )
        : null}
    </div>
  )
}

function getSavedFileLabel(path: string | undefined, fallback: string) {
  if (!path)
    return fallback
  return path.split(/[\\/]/).pop() || fallback
}

function getHistoryImageFilename(record: HistoryRecord, index: number, mimeType: ImageMimeType) {
  const extension = getImageExtension(mimeType)
  const recordId = record.id === undefined ? record.timestamp : record.id
  const label = record.mode === 'upscale' ? 'history_upscale' : 'history'
  return `${label}_${recordId}_${sanitizeFilename(record.modelId || 'image')}_${index + 1}_${makeTimestamp()}.${extension}`
}

async function createCropMarginImage(record: HistoryRecord, blob: Blob, index: number): Promise<CropMarginIncomingImage> {
  const [base64, dimensions] = await Promise.all([blobToBase64(blob), readBlobImageDimensions(blob)])
  const mimeType = normalizeImageMimeType(detectImageMimeType(base64))
  return {
    id: `history_${record.id || record.timestamp}_${index}_${Date.now()}`,
    fileName: getHistoryImageFilename(record, index, mimeType),
    fileSize: blob.size,
    mimeType,
    base64,
    width: dimensions.width,
    height: dimensions.height,
  }
}

async function createCropMarginImages(record: HistoryRecord): Promise<CropMarginIncomingImage[]> {
  if (record.mode === 'upscale')
    return createUpscaleRecordCropMarginImages(record)

  const images = record.images || EMPTY_HISTORY_IMAGES
  const items = await Promise.all(images.map((blob, index) => createVariantCropMarginImage(record, blob, index, record.upscaledImages?.[index])))
  return items.filter((item): item is CropMarginIncomingImage => !!item)
}

async function createUpscaleRecordCropMarginImages(record: HistoryRecord): Promise<CropMarginIncomingImage[]> {
  const source = record.images?.[0]
  if (!source)
    return []

  const factor = record.params.upscaleFactor || 2
  const output = record.upscaledImages?.[0]?.[factor]
  const item = await createVariantCropMarginImage(record, source, 0, output ? { [factor]: output } : undefined, output ? `${factor}x` : 'original')
  return item ? [item] : []
}

async function createVariantCropMarginImage(
  record: HistoryRecord,
  sourceBlob: Blob,
  index: number,
  upscaledImages?: Record<number, Blob>,
  preferredVariantId?: string,
): Promise<CropMarginIncomingImage | null> {
  const variants: CropMarginVariant[] = [await createCropMarginVariant(record, sourceBlob, index, 'original', '原图')]
  const factors = Object.keys(upscaledImages || {})
    .map(Number)
    .filter(factor => Number.isFinite(factor))
    .sort((left, right) => left - right)

  for (const factor of factors) {
    const blob = upscaledImages?.[factor]
    if (!blob)
      continue
    variants.push(await createCropMarginVariant(record, blob, index, `${factor}x`, `${factor}X`, factor))
  }

  const selectedVariantId = preferredVariantId && variants.some(variant => variant.id === preferredVariantId)
    ? preferredVariantId
    : variants[variants.length - 1].id
  const selectedVariant = variants.find(variant => variant.id === selectedVariantId) || variants[0]
  return {
    id: `history_${record.id || record.timestamp}_${index}_${selectedVariantId}_${Date.now()}`,
    fileName: getHistoryImageFilename(record, index, normalizeImageMimeType(selectedVariant.mimeType)),
    fileSize: selectedVariant.fileSize,
    mimeType: selectedVariant.mimeType,
    base64: selectedVariant.base64,
    width: selectedVariant.width,
    height: selectedVariant.height,
    sourceLabel: record.mode === 'upscale' ? '历史超分' : '历史记录',
    variants,
    selectedVariantId,
  }
}

async function createCropMarginVariant(record: HistoryRecord, blob: Blob, index: number, id: string, label: string, factor?: number): Promise<CropMarginVariant> {
  const [base64, dimensions] = await Promise.all([blobToBase64(blob), readBlobImageDimensions(blob)])
  const mimeType = normalizeImageMimeType(detectImageMimeType(base64))
  return {
    id,
    label,
    fileName: getHistoryImageFilename(record, index, mimeType),
    fileSize: blob.size,
    mimeType,
    base64,
    width: dimensions.width,
    height: dimensions.height,
    factor,
  }
}

function readBlobImageDimensions(blob: Blob) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      void readBlobImageDimensionsFromBase64(blob).then(resolve).catch(() => reject(new Error('图片尺寸读取失败')))
    }
    image.src = url
  })
}

async function readBlobImageDimensionsFromBase64(blob: Blob) {
  const base64 = await blobToBase64(blob)
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('图片尺寸读取失败'))
    image.src = `data:${detectImageMimeType(base64)};base64,${base64}`
  })
}

function getImageExtension(mimeType: ImageMimeType) {
  if (mimeType === 'image/jpeg')
    return 'jpg'
  if (mimeType === 'image/webp')
    return 'webp'
  return 'png'
}

function makeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function normalizeImageMimeType(mimeType: string): ImageMimeType {
  if (mimeType === 'image/jpeg' || mimeType === 'image/webp')
    return mimeType
  return 'image/png'
}

function getHistoryModeText(mode: HistoryRecord['mode']) {
  if (mode === 'edit')
    return '图生图'
  if (mode === 'upscale')
    return '单独超分'
  return '文生图'
}

function getHistoryPlaceholderIcon(mode: HistoryRecord['mode']): IconName {
  if (mode === 'edit')
    return 'editImage'
  if (mode === 'upscale')
    return 'upscale'
  return 'spark'
}

function getHistorySizeLabel(record: HistoryRecord) {
  if (record.mode === 'upscale') {
    const source = record.params.sourceWidth && record.params.sourceHeight
      ? `${record.params.sourceWidth} × ${record.params.sourceHeight}`
      : '原图'
    const output = record.params.outputWidth && record.params.outputHeight
      ? `${record.params.outputWidth} × ${record.params.outputHeight}`
      : record.params.targetWidth && record.params.targetHeight
        ? `${record.params.targetWidth} × ${record.params.targetHeight}`
        : '超分图'
    return `${source} -> ${output}`
  }
  return record.params.resolution || record.params.size || '未记录尺寸'
}

function hasFullHistoryImages(record: HistoryRecord) {
  return getHistoryDisplayImages(record).length > 0
}

function getHistoryDisplayImages(record: HistoryRecord) {
  if (record.mode !== 'upscale')
    return record.images || EMPTY_HISTORY_IMAGES

  const factor = record.params.upscaleFactor || 2
  const output = record.upscaledImages?.[0]?.[factor]
  return output ? [output, ...(record.images || [])] : (record.images || EMPTY_HISTORY_IMAGES)
}

function getPreviousImageIndex(index: number, total: number) {
  if (!total)
    return index
  return index <= 0 ? total - 1 : index - 1
}

function getNextImageIndex(index: number, total: number) {
  if (!total)
    return index
  return index >= total - 1 ? 0 : index + 1
}

function useObjectUrls(blobs: Blob[]) {
  const [urls, setUrls] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!blobs.length) {
      setUrls([])
      setIsLoading(false)
      return
    }

    let nextUrls: string[] = []
    setIsLoading(true)
    void Promise.all(blobs.map(blob => createImageObjectUrl(blob).catch(() => ''))).then((urls) => {
      const validUrls = urls.filter(Boolean)
      if (cancelled) {
        validUrls.forEach(url => URL.revokeObjectURL(url))
        return
      }
      nextUrls = validUrls
      setUrls(nextUrls)
      setIsLoading(false)
    })

    return () => {
      cancelled = true
      nextUrls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [blobs])

  return { urls, isLoading }
}

async function createImageObjectUrl(blob: Blob) {
  const mimeType = await detectBlobMimeType(blob)
  if (blob.type === mimeType)
    return URL.createObjectURL(blob)
  return URL.createObjectURL(new Blob([blob], { type: mimeType }))
}

async function detectBlobMimeType(blob: Blob) {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47)
    return 'image/png'
  if (bytes[0] === 0xFF && bytes[1] === 0xD8)
    return 'image/jpeg'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
    return 'image/webp'
  return blob.type || 'image/png'
}
