import type { HistoryRecord } from '../../lib/storage'
import { HistoryRecordCard } from './HistoryRecordCard'

type HistoryListProps = {
  historyRecords: HistoryRecord[]
  filteredHistory: HistoryRecord[]
  onRecallHistory: (recordId: number) => void | Promise<void>
  onRemoveHistory: (recordId: number) => void | Promise<void>
}

export function HistoryList(props: HistoryListProps) {
  const {
    historyRecords,
    filteredHistory,
    onRecallHistory,
    onRemoveHistory,
  } = props

  return (
    <div className="history-list history-list-page">
      {!filteredHistory.length
        ? (
            <div className="empty history-empty-state">
              <div className="empty-icon">📚</div>
              <div className="empty-text">{historyRecords.length ? '未找到匹配记录' : '暂无历史记录'}</div>
              <div className="empty-hint">{historyRecords.length ? '试试其他关键词、模型组合，或者回到工作台继续生成。' : '生成图片后会自动沉淀为可回看的本地资产。'}</div>
            </div>
          )
        : filteredHistory.map(record => (
            <HistoryRecordCard
              key={record.id}
              record={record}
              onRecallHistory={onRecallHistory}
              onRemoveHistory={onRemoveHistory}
            />
          ))}
    </div>
  )
}
