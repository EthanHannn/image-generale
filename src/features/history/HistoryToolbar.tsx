type HistoryToolbarProps = {
  historySearch: string
  historyModelFilter: string
  historyFavoriteFilter: 'all' | 'favorites'
  historyModeFilter: 'all' | 'gen' | 'edit' | 'upscale'
  totalCount: number
  favoriteCount: number
  storageSummary: string
  modelFilterOptions: string[]
  onHistorySearchChange: (value: string) => void
  onHistoryModelFilterChange: (value: string) => void
  onHistoryFavoriteFilterChange: (value: 'all' | 'favorites') => void
  onHistoryModeFilterChange: (value: 'all' | 'gen' | 'edit' | 'upscale') => void
  onClearHistory: () => void | Promise<void>
}

export function HistoryToolbar(props: HistoryToolbarProps) {
  const {
    historySearch,
    historyModelFilter,
    historyFavoriteFilter,
    historyModeFilter,
    totalCount,
    favoriteCount,
    storageSummary,
    modelFilterOptions,
    onHistorySearchChange,
    onHistoryModelFilterChange,
    onHistoryFavoriteFilterChange,
    onHistoryModeFilterChange,
    onClearHistory,
  } = props

  return (
    <div className="history-toolbar-shell">
      <div className="history-toolbar-heading">
        <div>
          <div className="history-toolbar-kicker">Asset Filters</div>
          <strong>快速定位你要回看的结果</strong>
        </div>
        <div className="history-toolbar-actions">
          <span>{storageSummary}</span>
          <button className="dl-btn history-clear-btn" type="button" onClick={() => void onClearHistory()}>清理未收藏</button>
        </div>
      </div>
      <div className="history-toolbar">
        <div className="history-filter-field">
          <span>收藏筛选</span>
          <div className="history-favorite-segment" role="group" aria-label="收藏筛选">
            <button
              className={historyFavoriteFilter === 'all' ? 'active' : ''}
              type="button"
              onClick={() => onHistoryFavoriteFilterChange('all')}
            >
              全部 {totalCount}
            </button>
            <button
              className={historyFavoriteFilter === 'favorites' ? 'active' : ''}
              type="button"
              onClick={() => onHistoryFavoriteFilterChange('favorites')}
            >
              收藏 {favoriteCount}
            </button>
          </div>
        </div>
        <label className="history-filter-field">
          <span>Prompt 搜索</span>
          <input value={historySearch} placeholder="按关键词检索历史描述..." onChange={event => onHistorySearchChange(event.target.value)} />
        </label>
        <label className="history-filter-field history-filter-compact">
          <span>类别筛选</span>
          <select value={historyModeFilter} onChange={event => onHistoryModeFilterChange(event.target.value as 'all' | 'gen' | 'edit' | 'upscale')}>
            <option value="all">全部类别</option>
            <option value="gen">文生图</option>
            <option value="edit">图生图</option>
            <option value="upscale">单独超分</option>
          </select>
        </label>
        <label className="history-filter-field history-filter-compact">
          <span>模型筛选</span>
          <select value={historyModelFilter} onChange={event => onHistoryModelFilterChange(event.target.value)}>
            <option value="">全部模型</option>
            {modelFilterOptions.map(modelId => <option key={modelId} value={modelId}>{modelId}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}
