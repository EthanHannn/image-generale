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
  const latestRecord = historyRecords[0]
  const totalImages = historyRecords.reduce((sum, record) => sum + record.imageCount, 0)

  return (
    <div className="view-panel-group">
      <section className="panel panel-large history-view-panel">
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
        <div className="history-overview-grid">
          <div className="history-overview-card accent">
            <span className="history-overview-label">历史资产</span>
            <strong>{historyRecords.length}</strong>
            <span className="history-overview-copy">当前已归档 {totalImages} 张图片，支持回显与二次筛选。</span>
          </div>
          <div className="history-overview-card">
            <span className="history-overview-label">最新记录</span>
            <strong>{latestRecord?.modelId || '暂无记录'}</strong>
            <span className="history-overview-copy">{latestRecord?.prompt || '生成图片后会在这里形成可回溯资产。'}</span>
          </div>
          <div className="history-overview-card">
            <span className="history-overview-label">存储占用</span>
            <strong>{storagePercent.toFixed(1)}%</strong>
            <span className="history-overview-copy">当前使用 {formatSize(storageUsed)}，接近上限时会触发自动清理策略。</span>
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
