import type { ComponentPropsWithoutRef } from 'react'

type ImageActionBarProps = ComponentPropsWithoutRef<'div'> & {
  label: string
}

export function ImageActionBar({ children, className, label, ...props }: ImageActionBarProps) {
  const classes = ['ui-image-action-bar', className].filter(Boolean).join(' ')

  return <div className={classes} role="group" aria-label={label} {...props}>{children}</div>
}
