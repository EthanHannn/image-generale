export function base64ToBlob(b64: string) {
  const byteChars = atob(b64)
  const byteNumbers = new Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i += 1)
    byteNumbers[i] = byteChars.charCodeAt(i)
  return new Blob([new Uint8Array(byteNumbers)], { type: 'image/png' })
}

export function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(blob)
  })
}

export function formatSize(bytes: number) {
  if (!bytes)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const value = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${Number.parseFloat((bytes / 1024 ** value).toFixed(1))} ${units[value]}`
}

export function formatTime(timestamp: number) {
  const diff = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = minute * 60
  const day = hour * 24
  if (diff < minute)
    return '刚刚'
  if (diff < hour)
    return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day)
    return `${Math.floor(diff / hour)} 小时前`
  if (diff < day * 7)
    return `${Math.floor(diff / day)} 天前`

  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function sanitizeFilename(value: string) {
  return value.slice(0, 20).replace(/[^\w\u4e00-\u9fa5]/g, '_') || 'image'
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
