import type { ReactNode } from 'react'

type SectionHeaderProps = {
  actions?: ReactNode
  className?: string
  description?: ReactNode
  title: ReactNode
}

export function SectionHeader({ actions, className, description, title }: SectionHeaderProps) {
  const classes = ['panel-heading', 'ui-section-header', className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <div>
        <h2>{title}</h2>
        {description ? <div className="panel-caption">{description}</div> : null}
      </div>
      {actions ? <div className="ui-section-header-actions">{actions}</div> : null}
    </div>
  )
}
