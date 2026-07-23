import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export type SelectOption = {
  label: string
  value: string
  disabled?: boolean
}

type SelectProps = {
  ariaLabel?: string
  className?: string
  disabled?: boolean
  id?: string
  options: SelectOption[]
  value: string
  onValueChange: (value: string) => void
}

export function Select({ ariaLabel, className, disabled = false, id, options, value, onValueChange }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pendingFocusIndexRef = useRef<number | null>(null)
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))
  const selectedOption = options[selectedIndex]
  const classes = ['ui-select', isOpen ? 'is-open' : '', className].filter(Boolean).join(' ')

  useEffect(() => {
    if (!isOpen)
      return

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node))
        setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen)
      return

    const focusIndex = pendingFocusIndexRef.current ?? selectedIndex
    pendingFocusIndexRef.current = null
    const frame = window.requestAnimationFrame(() => focusOption(focusIndex))
    return () => window.cancelAnimationFrame(frame)
  }, [isOpen, selectedIndex])

  function selectOption(index: number) {
    const option = options[index]
    if (!option || option.disabled)
      return
    onValueChange(option.value)
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  function focusOption(index: number) {
    const optionCount = options.length
    if (!optionCount)
      return

    let nextIndex = index
    for (let attempts = 0; attempts < optionCount; attempts += 1) {
      const option = options[(nextIndex + optionCount) % optionCount]
      if (!option.disabled) {
        optionRefs.current[(nextIndex + optionCount) % optionCount]?.focus()
        return
      }
      nextIndex += 1
    }
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      pendingFocusIndexRef.current = selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)
      setIsOpen(true)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setIsOpen(current => !current)
      return
    }

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      setIsOpen(false)
    }
  }

  function handleOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setIsOpen(false)
      triggerRef.current?.focus()
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusOption(index + (event.key === 'ArrowDown' ? 1 : -1))
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusOption(event.key === 'Home' ? 0 : options.length - 1)
      return
    }

    if (event.key === 'Tab')
      setIsOpen(false)
  }

  return (
    <div ref={rootRef} className={classes}>
      <button
        ref={triggerRef}
        id={id}
        className="ui-select-trigger"
        type="button"
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen(current => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedOption?.label || '请选择'}</span>
      </button>
      {isOpen
        ? (
            <div id={listId} className="ui-select-menu" role="listbox" aria-label={ariaLabel}>
              {options.map((option, index) => (
                <button
                  key={option.value}
                  ref={(element) => { optionRefs.current[index] = element }}
                  className={`ui-select-option${option.value === value ? ' active' : ''}`}
                  type="button"
                  role="option"
                  disabled={option.disabled}
                  aria-selected={option.value === value}
                  onClick={() => selectOption(index)}
                  onKeyDown={event => handleOptionKeyDown(event, index)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )
        : null}
    </div>
  )
}
