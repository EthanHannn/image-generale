import type { HistoryRecord } from '../../lib/storage'
import { useEffect, useRef } from 'react'
import { Icon } from '../../components/Icon'
import type { CropMarginIncomingImage } from '../crop-margin/types'
import { HistoryRecordCard } from './HistoryRecordCard'

type HistoryListProps = {
  historyRecords: HistoryRecord[]
  totalCount: number
  filteredTotal: number
  pageSize: number
  currentPage: number
  totalPages: number
  isLoading: boolean
  historyFavoriteFilter: 'all' | 'favorites'
  favoriteCount: number
  onPageChange: (page: number) => void
  onRecallHistory: (recordId: number) => void | Promise<void>
  onRemoveHistory: (recordId: number, isFavorite?: boolean) => void | Promise<void>
  onToggleFavorite: (recordId: number, nextFavorite: boolean) => void | Promise<void>
  favoritePendingIds: Record<number, boolean>
  onShowToast: (message: string, type: 'success' | 'error') => void
  onSendToCropMargin: (images: CropMarginIncomingImage[]) => void
}

export function HistoryList(props: HistoryListProps) {
  const {
    historyRecords,
    totalCount,
    filteredTotal,
    pageSize,
    currentPage,
    totalPages,
    isLoading,
    historyFavoriteFilter,
    favoriteCount,
    onPageChange,
    onRecallHistory,
    onRemoveHistory,
    onToggleFavorite,
    favoritePendingIds,
    onShowToast,
    onSendToCropMargin,
  } = props
  const pageStart = filteredTotal ? (currentPage - 1) * pageSize + 1 : 0
  const pageEnd = Math.min((currentPage - 1) * pageSize + historyRecords.length, filteredTotal)
  const pageRecordKey = historyRecords.map(record => record.id ?? record.timestamp).join('|')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const emptyText = totalCount
    ? historyFavoriteFilter === 'favorites' && !favoriteCount
      ? '暂无收藏记录'
      : historyFavoriteFilter === 'favorites'
        ? '未找到匹配收藏'
        : '未找到匹配记录'
    : '暂无历史记录'
  const emptyHint = totalCount
    ? historyFavoriteFilter === 'favorites' && !favoriteCount
      ? '在满意的结果上点击星标，就能在这里快速回看。'
      : historyFavoriteFilter === 'favorites'
        ? '试试调整关键词或模型筛选。'
        : '试试其他关键词、模型组合，或者回到工作台继续生成。'
    : '生成图片后会自动沉淀为可回看的本地资产。'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [currentPage, pageRecordKey])

  return (
    <div className="history-list history-list-page">
      {historyRecords.length || filteredTotal > 0
        ? (
            <div className="history-list-window">
              <span>第 {currentPage} / {totalPages} 页 · {pageStart}-{pageEnd} / {filteredTotal} 条</span>
              {isLoading ? <span>更新中...</span> : null}
            </div>
          )
        : null}
      <div className="history-record-scroll" ref={scrollRef}>
        {isLoading && !historyRecords.length
          ? (
              <div className="empty history-empty-state">
                <div className="empty-icon"><span className="spinner" /></div>
                <div className="empty-text">正在加载历史记录</div>
              </div>
            )
          : !historyRecords.length
              ? (
                  <div className="empty history-empty-state">
                    <div className="empty-icon"><Icon name="history" size={34} /></div>
                    <div className="empty-text">{emptyText}</div>
                    <div className="empty-hint">{emptyHint}</div>
                  </div>
                )
              : (
                  <>
              {historyRecords.map(record => (
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
                  </>
                )}
      </div>
      {filteredTotal > 0
        ? (
            <div className="history-pagination">
              <button
                type="button"
                className="history-page-btn"
                disabled={isLoading || currentPage <= 1}
                onClick={() => onPageChange(currentPage - 1)}
              >
                <Icon name="chevronLeft" size={16} />
                上一页
              </button>
              <span>第 {currentPage} / {totalPages} 页</span>
              <button
                type="button"
                className="history-page-btn"
                disabled={isLoading || currentPage >= totalPages}
                onClick={() => onPageChange(currentPage + 1)}
              >
                下一页
                <Icon name="chevronRight" size={16} />
              </button>
            </div>
          )
        : null}
    </div>
  )
}
