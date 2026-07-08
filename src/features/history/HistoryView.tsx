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
  const storageSummary = hasStorageLimit
    ? `存储 ${formatSize(storageUsed)} / ${formatSize(storagePolicy.limitBytes!)}`
    : `存储 ${formatSize(storageUsed)} · 无上限`
  const modelFilterOptions = historyOverview.modelIds
  const favoriteCount = historyOverview.favoriteCount
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

  useEffect(() => {
    function handleHistoryKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
        return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
        return
      if (isEditableShortcutTarget(event.target) || document.querySelector('.history-preview-modal, .image-context-menu'))
        return
      if (pageLoading)
        return

      if (event.key === 'ArrowLeft' && currentPage > 1) {
        event.preventDefault()
        changeHistoryPage(currentPage - 1)
        return
      }

      if (event.key === 'ArrowRight' && currentPage < totalPages) {
        event.preventDefault()
        changeHistoryPage(currentPage + 1)
      }
    }

    window.addEventListener('keydown', handleHistoryKeyDown)
    return () => window.removeEventListener('keydown', handleHistoryKeyDown)
  }, [currentPage, pageLoading, totalPages])

  return (
    <div className="view-panel-group">
      <section className="panel panel-large history-view-panel">
        <HistoryToolbar
          historySearch={historySearch}
          historyModelFilter={historyModelFilter}
          historyFavoriteFilter={historyFavoriteFilter}
          historyModeFilter={historyModeFilter}
          totalCount={historyOverview.totalCount}
          favoriteCount={favoriteCount}
          storageSummary={storageSummary}
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

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement))
    return false

  const tagName = target.tagName.toLowerCase()
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}
