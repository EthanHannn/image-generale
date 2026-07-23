import type { ComponentPropsWithoutRef, ReactNode } from 'react'

type FieldProps = ComponentPropsWithoutRef<'div'> & {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
}

export function Field({ children, className, error, hint, htmlFor, label, ...props }: FieldProps) {
  const classes = ['ui-field', className].filter(Boolean).join(' ')

  return (
    <div className={classes} {...props}>
      {htmlFor ? <label className="ui-field-label" htmlFor={htmlFor}>{label}</label> : <span className="ui-field-label">{label}</span>}
      <div className="ui-field-control">{children}</div>
      {error ? <div className="ui-field-message ui-field-message-error">{error}</div> : null}
      {!error && hint ? <div className="ui-field-message">{hint}</div> : null}
    </div>
  )
}
