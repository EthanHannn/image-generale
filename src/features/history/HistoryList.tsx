import { useEffect, useMemo, useState } from 'react'
import type { HistoryRecord } from '../../lib/storage'
import { Icon } from '../../components/Icon'
import type { CropMarginIncomingImage } from '../crop-margin/types'
import { HistoryRecordCard } from './HistoryRecordCard'

const HISTORY_PAGE_SIZE = 30

type HistoryListProps = {
  historyRecords: HistoryRecord[]
  filteredHistory: HistoryRecord[]
  filterKey: string
  historyFavoriteFilter: 'all' | 'favorites'
  onRecallHistory: (recordId: number) => void | Promise<void>
  onRemoveHistory: (recordId: number) => void | Promise<void>
  onToggleFavorite: (recordId: number, nextFavorite: boolean) => void | Promise<void>
  favoritePendingIds: Record<number, boolean>
  onShowToast: (message: string, type: 'success' | 'error') => void
  onSendToCropMargin: (images: CropMarginIncomingImage[]) => void
}

export function HistoryList(props: HistoryListProps) {
  const {
    historyRecords,
    filteredHistory,
    filterKey,
    historyFavoriteFilter,
    onRecallHistory,
    onRemoveHistory,
    onToggleFavorite,
    favoritePendingIds,
    onShowToast,
    onSendToCropMargin,
  } = props
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE)
  const visibleHistory = useMemo(() => filteredHistory.slice(0, visibleCount), [filteredHistory, visibleCount])
  const hasMore = visibleHistory.length < filteredHistory.length

  useEffect(() => {
    setVisibleCount(HISTORY_PAGE_SIZE)
  }, [filterKey])

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
              <div className="empty-icon"><Icon name="history" size={34} /></div>
              <div className="empty-text">{emptyText}</div>
              <div className="empty-hint">{emptyHint}</div>
            </div>
          )
        : (
            <>
              <div className="history-list-window">
                <span>已显示 {visibleHistory.length} / {filteredHistory.length} 条</span>
                <span>每批 {HISTORY_PAGE_SIZE} 条，减少一次性图片解码压力</span>
              </div>
              {visibleHistory.map(record => (
                <HistoryRecordCard
                  key={record.id}
                  record={record}
                  onRecallHistory={onRecallHistory}
                  onRemoveHistory={onRemoveHistory}
                  onToggleFavorite={onToggleFavorite}
                  favoritePending={record.id === undefined ? false : !!favoritePendingIds[record.id]}
                  onShowToast={onShowToast}
                  onSendToCropMargin={onSendToCropMargin}
                />
              ))}
              {hasMore
                ? (
                    <button
                      type="button"
                      className="history-load-more"
                      onClick={() => setVisibleCount(current => current + HISTORY_PAGE_SIZE)}
                    >
                      加载更多历史记录
                    </button>
                  )
                : null}
            </>
          )}
    </div>
  )
}
