const HISTORY_THUMBNAIL_MAX_WIDTH = 360
const HISTORY_THUMBNAIL_QUALITY = 0.76

export async function createHistoryThumbnails(images: Blob[]) {
  const thumbnails: Blob[] = []
  for (const image of images)
    thumbnails.push(await createHistoryThumbnail(image))
  return thumbnails
}

function createHistoryThumbnail(blob: Blob) {
  return new Promise<Blob>((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      const ratio = image.naturalWidth > HISTORY_THUMBNAIL_MAX_WIDTH ? HISTORY_THUMBNAIL_MAX_WIDTH / image.naturalWidth : 1
      const width = Math.max(1, Math.round(image.naturalWidth * ratio))
      const height = Math.max(1, Math.round(image.naturalHeight * ratio))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) {
        URL.revokeObjectURL(url)
        reject(new Error('缩略图生成失败'))
        return
      }

      context.drawImage(image, 0, 0, width, height)
      canvas.toBlob((thumbnail) => {
        URL.revokeObjectURL(url)
        if (!thumbnail) {
          reject(new Error('缩略图生成失败'))
          return
        }
        resolve(thumbnail)
      }, 'image/webp', HISTORY_THUMBNAIL_QUALITY)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('缩略图生成失败'))
    }
    image.src = url
  })
}
