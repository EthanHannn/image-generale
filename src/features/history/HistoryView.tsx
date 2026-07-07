import { useEffect, useMemo, useRef, useState } from 'react'
import { formatSize } from '../../lib/utils'
import { getHistoryPage, type HistoryOverview, type HistoryPageQuery, type HistoryRecord, type HistoryStoragePolicy } from '../../lib/storage'
import type { CropMarginIncomingImage } from '../crop-margin/types'
import { HistoryList } from './HistoryList'
import { HistoryToolbar } from './HistoryToolbar'

const HISTORY_PAGE_SIZE = 10

type HistoryViewProps = {
  historyOverview: HistoryOverview
  historyVersion: number
  historySearch: string
  historyModelFilter: string
  historyFavoriteFilter: 'all' | 'favorites'
  historyModeFilter: 'all' | 'gen' | 'edit' | 'upscale'
  storageUsed: number
  storagePolicy: HistoryStoragePolicy
  onHistorySearchChange: (value: string) => void
  onHistoryModelFilterChange: (value: string) => void
  onHistoryFavoriteFilterChange: (value: 'all' | 'favorites') => void
  onHistoryModeFilterChange: (value: 'all' | 'gen' | 'edit' | 'upscale') => void
  onClearHistory: () => void | Promise<void>
  onRecallHistory: (recordId: number) => void | Promise<void>
  onRemoveHistory: (recordId: number) => void | Promise<void>
  onToggleFavorite: (recordId: number, nextFavorite: boolean) => void | Promise<void>
  favoritePendingIds: Record<number, boolean>
  onShowToast: (message: string, type: 'success' | 'error') => void
  onSendToCropMargin: (images: CropMarginIncomingImage[]) => void
}

export function HistoryView(props: HistoryViewProps) {
  const {
    historyOverview,
    historyVersion,
    historySearch,
    historyModelFilter,
    historyFavoriteFilter,
    historyModeFilter,
    storageUsed,
    storagePolicy,
    onHistorySearchChange,
    onHistoryModelFilterChange,
    onHistoryFavoriteFilterChange,
    onHistoryModeFilterChange,
    onClearHistory,
    onRecallHistory,
    onRemoveHistory,
    onToggleFavorite,
    favoritePendingIds,
    onShowToast,
    onSendToCropMargin,
  } = props
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([])
  const [filteredTotal, setFilteredTotal] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageLoading, setPageLoading] = useState(false)
  const filterKeyRef = useRef('')

  const hasStorageLimit = storagePolicy.limitMode === 'limited' && !!storagePolicy.limitBytes
  const storagePercent = hasStorageLimit ? Math.min((storageUsed / storagePolicy.limitBytes!) * 100, 100) : 0
  const modelFilterOptions = historyOverview.modelIds
  const favoriteCount = historyOverview.favoriteCount
  const latestRecord = historyOverview.latestRecord
  const totalImages = historyOverview.totalImages
  const filterKey = `${historySearch}|${historyModelFilter}|${historyFavoriteFilter}|${historyModeFilter}`
  const totalPages = Math.max(1, Math.ceil(filteredTotal / HISTORY_PAGE_SIZE))
  const historyQuery = useMemo<HistoryPageQuery>(() => ({
    search: historySearch,
    modelId: historyModelFilter,
    favoriteOnly: historyFavoriteFilter === 'favorites',
    modeFilter: historyModeFilter,
    offset: (currentPage - 1) * HISTORY_PAGE_SIZE,
    limit: HISTORY_PAGE_SIZE,
  }), [currentPage, historyFavoriteFilter, historyModeFilter, historyModelFilter, historySearch])

  useEffect(() => {
    let cancelled = false
    if (filterKeyRef.current !== filterKey) {
      filterKeyRef.current = filterKey
      if (currentPage !== 1) {
        setCurrentPage(1)
        return () => {
          cancelled = true
        }
      }
    }

    setPageLoading(true)
    void getHistoryPage(historyQuery)
      .then((result) => {
        if (cancelled)
          return
        const nextTotalPages = Math.max(1, Math.ceil(result.totalCount / HISTORY_PAGE_SIZE))
        if (currentPage > nextTotalPages) {
          setCurrentPage(nextTotalPages)
          return
        }
        setHistoryRecords(result.records)
        setFilteredTotal(result.totalCount)
      })
      .catch(() => {
        if (cancelled)
          return
        setHistoryRecords([])
        setFilteredTotal(0)
      })
      .finally(() => {
        if (!cancelled)
          setPageLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [currentPage, filterKey, historyQuery, historyVersion])

  function changeHistoryPage(page: number) {
    if (pageLoading)
      return
    setCurrentPage(Math.min(Math.max(page, 1), totalPages))
  }

  return (
    <div className="view-panel-group">
      <section className="panel panel-large history-view-panel">
        <div className="panel-heading">
          <div>
            <h2>历史记录</h2>
            <div className="panel-caption">集中浏览本地历史结果，支持搜索、筛选、回显与清理。</div>
          </div>
          <div className="result-meta-badge">
            <span>{historyOverview.totalCount} 条</span>
            <span>{formatSize(storageUsed)}</span>
          </div>
        </div>
        <div className="storage-bar-wrap">
          <div className="storage-bar-info">
            <span className="storage-used">
              {hasStorageLimit
                ? `已用 ${formatSize(storageUsed)} / ${formatSize(storagePolicy.limitBytes!)}`
                : `已用 ${formatSize(storageUsed)} · 未设置上限`}
            </span>
            {hasStorageLimit ? <span>{storagePercent.toFixed(1)}%</span> : <span>无限制</span>}
          </div>
          {hasStorageLimit
            ? (
                <div className="storage-bar-track">
                  <div className={`storage-bar-fill ${storagePercent > 95 ? 'danger' : storagePercent > 80 ? 'warn' : ''}`} style={{ width: `${storagePercent}%` }} />
                </div>
              )
            : null}
        </div>
        <div className="history-overview-grid">
          <div className="history-overview-card">
            <span className="history-overview-label">历史资产</span>
            <strong>{historyOverview.totalCount}</strong>
            <span className="history-overview-copy">当前已归档 {totalImages} 张图片，支持回显与二次筛选。</span>
          </div>
          <div className="history-overview-card">
            <span className="history-overview-label">最新记录</span>
            <strong>{latestRecord?.modelId || '暂无记录'}</strong>
            <span className="history-overview-copy history-overview-copy--clamp">{latestRecord?.prompt || '生成图片后会在这里形成可回溯资产。'}</span>
          </div>
          <div className="history-overview-card">
            <span className="history-overview-label">收藏记录</span>
            <strong>{favoriteCount}</strong>
            <span className="history-overview-copy">满意结果会在收藏筛选中集中呈现，并在清理时默认保留。</span>
          </div>
          <div className="history-overview-card">
            <span className="history-overview-label">存储占用</span>
            <strong>{hasStorageLimit ? `${storagePercent.toFixed(1)}%` : formatSize(storageUsed)}</strong>
            <span className="history-overview-copy">
              {hasStorageLimit
                ? `当前上限 ${formatSize(storagePolicy.limitBytes!)}，接近上限时会自动清理最旧未收藏记录。`
                : '当前未设置上限，历史记录不会被自动清理。'}
            </span>
          </div>
        </div>
        <HistoryToolbar
          historySearch={historySearch}
          historyModelFilter={historyModelFilter}
          historyFavoriteFilter={historyFavoriteFilter}
          historyModeFilter={historyModeFilter}
          favoriteCount={favoriteCount}
          modelFilterOptions={modelFilterOptions}
          onHistorySearchChange={onHistorySearchChange}
          onHistoryModelFilterChange={onHistoryModelFilterChange}
          onHistoryFavoriteFilterChange={onHistoryFavoriteFilterChange}
          onHistoryModeFilterChange={onHistoryModeFilterChange}
          onClearHistory={onClearHistory}
        />
        <HistoryList
          historyRecords={historyRecords}
          totalCount={historyOverview.totalCount}
          filteredTotal={filteredTotal}
          pageSize={HISTORY_PAGE_SIZE}
          currentPage={currentPage}
          totalPages={totalPages}
          isLoading={pageLoading}
          historyFavoriteFilter={historyFavoriteFilter}
          favoriteCount={favoriteCount}
          onPageChange={changeHistoryPage}
          onRecallHistory={onRecallHistory}
          onRemoveHistory={onRemoveHistory}
          onToggleFavorite={onToggleFavorite}
          favoritePendingIds={favoritePendingIds}
          onShowToast={onShowToast}
          onSendToCropMargin={onSendToCropMargin}
        />
      </section>
    </div>
  )
}
