import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MouseEvent } from 'react'
import { saveImageFile } from '../../lib/files'
import { getErrorMessage } from '../../lib/errors'
import type { HistoryRecord } from '../../lib/storage'
import { blobToBase64, formatSize, formatTime, sanitizeFilename } from '../../lib/utils'
import { Icon, type IconName } from '../../components/Icon'
import type { CropMarginIncomingImage } from '../crop-margin/types'

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
  onRemoveHistory: (recordId: number) => void | Promise<void>
  onToggleFavorite: (recordId: number, nextFavorite: boolean) => void | Promise<void>
  favoritePending: boolean
  onShowToast: (message: string, type: 'success' | 'error') => void
  onSendToCropMargin: (images: CropMarginIncomingImage[]) => void
}

export function HistoryRecordCard(props: HistoryRecordCardProps) {
  const { record, onRecallHistory, onRemoveHistory, onToggleFavorite, favoritePending, onShowToast, onSendToCropMargin } = props
  const displayImages = useMemo(() => getHistoryDisplayImages(record), [record])
  const cropMarginImages = useMemo(() => getHistoryCropMarginImages(record), [record])
  const imageUrls = useObjectUrls(displayImages)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<HistoryContextMenuState | null>(null)
  const promptSummary = record.prompt || '(无 Prompt)'
  const modeText = getHistoryModeText(record.mode)
  const sizeLabel = getHistorySizeLabel(record)
  const titleLabel = record.mode === 'upscale' ? (record.providerName || record.modelName || '超分服务') : record.modelId
  const previewUrl = previewIndex !== null ? imageUrls[previewIndex] : ''
  const hasPreview = previewIndex !== null && !!previewUrl
  const hasMultipleImages = imageUrls.length > 1

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
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setPreviewIndex(current => current === null ? current : getPreviousImageIndex(current, imageUrls.length))
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setPreviewIndex(current => current === null ? current : getNextImageIndex(current, imageUrls.length))
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [contextMenu, hasPreview, imageUrls.length])

  function openPreview(index: number) {
    closeContextMenu()
    setPreviewIndex(index)
  }

  function showPrevious(event: React.MouseEvent) {
    event.stopPropagation()
    setPreviewIndex(current => current === null ? current : getPreviousImageIndex(current, imageUrls.length))
  }

  function showNext(event: React.MouseEvent) {
    event.stopPropagation()
    setPreviewIndex(current => current === null ? current : getNextImageIndex(current, imageUrls.length))
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
    const menuHeight = 88
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

    const blob = displayImages[index]
    if (!blob)
      return

    const mimeType = normalizeImageMimeType(blob.type)
    const filename = getHistoryImageFilename(record, index, mimeType)
    try {
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

    const blob = displayImages[index]
    if (!blob)
      return

    const mimeType = normalizeImageMimeType(blob.type)
    try {
      const imageBase64 = await blobToBase64(blob)
      await navigator.clipboard.writeText(`data:${mimeType};base64,${imageBase64}`)
      onShowToast('Base64 已复制到剪贴板', 'success')
    }
    catch (error) {
      onShowToast(`复制失败: ${getErrorMessage(error)}`, 'error')
    }
  }

  async function sendRecordToCropMargin() {
    if (!cropMarginImages.length) {
      onShowToast('该记录没有可发送的图片', 'error')
      return
    }

    try {
      const images = await Promise.all(cropMarginImages.map((blob, index) => createCropMarginImage(record, blob, index)))
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
          : (
              <div className="thumb-placeholder history-thumb-placeholder">
                <Icon name={getHistoryPlaceholderIcon(record.mode)} size={28} />
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
        <button className="history-action-btn" type="button" disabled={!cropMarginImages.length} onClick={() => void sendRecordToCropMargin()}>发送到裁剪台</button>
        <button className="history-action-btn delete-btn" type="button" onClick={() => record.id && void onRemoveHistory(record.id)}>删除记录</button>
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
                <img src={previewUrl} alt={`历史预览 ${previewIndex + 1}`} onContextMenu={event => openContextMenu(event, previewIndex)} />
                <div className="history-preview-count">{previewIndex + 1} / {imageUrls.length}</div>
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
            <div
              className={`image-context-menu-backdrop ${hasPreview ? 'history-context-menu-backdrop' : ''}`}
              onClick={closeContextMenu}
              onContextMenu={(event) => {
                event.preventDefault()
                closeContextMenu()
              }}
            >
              <div
                className="image-context-menu"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onClick={event => event.stopPropagation()}
                onContextMenu={event => event.preventDefault()}
              >
                <button type="button" onClick={() => void saveContextImage()}>
                  <span>图片另存为</span>
                </button>
                <button type="button" onClick={() => void copyContextImage()}>
                  <span>复制 Base64</span>
                </button>
              </div>
            </div>,
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
  const mimeType = normalizeImageMimeType(blob.type)
  const [base64, dimensions] = await Promise.all([blobToBase64(blob), readBlobImageDimensions(blob)])
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
      reject(new Error('图片尺寸读取失败'))
    }
    image.src = url
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

function getHistoryDisplayImages(record: HistoryRecord) {
  if (record.mode !== 'upscale')
    return record.images || EMPTY_HISTORY_IMAGES

  const factor = record.params.upscaleFactor || 2
  const output = record.upscaledImages?.[0]?.[factor]
  return output ? [output, ...(record.images || [])] : (record.images || EMPTY_HISTORY_IMAGES)
}

function getHistoryCropMarginImages(record: HistoryRecord) {
  if (record.mode === 'upscale')
    return getHistoryDisplayImages(record)

  const images = record.images || EMPTY_HISTORY_IMAGES
  if (!images.length)
    return EMPTY_HISTORY_IMAGES

  const nextImages: Blob[] = []
  images.forEach((blob, index) => {
    nextImages.push(blob)
    const variants = record.upscaledImages?.[index]
    if (!variants)
      return

    Object.keys(variants)
      .map(Number)
      .filter(factor => Number.isFinite(factor))
      .sort((left, right) => left - right)
      .forEach((factor) => {
        const variant = variants[factor]
        if (variant)
          nextImages.push(variant)
      })
  })
  return nextImages
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

  useEffect(() => {
    if (!blobs.length) {
      setUrls([])
      return
    }

    const nextUrls = blobs.map(blob => URL.createObjectURL(blob))
    setUrls(nextUrls)

    return () => {
      nextUrls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [blobs])

  return urls
}
