export type StatusMessageType = 'ok' | 'err' | 'loading' | 'warn'

type StatusMessageProps = {
  message: string
  type: StatusMessageType
}

export function StatusMessage({ message, type }: StatusMessageProps) {
  const role = type === 'err' ? 'alert' : 'status'

  return (
    <div className={`status ${type}`} role={role} aria-live={type === 'err' ? 'assertive' : 'polite'}>
      {type === 'loading' ? <span className="spinner" /> : null}
      <span>{message}</span>
    </div>
  )
}
