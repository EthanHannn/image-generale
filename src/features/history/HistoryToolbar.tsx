import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { Input } from '../../components/ui/Input'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Select } from '../../components/ui/Select'

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
          <Button className="history-clear-btn" variant="secondary" onClick={() => void onClearHistory()}>清理未收藏</Button>
        </div>
      </div>
      <div className="history-toolbar">
        <Field className="history-filter-field" label="收藏筛选">
          <SegmentedControl
            ariaLabel="收藏筛选"
            className="history-favorite-segment"
            value={historyFavoriteFilter}
            options={[
              { value: 'all', label: `全部 ${totalCount}` },
              { value: 'favorites', label: `收藏 ${favoriteCount}` },
            ]}
            onValueChange={onHistoryFavoriteFilterChange}
          />
        </Field>
        <Field className="history-filter-field" htmlFor="history-search" label="Prompt 搜索">
          <Input id="history-search" value={historySearch} placeholder="按关键词检索历史描述..." onChange={event => onHistorySearchChange(event.target.value)} />
        </Field>
        <Field className="history-filter-field history-filter-compact" htmlFor="history-mode-filter" label="类别筛选">
          <Select id="history-mode-filter" value={historyModeFilter} onChange={event => onHistoryModeFilterChange(event.target.value as 'all' | 'gen' | 'edit' | 'upscale')}>
            <option value="all">全部类别</option>
            <option value="gen">文生图</option>
            <option value="edit">图生图</option>
            <option value="upscale">单独超分</option>
          </Select>
        </Field>
        <Field className="history-filter-field history-filter-compact" htmlFor="history-model-filter" label="模型筛选">
          <Select id="history-model-filter" value={historyModelFilter} onChange={event => onHistoryModelFilterChange(event.target.value)}>
            <option value="">全部模型</option>
            {modelFilterOptions.map(modelId => <option key={modelId} value={modelId}>{modelId}</option>)}
          </Select>
        </Field>
      </div>
    </div>
  )
}
