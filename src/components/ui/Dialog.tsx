import { useEffect, useRef, type ReactNode } from 'react'

type DialogProps = {
  ariaLabelledBy: string
  children: ReactNode
  contentClassName?: string
  open: boolean
  overlayClassName?: string
  onClose: () => void
}

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function Dialog({ ariaLabelledBy, children, contentClassName, open, overlayClassName, onClose }: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const previousFocusedElementRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open)
      return

    previousFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const content = contentRef.current
    const focusableElements = () => Array.from(content?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])

    if (content && !content.contains(document.activeElement))
      focusableElements()[0]?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab')
        return

      const elements = focusableElements()
      const firstElement = elements[0]
      const lastElement = elements.at(-1)

      if (!firstElement || !lastElement) {
        event.preventDefault()
        content?.focus()
        return
      }

      const activeElement = document.activeElement
      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      }
      else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusedElementRef.current?.focus()
      previousFocusedElementRef.current = null
    }
  }, [open])

  if (!open)
    return null

  function handleOverlayMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget)
      onClose()
  }

  return (
    <div className={overlayClassName} onMouseDown={handleOverlayMouseDown}>
      <div ref={contentRef} className={contentClassName} role="dialog" aria-modal="true" aria-labelledby={ariaLabelledBy} tabIndex={-1}>
        {children}
      </div>
    </div>
  )
}
