import type { HistoryRecord } from '../../lib/storage'
import { HistoryRecordCard } from './HistoryRecordCard'

type HistoryListProps = {
  historyRecords: HistoryRecord[]
  filteredHistory: HistoryRecord[]
  historyFavoriteFilter: 'all' | 'favorites'
  onRecallHistory: (recordId: number) => void | Promise<void>
  onRemoveHistory: (recordId: number) => void | Promise<void>
  onToggleFavorite: (recordId: number, nextFavorite: boolean) => void | Promise<void>
  favoritePendingIds: Record<number, boolean>
}

export function HistoryList(props: HistoryListProps) {
  const {
    historyRecords,
    filteredHistory,
    historyFavoriteFilter,
    onRecallHistory,
    onRemoveHistory,
    onToggleFavorite,
    favoritePendingIds,
  } = props
  const hasFavoriteRecords = historyRecords.some(record => record.isFavorite)
  const emptyText = historyRecords.length
    ? historyFavoriteFilter === 'favorites' && !hasFavoriteRecords
      ? '暂无收藏记录'
      : historyFavoriteFilter === 'favorites'
        ? '未找到匹配收藏'
        : '未找到匹配记录'
    : '暂无历史记录'
  const emptyHint = historyRecords.length
    ? historyFavoriteFilter === 'favorites' && !hasFavoriteRecords
      ? '在满意的结果上点击星标，就能在这里快速回看。'
      : historyFavoriteFilter === 'favorites'
        ? '试试调整关键词或模型筛选。'
        : '试试其他关键词、模型组合，或者回到工作台继续生成。'
    : '生成图片后会自动沉淀为可回看的本地资产。'

  return (
    <div className="history-list history-list-page">
      {!filteredHistory.length
        ? (
            <div className="empty history-empty-state">
              <div className="empty-icon">📚</div>
              <div className="empty-text">{emptyText}</div>
              <div className="empty-hint">{emptyHint}</div>
            </div>
          )
        : filteredHistory.map(record => (
            <HistoryRecordCard
              key={record.id}
              record={record}
              onRecallHistory={onRecallHistory}
              onRemoveHistory={onRemoveHistory}
              onToggleFavorite={onToggleFavorite}
              favoritePending={record.id === undefined ? false : !!favoritePendingIds[record.id]}
            />
          ))}
    </div>
  )
}
