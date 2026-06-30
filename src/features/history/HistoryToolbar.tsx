type HistoryToolbarProps = {
  historySearch: string
  historyModelFilter: string
  modelFilterOptions: string[]
  onHistorySearchChange: (value: string) => void
  onHistoryModelFilterChange: (value: string) => void
  onClearHistory: () => void | Promise<void>
}

export function HistoryToolbar(props: HistoryToolbarProps) {
  const {
    historySearch,
    historyModelFilter,
    modelFilterOptions,
    onHistorySearchChange,
    onHistoryModelFilterChange,
    onClearHistory,
  } = props

  return (
    <div className="history-toolbar-shell">
      <div className="history-toolbar-heading">
        <div>
          <div className="history-toolbar-kicker">Asset Filters</div>
          <strong>快速定位你要回看的结果</strong>
        </div>
        <button className="dl-btn history-clear-btn" type="button" onClick={() => void onClearHistory()}>全部清空</button>
      </div>
      <div className="history-toolbar">
        <label className="history-filter-field">
          <span>Prompt 搜索</span>
          <input value={historySearch} placeholder="按关键词检索历史描述..." onChange={event => onHistorySearchChange(event.target.value)} />
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
