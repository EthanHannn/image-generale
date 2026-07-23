import { forwardRef, type ComponentPropsWithoutRef } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', type = 'button', ...props },
  ref,
) {
  const classes = ['ui-button', `ui-button-${variant}`, className].filter(Boolean).join(' ')

  return <button ref={ref} className={classes} type={type} {...props} />
})
