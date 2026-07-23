import type { ReactNode } from 'react'

type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
  disabled?: boolean
}

type SegmentedControlProps<T extends string> = {
  ariaLabel: string
  className?: string
  options: SegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
}

export function SegmentedControl<T extends string>({ ariaLabel, className, onValueChange, options, value }: SegmentedControlProps<T>) {
  const classes = ['ui-segmented-control', className].filter(Boolean).join(' ')

  return (
    <div className={classes} role="group" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.value}
          className={`ui-segmented-control-option${option.value === value ? ' active' : ''}`}
          type="button"
          disabled={option.disabled}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
