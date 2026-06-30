import { useEffect, useState } from 'react'
import type { HistoryRecord } from '../../lib/storage'
import { formatSize, formatTime } from '../../lib/utils'

type HistoryRecordCardProps = {
  record: HistoryRecord
  onRecallHistory: (recordId: number) => void | Promise<void>
  onRemoveHistory: (recordId: number) => void | Promise<void>
}

export function HistoryRecordCard(props: HistoryRecordCardProps) {
  const { record, onRecallHistory, onRemoveHistory } = props
  const thumbBlob = record.images?.[0]
  const thumbUrl = useObjectUrl(thumbBlob)
  const promptSummary = record.prompt || '(无 Prompt)'
  const sizeLabel = record.params.resolution || record.params.size || '未记录尺寸'

  return (
    <button className="history-card" type="button" onClick={() => record.id && void onRecallHistory(record.id)}>
      <div className="history-thumb-rail">
        {thumbUrl
          ? <img className="thumb history-thumb" src={thumbUrl} alt={record.prompt || 'history'} />
          : <div className="thumb-placeholder history-thumb-placeholder">{record.mode === 'edit' ? '🖼' : '✨'}</div>}
        <span className={`history-mode-pill ${record.mode === 'edit' ? 'edit' : 'gen'}`}>
          {record.mode === 'edit' ? '图生图' : '文生图'}
        </span>
      </div>
      <div className="card-body history-card-body">
        <div className="history-card-topline">
          <span className="model-tag">{record.modelId}</span>
          <span className="history-card-timestamp">{formatTime(record.timestamp)}</span>
        </div>
        <div className="card-prompt history-card-prompt" title={promptSummary}>{promptSummary}</div>
        <div className="history-card-summary">
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
        <button className="dl-btn history-action-btn" type="button" onClick={() => record.id && void onRecallHistory(record.id)}>回显到工作台</button>
        <button className="dl-btn delete-btn history-action-btn" type="button" onClick={() => record.id && void onRemoveHistory(record.id)}>删除记录</button>
      </div>
    </button>
  )
}

function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!blob) {
      setUrl('')
      return
    }

    const nextUrl = URL.createObjectURL(blob)
    setUrl(nextUrl)

    return () => {
      URL.revokeObjectURL(nextUrl)
    }
  }, [blob])

  return url
}
