export function getErrorMessage(error: unknown, fallback = '未知错误'): string {
  if (error instanceof Error && error.message)
    return error.message
  if (typeof error === 'string' && error.trim())
    return error
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim())
      return message
    try {
      const text = JSON.stringify(error)
      if (text && text !== '{}')
        return text
    }
    catch {}
  }
  return fallback
}
