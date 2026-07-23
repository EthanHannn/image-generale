import { forwardRef, type ComponentPropsWithoutRef } from 'react'

type InputProps = ComponentPropsWithoutRef<'input'>

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, type, ...props }, ref) {
  const shouldUseControlStyle = !['checkbox', 'file', 'radio', 'range'].includes(type ?? 'text')
  const classes = [shouldUseControlStyle ? 'ui-input' : '', className].filter(Boolean).join(' ')

  return <input ref={ref} className={classes} type={type} {...props} />
})
