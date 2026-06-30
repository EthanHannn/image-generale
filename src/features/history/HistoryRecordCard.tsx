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

  return (
    <button key={record.id} className="history-card" type="button" onClick={() => record.id && void onRecallHistory(record.id)}>
      {thumbUrl
        ? <img className="thumb" src={thumbUrl} alt={record.prompt || 'history'} />
        : <div className="thumb-placeholder">{record.mode === 'edit' ? '🖼' : '✨'}</div>}
      <div className="card-body">
        <div className="card-title">
          <span className="model-tag">{record.modelId}</span>
          {record.imageCount} 张 · {record.duration}s
        </div>
        <div className="card-prompt" title={record.prompt}>{record.prompt || '(无 Prompt)'}</div>
        <div className="card-meta">
          <span className="meta-item">🕐 {formatTime(record.timestamp)}</span>
          <span className="meta-item">💾 {formatSize(record.totalSize || 0)}</span>
          <span className="meta-item">{record.mode === 'edit' ? '图生图' : '文生图'}</span>
        </div>
      </div>
      <div className="card-actions" onClick={event => event.stopPropagation()}>
        <button className="dl-btn" type="button" onClick={() => record.id && void onRecallHistory(record.id)}>回显</button>
        <button className="dl-btn delete-btn" type="button" onClick={() => record.id && void onRemoveHistory(record.id)}>删除</button>
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
