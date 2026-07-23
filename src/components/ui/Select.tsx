import { forwardRef, type ComponentPropsWithoutRef } from 'react'

type SelectProps = ComponentPropsWithoutRef<'select'>

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ children, className, ...props }, ref) {
  const classes = ['ui-select', className].filter(Boolean).join(' ')

  return <select ref={ref} className={classes} {...props}>{children}</select>
})
