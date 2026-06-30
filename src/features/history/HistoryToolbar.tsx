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
    <div className="history-toolbar">
      <input value={historySearch} placeholder="搜索 Prompt..." onChange={event => onHistorySearchChange(event.target.value)} />
      <select value={historyModelFilter} onChange={event => onHistoryModelFilterChange(event.target.value)}>
        <option value="">全部模型</option>
        {modelFilterOptions.map(modelId => <option key={modelId} value={modelId}>{modelId}</option>)}
      </select>
      <button className="dl-btn" type="button" onClick={() => void onClearHistory()}>全部清空</button>
    </div>
  )
}
