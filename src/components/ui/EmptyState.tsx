import type { ReactNode } from 'react'

type EmptyStateProps = {
  className?: string
  description?: ReactNode
  icon?: ReactNode
  live?: 'polite' | 'assertive'
  title: ReactNode
}

export function EmptyState({ className, description, icon, live, title }: EmptyStateProps) {
  const classes = ['empty', 'ui-empty-state', className].filter(Boolean).join(' ')

  return (
    <section className={classes} aria-live={live}>
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <div className="empty-text">{title}</div>
      {description ? <div className="empty-hint">{description}</div> : null}
    </section>
  )
}
