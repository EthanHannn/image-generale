import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HistoryRecord } from '../../lib/storage'
import { formatSize, formatTime } from '../../lib/utils'

const EMPTY_HISTORY_IMAGES: Blob[] = []

type HistoryRecordCardProps = {
  record: HistoryRecord
  onRecallHistory: (recordId: number) => void | Promise<void>
  onRemoveHistory: (recordId: number) => void | Promise<void>
}

export function HistoryRecordCard(props: HistoryRecordCardProps) {
  const { record, onRecallHistory, onRemoveHistory } = props
  const imageUrls = useObjectUrls(record.images || EMPTY_HISTORY_IMAGES)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const promptSummary = record.prompt || '(无 Prompt)'
  const sizeLabel = record.params.resolution || record.params.size || '未记录尺寸'
  const previewUrl = previewIndex !== null ? imageUrls[previewIndex] : ''
  const hasPreview = previewIndex !== null && !!previewUrl
  const hasMultipleImages = imageUrls.length > 1

  useEffect(() => {
    if (!hasPreview)
      return

    function onKeyDown(event: KeyboardEvent) {
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
  }, [hasPreview, imageUrls.length])

  function openPreview(index: number) {
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
                  >
                    <img className="thumb history-thumb" src={url} alt={`历史图片 ${index + 1}`} />
                    {index === 3 && imageUrls.length > 4 ? <span className="history-thumb-more">+{imageUrls.length - 4}</span> : null}
                  </button>
                ))}
              </div>
            )
          : <div className="thumb-placeholder history-thumb-placeholder">{record.mode === 'edit' ? '🖼' : '✨'}</div>}
      </div>
      <div className="card-body history-card-body">
        <div className="history-card-topline">
          <span className="model-tag">{record.modelId}</span>
          <span className="history-card-timestamp">{formatTime(record.timestamp)}</span>
        </div>
        <div className="history-card-prompt" title={promptSummary}>{promptSummary}</div>
        <div className="history-card-summary">
          <span className={`history-mode-tag ${record.mode === 'edit' ? 'edit' : 'gen'}`}>
            {record.mode === 'edit' ? '图生图' : '文生图'}
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
        <button className="history-action-btn primary-btn" type="button" onClick={() => record.id && void onRecallHistory(record.id)}>回显到工作台</button>
        <button className="history-action-btn delete-btn" type="button" onClick={() => record.id && void onRemoveHistory(record.id)}>删除记录</button>
      </div>
      {hasPreview
        ? createPortal(
            <div className="history-preview-modal" onClick={() => setPreviewIndex(null)}>
              <button className="modal-close history-preview-close" type="button" onClick={() => setPreviewIndex(null)}>✕</button>
              {hasMultipleImages
                ? (
                    <button className="history-preview-nav prev" type="button" onClick={showPrevious}>‹</button>
                  )
                : null}
              <div className="history-preview-stage" onClick={event => event.stopPropagation()}>
                <img src={previewUrl} alt={`历史预览 ${previewIndex + 1}`} />
                <div className="history-preview-count">{previewIndex + 1} / {imageUrls.length}</div>
              </div>
              {hasMultipleImages
                ? (
                    <button className="history-preview-nav next" type="button" onClick={showNext}>›</button>
                  )
                : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
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
