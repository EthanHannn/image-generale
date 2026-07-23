import { useEffect, useRef, type ReactNode } from 'react'

type ContextMenuItem = {
  id: string
  label: ReactNode
  disabled?: boolean
  onSelect: () => void
}

type ContextMenuProps = {
  backdropClassName?: string
  items: ContextMenuItem[]
  x: number
  y: number
  onClose: () => void
}

export function ContextMenu({ backdropClassName, items, onClose, x, y }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const previousFocusedElementRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    previousFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const menu = menuRef.current
    const getMenuItems = () => Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
    const frame = window.requestAnimationFrame(() => getMenuItems()[0]?.focus())

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented)
        return

      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key === 'Tab') {
        onCloseRef.current()
        return
      }

      if (!['ArrowDown', 'ArrowUp', 'End', 'Home'].includes(event.key))
        return

      const menuItems = getMenuItems()
      if (!menuItems.length)
        return

      event.preventDefault()
      const activeIndex = menuItems.findIndex(item => item === document.activeElement)
      if (event.key === 'Home') {
        menuItems[0].focus()
        return
      }
      if (event.key === 'End') {
        menuItems.at(-1)?.focus()
        return
      }

      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = activeIndex < 0
        ? 0
        : (activeIndex + direction + menuItems.length) % menuItems.length
      menuItems[nextIndex].focus()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusedElementRef.current?.focus()
      previousFocusedElementRef.current = null
    }
  }, [])

  const backdropClasses = ['image-context-menu-backdrop', backdropClassName].filter(Boolean).join(' ')

  return (
    <div
      className={backdropClasses}
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={menuRef}
        className="image-context-menu"
        role="menu"
        aria-label="图片操作"
        style={{ left: x, top: y }}
        onClick={event => event.stopPropagation()}
        onContextMenu={event => event.preventDefault()}
      >
        {items.map(item => (
          <button key={item.id} type="button" role="menuitem" disabled={item.disabled} onClick={item.onSelect}>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
