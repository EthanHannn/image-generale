import { formatSize } from '../../lib/utils'
import type { HistoryRecord } from '../../lib/storage'
import { HistoryList } from './HistoryList'
import { HistoryToolbar } from './HistoryToolbar'

type HistoryViewProps = {
  historyRecords: HistoryRecord[]
  historySearch: string
  historyModelFilter: string
  storageUsed: number
  maxStorage: number
  onHistorySearchChange: (value: string) => void
  onHistoryModelFilterChange: (value: string) => void
  onClearHistory: () => void | Promise<void>
  onRecallHistory: (recordId: number) => void | Promise<void>
  onRemoveHistory: (recordId: number) => void | Promise<void>
}

export function HistoryView(props: HistoryViewProps) {
  const {
    historyRecords,
    historySearch,
    historyModelFilter,
    storageUsed,
    maxStorage,
    onHistorySearchChange,
    onHistoryModelFilterChange,
    onClearHistory,
    onRecallHistory,
    onRemoveHistory,
  } = props

  const storagePercent = Math.min((storageUsed / maxStorage) * 100, 100)
  const modelFilterOptions = [...new Set(historyRecords.map(record => record.modelId))].sort()
  const filteredHistory = historyRecords.filter((record) => {
    const hitPrompt = !historySearch || record.prompt.toLowerCase().includes(historySearch.toLowerCase())
    const hitModel = !historyModelFilter || record.modelId === historyModelFilter
    return hitPrompt && hitModel
  })

  return (
    <div className="view-panel-group">
      <section className="panel panel-large">
        <div className="panel-heading">
          <div>
            <h2>历史记录</h2>
            <div className="panel-caption">集中浏览本地历史结果，支持搜索、筛选、回显与清理。</div>
          </div>
          <div className="result-meta-badge">
            <span>{historyRecords.length} 条</span>
            <span>{formatSize(storageUsed)}</span>
          </div>
        </div>
        <div className="storage-bar-wrap">
          <div className="storage-bar-info">
            <span className="storage-used">已用 {formatSize(storageUsed)} / 1024 MB</span>
            <span>{storagePercent.toFixed(1)}%</span>
          </div>
          <div className="storage-bar-track">
            <div className={`storage-bar-fill ${storagePercent > 95 ? 'danger' : storagePercent > 80 ? 'warn' : ''}`} style={{ width: `${storagePercent}%` }} />
          </div>
        </div>
        <HistoryToolbar
          historySearch={historySearch}
          historyModelFilter={historyModelFilter}
          modelFilterOptions={modelFilterOptions}
          onHistorySearchChange={onHistorySearchChange}
          onHistoryModelFilterChange={onHistoryModelFilterChange}
          onClearHistory={onClearHistory}
        />
        <HistoryList
          historyRecords={historyRecords}
          filteredHistory={filteredHistory}
          onRecallHistory={onRecallHistory}
          onRemoveHistory={onRemoveHistory}
        />
      </section>
    </div>
  )
}
